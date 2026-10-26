from __future__ import annotations

from datetime import date, datetime, timedelta

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attendance.documents import ShiftAssignment
from apps.attendance.services import on_duty_dashboard, shift_window
from apps.core.audit import log_action
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.permissions import Role, require_roles
from apps.core.utils import clinic_tz, now_utc, parse_bool, parse_date
from apps.staff.documents import Department, Shift, Staff


class AssignmentSerializer(serializers.Serializer):
    staff_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    staff_id = serializers.CharField(required=False, allow_blank=True, default="")
    shift_id = serializers.CharField()
    work_date = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=300)
    is_public_holiday = serializers.BooleanField(required=False, default=False)


def _staff_or_404(staff_doc_id: str, staff_id: str) -> Staff:
    staff = None
    if staff_doc_id:
        staff = Staff.objects(id=staff_doc_id, is_deleted__ne=True).first()
    elif staff_id:
        staff = Staff.objects(staff_id=staff_id, is_deleted__ne=True).first()
    if not staff:
        raise NotFound("Staff member not found.")
    if not staff.is_active_employee:
        raise Conflict(f"{staff.full_name} is not an active employee.", code="staff_inactive")
    return staff


def _assign_one(staff: Staff, data: dict, request, work_date: date | None = None,
                silent: bool = False) -> ShiftAssignment | None:
    shift = Shift.objects(id=data["shift_id"]).first()
    if not shift:
        raise NotFound("Shift not found.")
    work_date = work_date or parse_date(str(data.get("work_date")))
    if not work_date:
        raise APIError("work_date is required.", code="missing_date", status_code=400)
    existing = ShiftAssignment.objects(staff_doc_id=str(staff.id),
                                       work_date=work_date.isoformat(),
                                       shift_id=str(shift.id), status__ne="cancelled").first()
    if existing:
        if silent:
            raise Conflict("Already rostered for this shift.")
        raise Conflict(f"{staff.full_name} is already rostered for {shift.name} on "
                       f"{work_date.isoformat()}.", code="duplicate_assignment")
    starts_at, ends_at = shift_window(work_date, shift)
    assignment = ShiftAssignment(
        staff_doc_id=str(staff.id), staff_id=staff.staff_id, staff_name=staff.full_name,
        department_id=staff.department_id, department_name=staff.department_name,
        job_title=staff.job_title, shift_id=str(shift.id), shift_code=shift.code,
        shift_name=shift.name, shift_start=shift.start_time, shift_end=shift.end_time,
        is_overnight=shift.is_overnight, work_date=work_date.isoformat(),
        starts_at=starts_at, ends_at=ends_at,
        is_weekend=work_date.weekday() >= 5,
        is_public_holiday=bool(data.get("is_public_holiday", False)),
        notes=data.get("notes", ""), assigned_by=str(request.user.id),
        assigned_by_name=request.user.full_name,
    )
    try:
        assignment.save(force_insert=True)
    except Exception as exc:  # DuplicateKeyError from a concurrent insert
        if "duplicate" in str(exc).lower():
            raise Conflict("This staff member is already rostered for that shift and date.",
                           code="duplicate_assignment") from exc
        raise
    log_action(action="roster.assigned", request=request, actor=request.user,
               target_type="shift_assignment", target_id=str(assignment.id),
               description=f"{staff.staff_id} -> {shift.code} on {work_date.isoformat()}")
    return assignment


def _bulk_assign(request, payload) -> tuple[list, list]:
    staff_ids = payload.get("staff_doc_ids") or []
    dates = [d for d in (parse_date(d) for d in (payload.get("dates") or [])) if d]
    shift_id = payload.get("shift_id")
    if not staff_ids or not dates or not shift_id:
        raise APIError("Bulk assignment requires staff_doc_ids, dates and shift_id.",
                       code="invalid_bulk_request", status_code=400)
    created, skipped = [], []
    for staff_id in staff_ids[:200]:
        staff = _staff_or_404(staff_id, "")
        for day in dates[:62]:
            try:
                assignment = _assign_one(staff, {"shift_id": shift_id}, request,
                                         work_date=day, silent=True)
                created.append(assignment.to_dict())
            except Conflict as exc:
                skipped.append({"staff_id": staff.staff_id, "date": day.isoformat(),
                                "reason": str(exc.detail)})
    return created, skipped


