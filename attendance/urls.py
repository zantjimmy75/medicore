from django.urls import path

from apps.attendance import views

urlpatterns = [
    path("clock-in/", views.ClockInView.as_view(), name="attendance-clock-in"),
    path("clock-out/", views.ClockOutView.as_view(), name="attendance-clock-out"),
    path("", views.AttendanceListView.as_view(), name="attendance-list"),
    path("today/", views.TodayAttendanceView.as_view(), name="attendance-today"),
    path("mine/", views.MyAttendanceView.as_view(), name="attendance-mine"),
    path("reports/", views.AttendanceReportView.as_view(), name="attendance-reports"),
    path("flag-missing-clockouts/", views.FlagMissingClockoutsView.as_view(),
         name="attendance-flag-missing"),
    path("<str:record_id>/correction/", views.CorrectionsView.as_view(), name="attendance-correction"),
]
