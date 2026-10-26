"""Laboratory workflow engine.

State machine (enforced server-side, no shortcuts):

    requested -> sample_collected -> processing -> results_entered
              -> awaiting_verification -> verified -> released
    (any pre-release state) -> cancelled (reason required)

Rules
-----
* Results can only be entered while the request is in `processing` /
  `sample_collected` (or re-entered by an authorised amendment).
* A result cannot be verified by the scientist who entered it when
  `lab_dual_control` is enabled.
* Release requires *every* result on the request to be verified.
* Unverified results are never presented as final: the report is flagged
  PRELIMINARY until release.
"""

from __future__ import annotations

import logging

from apps.core.documents import ClinicSettings
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.utils import generate_id, now_utc
from apps.laboratory.documents import LabReport, LabRequest, LabResult, LabTest

logger = logging.getLogger(__name__)

ALLOWED_TRANSITIONS = {
    "requested": {"sample_collected", "cancelled"},
    "sample_collected": {"processing", "cancelled"},
    "processing": {"results_entered", "cancelled"},
    "results_entered": {"awaiting_verification", "verified", "cancelled"},
    "awaiting_verification": {"verified", "cancelled"},
    "verified": {"released"},
    "released": set(),
    "cancelled": set(),
}

STATUS_LABELS = {
    "requested": "Requested",
    "sample_collected": "Sample collected",
    "processing": "Processing",
    "results_entered": "Results entered",
    "awaiting_verification": "Awaiting verification",
    "verified": "Verified",
    "released": "Released",
    "cancelled": "Cancelled",
}


def transition(request_doc: LabRequest, new_status: str, actor, *, reason: str = "",
               allow_force: bool = False) -> LabRequest:
    if new_status not in ALLOWED_TRANSITIONS:
        raise APIError("Unknown laboratory status.", code="invalid_status", status_code=400)
    if not allow_force and new_status not in ALLOWED_TRANSITIONS.get(request_doc.status, set()):
        raise Conflict(
            f"Cannot move a request from '{STATUS_LABELS.get(request_doc.status, request_doc.status)}' "
            f"to '{STATUS_LABELS.get(new_status, new_status)}'.",
            code="invalid_transition",
            extra={"from": request_doc.status, "to": new_status},
        )
    request_doc.status_history = list(request_doc.status_history or []) + [{
        "status": new_status,
        "previous": request_doc.status,
        "at": now_utc(),
        "by": str(getattr(actor, "id", "") or ""),
        "by_name": getattr(actor, "full_name", "") or "",
        "reason": reason,
    }]
    request_doc.status = new_status
    request_doc.updated_at = now_utc()
    if new_status == "cancelled":
        request_doc.cancelled_reason = reason
    request_doc.save()
    return request_doc


def compute_flag(result: LabResult) -> str:
    """Derive the abnormal flag from the configured reference interval."""
    if result.components:
        flags = [c.get("flag", "normal") for c in result.components]
        if "critical" in flags:
            return "critical"
        if "high" in flags or "low" in flags:
            return "abnormal"
        return "normal"
    if result.result_type == "numeric" and result.numeric_value is not None:
        if result.ref_low is not None and result.numeric_value < result.ref_low:
            return "low"
        if result.ref_high is not None and result.numeric_value > result.ref_high:
            return "high"
        return "normal"
    if result.result_type == "qualitative":
        test = LabTest.objects(id=result.test_id).first() if result.test_id else None
        normals = [v.lower() for v in ((test.normal_values if test else []) or [])]
        if normals and str(result.value).strip().lower() not in normals:
            return "abnormal"
    return "normal"


def _to_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def component_flag(component: dict) -> str:
    """Flag a component against its reference interval.

    Accepts either an explicit `numeric_value` or a numeric `value`, so the
    same logic works for structured FHIR-like payloads and plain numbers.
    """
    low = _to_float(component.get("ref_low"))
    high = _to_float(component.get("ref_high"))
    value = _to_float(component.get("numeric_value"))
    if value is None:
        value = _to_float(component.get("value"))
    if value is None:
        return "normal"
    if low is not None and value < low:
        return "critical" if component.get("critical_low") else "low"
    if high is not None and value > high:
        return "critical" if component.get("critical_high") else "high"
    return "normal"


