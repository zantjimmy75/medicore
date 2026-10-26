from __future__ import annotations

import mongoengine as me

from apps.core.utils import now_utc

REQUEST_STATUS = (
    "requested", "sample_collected", "processing", "results_entered",
    "awaiting_verification", "verified", "released", "cancelled",
)
PRIORITIES = ("routine", "urgent", "stat")
SPECIMEN_TYPES = (
    "whole_blood", "serum", "plasma", "urine", "stool", "sputum", "swab",
    "csf", "tissue", "other",
)


class LabTest(me.Document):
    """Configurable test catalogue (administrators can add tests and ranges)."""

    meta = {
        "collection": "laboratory_tests",
        "indexes": [
            {"fields": ["code"], "unique": True},
            {"fields": ["category"]},
            {"fields": ["is_active"]},
        ],
    }

    code = me.StringField(required=True, unique=True)
    name = me.StringField(required=True)
    category = me.StringField(default="General")
    specimen_type = me.StringField(default="whole_blood")
    unit = me.StringField(default="")
    # For qualitative tests: normal / abnormal value lists
    result_type = me.StringField(default="numeric")  # numeric | qualitative | text
    ref_low = me.FloatField(null=True)
    ref_high = me.FloatField(null=True)
    ref_text = me.StringField(default="")
    qualitative_options = me.ListField(me.StringField(), default=list)
    normal_values = me.ListField(me.StringField(), default=list)
    components = me.ListField(me.DictField(), default=list)
    turnaround_hours = me.IntField(default=24)
    is_active = me.BooleanField(default=True)
    notes = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)

    def reference_interval(self) -> str:
        if self.ref_text:
            return self.ref_text
        if self.ref_low is not None and self.ref_high is not None:
            return f"{_fmt(self.ref_low)} – {_fmt(self.ref_high)}"
        if self.ref_low is not None:
            return f"≥ {_fmt(self.ref_low)}"
        if self.ref_high is not None:
            return f"≤ {_fmt(self.ref_high)}"
        return ""

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "code": self.code,
            "name": self.name,
            "category": self.category,
            "specimen_type": self.specimen_type,
            "unit": self.unit,
            "result_type": self.result_type,
            "ref_low": self.ref_low,
            "ref_high": self.ref_high,
            "ref_text": self.ref_text,
            "reference_interval": self.reference_interval(),
            "qualitative_options": list(self.qualitative_options or []),
            "normal_values": list(self.normal_values or []),
            "components": list(self.components or []),
            "turnaround_hours": self.turnaround_hours,
            "is_active": self.is_active,
            "notes": self.notes,
        }


def _fmt(value: float) -> str:
    return f"{value:g}"


