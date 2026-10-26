"""Patient registration, duplicate detection, card issuing."""

from __future__ import annotations

import hashlib
from datetime import timedelta

from django.conf import settings

from apps.core.documents import ClinicSettings
from apps.core.exceptions import APIError, Conflict
from apps.core.files import resolve_upload_path
from apps.core.utils import (
    generate_id,
    normalize_name,
    normalize_phone,
    now_utc,
    random_token,
)
from apps.patients.documents import Patient, PatientChangeLog, PatientIDCard

TRACKED_FIELDS = (
    "full_name", "date_of_birth", "sex", "phone", "email", "address",
    "blood_group", "known_allergies", "existing_conditions", "status",
    "next_of_kin_name", "next_of_kin_phone", "insurance_provider", "insurance_number",
)


def generate_patient_number() -> str:
    for _ in range(20):
        candidate = generate_id("PT", pad=6)
        if not Patient.objects(patient_number=candidate).first():
            return candidate
    raise RuntimeError("Unable to allocate patient number")


def find_duplicates(*, full_name: str, phone: str = "", date_of_birth=None,
                    email: str = "", exclude_id: str | None = None) -> list[dict]:
    """Fuzzy duplicate detection so front-desk staff can review before saving.

    Matching rules (any of):
      * same normalised phone number
      * same normalised full name AND same date of birth
      * same normalised full name AND (same email or same year of birth)
    """
    name_norm = normalize_name(full_name)
    phone_norm = normalize_phone(phone)
    matches: dict[str, Patient] = {}

    if phone_norm:
        for p in Patient.objects(phone_normalized=phone_norm, status__ne="deceased").limit(10):
            matches[str(p.id)] = p
    if name_norm:
        for p in Patient.objects(full_name_lower=name_norm).limit(10):
            matches[str(p.id)] = p
        # token overlap for near-matches (e.g. "Aisha Bello" vs "Aisha B. Bello")
        tokens = [t for t in name_norm.split() if len(t) > 2]
        if tokens:
            raw = {"$and": [
                {"full_name_lower": {"$regex": t}} for t in tokens[:3]
            ]}
            for p in Patient.objects(__raw__=raw, status__ne="deceased").limit(10):
                matches[str(p.id)] = p

    results = []
    for pid, patient in matches.items():
        if exclude_id and str(patient.id) == str(exclude_id):
            continue
        score, reasons = _similarity(
            patient, name_norm=name_norm, phone_norm=phone_norm,
            date_of_birth=date_of_birth, email=(email or "").strip().lower(),
        )
        if score >= 40:
            results.append({
                "id": str(patient.id),
                "patient_number": patient.patient_number,
                "full_name": patient.full_name,
                "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
                "phone": patient.phone,
                "sex": patient.sex,
                "status": patient.status,
                "registration_date": patient.registration_date,
                "score": score,
                "reasons": reasons,
            })
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:8]


def _similarity(patient: Patient, *, name_norm: str, phone_norm: str,
                date_of_birth, email: str) -> tuple[int, list[str]]:
    score = 0
    reasons = []
    if phone_norm and patient.phone_normalized == phone_norm:
        score += 60
        reasons.append("Same phone number")
    if name_norm and patient.full_name_lower == name_norm:
        score += 45
        reasons.append("Identical full name")
    elif name_norm and patient.full_name_lower:
        a, b = set(name_norm.split()), set(patient.full_name_lower.split())
        overlap = len(a & b) / max(1, len(a | b))
        if overlap >= 0.5:
            score += int(30 * overlap)
            reasons.append("Similar name")
    if date_of_birth and patient.date_of_birth and patient.date_of_birth == date_of_birth:
        score += 30
        reasons.append("Same date of birth")
    elif date_of_birth and patient.date_of_birth and patient.date_of_birth.year == date_of_birth.year:
        score += 10
        reasons.append("Same birth year")
    if email and patient.email and patient.email.lower() == email:
        score += 20
        reasons.append("Same email")
    return min(100, score), reasons


def record_changes(patient: Patient, before: dict, after: dict, actor, reason: str = "") -> list[dict]:
    changes = []
    for field in TRACKED_FIELDS:
        if field not in after:
            continue
        old, new = before.get(field), after.get(field)
        if str(old or "") != str(new or ""):
            changes.append({"field": field, "from": str(old or ""), "to": str(new or "")})
    if changes:
        PatientChangeLog(
            patient_doc_id=str(patient.id),
            changed_by=str(actor.id),
            changed_by_name=actor.full_name,
            changed_by_role=actor.role,
            changes=changes,
            reason=reason,
        ).save()
    return changes


def issue_patient_card(patient: Patient, *, issued_by=None, validity_months: int = 60,
                       reason: str = "initial_issue") -> tuple[PatientIDCard, str]:
    token = random_token(32)
    settings_doc = ClinicSettings.load()
    card = PatientIDCard(
        patient_doc_id=str(patient.id),
        patient_number=patient.patient_number,
        patient_name=patient.full_name,
        card_number=generate_id("PC"),
        token=token,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        token_prefix=token[:8],
        status="active",
        issued_at=now_utc(),
        expires_at=now_utc() + timedelta(days=int(validity_months * 30.44)),
        issued_by=str(getattr(issued_by, "id", "") or ""),
        issued_by_name=getattr(issued_by, "full_name", "") or "",
    )
    card.save()
    for old in PatientIDCard.objects(patient_doc_id=str(patient.id), status="active",
                                     id__ne=card.id):
        old.status = "replaced"
        old.revoked_at = now_utc()
        old.revoked_reason = f"Replaced by {card.card_number} ({reason})"
        old.save()
    return card, token


