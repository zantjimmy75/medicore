from __future__ import annotations

import re

from rest_framework import serializers

from apps.patients.documents import PATIENT_STATUS

SEXES = ["male", "female", "other", "undisclosed"]
BLOOD_GROUPS = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"]
PHONE_RE = re.compile(r"^[0-9+()\-\s]{7,20}$")


class PatientCreateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=140)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    estimated_age = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=130)
    sex = serializers.ChoiceField(choices=SEXES, required=False, allow_blank=True, default="")
    phone = serializers.CharField(required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    address = serializers.CharField(required=False, allow_blank=True, default="", max_length=300)
    national_id = serializers.CharField(required=False, allow_blank=True, default="")
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True, default="")
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True, default="")
    next_of_kin_name = serializers.CharField(required=False, allow_blank=True, default="")
    next_of_kin_relationship = serializers.CharField(required=False, allow_blank=True, default="")
    next_of_kin_phone = serializers.CharField(required=False, allow_blank=True, default="")
    blood_group = serializers.ChoiceField(choices=BLOOD_GROUPS, required=False, default="")
    known_allergies = serializers.CharField(required=False, allow_blank=True, default="")
    existing_conditions = serializers.CharField(required=False, allow_blank=True, default="")
    status = serializers.ChoiceField(choices=PATIENT_STATUS, required=False, default="active")
    insurance_provider = serializers.CharField(required=False, allow_blank=True, default="")
    insurance_number = serializers.CharField(required=False, allow_blank=True, default="")
    # set to true once the registrar has reviewed duplicate warnings
    confirm_not_duplicate = serializers.BooleanField(required=False, default=False)

    def validate_full_name(self, value):
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Enter the patient's full name.")
        return value

    def validate_phone(self, value):
        value = (value or "").strip()
        if value and not PHONE_RE.match(value):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value

    def validate(self, attrs):
        if not attrs.get("date_of_birth") and attrs.get("estimated_age") is None:
            raise serializers.ValidationError(
                {"date_of_birth": ["Provide a date of birth or an estimated age."]}
            )
        dob = attrs.get("date_of_birth")
        if dob:
            from apps.core.utils import now_utc

            if dob > now_utc().date():
                raise serializers.ValidationError({"date_of_birth": ["Date of birth cannot be in the future."]})
        return attrs


class PatientUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=140, required=False)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    estimated_age = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=130)
    sex = serializers.ChoiceField(choices=SEXES, required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True, max_length=300)
    national_id = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True)
    next_of_kin_name = serializers.CharField(required=False, allow_blank=True)
    next_of_kin_relationship = serializers.CharField(required=False, allow_blank=True)
    next_of_kin_phone = serializers.CharField(required=False, allow_blank=True)
    blood_group = serializers.ChoiceField(choices=BLOOD_GROUPS, required=False)
    known_allergies = serializers.CharField(required=False, allow_blank=True)
    existing_conditions = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=PATIENT_STATUS, required=False)
    insurance_provider = serializers.CharField(required=False, allow_blank=True)
    insurance_number = serializers.CharField(required=False, allow_blank=True)
    change_reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_phone(self, value):
        value = (value or "").strip()
        if value and not PHONE_RE.match(value):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value
