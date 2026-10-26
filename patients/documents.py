from __future__ import annotations

import mongoengine as me

from apps.core.utils import now_utc

PATIENT_STATUS = ("active", "inactive", "deceased", "transferred")


class Patient(me.Document):
    meta = {
        "collection": "patients",
        "indexes": [
            {"fields": ["patient_number"], "unique": True},
            {"fields": ["phone_normalized"]},
            {"fields": ["full_name_lower"]},
            {"fields": ["status"]},
            {"fields": ["registration_date"]},
            {"fields": ["duplicate_of"]},
            {"fields": ["national_id"], "sparse": True},
        ],
    }

    patient_number = me.StringField(required=True, unique=True)
    full_name = me.StringField(required=True)
    full_name_lower = me.StringField(default="")
    date_of_birth = me.DateField(null=True)
    estimated_age = me.IntField(null=True)
    sex = me.StringField(default="")  # male | female | other | undisclosed
    photo = me.DictField(default=dict)

    phone = me.StringField(default="")
    phone_normalized = me.StringField(default="")
    email = me.StringField(default="")
    address = me.StringField(default="")
    national_id = me.StringField(default="")

    emergency_contact_name = me.StringField(default="")
    emergency_contact_phone = me.StringField(default="")
    next_of_kin_name = me.StringField(default="")
    next_of_kin_relationship = me.StringField(default="")
    next_of_kin_phone = me.StringField(default="")

    # Clinical header fields (visible only to clinical roles)
    blood_group = me.StringField(default="")
    known_allergies = me.StringField(default="")
    existing_conditions = me.StringField(default="")

    status = me.StringField(default="active")
    # Populated when a clinic administrator deregisters the record. Kept
    # separate from `status` so the audit trail survives later reactivation.
    deregistration = me.DictField(default=dict)
    insurance_provider = me.StringField(default="")
    insurance_number = me.StringField(default="")

    registration_date = me.DateTimeField(default=now_utc)
    last_visit_at = me.DateTimeField(null=True)
    last_visit_type = me.StringField(default="")

    duplicate_of = me.StringField(default="")  # patient_number of the canonical record
    merged_from = me.ListField(me.StringField(), default=list)

    created_by = me.StringField(default="")
    created_by_name = me.StringField(default="")
    updated_by = me.StringField(default="")
    updated_at = me.DateTimeField(default=now_utc)

    def age(self) -> int | None:
        if self.date_of_birth:
            today = now_utc().date()
            return today.year - self.date_of_birth.year - (
                (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day)
            )
        return self.estimated_age

    @property
    def photo_url(self) -> str:
        return (self.photo or {}).get("url", "")

    def to_summary(self, include_clinical: bool = False) -> dict:
        data = {
            "id": str(self.id),
            "patient_number": self.patient_number,
            "full_name": self.full_name,
            "sex": self.sex,
            "age": self.age(),
            "date_of_birth": self.date_of_birth,
            "phone": self.phone,
            "email": self.email,
            "status": self.status,
            "photo_url": self.photo_url,
            "registration_date": self.registration_date,
            "last_visit_at": self.last_visit_at,
            "duplicate_of": self.duplicate_of,
        }
        if include_clinical:
            data.update({
                "blood_group": self.blood_group,
                "known_allergies": self.known_allergies,
                "existing_conditions": self.existing_conditions,
            })
        return data

    def to_dict(self) -> dict:
        return {
            **self.to_summary(include_clinical=True),
            "estimated_age": self.estimated_age,
            "address": self.address,
            "national_id": self.national_id,
            "emergency_contact_name": self.emergency_contact_name,
            "emergency_contact_phone": self.emergency_contact_phone,
            "next_of_kin_name": self.next_of_kin_name,
            "next_of_kin_relationship": self.next_of_kin_relationship,
            "next_of_kin_phone": self.next_of_kin_phone,
            "insurance_provider": self.insurance_provider,
            "insurance_number": self.insurance_number,
            "created_at": self.registration_date,
            "created_by_name": self.created_by_name,
            "updated_at": self.updated_at,
            "merged_from": list(self.merged_from or []),
        }


