from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("login/", views.LoginView.as_view(), name="auth-login"),
    path("logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("logout-all/", views.LogoutAllView.as_view(), name="auth-logout-all"),
    path("refresh/", views.RefreshView.as_view(), name="auth-refresh"),
    path("me/", views.MeView.as_view(), name="auth-me"),
    path("session/", views.SessionInfoView.as_view(), name="auth-session"),
    path("password-reset/", views.PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("password-reset/confirm/", views.PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("password-change/", views.PasswordChangeView.as_view(), name="auth-password-change"),
    path("roles/", views.RolesView.as_view(), name="auth-roles"),
    path("users/", views.UserListCreateView.as_view(), name="user-list"),
    path("users/<str:user_id>/", views.UserDetailView.as_view(), name="user-detail"),
    path("users/<str:user_id>/password/", views.AdminResetPasswordView.as_view(), name="user-password"),
    path("users/<str:user_id>/sessions/", views.UserSessionsView.as_view(), name="user-sessions"),
]
