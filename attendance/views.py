from __future__ import annotations

from datetime import date, datetime, timedelta

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.throttles import QRScanThrottle, WriteThrottle
from apps.attendance.documents import AttendanceRecord, ShiftAssignment
from apps.attendance.services import (
    apply_correction,
    attendance_query,
    attendance_summary,
    clock_in,
    clock_out,
    duty_state_for,
    flag_missing_clockouts,
    on_duty_dashboard,
    verify_staff_identity,
)
from apps.core.audit import log_action
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.permissions import Role, require_roles
from apps.core.utils import (
    clinic_tz,
    date_range_bounds,
    local_date_of,
    now_utc,
    paginate,
    parse_bool,
)
from apps.staff.documents import Department, Shift, Staff


def _resolve_staff(data: dict) -> Staff:
    staff_ref = (data.get("staff_id") or "").strip()
    staff_doc_id = (data.get("staff_doc_id") or "").strip()
    if staff_doc_id:
        staff = Staff.objects(id=staff_doc_id, is_deleted__ne=True).first()
    elif staff_ref:
        staff = Staff.objects(staff_id=staff_ref, is_deleted__ne=True).first()
        if not staff and len(staff_ref) == 24:
            staff = Staff.objects(id=staff_ref, is_deleted__ne=True).first()
    else:
        staff = None
    return staff


class ClockInSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["qr_scan", "manual", "self_service"],
                                     default="qr_scan")
    card_token = serializers.CharField(required=False, allow_blank=True, default="")
    staff_id = serializers.CharField(required=False, allow_blank=True, default="")
    staff_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    pin = serializers.CharField(required=False, allow_blank=True, default="", trim_whitespace=True)
    shift_id = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=500)
    allow_outside_roster = serializers.BooleanField(required=False, default=False)


class ClockOutSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["qr_scan", "manual", "self_service"],
                                     default="qr_scan")
    card_token = serializers.CharField(required=False, allow_blank=True, default="")
    staff_id = serializers.CharField(required=False, allow_blank=True, default="")
    staff_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    pin = serializers.CharField(required=False, allow_blank=True, default="", trim_whitespace=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=500)


class ClockInView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [QRScanThrottle]

    def post(self, request):
        serializer = ClockInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        method = data["method"]

        staff = _resolve_staff(data)
        if method == "self_service" and staff is None:
            staff = Staff.objects(user_id=str(request.user.id), is_deleted__ne=True).first()
        staff, pin_verified = verify_staff_identity(
            card_token=data.get("card_token"), staff=staff, pin=data.get("pin"),
            actor=request.user, method=method,
        )
        if method != "manual" and request.user.role not in Role.ATTENDANCE_MANAGE_ROLES | {
            Role.DOCTOR, Role.NURSE, Role.LAB_SCIENTIST, Role.RECEPTIONIST
        } and staff.user_id != str(request.user.id):
            raise Forbidden("Your role cannot record attendance for another staff member.")

        allow_outside = data.get("allow_outside_roster", False)
        if allow_outside and request.user.role not in Role.ATTENDANCE_MANAGE_ROLES:
            raise Forbidden("Only an attendance officer can record unrostered attendance.")

        record = clock_in(
            staff=staff, actor=request.user, method=method, request=request,
            shift_id=data.get("shift_id", ""), notes=data.get("notes", ""),
            pin_verified=pin_verified, allow_outside_roster=allow_outside,
        )
        log_action(action="attendance.clock_in", request=request, actor=request.user,
                   target_type="attendance_record", target_id=str(record.id),
                   description=f"{staff.staff_id} clocked in via {method}",
                   meta={"late_minutes": record.late_minutes, "pin": pin_verified})
        return Response({"attendance": record.to_dict(), "staff": staff.to_summary(),
                         "message": f"{staff.full_name} clocked in at "
                                    f"{record.clock_in_at.astimezone(clinic_tz()).strftime('%H:%M')}."}, status=201)


