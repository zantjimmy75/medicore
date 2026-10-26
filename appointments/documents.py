from __future__ import annotations

import mongoengine as me

from apps.core.utils import now_utc

STATUSES = ("scheduled", "confirmed", "completed", "cancelled", "missed")


class Appointment(me.Document):
    meta = {
        "collection": "appointments",
        "indexes": [
            {"fields": ["appointment_number"], "unique": True},
            {"fields": ["patient_doc_id", "scheduled_at"]},
            {"fields": ["clinician_user_id", "scheduled_at"]},
            {"fields": ["scheduled_at"]},
            {"fields": ["status"]},
        ],
    }

    appointment_number = me.StringField(required=True, unique=True)
    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(default="")
    patient_name = me.StringField(default="")

    clinician_user_id = me.StringField(default="")
    clinician_name = me.StringField(default="")
    clinician_staff_id = me.StringField(default="")
    department_id = me.StringField(default="")
    department_name = me.StringField(default="")

    scheduled_at = me.DateTimeField(required=True)
    duration_minutes = me.IntField(default=30)
    reason = me.StringField(default="")
    status = me.StringField(default="scheduled")
    notes = me.StringField(default="")
    cancellation_reason = me.StringField(default="")
    consultation_doc_id = me.StringField(default="")
    reminded_at = me.DateTimeField(null=True)

    created_by = me.StringField(default="")
    created_by_name = me.StringField(default="")
    updated_by = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)
    status_history = me.ListField(me.DictField(), default=list)

    def ends_at(self):
        from datetime import timedelta

        return self.scheduled_at + timedelta(minutes=self.duration_minutes or 30)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "appointment_number": self.appointment_number,
            "patient_doc_id": self.patient_doc_id,
            "patient_number": self.patient_number,
            "patient_name": self.patient_name,
            "clinician_user_id": self.clinician_user_id,
            "clinician_name": self.clinician_name,
            "clinician_staff_id": self.clinician_staff_id,
            "department_id": self.department_id,
            "department_name": self.department_name,
            "scheduled_at": self.scheduled_at,
            "ends_at": self.ends_at(),
            "duration_minutes": self.duration_minutes,
            "reason": self.reason,
            "status": self.status,
            "notes": self.notes,
            "cancellation_reason": self.cancellation_reason,
            "consultation_doc_id": self.consultation_doc_id,
            "created_by_name": self.created_by_name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status_history": list(self.status_history or []),
        }
