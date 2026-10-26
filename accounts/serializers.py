"""Hand-written validation (kept explicit rather than DRF ModelSerializer,
which cannot bind to MongoEngine documents)."""

from __future__ import annotations

import re

from rest_framework import serializers

from apps.core.permissions import Role

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


def validate_email(value: str, field="email") -> str:
    value = (value or "").strip().lower()
    if not EMAIL_RE.match(value):
        raise serializers.ValidationError("Enter a valid email address.", code="invalid_email")
    return value


def validate_password_strength(value: str) -> str:
    if not value or len(value) < 10:
        raise serializers.ValidationError("Password must be at least 10 characters.", code="weak_password")
    checks = [any(c.islower() for c in value), any(c.isupper() for c in value),
              any(c.isdigit() for c in value)]
    if not all(checks):
        raise serializers.ValidationError(
            "Password must include upper-case, lower-case and numeric characters.",
            code="weak_password",
        )
    return value


class LoginSerializer(serializers.Serializer):
    email = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.CharField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_new_password(self, value):
        return validate_password_strength(value)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_new_password(self, value):
        return validate_password_strength(value)


class UserCreateSerializer(serializers.Serializer):
    email = serializers.CharField()
    full_name = serializers.CharField()
    role = serializers.ChoiceField(choices=Role.ALL)
    password = serializers.CharField(trim_whitespace=False)
    phone = serializers.CharField(required=False, allow_blank=True, default="")
    staff_id = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_email(self, value):
        return validate_email(value)

    def validate_password(self, value):
        return validate_password_strength(value)


class UserUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(required=False)
    role = serializers.ChoiceField(choices=Role.ALL, required=False)
    phone = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)


class AdminPasswordResetSerializer(serializers.Serializer):
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_new_password(self, value):
        return validate_password_strength(value)