class ClockOutView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [QRScanThrottle]

    def post(self, request):
        serializer = ClockOutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        method = data["method"]
        staff = _resolve_staff(data)
        if method == "self_service" and staff is None:
            staff = Staff.objects(user_id=str(request.user.id), is_deleted__ne=True).first()
        staff, pin_verified = verify_staff_identity(
            card_token=data.get("card_token"), staff=staff, pin=data.get("pin"),
            actor=request.user, method=method,
        )
        record = clock_out(staff=staff, actor=request.user, method=method, request=request,
                           notes=data.get("notes", ""), pin_verified=pin_verified)
        log_action(action="attendance.clock_out", request=request, actor=request.user,
                   target_type="attendance_record", target_id=str(record.id),
                   description=f"{staff.staff_id} clocked out via {method}",
                   meta={"total_hours": record.total_hours})
        return Response({"attendance": record.to_dict(), "staff": staff.to_summary(),
                         "message": f"{staff.full_name} clocked out. "
                                    f"Total hours: {record.total_hours}."})


class AttendanceListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        p = request.query_params
        staff_doc_id = p.get("staff_doc_id", "")
        # Non-management roles may only read their own attendance.
        if user.role not in Role.ATTENDANCE_MANAGE_ROLES | Role.ADMIN_ROLES:
            own = Staff.objects(user_id=str(user.id)).first()
            if not own:
                raise Forbidden("You do not have access to attendance records.")
            staff_doc_id = str(own.id)
        qs = attendance_query(
            start=p.get("start"), end=p.get("end"), staff_doc_id=staff_doc_id,
            department_id=p.get("department_id", ""), status=p.get("status", ""),
            method=p.get("method", ""),
        )
        if parse_bool(p.get("open_only"), False):
            qs = qs.filter(is_open=True)
        if parse_bool(p.get("late_only"), False):
            qs = qs.filter(late_minutes__gt=0)
        return Response(paginate(qs, p.get("page"), p.get("page_size"),
                                 lambda r: r.to_dict()))


