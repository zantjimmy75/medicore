from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import (
    hash_token,
    issue_session,
    revoke_all_for_user,
    revoke_session,
    rotate_session,
)
from apps.accounts.documents import AuthSession, PasswordResetToken, User
from apps.accounts.serializers import (
    AdminPasswordResetSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    validate_email,
)
from apps.accounts.throttles import LoginThrottle, PasswordResetThrottle
from apps.core.audit import client_ip, log_action
from apps.core.exceptions import APIError, Forbidden, NotFound
from apps.core.permissions import Role, assignable_roles, may_assign_role, require_roles
from apps.core.utils import now_utc, paginate, random_token

logger = logging.getLogger(__name__)


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = validate_email(serializer.validated_data["email"])
        password = serializer.validated_data["password"]

        user = User.objects(email=email).first()
        generic = "Invalid email or password."
        if not user:
            log_action(action="auth.login_failed", request=request,
                       description="Unknown email", outcome="failure")
            raise APIError(generic, status_code=status.HTTP_401_UNAUTHORIZED, code="invalid_credentials")

        if user.locked_until and user.locked_until > now_utc():
            remaining = int((user.locked_until - now_utc()).total_seconds() // 60) + 1
            raise APIError(
                f"Account temporarily locked after repeated failed attempts. Try again in {remaining} minute(s).",
                status_code=status.HTTP_423_LOCKED,
                code="account_locked",
            )

        if not user.check_password(password):
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= settings.MAX_LOGIN_ATTEMPTS:
                user.locked_until = now_utc() + timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
                user.failed_attempts = 0
            user.save()
            log_action(action="auth.login_failed", request=request, actor=user,
                       description="Bad password", outcome="failure")
            raise APIError(generic, status_code=status.HTTP_401_UNAUTHORIZED, code="invalid_credentials")

        if not user.is_active:
            log_action(action="auth.login_blocked", request=request, actor=user,
                       description="Deactivated account", outcome="failure")
            raise APIError(
                "This account has been deactivated. Contact your administrator.",
                status_code=status.HTTP_403_FORBIDDEN,
                code="account_inactive",
            )

        tokens = issue_session(user, request)
        user.failed_attempts = 0
        user.locked_until = None
        user.last_login_at = now_utc()
        user.save()
        log_action(action="auth.login", request=request, actor=user, description="Signed in")
        return Response({"user": user.to_public(), **tokens})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = getattr(request, "session_doc", None)
        if session:
            revoke_session(session, reason="logout")
        log_action(action="auth.logout", request=request, actor=request.user)
        return Response({"message": "Signed out."})


class LogoutAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        count = revoke_all_for_user(request.user, reason="logout_all")
        log_action(action="auth.logout_all", request=request, actor=request.user,
                   meta={"sessions_revoked": count})
        return Response({"message": "All sessions revoked.", "sessions_revoked": count})


class RefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        token = (request.data or {}).get("refresh_token", "")
        if not token:
            raise APIError("refresh_token is required.", code="missing_token",
                           status_code=status.HTTP_400_BAD_REQUEST)
        data = rotate_session(token, request)
        return Response(data)


class SessionInfoView(APIView):
    """Diagnostics for "why am I being signed out?" — safe to expose to the user.

    Returns when the current token expires and whether a refresh token is still
    usable, without ever echoing a token or PHI.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        session = getattr(request, "session_doc", None)
        now = now_utc()
        payload = {
            "authenticated": True,
            "user_id": str(request.user.id),
            "role": request.user.role,
            "access_expires_at": getattr(session, "access_expires_at", None),
            "refresh_expires_at": getattr(session, "refresh_expires_at", None),
            "access_seconds_remaining": (
                int((session.access_expires_at - now).total_seconds()) if session else None
            ),
            "refresh_seconds_remaining": (
                int((session.refresh_expires_at - now).total_seconds()) if session else None
            ),
            "grace_seconds": settings.AUTH_REFRESH_GRACE_SECONDS,
            "server_time": now,
            "revoked": bool(getattr(session, "revoked", False)),
        }
        return Response(payload)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        payload = {"user": user.to_public(), "permissions": permissions_for(user)}
        from apps.staff.documents import Staff

        staff = Staff.objects(user_id=str(user.id), is_deleted__ne=True).first()
        if staff:
            payload["staff"] = {
                "staff_id": staff.staff_id,
                "full_name": staff.full_name,
                "job_title": staff.job_title,
                "department": staff.department_name,
                "photo_url": staff.photo_url,
                "employment_status": staff.employment_status,
            }
        return Response(payload)


def permissions_for(user) -> dict:
    role = user.role
    return {
        "role": role,
        "role_label": Role.LABELS.get(role, role),
        "can_manage_staff": role in Role.STAFF_MANAGE_ROLES,
        # Registering a *new* staff member is narrower than managing one.
        "can_register_staff": role in Role.STAFF_REGISTER_ROLES,
        "can_register_clinic_admin": role in Role.CLINIC_ADMIN_CREATE_ROLES,
        "assignable_staff_roles": assignable_roles(user),
        "can_register_patients": role in Role.PATIENT_REGISTER_ROLES,
        "can_request_patient_deregistration": (
            role in Role.PATIENT_DEREGISTRATION_REQUEST_ROLES
        ),
        "can_decide_patient_deregistration": role in Role.PATIENT_DEREGISTER_ROLES,
        "can_view_any_staff_card": role in Role.STAFF_CARD_VIEW_ANY_ROLES,
        "can_view_medical": role in Role.MEDICAL_READ_ROLES,
        "can_write_medical": role in Role.MEDICAL_WRITE_ROLES,
        "can_manage_attendance": role in Role.ATTENDANCE_MANAGE_ROLES,
        "can_manage_lab": role in Role.LAB_ROLES,
        "can_verify_lab": role in {Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST},
        "can_manage_appointments": role in Role.APPOINTMENT_ROLES,
        "can_manage_settings": role == Role.SUPER_ADMIN,
        "can_view_audit": role in Role.ADMIN_ROLES,
        "can_view_hr_reports": role in {Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.HR_OFFICER},
    }


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PasswordResetThrottle]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = validate_email(serializer.validated_data["email"])
        user = User.objects(email=email, is_active=True).first()
        # Always 200: never disclose whether an account exists.
        payload = {"message": "If that email is registered, a reset link has been generated."}
        if user:
            token = random_token(32)
            PasswordResetToken(
                user_id=str(user.id),
                token_hash=hash_token(token),
                expires_at=now_utc() + timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES),
                requested_ip=client_ip(request),
            ).save()
            log_action(action="auth.password_reset_requested", request=request, actor=user)
            if getattr(settings, "EXPOSE_RESET_TOKEN", False):
                # Dev convenience only: production sends this by email so the
                # token never appears in an API response.
                payload["dev_reset_token"] = token
        return Response(payload)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PasswordResetThrottle]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token_hash = hash_token(serializer.validated_data["token"])
        record = PasswordResetToken.objects(
            token_hash=token_hash, used_at=None, expires_at__gt=now_utc()
        ).first()
        if not record:
            raise APIError("This reset link is invalid or has expired.",
                           code="invalid_reset_token", status_code=status.HTTP_400_BAD_REQUEST)
        user = User.objects(id=record.user_id).first()
        if not user:
            raise NotFound("Account no longer exists.")
        user.set_password(serializer.validated_data["new_password"])
        user.failed_attempts = 0
        user.locked_until = None
        user.save()
        record.used_at = now_utc()
        record.save()
        revoke_all_for_user(user, reason="password_reset")
        log_action(action="auth.password_reset_completed", request=request, actor=user)
        return Response({"message": "Password updated. Please sign in with your new password."})


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            raise APIError("Current password is incorrect.", code="bad_password",
                           status_code=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.save()
        log_action(action="auth.password_changed", request=request, actor=user)
        return Response({"message": "Password changed."})


# --------------------------------------------------------------- user admin
def serialize_user(u: User) -> dict:
    return {
        **u.to_public(),
        "role_label": Role.LABELS.get(u.role, u.role),
        "last_login_at": u.last_login_at,
    }


class UserListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        qs = User.objects()
        role = request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)
        if request.query_params.get("is_active") in {"true", "false"}:
            qs = qs.filter(is_active=request.query_params["is_active"] == "true")
        search = (request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(__raw__={"$or": [
                {"full_name": {"$regex": search, "$options": "i"}},
                {"email": {"$regex": search, "$options": "i"}},
            ]})
        qs = qs.order_by("-created_at")
        return Response(paginate(qs, request.query_params.get("page"),
                                 request.query_params.get("page_size"), serialize_user))

    def post(self, request):
        require_roles(request.user, *Role.STAFF_REGISTER_ROLES)
        serializer = UserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # Creating another administrator is a super-administrator action.
        if not may_assign_role(request.user, data["role"]):
            raise Forbidden(
                f"Your role cannot create a {Role.LABELS.get(data['role'], data['role'])} account.",
                code="role_escalation_blocked",
            )
        if User.objects(email=data["email"]).first():
            raise APIError("An account with this email already exists.", code="duplicate_email",
                           status_code=status.HTTP_409_CONFLICT)
        user = User(
            email=data["email"],
            full_name=data["full_name"].strip(),
            role=data["role"],
            phone=data.get("phone", ""),
            staff_id=data.get("staff_id", ""),
            created_by=str(request.user.id),
            must_change_password=True,
        )
        user.set_password(data["password"])
        user.save()
        log_action(action="user.created", request=request, actor=request.user,
                   target_type="user", target_id=str(user.id),
                   description=f"Created account with role {user.role}")
        return Response({"user": serialize_user(user)}, status=201)


class UserDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        user = User.objects(id=user_id).first()
        if not user:
            raise NotFound("Account not found.")
        return Response({"user": serialize_user(user)})

    def patch(self, request, user_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        user = User.objects(id=user_id).first()
        if not user:
            raise NotFound("Account not found.")
        if user.role == Role.SUPER_ADMIN and request.user.role != Role.SUPER_ADMIN:
            raise Forbidden("Only a Super Administrator can modify a Super Administrator account.")
        serializer = UserUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = []
        for field, value in serializer.validated_data.items():
            if field == "role" and user.role == Role.SUPER_ADMIN and request.user.id != user.id:
                raise Forbidden("Cannot change the role of a Super Administrator.")
            if field == "role" and value != user.role and not may_assign_role(request.user, value):
                # Promoting anyone to administrator is a super-administrator act,
                # otherwise a clinic administrator could escalate an account —
                # including (in two steps) their own.
                raise Forbidden(
                    f"Your role cannot assign the {Role.LABELS.get(value, value)} role.",
                    code="role_escalation_blocked",
                )
            setattr(user, field, value)
            changed.append(field)
        user.updated_at = now_utc()
        user.save()
        if "is_active" in changed and not user.is_active:
            revoke_all_for_user(user, reason="account_deactivated")
        log_action(action="user.updated", request=request, actor=request.user,
                   target_type="user", target_id=str(user.id),
                   description=f"Updated fields: {', '.join(changed)}")
        return Response({"user": serialize_user(user)})


class AdminResetPasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, user_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        user = User.objects(id=user_id).first()
        if not user:
            raise NotFound("Account not found.")
        serializer = AdminPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = True
        user.save()
        count = revoke_all_for_user(user, reason="admin_password_reset")
        log_action(action="user.password_reset_admin", request=request, actor=request.user,
                   target_type="user", target_id=str(user.id), meta={"sessions_revoked": count})
        return Response({"message": "Password reset. The user must set a new password at next sign-in."})


class UserSessionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        sessions = AuthSession.objects(user_id=user_id, revoked=False).order_by("-created_at").limit(50)
        return Response({"sessions": [
            {
                "id": str(s.id),
                "created_at": s.created_at,
                "access_expires_at": s.access_expires_at,
                "refresh_expires_at": s.refresh_expires_at,
                "user_agent": s.user_agent,
                "ip_address": s.ip_address,
            }
            for s in sessions
        ]})

    def delete(self, request, user_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        user = User.objects(id=user_id).first()
        if not user:
            raise NotFound("Account not found.")
        count = revoke_all_for_user(user, reason="admin_revoked_sessions")
        log_action(action="user.sessions_revoked", request=request, actor=request.user,
                   target_type="user", target_id=str(user.id), meta={"count": count})
        return Response({"message": f"{count} session(s) revoked.", "count": count})


class RolesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.core.permissions import serialize_roles

        return Response({"roles": serialize_roles()})