def enter_result(*, request_doc: LabRequest, payload: dict, actor, request=None) -> LabResult:
    """Create or amend a result for one test on the request."""
    test_code = (payload.get("test_code") or "").strip()
    test = LabTest.objects(code=test_code).first()
    if not test:
        raise NotFound(f"Test '{test_code}' is not configured.")
    if test_code not in [t.get("code") for t in (request_doc.tests or [])]:
        raise APIError("This test is not part of the laboratory request.",
                       code="test_not_requested", status_code=400)
    if request_doc.status in {"cancelled"}:
        raise Conflict("Cannot record results on a cancelled request.", code="request_cancelled")
    if request_doc.status in {"released"}:
        raise Conflict(
            "Results for this request have already been released. Amend through the "
            "correction workflow.", code="already_released",
        )
    if request_doc.status == "requested":
        raise Conflict(
            "Record specimen collection before entering results.",
            code="specimen_not_collected",
        )

    existing = LabResult.objects(request_doc_id=str(request_doc.id), test_code=test_code).first()
    creating = existing is None
    result = existing or LabResult(
        request_doc_id=str(request_doc.id),
        request_number=request_doc.request_number,
        patient_doc_id=request_doc.patient_doc_id,
        patient_number=request_doc.patient_number,
        test_id=str(test.id),
        test_code=test.code,
        test_name=test.name,
        category=test.category,
        result_type=test.result_type,
        unit=payload.get("unit", test.unit),
        ref_low=test.ref_low,
        ref_high=test.ref_high,
        ref_text=test.ref_text,
        specimen_collected_at=request_doc.specimen_collected_at,
    )

    if existing and result.status in {"verified", "released"}:
        # Amended result: preserve the previous version, invalidate verification.
        reason = (payload.get("amendment_reason") or "").strip()
        if len(reason) < 5:
            raise APIError(
                "This result is verified. Provide an amendment_reason of at least 5 characters.",
                code="amendment_reason_required", status_code=400,
            )
        result.amendments = list(result.amendments or []) + [{
            "amended_at": now_utc(),
            "amended_by": str(actor.id),
            "amended_by_name": actor.full_name,
            "reason": reason,
            "previous_value": result.value,
            "previous_flag": result.flag,
            "previous_status": result.status,
            "previous_verified_by": result.verified_by_name,
        }]
        result.version = (result.version or 1) + 1
        result.verified_by = ""
        result.verified_by_name = ""
        result.verified_at = None

    _apply_value(result, payload, test)
    result.entered_by = str(actor.id)
    result.entered_by_name = actor.full_name
    result.resulted_at = now_utc()
    result.status = "awaiting_verification"
    result.updated_at = now_utc()
    result.save()

    _refresh_counts(request_doc)
    # Walk the state machine forward one legal step at a time.
    if request_doc.status == "sample_collected":
        transition(request_doc, "processing", actor, reason="Analysis started")
    if request_doc.status == "processing":
        transition(request_doc, "results_entered", actor, reason="Result entry in progress")
    if request_doc.status == "results_entered":
        transition(request_doc, "awaiting_verification", actor,
                   reason="Result submitted for verification")
    return result


def _apply_value(result: LabResult, payload: dict, test: LabTest) -> None:
    result.result_type = payload.get("result_type", test.result_type)
    result.unit = payload.get("unit", test.unit)
    if payload.get("comments") is not None:
        result.comments = payload["comments"]
    if payload.get("interpretation") is not None:
        result.interpretation = payload["interpretation"]

    components = payload.get("components") or []
    if components:
        cleaned = []
        for component in components:
            raw_value = component.get("value", "")
            entry = {
                "name": component.get("name", ""),
                "value": str(raw_value),
                "numeric_value": _to_float(component.get("numeric_value") or raw_value),
                "unit": component.get("unit", result.unit),
                "ref_low": component.get("ref_low"),
                "ref_high": component.get("ref_high"),
                "ref_text": component.get("ref_text", ""),
            }
            entry["flag"] = component_flag(entry)
            cleaned.append(entry)
        result.components = cleaned
        result.value = "; ".join(f"{c['name']}: {c['value']}" for c in cleaned if c["name"])
        result.numeric_value = None
    else:
        raw = payload.get("value", "")
        result.value = str(raw)
        numeric = payload.get("numeric_value")
        if numeric in ("", None):
            try:
                numeric = float(str(raw).strip())
            except (TypeError, ValueError):
                numeric = None
        result.numeric_value = numeric
        result.components = []

    if "ref_low" in payload and payload["ref_low"] not in (None, ""):
        result.ref_low = float(payload["ref_low"])
    if "ref_high" in payload and payload["ref_high"] not in (None, ""):
        result.ref_high = float(payload["ref_high"])
    if payload.get("ref_text") is not None:
        result.ref_text = payload["ref_text"]
    result.flag = compute_flag(result)


