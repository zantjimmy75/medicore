from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class LoginThrottle(AnonRateThrottle):
    scope = "login"

    def get_cache_key(self, request, view):
        # Throttle per IP *and* per submitted email so one noisy IP cannot
        # lock out the whole clinic, and one account cannot be brute-forced
        # from many IPs silently.
        email = (request.data or {}).get("email", "") if hasattr(request, "data") else ""
        ident = f"{self.get_ident(request)}:{str(email).lower()[:80]}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PasswordResetThrottle(AnonRateThrottle):
    scope = "password_reset"


class WriteThrottle(SimpleRateThrottle):
    scope = "write"

    def get_cache_key(self, request, view):
        if not getattr(request, "user", None):
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(request.user.id)}


class QRScanThrottle(SimpleRateThrottle):
    scope = "qr_scan"

    def get_cache_key(self, request, view):
        ident = str(getattr(request.user, "id", "") or self.get_ident(request))
        return self.cache_format % {"scope": self.scope, "ident": ident}