class TodayAttendanceView(APIView):
    """Dashboard tile data: present / late / incomplete counts for today."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES, *Role.ADMIN_ROLES)
        day = request.query_params.get("date") or local_date_of()
        records = list(AttendanceRecord.objects(work_date=day))
        active_staff = Staff.objects(is_deleted__ne=True, status="approved",
                                     employment_status="active").count()

        # A staff member can clock in more than once a day (a closed session
        # followed by a new one is legal), so totals must be aggregated per
        # staff member — counting raw records would report more people present
        # than the clinic employs.
        sessions_by_staff: dict[str, list[AttendanceRecord]] = {}
        for record in records:
            sessions_by_staff.setdefault(record.staff_doc_id, []).append(record)
        for sessions in sessions_by_staff.values():
            sessions.sort(key=lambda r: r.clock_in_at or now_utc())

        day_value = day if isinstance(day, date) else date.fromisoformat(str(day))
        staff_docs = {str(s.id): s for s in
                      Staff.objects(id__in=list(sessions_by_staff))} if sessions_by_staff else {}
        assignments = {a.staff_doc_id: a for a in ShiftAssignment.objects(
            staff_doc_id__in=list(sessions_by_staff), work_date=str(day),
            status__ne="cancelled")} if sessions_by_staff else {}

        rows = []
        for staff_doc_id, sessions in sessions_by_staff.items():
            latest = sessions[-1]
            staff = staff_docs.get(staff_doc_id)
            payload = latest.to_dict()
            payload["duty_state"] = (
                duty_state_for(staff, day_value, latest, assignments.get(staff_doc_id))
                if staff else ("on_duty" if latest.is_open else "completed")
            )
            payload["sessions_today"] = len(sessions)
            payload["first_clock_in_at"] = sessions[0].clock_in_at
            rows.append(payload)
        rows.sort(key=lambda r: r.get("staff_name") or "")

        return Response({
            "date": day,
            "active_staff": active_staff,
            "present": len(sessions_by_staff),
            "late": sum(1 for sessions in sessions_by_staff.values()
                        if any(r.late_minutes > 0 for r in sessions)),
            "incomplete": sum(1 for sessions in sessions_by_staff.values()
                              if sessions[-1].status == "incomplete"),
            "currently_in": sum(1 for sessions in sessions_by_staff.values()
                                if any(r.is_open for r in sessions)),
            "completed": sum(1 for sessions in sessions_by_staff.values()
                             if not any(r.is_open for r in sessions)),
            "total_sessions": len(records),
            "records": rows[:50],
        })


class CorrectionsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, record_id):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES)
        record = AttendanceRecord.objects(id=record_id).first()
        if not record:
            raise NotFound("Attendance record not found.")
        payload = request.data or {}
        reason = (payload.get("reason") or "").strip()
        changes = {k: payload[k] for k in ("clock_in_at", "clock_out_at", "status", "notes")
                   if k in payload}
        if not changes:
            raise APIError("Provide at least one field to correct.", code="no_changes",
                           status_code=400)
        parsed = {}
        for key in ("clock_in_at", "clock_out_at"):
            if key in changes and changes[key]:
                try:
                    parsed[key] = datetime.fromisoformat(str(changes[key]).replace("Z", "+00:00"))
                except ValueError as exc:
                    raise APIError(f"{key} must be an ISO-8601 timestamp.", code="invalid_timestamp",
                                   status_code=400) from exc
            elif key in changes:
                parsed[key] = None
        if "status" in changes:
            parsed["status"] = changes["status"]
        if "notes" in changes:
            parsed["notes"] = changes["notes"]
        record = apply_correction(record, actor=request.user, reason=reason, changes=parsed,
                                  request=request)
        log_action(action="attendance.corrected", request=request, actor=request.user,
                   target_type="attendance_record", target_id=str(record.id),
                   description=f"Correction for {record.staff_id}: {reason}",
                   meta={"fields": list(parsed)})
        return Response({"attendance": record.to_dict(), "message": "Correction recorded."})


class AttendanceReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES, *Role.ADMIN_ROLES)
        p = request.query_params
        period = p.get("period", "month")
        start, end = p.get("start"), p.get("end")
        if not start and not end:
            today = now_utc().astimezone(clinic_tz()).date()
            if period == "day":
                start = end = today.isoformat()
            elif period == "week":
                start = (today - timedelta(days=today.weekday())).isoformat()
                end = today.isoformat()
            else:
                start = today.replace(day=1).isoformat()
                end = today.isoformat()
        summary = attendance_summary(start=start, end=end,
                                    department_id=p.get("department_id", ""),
                                    staff_doc_id=p.get("staff_doc_id", ""))
        records = attendance_query(start=start, end=end, department_id=p.get("department_id", ""),
                                   staff_doc_id=p.get("staff_doc_id", ""))
        rows = [r.to_dict() for r in records.limit(500)]
        return Response({"period": {"start": start, "end": end, "kind": period},
                         "summary": summary, "records": rows})


class FlagMissingClockoutsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        count = flag_missing_clockouts()
        log_action(action="attendance.flagged_missing_clockouts", request=request,
                   actor=request.user, meta={"count": count})
        return Response({"message": f"{count} attendance record(s) flagged as incomplete.",
                         "count": count})


class MyAttendanceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        staff = Staff.objects(user_id=str(request.user.id), is_deleted__ne=True).first()
        if not staff:
            return Response({"staff": None, "records": [],
                             "message": "No staff record is linked to your account."})
        from apps.attendance.services import staff_attendance_snapshot

        records = AttendanceRecord.objects(staff_doc_id=str(staff.id)).order_by("-clock_in_at").limit(30)
        return Response({
            "staff": staff.to_summary(),
            "today": staff_attendance_snapshot(staff),
            "records": [r.to_dict() for r in records],
        })