def _refresh_counts(request_doc: LabRequest) -> None:
    results = list(LabResult.objects(request_doc_id=str(request_doc.id)))
    request_doc.result_count = len(results)
    request_doc.verified_count = sum(1 for r in results if r.status in {"verified", "released"})
    request_doc.updated_at = now_utc()
    request_doc.save()


def verify_result(*, result: LabResult, actor, comments: str = "") -> LabResult:
    if result.status not in {"awaiting_verification", "entered"}:
        raise Conflict(f"Result is already {result.status} and cannot be verified again.",
                       code="already_verified")
    settings_doc = ClinicSettings.load()
    if settings_doc.lab_dual_control and result.entered_by == str(actor.id):
        raise Conflict(
            "Dual control is enabled: the scientist who entered this result cannot verify it. "
            "Ask a different authorised scientist to verify.",
            code="dual_control_required",
        )
    result.status = "verified"
    result.verified_by = str(actor.id)
    result.verified_by_name = actor.full_name
    result.verified_at = now_utc()
    if comments:
        result.comments = (result.comments + f"\nVerifier: {comments}").strip()
    result.updated_at = now_utc()
    result.save()

    request_doc = LabRequest.objects(id=result.request_doc_id).first()
    if request_doc:
        _refresh_counts(request_doc)
        if request_doc.status in {"results_entered", "awaiting_verification"}:
            results = list(LabResult.objects(request_doc_id=str(request_doc.id)))
            if results and all(r.status in {"verified", "released"} for r in results):
                transition(request_doc, "verified", actor, reason="All results verified")
            else:
                transition(request_doc, "awaiting_verification", actor,
                           reason="Awaiting remaining verifications")
    return result


def release_request(*, request_doc: LabRequest, actor, request=None) -> LabReport:
    # Always work from the freshest document state: callers may hold a stale
    # in-memory copy after verification updated the request.
    fresh = LabRequest.objects(id=request_doc.id).first()
    if fresh:
        request_doc = fresh
    if request_doc.status == "cancelled":
        raise Conflict("Cancelled requests cannot be released.", code="request_cancelled")
    results = list(LabResult.objects(request_doc_id=str(request_doc.id)))
    if not results:
        raise Conflict("There are no results to release.", code="no_results")
    unverified = [r for r in results if r.status not in {"verified", "released"}]
    if unverified and ClinicSettings.load().lab_requires_verification:
        raise Conflict(
            f"{len(unverified)} result(s) are not verified. Unverified results cannot be released "
            "as a final report.",
            code="unverified_results",
            extra={"unverified": [r.test_name for r in unverified]},
        )
    if request_doc.status == "released":
        raise Conflict("This request has already been released.", code="already_released")
    if request_doc.status == "awaiting_verification":
        # Everything is verified by this point, so advance through the
        # `verified` state rather than jumping the state machine.
        transition(request_doc, "verified", actor, reason="All results verified")
    if request_doc.status not in {"verified"}:
        raise Conflict(
            f"Request must be verified before release (current: {request_doc.status}).",
            code="invalid_transition",
        )

    for result in results:
        result.status = "released"
        result.released_by = str(actor.id)
        result.released_at = now_utc()
        result.save()

    if request_doc.status != "released":
        transition(request_doc, "released", actor, reason="Report released to clinical staff")
    request_doc.released_at = now_utc()
    request_doc.released_by = str(actor.id)
    request_doc.released_by_name = actor.full_name
    request_doc.save()
    _refresh_counts(request_doc)

    previous = LabReport.objects(request_doc_id=str(request_doc.id)).order_by("-version").first()
    report = LabReport(
        report_number=generate_id("LR", pad=5),
        request_doc_id=str(request_doc.id),
        request_number=request_doc.request_number,
        patient_doc_id=request_doc.patient_doc_id,
        patient_number=request_doc.patient_number,
        version=(previous.version + 1) if previous else 1,
        status="released",
        snapshot=[_result_snapshot(r) for r in results],
        verified_by_name=", ".join(sorted({r.verified_by_name for r in results if r.verified_by_name})),
        released_by_name=actor.full_name,
        generated_by=str(actor.id),
        generated_by_name=actor.full_name,
    )
    report.save()
    return report


