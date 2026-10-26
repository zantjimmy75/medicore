"""Attendance + duty-status domain logic.

Time handling
-------------
* All timestamps are stored timezone-aware in UTC.
* `work_date` is the **clinic-local** calendar date on which the shift starts,
  stored as an ISO string so daily reports never depend on the server TZ.
* An overnight shift (end <= start) belongs to its start date and its expected
  end falls on the following local day.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password
from mongoengine.errors import NotUniqueError
from pymongo.errors import DuplicateKeyError

from apps.attendance.documents import AttendanceRecord, ShiftAssignment
from apps.core.documents import ClinicSettings
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.utils import (
    clinic_tz,
    combine_local,
    date_range_bounds,
    generate_id,
    local_date_of,
    now_utc,
    parse_hhmm,
    to_utc,
)
from apps.staff.documents import Shift, Staff, StaffIDCard

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- windows
def shift_window(work_date: date, shift: Shift) -> tuple[datetime, datetime]:
    start = combine_local(work_date, parse_hhmm(shift.start_time))
    end_day = work_date + timedelta(days=1) if shift.is_overnight else work_date
    end = combine_local(end_day, parse_hhmm(shift.end_time))
    return start, end


def expected_shift_for(staff: Staff, work_date: date) -> tuple[Shift | None, ShiftAssignment | None]:
    """Roster assignment wins; otherwise fall back to the staff member's default shift."""
    assignment = ShiftAssignment.objects(
        staff_doc_id=str(staff.id), work_date=work_date.isoformat(), status__ne="cancelled"
    ).first()
    if assignment:
        shift = Shift.objects(id=assignment.shift_id).first()
        return shift, assignment
    if staff.shift_id:
        try:
            return Shift.objects(id=staff.shift_id, is_active=True).first(), None
        except Exception:  # noqa: BLE001 - malformed legacy reference
            logger.warning("Staff %s has an invalid shift reference", staff.staff_id)
    return None, None


def _find_open_record(staff: Staff) -> AttendanceRecord | None:
    return AttendanceRecord.objects(staff_doc_id=str(staff.id), is_open=True).order_by("-clock_in_at").first()