class RosterListView(APIView):
    """/api/duty-roster/ — GET the roster, POST a (possibly bulk) assignment."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        p = request.query_params
        start = parse_date(p.get("start")) or now_utc().astimezone(clinic_tz()).date()
        end = parse_date(p.get("end")) or start + timedelta(days=6)
        if (end - start).days > 62:
            raise APIError("Date range cannot exceed 62 days.", code="range_too_large",
                           status_code=400)
        qs = ShiftAssignment.objects(
            work_date__gte=start.isoformat(), work_date__lte=end.isoformat(), status__ne="cancelled"
        )
        if p.get("department_id"):
            qs = qs.filter(department_id=p["department_id"])
        if p.get("shift_id"):
            qs = qs.filter(shift_id=p["shift_id"])
        if p.get("staff_doc_id"):
            qs = qs.filter(staff_doc_id=p["staff_doc_id"])
        if p.get("role"):
            staff_ids = [str(s.id) for s in Staff.objects(role=p["role"], is_deleted__ne=True)]
            qs = qs.filter(staff_doc_id__in=staff_ids)
        assignments = [a.to_dict() for a in qs.order_by("work_date", "shift_start")]
        return Response({
            "range": {"start": start.isoformat(), "end": end.isoformat()},
            "assignments": assignments,
            "total": len(assignments),
        })


    def post(self, request):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES)
        payload = request.data or {}
        if payload.get("staff_doc_ids") or payload.get("dates"):
            created, skipped = _bulk_assign(request, payload)
            return Response({
                "created": created, "skipped": skipped,
                "message": f"{len(created)} assignment(s) created, {len(skipped)} skipped.",
            }, status=201)

        serializer = AssignmentSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        staff = _staff_or_404(data.get("staff_doc_id"), data.get("staff_id"))
        assignment = _assign_one(staff, data, request)
        return Response({"assignment": assignment.to_dict()}, status=201)


class RosterDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, assignment_id):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES)
        assignment = ShiftAssignment.objects(id=assignment_id).first()
        if not assignment:
            raise NotFound("Roster entry not found.")
        assignment.status = "cancelled"
        assignment.notes = (assignment.notes + f" | Cancelled by {request.user.full_name}").strip(" |")
        assignment.updated_at = now_utc()
        assignment.save()
        log_action(action="roster.cancelled", request=request, actor=request.user,
                   target_type="shift_assignment", target_id=str(assignment.id))
        return Response({"message": "Roster entry cancelled."})


class OnDutyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES, *Role.ADMIN_ROLES,
                      Role.DOCTOR, Role.NURSE, Role.LAB_SCIENTIST, Role.RECEPTIONIST)
        p = request.query_params
        day = parse_date(p.get("date")) or now_utc().astimezone(clinic_tz()).date()
        payload = on_duty_dashboard(
            day=day,
            department_id=p.get("department_id", ""),
            role=p.get("role", ""),
            shift_id=p.get("shift_id", ""),
            include_off_duty=parse_bool(p.get("include_off_duty"), False),
        )
        return Response(payload)


class RosterPdfView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.ATTENDANCE_MANAGE_ROLES, *Role.ADMIN_ROLES)
        from apps.core.documents import ClinicSettings
        from apps.core.pdf import render_table_pdf

        p = request.query_params
        start = parse_date(p.get("start")) or now_utc().astimezone(clinic_tz()).date()
        end = parse_date(p.get("end")) or start + timedelta(days=6)
        qs = ShiftAssignment.objects(work_date__gte=start.isoformat(),
                                     work_date__lte=end.isoformat(), status__ne="cancelled")
        rows = [[a.work_date, a.staff_name, a.staff_id, a.department_name, a.shift_name,
                 f"{a.shift_start}–{a.shift_end}"] for a in qs.order_by("work_date", "shift_start")]
        pdf = render_table_pdf(
            title=f"Duty Roster {start.isoformat()} to {end.isoformat()}",
            subtitle="Shift assignments generated from the roster",
            headers=["Date", "Staff", "Staff ID", "Department", "Shift", "Hours"],
            rows=rows,
            clinic=ClinicSettings.load().to_public(),
            footer_note="Internal scheduling document.",
        )
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="duty-roster-{start}.pdf"'
        return response