def _result_snapshot(result: LabResult) -> dict:
    return {
        "test_name": result.test_name,
        "test_code": result.test_code,
        "value": result.value,
        "unit": result.unit,
        "reference_interval": result.reference_interval(),
        "flag": result.flag,
        "verified_by_name": result.verified_by_name,
        "verified_at": result.verified_at,
        "comments": result.comments,
    }


def report_payload(request_doc: LabRequest, report: LabReport | None = None) -> dict:
    """Assemble the data used to render the PDF report."""
    from apps.core.documents import ClinicSettings

    settings_doc = ClinicSettings.load()
    results = list(LabResult.objects(request_doc_id=str(request_doc.id)).order_by("test_name"))
    all_verified = bool(results) and all(r.status in {"verified", "released"} for r in results)
    status_key = "released" if request_doc.status == "released" else (
        "verified" if all_verified else "preliminary"
    )
    status_label = {
        "released": "Released — final report",
        "verified": "Verified — awaiting release",
        "preliminary": "Preliminary — not verified",
    }[status_key]

    return {
        "clinic_name": settings_doc.clinic_name,
        "clinic_address": settings_doc.address,
        "clinic_phone": settings_doc.phone,
        "clinic_email": settings_doc.email,
        "patient_name": request_doc.patient_name,
        "patient_number": request_doc.patient_number,
        "patient_demographics": f"{request_doc.patient_sex or '—'} / {request_doc.patient_age or '—'} yrs",
        "request_number": request_doc.request_number,
        "ordering_clinician": request_doc.ordering_clinician,
        "requested_at": request_doc.requested_at.strftime("%d %b %Y, %H:%M") if request_doc.requested_at else "",
        "specimen_type": (request_doc.specimen_type or "").replace("_", " ").title(),
        "collected_at": request_doc.specimen_collected_at.strftime("%d %b %Y, %H:%M")
        if request_doc.specimen_collected_at else "Not recorded",
        "priority": request_doc.priority.upper(),
        "clinical_indication": request_doc.clinical_indication,
        "status": status_label,
        "status_key": status_key,
        "results": [{
            "test_name": r.test_name,
            "value_display": r.value or "—",
            "unit": r.unit,
            "reference_interval": r.reference_interval(),
            "flag": r.flag,
            "flag_label": {"normal": "Normal", "high": "High", "low": "Low",
                           "abnormal": "Abnormal", "critical": "CRITICAL"}.get(r.flag, r.flag),
            "components": r.components,
        } for r in results],
        "comments": "\n".join(f"{r.test_name}: {r.comments}" for r in results if r.comments),
        "entered_by": ", ".join(sorted({r.entered_by_name for r in results if r.entered_by_name})) or "—",
        "resulted_at": max((r.resulted_at for r in results), default=None).strftime("%d %b %Y, %H:%M")
        if results else "—",
        "verified_by": ", ".join(sorted({r.verified_by_name for r in results if r.verified_by_name}))
        or "Not verified",
        "verified_at": max((r.verified_at for r in results if r.verified_at), default=None).strftime(
            "%d %b %Y, %H:%M") if any(r.verified_at for r in results) else "—",
        "released_by": request_doc.released_by_name or "—",
        "released_at": request_doc.released_at.strftime("%d %b %Y, %H:%M") if request_doc.released_at else "—",
        "attachments": [a.get("original_name", "attachment") for r in results for a in (r.attachments or [])],
        "corrections": [f"{r.test_name}: version {r.version} ({len(r.amendments or [])} amendment(s))"
                        for r in results if r.amendments],
        "generated_at": now_utc().strftime("%d %b %Y, %H:%M UTC"),
        "generated_by": "MediCore Laboratory Information Module",
        "retention_note": settings_doc.retention_note,
        "report_number": report.report_number if report else "",
        "report_version": report.version if report else 0,
    }