def patient_card_pdf_data(patient: Patient, card: PatientIDCard) -> dict:
    settings_doc = ClinicSettings.load()
    photo_path = None
    if (patient.photo or {}).get("file_id"):
        photo_path = resolve_upload_path("photo", patient.photo["file_id"])
    verify_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/verify/patient/{card.token}"
    return {
        "kind": "patient",
        "card_type_label": "PATIENT IDENTIFICATION CARD",
        "card_number_label": card.card_number,
        "clinic_name": settings_doc.clinic_name,
        "clinic_address": settings_doc.address,
        "clinic_phone": settings_doc.phone,
        "clinic_email": settings_doc.email,
        "clinic_website": settings_doc.website,
        "clinic_contact": f"{settings_doc.phone}  •  {settings_doc.email}",
        "logo_path": None,
        "photo_path": photo_path,
        "signature_path": None,
        "full_name": patient.full_name,
        "job_title": f"Patient • {patient.sex.upper()[:1] + patient.sex[1:] if patient.sex else ''}",
        "department_label": f"Registered {patient.registration_date.strftime('%d %b %Y') if patient.registration_date else ''}"
                            f" • Blood group: {patient.blood_group or 'not recorded'}",
        "id_label": "PATIENT NO",
        "identifier": patient.patient_number,
        "secondary_line": (f"Allergies: {patient.known_allergies[:60]}" if patient.known_allergies
                           else "Allergies: none recorded"),
        "qr_payload": verify_url,
        "issued_on": card.issued_at.strftime("%d %b %Y") if card.issued_at else "—",
        "expires_on": card.expires_at.strftime("%d %b %Y") if card.expires_at else "—",
        "card_status_label": card.status.upper(),
        "contact_line": f"{settings_doc.phone} • {settings_doc.email}",
        "back_notes": settings_doc.patient_card_footer,
        "emergency_line": (
            f"{patient.emergency_contact_name or patient.next_of_kin_name or 'Clinic reception'} — "
            f"{patient.emergency_contact_phone or patient.next_of_kin_phone or settings_doc.phone}"
        ),
    }


def patient_verification_payload(card: PatientIDCard, *, record_scan: bool = True) -> dict:
    """Public payload: identity confirmation only. No clinical information."""
    patient = Patient.objects(id=card.patient_doc_id).first()
    if not patient:
        return {"valid": False, "reason": "The patient record linked to this card no longer exists."}
    reasons = []
    if card.status != "active":
        reasons.append(f"Card status is '{card.status}'.")
    if card.expires_at and card.expires_at < now_utc():
        reasons.append("Card has expired.")
    if patient.status not in {"active", "inactive"}:
        reasons.append(f"Patient record status is '{patient.status}'.")
    if record_scan:
        card.scan_count = (card.scan_count or 0) + 1
        card.save()
    return {
        "valid": not reasons,
        "reasons": reasons,
        "kind": "patient",
        "clinic_name": ClinicSettings.load().clinic_name,
        "full_name": patient.full_name,
        "patient_number": patient.patient_number,
        "photo_url": patient.photo_url,
        "sex": patient.sex,
        "card_status": card.status,
        "card_number": card.card_number,
        "issued_at": card.issued_at,
        "expires_at": card.expires_at,
        "notice": "This page confirms identity only. Clinical records are not available here.",
    }


def deregister_patient(patient, *, status: str = "inactive", reason: str, actor, request=None,
                       source_request=None) -> dict:
    """Close a patient record and revoke any live ID card.

    Clinic administrators only — enforced by the caller. Nothing is deleted: the
    record keeps its history, its appointments and its medical notes, and the
    reason is stored on the patient plus in the audit log.
    """
    from apps.core.audit import log_action

    if patient.status not in {"active"}:
        raise Conflict(
            f"This patient record is already {patient.status}.", code="already_deregistered"
        )
    if status not in {"inactive", "deceased", "transferred"}:
        raise APIError("Unsupported deregistration status.", code="invalid_status",
                       status_code=400)

    revoked_cards = 0
    for card in PatientIDCard.objects(patient_doc_id=str(patient.id), status="active"):
        card.status = "revoked"
        card.revoked_at = now_utc()
        card.revoked_reason = f"Deregistered: {reason[:180]}"
        card.save()
        revoked_cards += 1

    patient.status = status
    patient.deregistration = {
        "reason": reason,
        "status": status,
        "by": str(actor.id),
        "by_name": getattr(actor, "full_name", ""),
        "at": now_utc(),
        "request_id": str(source_request.id) if source_request else "",
    }
    patient.updated_by = str(actor.id)
    patient.updated_at = now_utc()
    patient.save()

    log_action(action="patient.deregistered", request=request, actor=actor,
               target_type="patient", target_id=str(patient.id),
               description=f"{patient.patient_number} set to {status}: {reason[:180]}")
    return {
        "status": status,
        "revoked_cards": revoked_cards,
        "reason": reason,
    }
