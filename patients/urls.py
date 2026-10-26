from django.urls import path

from apps.medical_records import views as medical_views
from apps.patients import views

urlpatterns = [
    path("", views.PatientListCreateView.as_view(), name="patient-list"),
    path("duplicate-check/", views.PatientDuplicateCheckView.as_view(), name="patient-duplicate-check"),
    # Deregistration workflow. The queue route must come before <patient_ref>/.
    path("deregistration-requests/", views.DeregistrationQueueView.as_view(),
         name="deregistration-queue"),
    path("verify-card/<str:token>/", views.PatientCardVerifyView.as_view(), name="patient-verify"),
    path("<str:patient_ref>/", views.PatientDetailView.as_view(), name="patient-detail"),
    path("<str:patient_ref>/photo/", views.PatientPhotoView.as_view(), name="patient-photo"),
    path("<str:patient_ref>/merge/", views.PatientMergeView.as_view(), name="patient-merge"),
    # Deregistration: receptionist requests, clinic administrator decides.
    path("<str:patient_ref>/deregister/", views.PatientDeregisterView.as_view(),
         name="patient-deregister"),
    path("<str:patient_ref>/deregistration-requests/",
         views.PatientDeregistrationRequestView.as_view(), name="patient-deregistration-requests"),
    path("<str:patient_ref>/deregistration-requests/<str:request_id>/decision/",
         views.PatientDeregistrationDecisionView.as_view(),
         name="patient-deregistration-decision"),
    path("<str:patient_ref>/id-card/", views.PatientIDCardView.as_view(), name="patient-card"),
    path("<str:patient_ref>/id-card/preview/", views.PatientCardPreviewView.as_view(), name="patient-card-preview"),
    path("<str:patient_ref>/id-card/pdf/", views.PatientCardPdfView.as_view(), name="patient-card-pdf"),
    path("<str:patient_ref>/id-card/<str:card_id>/revoke/", views.PatientCardRevokeView.as_view(),
         name="patient-card-revoke"),
    # Medical records are nested under the patient per the API contract
    path("<str:patient_ref>/medical-history/", medical_views.MedicalHistoryView.as_view(),
         name="patient-medical-history"),
    path("<str:patient_ref>/medical-history/amendments/", medical_views.MedicalHistoryAmendView.as_view(),
         name="patient-medical-history-amend"),
    path("<str:patient_ref>/consultations/", medical_views.ConsultationListCreateView.as_view(),
         name="patient-consultations"),
    path("<str:patient_ref>/consultations/<str:consultation_id>/", medical_views.ConsultationDetailView.as_view(),
         name="patient-consultation-detail"),
    path("<str:patient_ref>/vital-signs/", medical_views.VitalSignsListCreateView.as_view(),
         name="patient-vitals"),
    path("<str:patient_ref>/summary/pdf/", medical_views.ClinicalSummaryPdfView.as_view(),
         name="patient-summary-pdf"),
]
