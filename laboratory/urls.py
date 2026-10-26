from django.urls import path

from apps.laboratory import views

urlpatterns = [
    path("tests/", views.LabTestListCreateView.as_view(), name="lab-test-list"),
    path("tests/<str:test_id>/", views.LabTestDetailView.as_view(), name="lab-test-detail"),
    path("requests/", views.LabRequestListCreateView.as_view(), name="lab-request-list"),
    path("requests/<str:request_ref>/", views.LabRequestDetailView.as_view(), name="lab-request-detail"),
    path("requests/<str:request_ref>/results/", views.LabResultCreateView.as_view(),
         name="lab-result-create"),
    path("requests/<str:request_ref>/preliminary-pdf/", views.LabRequestPreliminaryPdfView.as_view(),
         name="lab-preliminary-pdf"),
    path("results/<str:result_id>/verify/", views.LabResultVerifyView.as_view(), name="lab-result-verify"),
    path("results/<str:result_id>/release/", views.LabResultReleaseView.as_view(), name="lab-result-release"),
    path("reports/", views.LabReportListView.as_view(), name="lab-report-list"),
    path("reports/<str:report_id>/", views.LabReportDetailView.as_view(), name="lab-report-detail"),
    path("reports/<str:report_id>/pdf/", views.LabReportPdfView.as_view(), name="lab-report-pdf"),
    path("workload/", views.LabWorkloadView.as_view(), name="lab-workload"),
]
