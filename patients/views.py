from __future__ import annotations

import logging
import re

from django.conf import settings as dj_settings
from django.http import HttpResponse
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.throttles import QRScanThrottle, WriteThrottle
from apps.core.audit import log_action
from apps.core.documents import ClinicSettings
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.files import save_upload
from apps.core.pdf import render_id_card_pdf
from apps.core.permissions import Role, can_view_medical_record, require_roles
from apps.core.utils import normalize_name, normalize_phone, now_utc, paginate, parse_bool
from apps.patients.documents import (
    Patient,
    PatientChangeLog,
    PatientDeregistrationRequest,
    PatientIDCard,
)
from apps.patients.serializers import PatientCreateSerializer, PatientUpdateSerializer
from apps.patients.services import (
    find_duplicates,
    issue_patient_card,
    patient_card_pdf_data,
    deregister_patient,
    patient_verification_payload,
    record_changes,
)

logger = logging.getLogger(__name__)


def _patient_or_404(patient_ref: str) -> Patient:
    patient = Patient.objects(patient_number=patient_ref).first()
    if not patient and len(patient_ref) == 24:
        try:
            patient = Patient.objects(id=patient_ref).first()
        except Exception:  # noqa: BLE001 - invalid ObjectId
            patient = None
    if not patient:
        raise NotFound("Patient not found.")
    return patient


def _serialize_patient(patient: Patient, user) -> dict:
    clinical = can_view_medical_record(user, patient)
    data = patient.to_dict() if clinical else patient.to_summary()
    data["can_view_medical"] = clinical
    if not clinical:
        data["clinical_fields_restricted"] = True
    return data


class PatientListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    def get(self, request):
        require_roles(request.user, *Role.PATIENT_READ_ROLES)
        p = request.query_params
        qs = Patient.objects()
        search = (p.get("search") or "").strip()
        if search:
            digits = re.sub(r"\D", "", search)
            clauses = [
                {"full_name": {"$regex": re.escape(search), "$options": "i"}},
                {"patient_number": {"$regex": re.escape(search), "$options": "i"}},
                {"phone": {"$regex": re.escape(search), "$options": "i"}},
                {"email": {"$regex": re.escape(search), "$options": "i"}},
            ]
            if digits:
                clauses.append({"phone_normalized": {"$regex": digits}})
            qs = qs.filter(__raw__={"$or": clauses})
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("sex"):
            qs = qs.filter(sex=p["sex"])
        if parse_bool(p.get("include_duplicates"), False) is False:
            qs = qs.filter(duplicate_of="")
        if p.get("start") or p.get("end"):
            from apps.core.utils import date_range_bounds

            start, end = date_range_bounds(p.get("start"), p.get("end"))
            if start:
                qs = qs.filter(registration_date__gte=start)
            if end:
                qs = qs.filter(registration_date__lt=end)
        qs = qs.order_by("-registration_date")
        return Response(paginate(qs, p.get("page"), p.get("page_size"),
                                 lambda x: _serialize_patient(x, request.user)))

    def post(self, request):
        require_roles(request.user, *Role.PATIENT_REGISTER_ROLES)
        serializer = PatientCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        confirm = data.pop("confirm_not_duplicate", False)

        duplicates = find_duplicates(
            full_name=data["full_name"], phone=data.get("phone", ""),
            date_of_birth=data.get("date_of_birth"), email=data.get("email", ""),
        )
        strong = [d for d in duplicates if d["score"] >= 60]
        if strong and not confirm:
            return Response({
                "error": {
                    "code": "possible_duplicate",
                    "message": "Possible existing patient record(s) found. Review before registering.",
                    "details": {"duplicates": duplicates},
                }
            }, status=409)

        phone_norm = normalize_phone(data.get("phone"))
        patient = Patient(
            patient_number=generate_number(),
            full_name=data["full_name"],
            full_name_lower=normalize_name(data["full_name"]),
            date_of_birth=data.get("date_of_birth"),
            estimated_age=data.get("estimated_age"),
            sex=data.get("sex", ""),
            phone=data.get("phone", ""),
            phone_normalized=phone_norm,
            email=(data.get("email") or "").lower(),
            address=data.get("address", ""),
            national_id=data.get("national_id", ""),
            emergency_contact_name=data.get("emergency_contact_name", ""),
            emergency_contact_phone=data.get("emergency_contact_phone", ""),
            next_of_kin_name=data.get("next_of_kin_name", ""),
            next_of_kin_relationship=data.get("next_of_kin_relationship", ""),
            next_of_kin_phone=data.get("next_of_kin_phone", ""),
            blood_group=data.get("blood_group", ""),
            known_allergies=data.get("known_allergies", ""),
            existing_conditions=data.get("existing_conditions", ""),
            status=data.get("status", "active"),
            insurance_provider=data.get("insurance_provider", ""),
            insurance_number=data.get("insurance_number", ""),
            created_by=str(request.user.id),
            created_by_name=request.user.full_name,
        )
        patient.save()

        if request.FILES.get("photo"):
            try:
                patient.photo = save_upload(request.FILES["photo"], kind="photo",
                                            owner_ref=patient.patient_number)
                patient.save()
            except ValueError as exc:
                patient.delete()
                raise APIError(str(exc), code="invalid_upload", status_code=400) from exc

        # Registration issues the QR identification card straight away so the
        # patient leaves the desk with a printable card. Failure to issue must
        # never lose the registration itself.
        card_issued = False
        try:
            issue_patient_card(patient, issued_by=request.user, reason="registration")
            card_issued = True
        except Exception:  # noqa: BLE001 - card issuance is best-effort here
            logger.warning("Could not auto-issue patient card for %s", patient.patient_number,
                           exc_info=True)

        log_action(action="patient.registered", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(patient.id),
                   description=f"Registered {patient.patient_number}",
                   meta={"overrode_duplicate_warning": bool(strong and confirm),
                         "card_issued": card_issued})
        return Response({"patient": _serialize_patient(patient, request.user),
                         "duplicates": duplicates}, status=201)


