from __future__ import annotations

import mongoengine as me

from apps.core.utils import now_utc

CONSULTATION_STATUS = ("draft", "finalized", "amended")


class MedicalHistory(me.Document):
    """One longitudinal record per patient, versioned with an amendment trail."""

    meta = {
        "collection": "medical_histories",
        "indexes": [
            {"fields": ["patient_doc_id"], "unique": True},
            {"fields": ["updated_at"]},
        ],
    }

    patient_doc_id = me.StringField(required=True, unique=True)
    patient_number = me.StringField(default="")

    presenting_complaint = me.StringField(default="")
    history_of_present_illness = me.StringField(default="")
    past_medical_conditions = me.StringField(default="")
    past_surgeries = me.StringField(default="")
    allergies = me.StringField(default="")
    allergy_reactions = me.StringField(default="")
    current_medications = me.StringField(default="")
    past_medications = me.StringField(default="")
    family_history = me.StringField(default="")
    social_history = me.StringField(default="")
    previous_diagnoses = me.StringField(default="")
    immunizations = me.StringField(default="")
    risk_factors = me.StringField(default="")
    clinical_notes = me.StringField(default="")
    treatment_followup_plan = me.StringField(default="")
    # Explicit marker so the UI can distinguish "not recorded" from "no allergies"
    not_recorded_fields = me.ListField(me.StringField(), default=list)

    version = me.IntField(default=1)
    status = me.StringField(default="draft")  # draft | finalized
    finalized_at = me.DateTimeField(null=True)
    finalized_by = me.StringField(default="")
    finalized_by_name = me.StringField(default="")

    created_by = me.StringField(default="")
    created_by_name = me.StringField(default="")
    updated_by = me.StringField(default="")
    updated_by_name = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)
    amendments = me.ListField(me.DictField(), default=list)

    FIELDS = (
        "presenting_complaint", "history_of_present_illness", "past_medical_conditions",
        "past_surgeries", "allergies", "allergy_reactions", "current_medications",
        "past_medications", "family_history", "social_history", "previous_diagnoses",
        "immunizations", "risk_factors", "clinical_notes", "treatment_followup_plan",
    )

    def to_dict(self) -> dict:
        data = {f: getattr(self, f, "") for f in self.FIELDS}
        recorded = {f for f in self.FIELDS if (getattr(self, f, "") or "").strip()}
        return {
            "id": str(self.id),
            "patient_doc_id": self.patient_doc_id,
            "patient_number": self.patient_number,
            **data,
            "recorded_fields": sorted(recorded),
            "missing_fields": sorted(set(self.FIELDS) - recorded),
            "version": self.version,
            "status": self.status,
            "finalized_at": self.finalized_at,
            "finalized_by_name": self.finalized_by_name,
            "created_by_name": self.created_by_name,
            "updated_by_name": self.updated_by_name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "amendments": list(self.amendments or []),
        }


