from __future__ import annotations

import mongoengine as me

from apps.core.utils import now_utc

ATTENDANCE_STATUS = ("present", "late", "absent", "incomplete", "on_leave", "completed")


class ShiftAssignment(me.Document):
    """A roster entry: one staff member on one shift for one local date."""

    meta = {
        "collection": "shift_schedules",
        "indexes": [
            # One assignment per staff, per date, per shift template.
            {"fields": ["staff_doc_id", "work_date", "shift_id"], "unique": True},
            {"fields": ["work_date"]},
            {"fields": ["department_id", "work_date"]},
            {"fields": ["staff_doc_id", "work_date"]},
        ],
    }

    staff_doc_id = me.StringField(required=True)
    staff_id = me.StringField(required=True)
    staff_name = me.StringField(default="")
    department_id = me.StringField(default="")
    department_name = me.StringField(default="")
    job_title = me.StringField(default="")

    shift_id = me.StringField(required=True)
    shift_code = me.StringField(default="")
    shift_name = me.StringField(default="")
    shift_start = me.StringField(default="")  # "08:00"
    shift_end = me.StringField(default="")  # "16:00"
    is_overnight = me.BooleanField(default=False)

    work_date = me.StringField(required=True)  # clinic-local YYYY-MM-DD of shift start
    starts_at = me.DateTimeField(required=True)  # UTC
    ends_at = me.DateTimeField(required=True)  # UTC

    status = me.StringField(default="scheduled")  # scheduled|swapped|cancelled
    is_public_holiday = me.BooleanField(default=False)
    is_weekend = me.BooleanField(default=False)
    notes = me.StringField(default="")
    assigned_by = me.StringField(default="")
    assigned_by_name = me.StringField(default="")
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "staff_doc_id": self.staff_doc_id,
            "staff_id": self.staff_id,
            "staff_name": self.staff_name,
            "department_id": self.department_id,
            "department_name": self.department_name,
            "job_title": self.job_title,
            "shift_id": self.shift_id,
            "shift_code": self.shift_code,
            "shift_name": self.shift_name,
            "shift_start": self.shift_start,
            "shift_end": self.shift_end,
            "is_overnight": self.is_overnight,
            "work_date": self.work_date,
            "starts_at": self.starts_at,
            "ends_at": self.ends_at,
            "status": self.status,
            "is_weekend": self.is_weekend,
            "is_public_holiday": self.is_public_holiday,
            "notes": self.notes,
            "assigned_by_name": self.assigned_by_name,
        }


class AttendanceRecord(me.Document):
    meta = {
        "collection": "attendance_records",
        "indexes": [
            # Atomic duplicate prevention for *open* sessions only: a second
            # concurrent clock-in for the same staff/shift/date fails at the
            # database level. Closed sessions do not block a new clock-in later
            # in the day (for example after a correction or a split shift).
            {"fields": ["staff_doc_id", "work_date", "shift_id"], "unique": True,
             "name": "uniq_open_attendance_session",
             "partialFilterExpression": {"is_open": True}},
            {"fields": ["work_date"]},
            {"fields": ["staff_doc_id", "work_date"]},
            {"fields": ["is_open"]},
            {"fields": ["clock_in_at"]},
        ],
    }

    staff_doc_id = me.StringField(required=True)
    staff_id = me.StringField(required=True)
    staff_name = me.StringField(default="")
    department_id = me.StringField(default="")
    department_name = me.StringField(default="")
    job_title = me.StringField(default="")

    assignment_id = me.StringField(default="")
    shift_id = me.StringField(default="")
    shift_code = me.StringField(default="")
    shift_name = me.StringField(default="")
    shift_start = me.StringField(default="")
    shift_end = me.StringField(default="")
    shift_expected_start = me.DateTimeField(null=True)
    shift_expected_end = me.DateTimeField(null=True)

    work_date = me.StringField(required=True)  # clinic-local date of the shift start
    clock_in_at = me.DateTimeField(required=True)
    clock_out_at = me.DateTimeField(null=True)
    is_open = me.BooleanField(default=True)

    status = me.StringField(default="present")  # present|late|incomplete|completed|absent
    late_minutes = me.IntField(default=0)
    early_departure_minutes = me.IntField(default=0)
    overtime_minutes = me.IntField(default=0)
    total_hours = me.FloatField(default=0.0)

    method = me.StringField(default="qr_scan")  # qr_scan|manual|self_service|correction
    recorded_by = me.StringField(default="")
    recorded_by_name = me.StringField(default="")
    recorded_by_role = me.StringField(default="")
    verified_by_pin = me.BooleanField(default=False)
    device_info = me.StringField(default="")
    ip_address = me.StringField(default="")

    notes = me.StringField(default="")
    corrections = me.ListField(me.DictField(), default=list)
    correction_count = me.IntField(default=0)
    created_at = me.DateTimeField(default=now_utc)
    updated_at = me.DateTimeField(default=now_utc)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "staff_doc_id": self.staff_doc_id,
            "staff_id": self.staff_id,
            "staff_name": self.staff_name,
            "department_id": self.department_id,
            "department_name": self.department_name,
            "job_title": self.job_title,
            "assignment_id": self.assignment_id,
            "shift_id": self.shift_id,
            "shift_code": self.shift_code,
            "shift_name": self.shift_name,
            "shift_start": self.shift_start,
            "shift_end": self.shift_end,
            "shift_expected_start": self.shift_expected_start,
            "shift_expected_end": self.shift_expected_end,
            "work_date": self.work_date,
            "clock_in_at": self.clock_in_at,
            "clock_out_at": self.clock_out_at,
            "is_open": self.is_open,
            "status": self.status,
            "late_minutes": self.late_minutes,
            "early_departure_minutes": self.early_departure_minutes,
            "overtime_minutes": self.overtime_minutes,
            "total_hours": self.total_hours,
            "method": self.method,
            "recorded_by_name": self.recorded_by_name,
            "verified_by_pin": self.verified_by_pin,
            "notes": self.notes,
            "correction_count": self.correction_count,
            "corrections": list(self.corrections or []),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
