from django.urls import path

from apps.medical_records import views

# Consultations and vitals are exposed under /api/patients/{ref}/... in
# patients/urls.py (matching the proposed API contract). These extra routes
# support cross-patient clinical views without a patient reference.
urlpatterns = [
    path("consultations/mine/", views.MyConsultationsView.as_view(), name="consultations-mine"),
]
