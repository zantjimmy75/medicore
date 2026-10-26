from __future__ import annotations

import mongoengine as me

from apps.core.utils import now_utc


class User(me.Document):
    """Application account. Passwords are hashed with Django's PBKDF2 hasher."""

    meta = {
        "collection": "users",
        "indexes": [
            {"fields": ["email"], "unique": True},
            {"fields": ["role"]},
            {"fields": ["is_active"]},
        ],
    }

    email = me.StringField(required=True, unique=True)
    password_hash = me.StringField(required=True)
    full_name = me.StringField(required=True)
    role = me.StringField(required=True, default="receptionist")
    phone = me.StringField(default="")
    is_active = me.BooleanField(default=True)
    must_change_password = me.BooleanField(default=False)
    staff_id = me.StringField(default="")  # link to Staff.staff_id when applicable
    token_version = me.IntField(default=0)  # bumped to revoke every session
    failed_attempts = me.IntField(default=0)
    locked_until = me.DateTimeField(null=True)
    last_login_at = me.DateTimeField(null=True)
    password_changed_at = me.DateTimeField(null=True)
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)
    created_by = me.StringField(default="")

    def set_password(self, raw: str) -> None:
        from django.contrib.auth.hashers import make_password

        self.password_hash = make_password(raw)
        self.password_changed_at = now_utc()
        self.must_change_password = False

    def check_password(self, raw: str) -> bool:
        from django.contrib.auth.hashers import check_password

        return check_password(raw, self.password_hash)

    # DRF compatibility -------------------------------------------------
    @property
    def is_authenticated(self) -> bool:  # noqa: D401
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def pk(self):
        return str(self.id)

    def to_public(self) -> dict:
        return {
            "id": str(self.id),
            "email": self.email,
            "full_name": self.full_name,
            "role": self.role,
            "phone": self.phone,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password,
            "staff_id": self.staff_id,
            "last_login_at": self.last_login_at,
            "created_at": self.created_at,
        }


class AuthSession(me.Document):
    """Opaque bearer-token session; enables instant server-side revocation."""

    meta = {
        "collection": "auth_sessions",
        "indexes": [
            {"fields": ["access_hash"], "unique": True, "sparse": True},
            {"fields": ["previous_access_hash"], "sparse": True},
            {"fields": ["refresh_hash"], "unique": True, "sparse": True},
            {"fields": ["user_id"]},
            {"fields": ["revoked"]},
            # No TTL index here: the session must outlive the short access token
            # so the refresh token stays usable. Expired rows are purged by the
            # `purge_sessions` management command.
            {"fields": ["refresh_expires_at"]},
        ],
    }

    user_id = me.StringField(required=True)
    access_hash = me.StringField()
    refresh_hash = me.StringField()
    # The token that was current before the last refresh. It stays valid until
    # `previous_access_grace_until` so that requests already in flight (or a
    # second tab, or a React StrictMode double-effect) are not rejected merely
    # because a sibling request rotated the token a moment earlier.
    previous_access_hash = me.StringField(default="")
    previous_access_grace_until = me.DateTimeField(null=True)
    access_expires_at = me.DateTimeField(required=True)
    refresh_expires_at = me.DateTimeField(required=True)
    revoked = me.BooleanField(default=False)
    revoked_at = me.DateTimeField(null=True)
    revoked_reason = me.StringField(default="")
    user_agent = me.StringField(default="")
    ip_address = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)
    last_used_at = me.DateTimeField(null=True)


class PasswordResetToken(me.Document):
    meta = {
        "collection": "password_reset_tokens",
        "indexes": [
            {"fields": ["token_hash"], "unique": True},
            {"fields": ["expires_at"], "expireAfterSeconds": 0},
        ],
    }

    user_id = me.StringField(required=True)
    token_hash = me.StringField(required=True)
    expires_at = me.DateTimeField(required=True)
    used_at = me.DateTimeField(null=True)
    requested_ip = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)


class AuditLog(me.Document):
    """Append-only audit trail. Never stores clinical payloads or passwords."""

    meta = {
        "collection": "audit_logs",
        "indexes": [
            {"fields": ["created_at"]},
            {"fields": ["actor_id"]},
            {"fields": ["action"]},
            {"fields": ["target_type", "target_id"]},
        ],
    }

    actor_id = me.StringField(default="")
    actor_name = me.StringField(default="")
    actor_role = me.StringField(default="")
    action = me.StringField(required=True)
    target_type = me.StringField(default="")
    target_id = me.StringField(default="")
    description = me.StringField(default="")
    patient_id = me.StringField(default="")  # reference only, no PHI
    ip_address = me.StringField(default="")
    request_id = me.StringField(default="")
    user_agent = me.StringField(default="")
    outcome = me.StringField(default="success")
    # NOTE: not named `meta` — that identifier is reserved by MongoEngine for
    # document metadata. Stored as `meta` in MongoDB for readable exports.
    details = me.DictField(default=dict, db_field="meta")
    created_at = me.DateTimeField(default=now_utc)