# --------------------------------------------------------------- clock in
def clock_in(*, staff: Staff, actor, method: str, request=None, shift_id: str = "",
             work_date: date | None = None, notes: str = "", pin_verified: bool = False,
             allow_outside_roster: bool = False) -> AttendanceRecord:
    if not staff.is_active_employee:
        raise Conflict(f"{staff.full_name} is not an active employee "
                       f"(status: {staff.employment_status}).", code="staff_inactive")

    now = now_utc()
    today_local = now.astimezone(clinic_tz()).date()
    work_date = work_date or today_local

    shift, assignment = expected_shift_for(staff, work_date)
    if shift_id:
        explicit = Shift.objects(id=shift_id).first()
        if not explicit:
            raise NotFound("Shift not found.")
        shift = explicit
    if shift is None:
        shift = _ad_hoc_shift()
        if not allow_outside_roster:
            raise Conflict(
                "No shift is scheduled for this staff member on "
                f"{work_date.isoformat()}. Assign a roster entry or provide a shift explicitly.",
                code="no_shift_scheduled",
            )

    open_record = _find_open_record(staff)
    if open_record:
        raise Conflict(
            f"{staff.full_name} is already clocked in since "
            f"{open_record.clock_in_at.astimezone(clinic_tz()).strftime('%H:%M')} "
            f"({open_record.work_date}). Clock out before starting a new session.",
            code="already_clocked_in",
            extra={"attendance_id": str(open_record.id)},
        )

    expected_start, expected_end = shift_window(work_date, shift)
    grace = ClinicSettings.load().late_grace_minutes or 0
    late_minutes = max(0, int((now - expected_start).total_seconds() // 60) - grace)

    record = AttendanceRecord(
        staff_doc_id=str(staff.id),
        staff_id=staff.staff_id,
        staff_name=staff.full_name,
        department_id=staff.department_id,
        department_name=staff.department_name,
        job_title=staff.job_title,
        assignment_id=str(assignment.id) if assignment else "",
        shift_id=str(shift.id) if shift else "",
        shift_code=shift.code if shift else "ADHOC",
        shift_name=shift.name if shift else "Ad hoc attendance",
        shift_start=shift.start_time if shift else "",
        shift_end=shift.end_time if shift else "",
        shift_expected_start=expected_start,
        shift_expected_end=expected_end,
        work_date=work_date.isoformat(),
        clock_in_at=now,
        is_open=True,
        status="late" if late_minutes > 0 else "present",
        late_minutes=late_minutes,
        method=method,
        recorded_by=str(getattr(actor, "id", "") or ""),
        recorded_by_name=getattr(actor, "full_name", "") or "",
        recorded_by_role=getattr(actor, "role", "") or "",
        verified_by_pin=pin_verified,
        device_info=(request.META.get("HTTP_USER_AGENT", "")[:200] if request else ""),
        ip_address=(request.META.get("REMOTE_ADDR", "") if request else ""),
        notes=notes,
    )
    try:
        record.save(force_insert=True)
    except (DuplicateKeyError, NotUniqueError) as exc:
        # Concurrent scan of the same card for the same shift/date.
        existing = AttendanceRecord.objects(
            staff_doc_id=str(staff.id), work_date=work_date.isoformat(),
            shift_id=str(shift.id), is_open=True,
        ).first()
        raise Conflict(
            "An open attendance session already exists for this shift and date.",
            code="already_clocked_in",
            extra={"attendance_id": str(existing.id) if existing else None},
        ) from exc
    return record


def _ad_hoc_shift() -> Shift:
    shift = Shift.objects(code="ADHOC").first()
    if shift:
        return shift
    now_local = now_utc().astimezone(clinic_tz())
    shift = Shift(
        name="Ad hoc attendance", code="ADHOC",
        start_time=now_local.strftime("%H:%M"), end_time=(now_local + timedelta(hours=8)).strftime("%H:%M"),
        notes="System-generated placeholder used when no roster exists.",
    )
    shift.save()
    return shift


# -------------------------------------------------------------- clock out
def clock_out(*, staff: Staff, actor, method: str, request=None, notes: str = "",
              pin_verified: bool = False) -> AttendanceRecord:
    record = _find_open_record(staff)
    if not record:
        raise Conflict(
            f"{staff.full_name} has no open attendance session. Use the correction workflow if a "
            "clock-in was missed.",
            code="no_open_session",
        )
    now = now_utc()
    if now <= record.clock_in_at:
        raise APIError("Clock-out time must be after the clock-in time.", code="invalid_time",
                       status_code=400)

    shift_minutes = 0
    if record.shift_expected_end and record.shift_expected_start:
        shift_minutes = int((record.shift_expected_end - record.shift_expected_start).total_seconds() // 60)

    worked_minutes = int((now - record.clock_in_at).total_seconds() // 60)
    if worked_minutes > 24 * 60:
        # Guard against a forgotten clock-out spanning days: flag for correction.
        record.status = "incomplete"
        record.notes = (record.notes + " | Clock-out exceeded 24h; flagged for review.").strip(" |")
    record.clock_out_at = now
    record.is_open = False
    record.total_hours = round(worked_minutes / 60.0, 2)
    record.early_departure_minutes = max(
        0, int((record.shift_expected_end - now).total_seconds() // 60)
    ) if record.shift_expected_end else 0
    record.overtime_minutes = max(0, worked_minutes - shift_minutes) if shift_minutes else 0
    if record.status != "incomplete":
        record.status = "late" if record.late_minutes > 0 else "completed"
    record.method = method if method == "qr_scan" else record.method
    record.recorded_by = str(getattr(actor, "id", "") or record.recorded_by)
    record.recorded_by_name = getattr(actor, "full_name", "") or record.recorded_by_name
    record.recorded_by_role = getattr(actor, "role", "") or record.recorded_by_role
    record.verified_by_pin = pin_verified or record.verified_by_pin
    if notes:
        record.notes = (record.notes + f" | {notes}").strip(" |")
    record.updated_at = now
    record.save()
    return record


def apply_correction(record: AttendanceRecord, *, actor, reason: str, changes: dict,
                     request=None) -> AttendanceRecord:
    """Authorised correction. The original values are preserved in `corrections`."""
    if not reason or len(reason.strip()) < 5:
        raise APIError("A correction reason of at least 5 characters is required.",
                       code="reason_required", status_code=400)
    before = {
        "clock_in_at": record.clock_in_at,
        "clock_out_at": record.clock_out_at,
        "status": record.status,
        "total_hours": record.total_hours,
        "late_minutes": record.late_minutes,
    }
    if "clock_in_at" in changes and changes["clock_in_at"]:
        record.clock_in_at = to_utc(changes["clock_in_at"])
    if "clock_out_at" in changes:
        record.clock_out_at = to_utc(changes["clock_out_at"]) if changes["clock_out_at"] else None
    if record.clock_out_at and record.clock_out_at <= record.clock_in_at:
        raise APIError("Clock-out must be after clock-in.", code="invalid_time", status_code=400)
    record.is_open = record.clock_out_at is None
    if record.clock_out_at:
        worked = int((record.clock_out_at - record.clock_in_at).total_seconds() // 60)
        record.total_hours = round(worked / 60.0, 2)
        expected_end = record.shift_expected_end
        record.early_departure_minutes = (max(0, int((expected_end - record.clock_out_at).total_seconds() // 60))
                                          if expected_end else 0)
        record.status = "late" if record.late_minutes > 0 else "completed"
    else:
        record.total_hours = 0.0
        record.status = "late" if record.late_minutes > 0 else "present"
    if "status" in changes and changes["status"]:
        record.status = changes["status"]
    if "notes" in changes and changes["notes"]:
        record.notes = changes["notes"]
    record.corrections = list(record.corrections or []) + [{
        "corrected_at": now_utc(),
        "corrected_by": str(getattr(actor, "id", "") or ""),
        "corrected_by_name": getattr(actor, "full_name", "") or "",
        "reason": reason.strip(),
        "before": {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in before.items()},
        "after": {
            "clock_in_at": record.clock_in_at.isoformat(),
            "clock_out_at": record.clock_out_at.isoformat() if record.clock_out_at else None,
            "status": record.status,
            "total_hours": record.total_hours,
            "late_minutes": record.late_minutes,
        },
    }]
    record.correction_count = (record.correction_count or 0) + 1
    record.method = "correction"
    record.updated_at = now_utc()
    record.save()
    return record


# ------------------------------------------------------------- verification
def verify_staff_identity(*, card_token: str | None, staff: Staff | None = None,
                          pin: str | None = None, actor=None, method: str = "qr_scan") -> tuple[Staff, bool]:
    """Resolve and verify a staff member for an attendance action.

    A QR scan alone is never sufficient:
      * `manual`      -> actor must hold an attendance-management role.
      * `qr_scan`     -> actor must be signed in AND (staff PIN verified OR the
                         officer explicitly attests identity).
      * `self_service`-> the signed-in account must belong to the staff member.
    """
    from apps.core.permissions import Role

    if method == "manual":
        if actor is None or actor.role not in Role.ATTENDANCE_MANAGE_ROLES:
            raise Forbidden("Manual attendance requires an attendance officer or administrator.")
        if staff is None:
            raise APIError("staff_id is required for manual attendance.", code="missing_staff",
                           status_code=400)
        return staff, False

    if method == "self_service":
        if staff is None or staff.user_id != str(getattr(actor, "id", "")):
            raise Forbidden("Self-service attendance is limited to your own staff record.")
        return staff, True

    # qr_scan
    if actor is None:
        raise Forbidden("Sign in before scanning a staff card for attendance.")
    if not card_token:
        raise APIError("card_token is required.", code="missing_token", status_code=400)
    import hashlib

    card = StaffIDCard.objects(token_hash=hashlib.sha256(card_token.encode()).hexdigest()).first()
    if not card:
        raise NotFound("Card not recognised.")
    if card.status != "active":
        raise Conflict(f"This card is {card.status} and cannot be used for attendance.",
                       code="card_inactive")
    if card.expires_at and card.expires_at < now_utc():
        raise Conflict("This card has expired.", code="card_expired")
    staff = Staff.objects(id=card.staff_doc_id, is_deleted__ne=True).first()
    if not staff:
        raise NotFound("Staff record not found for this card.")

    if staff.has_attendance_pin:
        if not pin:
            raise APIError("This staff member must confirm their attendance PIN.",
                           code="pin_required", status_code=401)
        if not check_password(str(pin), staff.attendance_pin_hash):
            raise APIError("Incorrect attendance PIN.", code="invalid_pin",
                           status_code=401)
        return staff, True
    # No PIN configured: the signed-in officer attests identity (recorded in the
    # audit log with their identity and role).
    if actor.role not in Role.ATTENDANCE_MANAGE_ROLES | {Role.DOCTOR, Role.NURSE, Role.LAB_SCIENTIST,
                                                         Role.RECEPTIONIST}:
        raise Forbidden("Your role cannot record attendance.")
    return staff, False


# --------------------------------------------------------------- snapshots
def staff_attendance_snapshot(staff: Staff, day: date | None = None,
                              include_records: bool = False) -> dict:
    day = day or now_utc().astimezone(clinic_tz()).date()
    record = AttendanceRecord.objects(staff_doc_id=str(staff.id), work_date=day.isoformat()).first()
    assignment = ShiftAssignment.objects(
        staff_doc_id=str(staff.id), work_date=day.isoformat(), status__ne="cancelled"
    ).first()
    data = {
        "date": day.isoformat(),
        "scheduled": bool(assignment) or bool(staff.shift_id),
        "shift_code": (assignment.shift_code if assignment else staff.shift_code) or "",
        "scheduled_start": (assignment.starts_at if assignment else None),
        "scheduled_end": (assignment.ends_at if assignment else None),
        "clocked_in_at": record.clock_in_at if record else None,
        "clocked_out_at": record.clock_out_at if record else None,
        "is_open": bool(record and record.is_open),
        "status": record.status if record else None,
        "late_minutes": record.late_minutes if record else 0,
        "total_hours": record.total_hours if record else 0,
        "duty_state": duty_state_for(staff, day, record, assignment),
    }
    if include_records:
        data["recent_records"] = [
            r.to_dict() for r in AttendanceRecord.objects(staff_doc_id=str(staff.id))
            .order_by("-clock_in_at").limit(10)
        ]
    return data


def duty_state_for(staff: Staff, day: date, record: AttendanceRecord | None,
                   assignment: ShiftAssignment | None) -> str:
    """One of: scheduled | not_scheduled | on_duty | late | absent | completed | left_early."""
    if not staff.is_active_employee:
        return "not_available"
    if record:
        if record.is_open:
            return "on_duty" if record.late_minutes == 0 else "on_duty"
        if record.status == "incomplete":
            return "incomplete"
        return "completed"
    if not assignment:
        return "not_scheduled"
    now = now_utc()
    grace = timedelta(minutes=ClinicSettings.load().late_grace_minutes or 0)
    if now < assignment.starts_at - timedelta(hours=1):
        return "scheduled"
    if now < assignment.starts_at + grace:
        return "scheduled"
    if now < assignment.ends_at:
        return "late"
    return "absent"


def on_duty_dashboard(*, day: date | None = None, department_id: str = "", role: str = "",
                     shift_id: str = "", include_off_duty: bool = False) -> dict:
    """Live duty board combining roster, attendance and clinic time zone."""
    now = now_utc()
    day = day or now.astimezone(clinic_tz()).date()
    yesterday = day - timedelta(days=1)

    staff_qs = Staff.objects(is_deleted__ne=True, status="approved")
    if department_id:
        staff_qs = staff_qs.filter(department_id=department_id)
    if role:
        staff_qs = staff_qs.filter(role=role)
    staff_list = list(staff_qs)
    staff_by_id = {str(s.id): s for s in staff_list}

    # Assignments for today plus yesterday's overnight shifts still running.
    assignments = list(ShiftAssignment.objects(
        work_date__in=[day.isoformat(), yesterday.isoformat()], status__ne="cancelled"
    ))
    if shift_id:
        assignments = [a for a in assignments if a.shift_id == shift_id]

    records = list(AttendanceRecord.objects(work_date__in=[day.isoformat(), yesterday.isoformat()]))
    open_by_staff: dict[str, AttendanceRecord] = {}
    for r in records:
        if not r.is_open:
            continue
        current = open_by_staff.get(r.staff_doc_id)
        if current is None or r.clock_in_at > current.clock_in_at:
            open_by_staff[r.staff_doc_id] = r

    on_duty, expected, late, completed, absent, off_shift = [], [], [], [], [], []
    seen = set()

    for assignment in assignments:
        staff = staff_by_id.get(assignment.staff_doc_id)
        if not staff or not staff.is_active_employee:
            continue
        if assignment.work_date != day.isoformat() and not assignment.is_overnight:
            continue  # only yesterday's *overnight* shifts can still be running
        if assignment.is_overnight and assignment.work_date == yesterday.isoformat() and assignment.ends_at < now:
            continue  # overnight shift already finished
        if assignment.starts_at > now + timedelta(hours=8):
            continue
        seen.add(assignment.staff_doc_id)
        record = open_by_staff.get(assignment.staff_doc_id)
        if record is not None and record.work_date != assignment.work_date:
            # The open session belongs to a different (e.g. today's) shift.
            record = None
        closed = AttendanceRecord.objects(
            staff_doc_id=assignment.staff_doc_id, work_date=assignment.work_date
        ).first()
        entry = {
            **staff.to_summary(),
            "assignment_id": str(assignment.id),
            "shift_code": assignment.shift_code,
            "shift_name": assignment.shift_name,
            "shift_start": assignment.shift_start,
            "shift_end": assignment.shift_end,
            "is_overnight": assignment.is_overnight,
            "starts_at": assignment.starts_at,
            "ends_at": assignment.ends_at,
            "clock_in_at": (record or closed).clock_in_at if (record or closed) else None,
            "clock_out_at": (record or closed).clock_out_at if (record or closed) else None,
            "late_minutes": (record or closed).late_minutes if (record or closed) else 0,
            "total_hours": (record or closed).total_hours if (record or closed) else 0,
            "attendance_id": str((record or closed).id) if (record or closed) else None,
        }
        grace = timedelta(minutes=ClinicSettings.load().late_grace_minutes or 0)
        if record:
            entry["duty_state"] = "on_duty"
            on_duty.append(entry)
        elif closed and not closed.is_open:
            entry["duty_state"] = "completed"
            completed.append(entry)
        elif now > assignment.starts_at + grace and now < assignment.ends_at:
            entry["duty_state"] = "late"
            late.append(entry)
        elif now >= assignment.ends_at:
            entry["duty_state"] = "absent"
            absent.append(entry)
        else:
            entry["duty_state"] = "scheduled"
            expected.append(entry)

    # Staff clocked in without a roster entry (ad hoc / unassigned)
    seen_on_duty = {entry.get("id") for entry in on_duty}
    for staff_id, record in open_by_staff.items():
        if staff_id in seen_on_duty:
            continue
        if staff_id in seen:
            continue
        staff = staff_by_id.get(staff_id)
        if not staff:
            continue
        on_duty.append({
            **staff.to_summary(),
            "assignment_id": "",
            "shift_code": record.shift_code,
            "shift_name": record.shift_name,
            "shift_start": record.shift_start,
            "shift_end": record.shift_end,
            "is_overnight": False,
            "starts_at": record.shift_expected_start,
            "ends_at": record.shift_expected_end,
            "clock_in_at": record.clock_in_at,
            "clock_out_at": None,
            "late_minutes": record.late_minutes,
            "total_hours": 0,
            "attendance_id": str(record.id),
            "duty_state": "on_duty",
            "unrostered": True,
        })
        seen_on_duty.add(staff_id)

    if include_off_duty:
        for staff in staff_list:
            if str(staff.id) in seen or str(staff.id) in open_by_staff:
                continue
            off_shift.append({**staff.to_summary(), "duty_state": "not_scheduled"})

    departments: dict[str, dict] = {}
    for entry in on_duty:
        key = entry.get("department_name") or "Unassigned"
        dept = departments.setdefault(key, {"department": key, "on_duty": 0, "names": []})
        dept["on_duty"] += 1
        if len(dept["names"]) < 6:
            dept["names"].append(entry["full_name"])

    return {
        "date": day.isoformat(),
        "generated_at": now,
        "timezone": settings.TIME_ZONE,
        "counts": {
            "on_duty": len(on_duty),
            "scheduled": len(expected),
            "late": len(late),
            "absent": len(absent),
            "completed": len(completed),
            "total_scheduled": len(seen),
        },
        "on_duty": sorted(on_duty, key=lambda e: e.get("department_name") or ""),
        "expected": expected,
        "late": late,
        "absent": absent,
        "completed": completed,
        "off_duty": off_shift,
        "departments": sorted(departments.values(), key=lambda d: -d["on_duty"]),
    }


# ----------------------------------------------------------------- reports
def attendance_query(*, start=None, end=None, staff_doc_id="", department_id="",
                     status="", method=""):
    qs = AttendanceRecord.objects()
    start_dt, end_dt = date_range_bounds(start, end)
    if start_dt:
        qs = qs.filter(clock_in_at__gte=start_dt)
    if end_dt:
        qs = qs.filter(clock_in_at__lt=end_dt)
    if staff_doc_id:
        qs = qs.filter(staff_doc_id=staff_doc_id)
    if department_id:
        qs = qs.filter(department_id=department_id)
    if status:
        qs = qs.filter(status=status)
    if method:
        qs = qs.filter(method=method)
    return qs.order_by("-clock_in_at")


def attendance_summary(*, start=None, end=None, department_id="", staff_doc_id="") -> dict:
    qs = attendance_query(start=start, end=end, department_id=department_id,
                          staff_doc_id=staff_doc_id)
    records = list(qs.limit(5000))
    total_minutes = sum(int((r.total_hours or 0) * 60) for r in records)
    by_department: dict[str, dict] = {}
    by_staff: dict[str, dict] = {}
    for r in records:
        dept = by_department.setdefault(r.department_name or "Unassigned", {
            "department": r.department_name or "Unassigned", "records": 0,
            "total_hours": 0.0, "late": 0, "incomplete": 0,
        })
        dept["records"] += 1
        dept["total_hours"] = round(dept["total_hours"] + (r.total_hours or 0), 2)
        dept["late"] += 1 if r.late_minutes > 0 else 0
        dept["incomplete"] += 1 if r.status == "incomplete" else 0

        person = by_staff.setdefault(r.staff_doc_id, {
            "staff_doc_id": r.staff_doc_id, "staff_id": r.staff_id, "staff_name": r.staff_name,
            "department_name": r.department_name, "records": 0, "total_hours": 0.0,
            "late_count": 0, "incomplete_count": 0, "last_clock_in": None,
        })
        person["records"] += 1
        person["total_hours"] = round(person["total_hours"] + (r.total_hours or 0), 2)
        person["late_count"] += 1 if r.late_minutes > 0 else 0
        person["incomplete_count"] += 1 if r.status == "incomplete" else 0
        if not person["last_clock_in"] or r.clock_in_at > person["last_clock_in"]:
            person["last_clock_in"] = r.clock_in_at

    # Missing clock-outs older than 16h are flagged as incomplete for follow-up.
    stale = AttendanceRecord.objects(is_open=True,
                                     clock_in_at__lt=now_utc() - timedelta(hours=16)).count()

    return {
        "records": len(records),
        "total_hours": round(total_minutes / 60.0, 2),
        "late_events": sum(1 for r in records if r.late_minutes > 0),
        "incomplete_records": sum(1 for r in records if r.status == "incomplete"),
        "open_sessions": sum(1 for r in records if r.is_open),
        "stale_open_sessions": stale,
        "by_department": sorted(by_department.values(), key=lambda d: -d["total_hours"]),
        "by_staff": sorted(by_staff.values(), key=lambda s: -s["total_hours"]),
        "corrected_records": sum(1 for r in records if r.correction_count),
    }


def flag_missing_clockouts() -> int:
    """Mark long-open sessions as incomplete (called by a scheduled job)."""
    cutoff = now_utc() - timedelta(hours=16)
    updated = 0
    for record in AttendanceRecord.objects(is_open=True, clock_in_at__lt=cutoff):
        record.status = "incomplete"
        record.notes = (record.notes + " | Missing clock-out flagged automatically.").strip(" |")
        record.updated_at = now_utc()
        record.save()
        updated += 1
    return updated