def generate_number() -> str:
    from apps.patients.services import generate_patient_number

    return generate_patient_number()


class PatientDuplicateCheckView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.PATIENT_REGISTER_ROLES)
        name = (request.query_params.get("full_name") or "").strip()
        if len(name) < 2:
            return Response({"duplicates": []})
        duplicates = find_duplicates(
            full_name=name,
            phone=request.query_params.get("phone", ""),
            date_of_birth=request.query_params.get("date_of_birth") or None,
            email=request.query_params.get("email", ""),
        )
        return Response({"duplicates": duplicates})


class PatientDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        require_roles(request.user, *Role.PATIENT_READ_ROLES)
        patient = _patient_or_404(patient_ref)
        if request.user.role == Role.LAB_SCIENTIST:
            from apps.laboratory.documents import LabRequest

            if not LabRequest.objects(patient_doc_id=str(patient.id)).first():
                raise Forbidden("Laboratory staff may only view patients with laboratory requests.")
        payload = _serialize_patient(patient, request.user)

        from apps.appointments.documents import Appointment
        from apps.medical_records.documents import Consultation
        from apps.patients.documents import PatientIDCard as Card

        payload["stats"] = {
            "consultations": Consultation.objects(patient_doc_id=str(patient.id)).count(),
            "appointments": Appointment.objects(patient_doc_id=str(patient.id)).count(),
            "last_consultation_at": (
                Consultation.objects(patient_doc_id=str(patient.id)).order_by("-consulted_at")
                .first().consulted_at
                if Consultation.objects(patient_doc_id=str(patient.id)).count() else None
            ),
        }
        payload["active_card"] = (
            Card.objects(patient_doc_id=str(patient.id), status="active").first().to_dict()
            if Card.objects(patient_doc_id=str(patient.id), status="active").first() else None
        )
        payload["change_history"] = [
            {"changes": c.changes, "reason": c.reason, "changed_by_name": c.changed_by_name,
             "changed_by_role": c.changed_by_role, "created_at": c.created_at}
            for c in PatientChangeLog.objects(patient_doc_id=str(patient.id))
            .order_by("-created_at").limit(20)
        ] if can_view_medical_record(request.user, patient) else []
        return Response({"patient": payload})

    def patch(self, request, patient_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST,
                      Role.NURSE, Role.DOCTOR)
        patient = _patient_or_404(patient_ref)
        serializer = PatientUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        reason = data.pop("change_reason", "")
        before = {f: getattr(patient, f, None) for f in
                  ("full_name", "date_of_birth", "sex", "phone", "email", "address",
                   "blood_group", "known_allergies", "existing_conditions", "status",
                   "next_of_kin_name", "next_of_kin_phone", "insurance_provider", "insurance_number")}
        # Clinical fields may only be amended by clinical roles / admins
        clinical_fields = {"blood_group", "known_allergies", "existing_conditions"}
        if clinical_fields & set(data) and not can_view_medical_record(request.user, patient):
            raise Forbidden("Your role cannot modify clinical patient information.")

        for field, value in data.items():
            if field == "full_name":
                patient.full_name = " ".join(value.split())
                patient.full_name_lower = normalize_name(value)
            elif field == "phone":
                patient.phone = value
                patient.phone_normalized = normalize_phone(value)
            elif field == "email":
                patient.email = (value or "").lower()
            else:
                setattr(patient, field, value)
        patient.updated_by = str(request.user.id)
        patient.updated_at = now_utc()
        patient.save()
        changes = record_changes(patient, before, data, request.user, reason)
        log_action(action="patient.updated", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(patient.id),
                   description=f"Updated fields: {', '.join(c['field'] for c in changes) or 'none'}",
                   meta={"fields": [c["field"] for c in changes], "reason": reason})
        return Response({"patient": _serialize_patient(patient, request.user), "changes": changes})


class PatientPhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, patient_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST,
                      Role.NURSE, Role.DOCTOR)
        patient = _patient_or_404(patient_ref)
        upload = request.FILES.get("photo")
        if not upload:
            raise APIError("Attach a file in the 'photo' field.", code="missing_file", status_code=400)
        try:
            patient.photo = save_upload(upload, kind="photo", owner_ref=patient.patient_number)
        except ValueError as exc:
            raise APIError(str(exc), code="invalid_upload", status_code=400) from exc
        patient.save()
        log_action(action="patient.photo_updated", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(patient.id))
        return Response({"message": "Photograph updated.", "patient": patient.to_summary()})


class PatientMergeView(APIView):
    """Mark a duplicate record as merged into a canonical record (no data loss)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, patient_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        patient = _patient_or_404(patient_ref)
        canonical_ref = (request.data or {}).get("canonical_patient_number", "")
        if not canonical_ref or canonical_ref == patient.patient_number:
            raise APIError("Provide a different canonical patient number.",
                           code="invalid_target", status_code=400)
        canonical = _patient_or_404(canonical_ref)
        if patient.duplicate_of:
            raise Conflict("This record is already marked as a duplicate.", code="already_merged")
        patient.duplicate_of = canonical.patient_number
        patient.status = "inactive"
        patient.save()
        canonical.merged_from = list(canonical.merged_from or []) + [patient.patient_number]
        canonical.save()
        for card in PatientIDCard.objects(patient_doc_id=str(patient.id), status="active"):
            card.status = "revoked"
            card.revoked_at = now_utc()
            card.revoked_reason = f"Merged into {canonical.patient_number}"
            card.save()
        log_action(action="patient.merged", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(canonical.id),
                   description=f"{patient.patient_number} merged into {canonical.patient_number}")
        return Response({"message": f"{patient.patient_number} marked as a duplicate of {canonical.patient_number}.",
                         "patient": patient.to_summary()})



# ------------------------------------------------------- deregistration
class PatientDeregistrationRequestView(APIView):
    """Receptionist raises the request; clinic administrator decides it."""

    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        require_roles(request.user, *Role.PATIENT_DEREGISTRATION_VIEW_ROLES)
        patient = _patient_or_404(patient_ref)
        requests = PatientDeregistrationRequest.objects(
            patient_doc_id=str(patient.id)
        ).order_by("-requested_at")
        return Response({
            "requests": [r.to_dict() for r in requests],
            "patient": patient.to_summary(),
            "current_status": patient.status,
        })

    def post(self, request, patient_ref):
        # Only a receptionist may raise a deregistration request.
        require_roles(request.user, *Role.PATIENT_DEREGISTRATION_REQUEST_ROLES)
        patient = _patient_or_404(patient_ref)
        reason = str((request.data or {}).get("reason", "")).strip()
        if len(reason) < 10:
            raise APIError(
                "Explain why this patient should be deregistered (at least 10 characters).",
                code="reason_required",
                status_code=400,
            )
        if patient.status != "active":
            raise Conflict(
                f"This patient record is already {patient.status}.", code="not_active"
            )
        existing = PatientDeregistrationRequest.objects(
            patient_doc_id=str(patient.id), status="pending"
        ).first()
        if existing:
            raise Conflict(
                "A deregistration request for this patient is already awaiting a decision.",
                code="request_pending",
            )
        record = PatientDeregistrationRequest(
            patient_doc_id=str(patient.id),
            patient_number=patient.patient_number,
            patient_name=patient.full_name,
            requested_status=str((request.data or {}).get("requested_status", "inactive")),
            reason=reason,
            requested_by=str(request.user.id),
            requested_by_name=getattr(request.user, "full_name", ""),
        )
        record.save()
        log_action(action="patient.deregistration_requested", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id),
                   description=f"Requested deregistration of {patient.patient_number}: {reason[:160]}")
        return Response({"request": record.to_dict()}, status=201)


class PatientDeregistrationDecisionView(APIView):
    """Approve or reject a deregistration request. Clinic administrators only."""

    permission_classes = [IsAuthenticated]

    def post(self, request, patient_ref, request_id):
        require_roles(request.user, *Role.PATIENT_DEREGISTER_ROLES)
        patient = _patient_or_404(patient_ref)
        record = PatientDeregistrationRequest.objects(
            id=request_id, patient_doc_id=str(patient.id)
        ).first()
        if not record:
            raise NotFound("Deregistration request not found for this patient.")
        if record.status != "pending":
            raise Conflict(f"This request was already {record.status}.", code="already_decided")

        decision = str((request.data or {}).get("decision", "")).strip().lower()
        note = str((request.data or {}).get("note", "")).strip()
        if decision not in {"approve", "reject"}:
            raise APIError("Decision must be 'approve' or 'reject'.", code="invalid_decision",
                           status_code=400)
        if decision == "reject" and not note:
            raise APIError("Give a reason when rejecting a deregistration request.",
                           code="reason_required", status_code=400)

        record.decided_by = str(request.user.id)
        record.decided_by_name = getattr(request.user, "full_name", "")
        record.decided_at = now_utc()
        record.decision_note = note

        if decision == "reject":
            record.status = "rejected"
            record.save()
            log_action(action="patient.deregistration_rejected", request=request,
                       actor=request.user, target_type="patient", target_id=str(patient.id),
                       description=f"Rejected deregistration of {patient.patient_number}: {note[:160]}")
            return Response({"request": record.to_dict()})

        outcome = deregister_patient(
            patient,
            status=record.requested_status,
            reason=record.reason,
            actor=request.user,
            request=request,
            source_request=record,
        )
        record.status = "approved"
        record.save()
        log_action(action="patient.deregistration_approved", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id),
                   description=f"Approved deregistration of {patient.patient_number}")
        return Response({
            "request": record.to_dict(),
            "patient": patient.to_summary(),
            "outcome": outcome,
        })


class PatientDeregisterView(APIView):
    """Direct deregistration by a clinic administrator (no prior request needed)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, patient_ref):
        require_roles(request.user, *Role.PATIENT_DEREGISTER_ROLES)
        patient = _patient_or_404(patient_ref)
        reason = str((request.data or {}).get("reason", "")).strip()
        status = str((request.data or {}).get("status", "inactive")).strip().lower()
        if len(reason) < 10:
            raise APIError("A reason of at least 10 characters is required.",
                           code="reason_required", status_code=400)
        outcome = deregister_patient(patient, status=status, reason=reason, actor=request.user,
                                     request=request)
        return Response({
            "message": f"{patient.patient_number} is now {patient.status}.",
            "patient": patient.to_summary(),
            "outcome": outcome,
        })


