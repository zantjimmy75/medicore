"""Bearer-token authentication backed by MongoDB sessions.

Why not JWT? Access tokens are opaque random strings whose SHA-256 hash is
stored in `auth_sessions`. That keeps revocation instantaneous (admin
deactivation, logout, "revoke all sessions") and avoids the classic JWT
problem of a stolen token remaining valid until expiry.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta

from django.conf import settings
from rest_framework import authentication, exceptions

from apps.accounts.documents import AuthSession, User
from apps.core.utils import now_utc, random_token


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_session(user: User, request=None) -> dict:
    access = random_token(32)
    refresh = random_token(32)
    now = now_utc()
    session = AuthSession(
        user_id=str(user.id),
        access_hash=hash_token(access),
        refresh_hash=hash_token(refresh),
        access_expires_at=now + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES),
        refresh_expires_at=now + timedelta(hours=settings.REFRESH_TOKEN_TTL_HOURS),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:300] if request else ""),
        ip_address=(request.META.get("REMOTE_ADDR", "") if request else ""),
        created_at=now,
    )
    session.save()
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": settings.ACCESS_TOKEN_TTL_MINUTES * 60,
        "refresh_expires_in": settings.REFRESH_TOKEN_TTL_HOURS * 3600,
        "session_id": str(session.id),
    }


def revoke_session(session: AuthSession, reason: str = "logout") -> None:
    session.revoked = True
    session.revoked_at = now_utc()
    session.revoked_reason = reason
    session.save()


def revoke_all_for_user(user: User, reason: str = "admin_revoked") -> int:
    count = 0
    for session in AuthSession.objects(user_id=str(user.id), revoked=False):
        revoke_session(session, reason=reason)
        count += 1
    user.token_version = (user.token_version or 0) + 1
    user.save()
    return count


def rotate_session(refresh_token: str, request=None) -> dict:
    """Refresh-token rotation: old access token is replaced, refresh is reused
    only if still valid (single active session per login)."""
    session = AuthSession.objects(refresh_hash=hash_token(refresh_token)).first()
    if not session:
        raise exceptions.AuthenticationFailed("Invalid refresh token.")
    if session.revoked:
        raise exceptions.AuthenticationFailed("Session has been revoked.")
    if session.refresh_expires_at <= now_utc():
        raise exceptions.AuthenticationFailed("Refresh token expired. Please sign in again.")
    user = User.objects(id=session.user_id, is_active=True).first()
    if not user:
        raise exceptions.AuthenticationFailed("Account is not available.")

    access = random_token(32)
    # Give the token we are replacing a short grace window. Without it, any
    # request that was already in flight (browser retries, a second tab, React
    # StrictMode's duplicate effects) is rejected with 401 the instant a sibling
    # request refreshes — which the client reads as "your session has ended".
    session.previous_access_hash = session.access_hash or ""
    session.previous_access_grace_until = now_utc() + timedelta(
        seconds=settings.AUTH_REFRESH_GRACE_SECONDS
    )
    session.access_hash = hash_token(access)
    session.access_expires_at = now_utc() + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES)
    session.last_used_at = now_utc()
    session.save()
    return {
        "access_token": access,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "expires_in": settings.ACCESS_TOKEN_TTL_MINUTES * 60,
        "user": user.to_public(),
    }


class MongoTokenAuthentication(authentication.BaseAuthentication):
    """Bearer tokens over `Authorization`, with a mirror channel.

    `X-Auth-Token` carries the same opaque token for environments whose HTTP
    proxy strips `Authorization` (some sandboxed-iframe previews do). Both are
    TLS-only headers, neither is logged, and the token is identical — so the
    second channel adds no exposure beyond the first.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header:
            mirror = request.META.get("HTTP_X_AUTH_TOKEN", "").strip()
            if mirror:
                header = [self.keyword.encode(), mirror.encode()]
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Malformed Authorization header. Use 'Bearer <token>'.")
        try:
            token = header[1].decode()
        except UnicodeError as exc:  # pragma: no cover
            raise exceptions.AuthenticationFailed("Invalid token encoding.") from exc

        token_hash = hash_token(token)
        session = AuthSession.objects(access_hash=token_hash, revoked=False).first()
        within_grace = False
        if not session:
            # A token minted just before the last rotation is still honoured for
            # a few seconds (see rotate_session / AUTH_REFRESH_GRACE_SECONDS).
            session = AuthSession.objects(previous_access_hash=token_hash, revoked=False).first()
            grace_until = getattr(session, "previous_access_grace_until", None) if session else None
            if not session or not grace_until or grace_until <= now_utc():
                raise exceptions.AuthenticationFailed(
                    "Session is invalid or has been signed out."
                )
            within_grace = True
        if not within_grace and session.access_expires_at <= now_utc():
            raise exceptions.AuthenticationFailed("Access token has expired.")

        user = User.objects(id=session.user_id).first()
        if not user or not user.is_active:
            raise exceptions.AuthenticationFailed("Account is inactive or deactivated.")

        request.session_doc = session
        request.auth = session
        return (user, session)

    def authenticate_header(self, request):  # noqa: ARG002
        return "Bearer"