class PatientIDCard(me.Document):
    meta = {
        "collection": "patient_id_cards",
        "indexes": [
            {"fields": ["card_number"], "unique": True},
            {"fields": ["token_hash"], "unique": True},
            {"fields": ["patient_doc_id", "status"]},
        ],
    }

    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(required=True)
    patient_name = me.StringField(default="")
    card_number = me.StringField(required=True, unique=True)
    token_hash = me.StringField(required=True, unique=True)
    token = me.StringField(default="")
    token_prefix = me.StringField(default="")
    status = me.StringField(default="active")
    # Populated when a clinic administrator deregisters the record. Kept
    # separate from `status` so the audit trail survives later reactivation.
    deregistration = me.DictField(default=dict)
    issued_at = me.DateTimeField(default=now_utc)
    expires_at = me.DateTimeField(null=True)
    issued_by = me.StringField(default="")
    issued_by_name = me.StringField(default="")
    revoked_at = me.DateTimeField(null=True)
    revoked_reason = me.StringField(default="")
    scan_count = me.IntField(default=0)

    def to_dict(self, include_secret: bool = False) -> dict:
        data = {
            "id": str(self.id),
            "card_number": self.card_number,
            "patient_number": self.patient_number,
            "patient_name": self.patient_name,
            "status": self.status,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
            "issued_by_name": self.issued_by_name,
            "revoked_at": self.revoked_at,
            "revoked_reason": self.revoked_reason,
            "scan_count": self.scan_count,
            "token_prefix": self.token_prefix,
        }
        if include_secret:
            data["token"] = self.token
        return data


class PatientChangeLog(me.Document):
    """Field-level change history for important patient information."""

    meta = {
        "collection": "patient_change_logs",
        "indexes": [
            {"fields": ["patient_doc_id"]},
            {"fields": ["created_at"]},
        ],
    }

    patient_doc_id = me.StringField(required=True)
    changed_by = me.StringField(default="")
    changed_by_name = me.StringField(default="")
    changed_by_role = me.StringField(default="")
    changes = me.ListField(me.DictField(), default=list)  # [{field, from, to}]
    reason = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)


DEREGISTRATION_STATUS = ("pending", "approved", "rejected", "cancelled")


class PatientDeregistrationRequest(me.Document):
    """A receptionist's request to remove a patient from the active register.

    Separation of duties: the receptionist knows why a record should be closed
    (moved away, registered twice, deceased), but only a clinic administrator may
    act on it. The reason is mandatory and is kept verbatim for the audit trail.
    """

    meta = {
        "collection": "patient_deregistration_requests",
        "indexes": [
            {"fields": ["patient_doc_id"]},
            {"fields": ["patient_number"]},
            {"fields": ["status"]},
            {"fields": ["requested_by"]},
            {"fields": ["requested_at"]},
        ],
    }

    patient_doc_id = me.StringField(required=True)
    patient_number = me.StringField(required=True)
    patient_name = me.StringField(default="")
    requested_status = me.StringField(default="inactive")  # inactive|deceased|transferred
    reason = me.StringField(required=True)

    status = me.StringField(default="pending", choices=DEREGISTRATION_STATUS)
    requested_by = me.StringField(required=True)
    requested_by_name = me.StringField(default="")
    requested_at = me.DateTimeField(default=now_utc)

    decided_by = me.StringField(default="")
    decided_by_name = me.StringField(default="")
    decided_at = me.DateTimeField(null=True)
    decision_note = me.StringField(default="")

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "patient_doc_id": self.patient_doc_id,
            "patient_number": self.patient_number,
            "patient_name": self.patient_name,
            "requested_status": self.requested_status,
            "reason": self.reason,
            "status": self.status,
            "requested_by": self.requested_by,
            "requested_by_name": self.requested_by_name,
            "requested_at": self.requested_at,
            "decided_by": self.decided_by,
            "decided_by_name": self.decided_by_name,
            "decided_at": self.decided_at,
            "decision_note": self.decision_note,
        }
