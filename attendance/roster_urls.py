from django.urls import path

from apps.attendance import roster_views

urlpatterns = [
    path("", roster_views.RosterListView.as_view(), name="roster-list"),
    path("on-duty/", roster_views.OnDutyView.as_view(), name="roster-on-duty"),
    path("pdf/", roster_views.RosterPdfView.as_view(), name="roster-pdf"),
    path("<str:assignment_id>/", roster_views.RosterDetailView.as_view(), name="roster-detail"),
]
