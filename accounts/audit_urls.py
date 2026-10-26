from django.urls import path

from apps.accounts import views as account_views
from apps.core.views import AuditLogView, AuditLogSummaryView

urlpatterns = [
    path("", AuditLogView.as_view(), name="audit-list"),
    path("summary/", AuditLogSummaryView.as_view(), name="audit-summary"),
]