class LabRequest(me.Document):
    meta = {
        "collection": "laboratory_requests",
        "indexes": [
            {"fields": ["request_number"], "unique": True},
            {"fields": ["patient_doc_id", "requested_at"]},
            {"fields": ["status"]},
            {"fields": ["requested_at"]},
            {"fields": ["ordering_user_id"]},
            {"fields": ["priority"]},
        ],
    }

    request_number = me.StringField(required=True, unique=True)
    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(default="")
    patient_name = me.StringField(default="")
    patient_sex = me.StringField(default="")
    patient_age = me.IntField(null=True)

    ordering_user_id = me.StringField(default="")
    ordering_clinician = me.StringField(default="")
    ordering_department = me.StringField(default="")
    consultation_doc_id = me.StringField(default="")

    requested_at = me.DateTimeField(default=now_utc)
    priority = me.StringField(default="routine")
    clinical_indication = me.StringField(default="")
    specimen_type = me.StringField(default="")
    specimen_collected_at = me.DateTimeField(null=True)
    specimen_collected_by = me.StringField(default="")
    notes = me.StringField(default="")

    tests = me.ListField(me.DictField(), default=list)  # snapshot of ordered tests
    status = me.StringField(default="requested")
    status_history = me.ListField(me.DictField(), default=list)
    cancelled_reason = me.StringField(default="")

    result_count = me.IntField(default=0)
    verified_count = me.IntField(default=0)
    released_at = me.DateTimeField(null=True)
    released_by = me.StringField(default="")
    released_by_name = me.StringField(default="")

    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)

    def to_summary(self) -> dict:
        return {
            "id": str(self.id),
            "request_number": self.request_number,
            "patient_doc_id": self.patient_doc_id,
            "patient_number": self.patient_number,
            "patient_name": self.patient_name,
            "ordering_clinician": self.ordering_clinician,
            "requested_at": self.requested_at,
            "priority": self.priority,
            "status": self.status,
            "tests": [t.get("name", "") for t in (self.tests or [])],
            "result_count": self.result_count,
            "verified_count": self.verified_count,
            "specimen_type": self.specimen_type,
            "released_at": self.released_at,
        }

    def to_dict(self) -> dict:
        results = list(LabResult.objects(request_doc_id=str(self.id)).order_by("test_name"))
        return {
            **self.to_summary(),
            "patient_sex": self.patient_sex,
            "patient_age": self.patient_age,
            "ordering_user_id": self.ordering_user_id,
            "ordering_department": self.ordering_department,
            "consultation_doc_id": self.consultation_doc_id,
            "clinical_indication": self.clinical_indication,
            "specimen_collected_at": self.specimen_collected_at,
            "specimen_collected_by": self.specimen_collected_by,
            "notes": self.notes,
            "tests_detail": list(self.tests or []),
            "status_history": list(self.status_history or []),
            "cancelled_reason": self.cancelled_reason,
            "released_by_name": self.released_by_name,
            "results": [r.to_dict() for r in results],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class LabResult(me.Document):
    meta = {
        "collection": "laboratory_results",
        "indexes": [
            {"fields": ["request_doc_id", "test_code"]},
            {"fields": ["patient_doc_id", "resulted_at"]},
            {"fields": ["status"]},
        ],
    }

    request_doc_id = me.StringField(required=True)
    request_number = me.StringField(default="")
    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(default="")
    test_id = me.StringField(default="")
    test_code = me.StringField(default="")
    test_name = me.StringField(required=True)
    category = me.StringField(default="")
    result_type = me.StringField(default="numeric")

    value = me.StringField(default="")          # raw displayed value
    numeric_value = me.FloatField(null=True)
    unit = me.StringField(default="")
    ref_low = me.FloatField(null=True)
    ref_high = me.FloatField(null=True)
    ref_text = me.StringField(default="")
    flag = me.StringField(default="normal")     # normal|high|low|abnormal|critical
    components = me.ListField(me.DictField(), default=list)

    specimen_collected_at = me.DateTimeField(null=True)
    resulted_at = me.DateTimeField(default=now_utc)
    entered_by = me.StringField(default="")
    entered_by_name = me.StringField(default="")

    status = me.StringField(default="entered")  # entered|awaiting_verification|verified|released
    verified_by = me.StringField(default="")
    verified_by_name = me.StringField(default="")
    verified_at = me.DateTimeField(null=True)
    released_by = me.StringField(default="")
    released_at = me.DateTimeField(null=True)

    comments = me.StringField(default="")
    interpretation = me.StringField(default="")
    attachments = me.ListField(me.DictField(), default=list)
    amendments = me.ListField(me.DictField(), default=list)
    version = me.IntField(default=1)
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)

    def reference_interval(self) -> str:
        if self.ref_text:
            return self.ref_text
        if self.ref_low is not None and self.ref_high is not None:
            return f"{_fmt(self.ref_low)} – {_fmt(self.ref_high)}"
        if self.ref_low is not None:
            return f"≥ {_fmt(self.ref_low)}"
        if self.ref_high is not None:
            return f"≤ {_fmt(self.ref_high)}"
        return ""

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "request_doc_id": self.request_doc_id,
            "request_number": self.request_number,
            "patient_doc_id": self.patient_doc_id,
            "patient_number": self.patient_number,
            "test_id": self.test_id,
            "test_code": self.test_code,
            "test_name": self.test_name,
            "category": self.category,
            "result_type": self.result_type,
            "value": self.value,
            "numeric_value": self.numeric_value,
            "unit": self.unit,
            "ref_low": self.ref_low,
            "ref_high": self.ref_high,
            "ref_text": self.ref_text,
            "reference_interval": self.reference_interval(),
            "flag": self.flag,
            "components": list(self.components or []),
            "specimen_collected_at": self.specimen_collected_at,
            "resulted_at": self.resulted_at,
            "entered_by_name": self.entered_by_name,
            "status": self.status,
            "verified_by_name": self.verified_by_name,
            "verified_at": self.verified_at,
            "released_at": self.released_at,
            "comments": self.comments,
            "interpretation": self.interpretation,
            "attachments": list(self.attachments or []),
            "amendments": list(self.amendments or []),
            "version": self.version,
        }


class LabReport(me.Document):
    """Immutable-ish issued report record (re-issued as a new version)."""

    meta = {
        "collection": "laboratory_reports",
        "indexes": [
            {"fields": ["report_number"], "unique": True},
            {"fields": ["request_doc_id", "version"]},
            {"fields": ["patient_doc_id"]},
        ],
    }

    report_number = me.StringField(required=True, unique=True)
    request_doc_id = me.StringField(required=True)
    request_number = me.StringField(default="")
    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(default="")
    version = me.IntField(default=1)
    status = me.StringField(default="released")  # preliminary | verified | released
    snapshot = me.ListField(me.DictField(), default=list)
    verified_by_name = me.StringField(default="")
    released_by_name = me.StringField(default="")
    generated_at = me.DateTimeField(default=now_utc)
    generated_by = me.StringField(default="")
    generated_by_name = me.StringField(default="")
    download_count = me.IntField(default=0)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "report_number": self.report_number,
            "request_doc_id": self.request_doc_id,
            "request_number": self.request_number,
            "patient_number": self.patient_number,
            "version": self.version,
            "status": self.status,
            "generated_at": self.generated_at,
            "generated_by_name": self.generated_by_name,
            "verified_by_name": self.verified_by_name,
            "released_by_name": self.released_by_name,
            "download_count": self.download_count,
            "results": list(self.snapshot or []),
        }
