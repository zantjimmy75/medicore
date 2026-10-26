from django.urls import path

from apps.appointments import views

urlpatterns = [
    path("", views.AppointmentListCreateView.as_view(), name="appointment-list"),
    path("availability/", views.ClinicianAvailabilityView.as_view(), name="appointment-availability"),
    path("clinicians/", views.ClinicianListView.as_view(), name="appointment-clinicians"),
    path("stats/", views.AppointmentStatsView.as_view(), name="appointment-stats"),
    path("<str:appointment_id>/", views.AppointmentDetailView.as_view(), name="appointment-detail"),
]