class DeregistrationQueueView(APIView):
    """Pending deregistration requests, for the clinic administrator's queue."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
        qs = PatientDeregistrationRequest.objects()
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        if request.user.role == Role.RECEPTIONIST:
            # A receptionist sees only what they raised.
            qs = qs.filter(requested_by=str(request.user.id))
        qs = qs.order_by("-requested_at")
        rows = [r.to_dict() for r in qs.limit(200)]
        return Response({
            "requests": rows,
            "pending_count": sum(1 for r in rows if r["status"] == "pending"),
        })


# ------------------------------------------------------------------- cards
class PatientIDCardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        require_roles(request.user, *Role.PATIENT_READ_ROLES)
        patient = _patient_or_404(patient_ref)
        cards = PatientIDCard.objects(patient_doc_id=str(patient.id)).order_by("-issued_at")
        show_secret = request.user.role in {Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST}
        return Response({"cards": [c.to_dict(include_secret=show_secret) for c in cards]})

    def post(self, request, patient_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
        patient = _patient_or_404(patient_ref)
        if patient.status not in {"active", "inactive"}:
            raise Conflict("Cannot issue a card for a patient with status " + patient.status,
                           code="patient_not_eligible")
        reason = (request.data or {}).get("reason", "issue")
        card, _token = issue_patient_card(patient, issued_by=request.user, reason=reason)
        log_action(action="patient.card_issued", request=request, actor=request.user,
                   target_type="patient_id_card", target_id=str(card.id),
                   patient_id=str(patient.id), description=f"Issued card {card.card_number}")
        return Response({"card": card.to_dict(include_secret=True)}, status=201)


class PatientCardRevokeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, patient_ref, card_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
        patient = _patient_or_404(patient_ref)
        card = PatientIDCard.objects(id=card_id, patient_doc_id=str(patient.id)).first()
        if not card:
            raise NotFound("Card not found for this patient.")
        reason = ((request.data or {}).get("reason") or "").strip()
        if len(reason) < 4:
            raise APIError("A reason of at least 4 characters is required.", code="reason_required",
                           status_code=400)
        if card.status != "active":
            raise Conflict("Only an active card can be revoked.", code="card_not_active")
        card.status = "revoked"
        card.revoked_at = now_utc()
        card.revoked_reason = reason[:300]
        card.save()
        log_action(action="patient.card_revoked", request=request, actor=request.user,
                   target_type="patient_id_card", target_id=str(card.id),
                   patient_id=str(patient.id), description=f"Revoked {card.card_number}: {reason}")
        return Response({"message": f"Card {card.card_number} revoked.", "card": card.to_dict()})


class PatientCardPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
        patient = _patient_or_404(patient_ref)
        card = PatientIDCard.objects(patient_doc_id=str(patient.id), status="active").first()
        if not card:
            raise NotFound("No active card. Issue one first.")
        from apps.core.files import qr_data_uri

        verify_url = f"{dj_settings.FRONTEND_BASE_URL.rstrip('/')}/verify/patient/{card.token}"
        payload = patient_card_pdf_data(patient, card)
        return Response({
            "card": card.to_dict(include_secret=True),
            "patient": patient.to_summary(),
            "clinic": ClinicSettings.load().to_public(),
            "qr_data_uri": qr_data_uri(verify_url),
            "verify_url": verify_url,
            "layout": {"width_mm": 85.6, "height_mm": 54,
                       "issued_on": payload["issued_on"], "expires_on": payload["expires_on"]},
        })


class PatientCardPdfView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
        patient = _patient_or_404(patient_ref)
        card = PatientIDCard.objects(patient_doc_id=str(patient.id), status="active").first()
        if not card:
            raise NotFound("No active card for this patient.")
        pdf = render_id_card_pdf(patient_card_pdf_data(patient, card))
        log_action(action="patient.card_downloaded", request=request, actor=request.user,
                   target_type="patient_id_card", target_id=str(card.id),
                   patient_id=str(patient.id))
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="patient-card-{patient.patient_number}.pdf"'
        return response


class PatientCardVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [QRScanThrottle]

    def get(self, request, token):
        import hashlib

        card = PatientIDCard.objects(token_hash=hashlib.sha256(token.encode()).hexdigest()).first()
        if not card or len(token) < 16:
            log_action(action="patient.card_verification_failed", request=request,
                       description="Unknown patient card token", outcome="failure")
            raise NotFound("Card not recognised.")
        payload = patient_verification_payload(card)
        log_action(action="patient.card_verified" if payload.get("valid") else "patient.card_verification_failed",
                   request=request, target_type="patient_id_card", target_id=str(card.id),
                   outcome="success" if payload.get("valid") else "failure")
        return Response(payload, status=200 if payload.get("valid") else 410)