class Consultation(me.Document):
    """Clinical encounter. Immutable once finalised; changes go through amendments."""

    meta = {
        "collection": "consultations",
        "indexes": [
            {"fields": ["consultation_number"], "unique": True},
            {"fields": ["patient_doc_id", "consulted_at"]},
            {"fields": ["attending_user_id"]},
            {"fields": ["status"]},
            {"fields": ["consulted_at"]},
        ],
    }

    consultation_number = me.StringField(required=True, unique=True)
    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(default="")
    patient_name = me.StringField(default="")
    appointment_doc_id = me.StringField(default="")

    consulted_at = me.DateTimeField(default=now_utc)
    consultation_type = me.StringField(default="outpatient")  # outpatient|follow_up|emergency|teleconsult
    attending_user_id = me.StringField(default="")
    attending_name = me.StringField(default="")
    attending_role = me.StringField(default="")
    department_name = me.StringField(default="")

    chief_complaint = me.StringField(default="")
    history_of_present_illness = me.StringField(default="")
    examination_findings = me.StringField(default="")
    assessment = me.StringField(default="")
    diagnosis = me.ListField(me.DictField(), default=list)  # [{text, certainty}]
    treatment_plan = me.StringField(default="")
    prescriptions = me.ListField(me.DictField(), default=list)
    investigations_requested = me.StringField(default="")
    follow_up_instructions = me.StringField(default="")
    follow_up_date = me.DateField(null=True)
    notes = me.StringField(default="")

    status = me.StringField(default="draft")
    finalized_at = me.DateTimeField(null=True)
    finalized_by_name = me.StringField(default="")
    amendments = me.ListField(me.DictField(), default=list)

    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)

    def to_dict(self, include_vitals: dict | None = None) -> dict:
        vitals = include_vitals
        if vitals is None:
            doc = VitalSigns.objects(consultation_doc_id=str(self.id)).order_by("-recorded_at").first()
            vitals = doc.to_dict() if doc else None
        return {
            "id": str(self.id),
            "consultation_number": self.consultation_number,
            "patient_doc_id": self.patient_doc_id,
            "patient_number": self.patient_number,
            "patient_name": self.patient_name,
            "consulted_at": self.consulted_at,
            "consultation_type": self.consultation_type,
            "attending_name": self.attending_name,
            "attending_role": self.attending_role,
            "department_name": self.department_name,
            "chief_complaint": self.chief_complaint,
            "history_of_present_illness": self.history_of_present_illness,
            "examination_findings": self.examination_findings,
            "assessment": self.assessment,
            "diagnosis": list(self.diagnosis or []),
            "treatment_plan": self.treatment_plan,
            "prescriptions": list(self.prescriptions or []),
            "investigations_requested": self.investigations_requested,
            "follow_up_instructions": self.follow_up_instructions,
            "follow_up_date": self.follow_up_date,
            "notes": self.notes,
            "status": self.status,
            "finalized_at": self.finalized_at,
            "finalized_by_name": self.finalized_by_name,
            "amendments": list(self.amendments or []),
            "vital_signs": vitals,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class VitalSigns(me.Document):
    meta = {
        "collection": "vital_signs",
        "indexes": [
            {"fields": ["patient_doc_id", "recorded_at"]},
            {"fields": ["consultation_doc_id"]},
        ],
    }

    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(default="")
    consultation_doc_id = me.StringField(default="")
    recorded_at = me.DateTimeField(default=now_utc)
    recorded_by = me.StringField(default="")
    recorded_by_name = me.StringField(default="")
    recorded_by_role = me.StringField(default="")

    systolic = me.IntField(null=True)
    diastolic = me.IntField(null=True)
    pulse = me.IntField(null=True)
    temperature_c = me.FloatField(null=True)
    respiratory_rate = me.IntField(null=True)
    oxygen_saturation = me.IntField(null=True)
    weight_kg = me.FloatField(null=True)
    height_cm = me.FloatField(null=True)
    pain_score = me.IntField(null=True)
    notes = me.StringField(default="")

    def bmi(self) -> float | None:
        if self.weight_kg and self.height_cm:
            h = self.height_cm / 100.0
            if h > 0:
                return round(self.weight_kg / (h * h), 1)
        return None

    def to_dict(self) -> dict:
        vitals = {
            "systolic": self.systolic,
            "diastolic": self.diastolic,
            "pulse": self.pulse,
            "temperature_c": self.temperature_c,
            "respiratory_rate": self.respiratory_rate,
            "oxygen_saturation": self.oxygen_saturation,
            "weight_kg": self.weight_kg,
            "height_cm": self.height_cm,
            "pain_score": self.pain_score,
        }
        return {
            "id": str(self.id),
            "patient_doc_id": self.patient_doc_id,
            "consultation_doc_id": self.consultation_doc_id,
            "recorded_at": self.recorded_at,
            "recorded_by_name": self.recorded_by_name,
            "recorded_by_role": self.recorded_by_role,
            "blood_pressure": (f"{self.systolic}/{self.diastolic}"
                               if self.systolic and self.diastolic else None),
            "bmi": self.bmi(),
            **vitals,
            "notes": self.notes,
            "recorded_fields": [k for k, v in vitals.items() if v is not None],
        }
