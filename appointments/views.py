from __future__ import annotations

from datetime import datetime, time, timedelta

from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.documents import User
from apps.appointments.documents import STATUSES, Appointment
from apps.core.audit import log_action
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.permissions import Role, require_roles
from apps.core.utils import combine_local, generate_id, now_utc, paginate, parse_date, to_utc
from apps.patients.documents import Patient
from apps.staff.documents import Staff


def _check_conflict(clinician_user_id: str, start: datetime, duration: int,
                    exclude_id: str | None = None) -> list[dict]:
    """Return overlapping active appointments for the same clinician."""
    end = start + timedelta(minutes=duration)
    window_start = start - timedelta(hours=6)
    window_end = end + timedelta(hours=6)
    qs = Appointment.objects(
        clinician_user_id=clinician_user_id,
        scheduled_at__gte=window_start,
        scheduled_at__lte=window_end,
        status__in=["scheduled", "confirmed"],
    )
    conflicts = []
    for appt in qs:
        if exclude_id and str(appt.id) == exclude_id:
            continue
        appt_end = appt.ends_at()
        if appt.scheduled_at < end and appt_end > start:
            conflicts.append({
                "appointment_number": appt.appointment_number,
                "patient_name": appt.patient_name,
                "scheduled_at": appt.scheduled_at,
                "ends_at": appt_end,
            })
    return conflicts


class AppointmentCreateSerializer(serializers.Serializer):
    patient_number = serializers.CharField(required=False, allow_blank=True, default="")
    patient_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    clinician_user_id = serializers.CharField()
    scheduled_at = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(required=False, min_value=10, max_value=240,
                                                 default=30)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    department_id = serializers.CharField(required=False, allow_blank=True, default="")
    allow_double_booking = serializers.BooleanField(required=False, default=False)

    def validate_scheduled_at(self, value):
        return to_utc(value)


class AppointmentUpdateSerializer(serializers.Serializer):
    scheduled_at = serializers.DateTimeField(required=False)
    duration_minutes = serializers.IntegerField(required=False, min_value=10, max_value=240)
    clinician_user_id = serializers.CharField(required=False)
    status = serializers.ChoiceField(choices=STATUSES, required=False)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    cancellation_reason = serializers.CharField(max_length=300, required=False, allow_blank=True)
    allow_double_booking = serializers.BooleanField(required=False, default=False)

    def validate_scheduled_at(self, value):
        return to_utc(value)


class AppointmentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.APPOINTMENT_ROLES)
        p = request.query_params
        qs = Appointment.objects()
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("patient_doc_id"):
            qs = qs.filter(patient_doc_id=p["patient_doc_id"])
        if p.get("patient_number"):
            qs = qs.filter(patient_number=p["patient_number"])
        if p.get("clinician_user_id"):
            qs = qs.filter(clinician_user_id=p["clinician_user_id"])
        if p.get("mine") and request.user.role == Role.DOCTOR:
            qs = qs.filter(clinician_user_id=str(request.user.id))
        if p.get("department_id"):
            qs = qs.filter(department_id=p["department_id"])
        if p.get("date"):
            day = parse_date(p["date"])
            if day:
                start = combine_local(day, time.min)
                qs = qs.filter(scheduled_at__gte=start, scheduled_at__lt=start + timedelta(days=1))
        elif p.get("start") or p.get("end"):
            from apps.core.utils import date_range_bounds

            s, e = date_range_bounds(p.get("start"), p.get("end"))
            if s:
                qs = qs.filter(scheduled_at__gte=s)
            if e:
                qs = qs.filter(scheduled_at__lt=e)
        if p.get("search"):
            term = p["search"]
            qs = qs.filter(__raw__={"$or": [
                {"patient_name": {"$regex": term, "$options": "i"}},
                {"patient_number": {"$regex": term, "$options": "i"}},
                {"clinician_name": {"$regex": term, "$options": "i"}},
                {"appointment_number": {"$regex": term, "$options": "i"}},
            ]})
        if p.get("upcoming") and p["upcoming"] in {"1", "true"}:
            qs = qs.filter(scheduled_at__gte=now_utc(), status__in=["scheduled", "confirmed"])
        qs = qs.order_by("-scheduled_at" if p.get("past") in {"1", "true"} else "scheduled_at")
        return Response(paginate(qs, p.get("page"), p.get("page_size"), lambda a: a.to_dict()))

    def post(self, request):
        require_roles(request.user, *Role.APPOINTMENT_ROLES)
        serializer = AppointmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        patient = None
        if data.get("patient_doc_id"):
            patient = Patient.objects(id=data["patient_doc_id"]).first()
        elif data.get("patient_number"):
            patient = Patient.objects(patient_number=data["patient_number"]).first()
        if not patient:
            raise NotFound("Patient not found.")
        if patient.status not in {"active", "inactive"}:
            raise Conflict(f"Cannot book appointments for a patient with status '{patient.status}'.",
                           code="patient_not_active")

        clinician = User.objects(id=data["clinician_user_id"], is_active=True).first()
        if not clinician:
            raise NotFound("Clinician account not found.")
        if clinician.role not in {Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN}:
            raise APIError("The selected user is not a clinician.", code="invalid_clinician",
                           status_code=400)
        staff = Staff.objects(user_id=str(clinician.id)).first()

        conflicts = _check_conflict(str(clinician.id), data["scheduled_at"],
                                    data.get("duration_minutes", 30))
        if conflicts:
            raise Conflict(
                "The clinician already has an appointment that overlaps this time.",
                code="appointment_conflict",
                extra={"conflicts": conflicts},
            )

        appointment = Appointment(
            appointment_number=generate_id("APT", pad=5),
            patient_doc_id=str(patient.id),
            patient_number=patient.patient_number,
            patient_name=patient.full_name,
            clinician_user_id=str(clinician.id),
            clinician_name=clinician.full_name,
            clinician_staff_id=staff.staff_id if staff else "",
            department_id=(staff.department_id if staff else data.get("department_id", "")),
            department_name=(staff.department_name if staff else ""),
            scheduled_at=data["scheduled_at"],
            duration_minutes=data.get("duration_minutes", 30),
            reason=data.get("reason", ""),
            notes=data.get("notes", ""),
            status="scheduled",
            created_by=str(request.user.id),
            created_by_name=request.user.full_name,
            status_history=[{"status": "scheduled", "at": now_utc(),
                             "by_name": request.user.full_name, "reason": "Appointment created"}],
        )
        appointment.save()
        log_action(action="appointment.created", request=request, actor=request.user,
                   target_type="appointment", target_id=str(appointment.id),
                   patient_id=str(patient.id),
                   description=f"{appointment.appointment_number} with {clinician.full_name}")
        return Response({"appointment": appointment.to_dict()}, status=201)


class AppointmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, appointment_id):
        require_roles(request.user, *Role.APPOINTMENT_ROLES)
        appointment = Appointment.objects(id=appointment_id).first()
        if not appointment:
            raise NotFound("Appointment not found.")
        return Response({"appointment": appointment.to_dict()})

    def patch(self, request, appointment_id):
        require_roles(request.user, *Role.APPOINTMENT_ROLES)
        appointment = Appointment.objects(id=appointment_id).first()
        if not appointment:
            raise NotFound("Appointment not found.")
        serializer = AppointmentUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        allow_double = data.pop("allow_double_booking", False)
        new_status = data.get("status")
        clinician_id = data.get("clinician_user_id", appointment.clinician_user_id)
        scheduled_at = data.get("scheduled_at", appointment.scheduled_at)
        duration = data.get("duration_minutes", appointment.duration_minutes)

        if new_status in {"cancelled", "missed"} and not (
            data.get("cancellation_reason") or appointment.cancellation_reason
        ):
            raise APIError("A cancellation reason is required.", code="reason_required",
                           status_code=400)
        if appointment.status in {"cancelled", "completed"} and new_status and new_status not in {
            appointment.status
        }:
            raise Conflict(f"Cannot change a {appointment.status} appointment to {new_status}.",
                           code="invalid_transition")
        if not allow_double and (new_status in {None, "scheduled", "confirmed"}):
            conflicts = _check_conflict(str(clinician_id), scheduled_at, duration,
                                        exclude_id=str(appointment.id))
            if conflicts:
                raise Conflict("This change would create a conflicting appointment.",
                               code="appointment_conflict", extra={"conflicts": conflicts})

        if "clinician_user_id" in data:
            clinician = User.objects(id=clinician_id, is_active=True).first()
            if not clinician:
                raise NotFound("Clinician not found.")
            appointment.clinician_user_id = str(clinician.id)
            appointment.clinician_name = clinician.full_name
        for field in ("scheduled_at", "duration_minutes", "reason", "notes", "cancellation_reason"):
            if field in data:
                setattr(appointment, field, data[field])
        if new_status and new_status != appointment.status:
            appointment.status_history = list(appointment.status_history or []) + [{
                "status": new_status, "previous": appointment.status, "at": now_utc(),
                "by_name": request.user.full_name,
                "reason": data.get("cancellation_reason", ""),
            }]
            appointment.status = new_status
        appointment.updated_by = str(request.user.id)
        appointment.updated_at = now_utc()
        appointment.save()
        log_action(action="appointment.updated", request=request, actor=request.user,
                   target_type="appointment", target_id=str(appointment.id),
                   patient_id=appointment.patient_doc_id,
                   description=f"Updated: {', '.join(data.keys()) or new_status or 'none'}")
        return Response({"appointment": appointment.to_dict()})


class ClinicianAvailabilityView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.APPOINTMENT_ROLES)
        clinician_id = request.query_params.get("clinician_user_id")
        day = parse_date(request.query_params.get("date")) or now_utc().date()
        if not clinician_id:
            raise APIError("clinician_user_id is required.", code="missing_param", status_code=400)
        clinician = User.objects(id=clinician_id).first()
        if not clinician:
            raise NotFound("Clinician not found.")
        start = combine_local(day, time(8, 0))
        end = combine_local(day, time(18, 0))
        booked = list(Appointment.objects(
            clinician_user_id=clinician_id, scheduled_at__gte=start, scheduled_at__lt=end,
            status__in=["scheduled", "confirmed"],
        ).order_by("scheduled_at"))
        slots = []
        cursor = start
        while cursor < end:
            overlapping = [b for b in booked if b.scheduled_at < cursor + timedelta(minutes=30)
                           and b.ends_at() > cursor]
            slots.append({
                "start": cursor,
                "available": not overlapping,
                "appointment": overlapping[0].appointment_number if overlapping else None,
            })
            cursor += timedelta(minutes=30)
        return Response({
            "clinician": {"id": str(clinician.id), "name": clinician.full_name,
                          "role": clinician.role},
            "date": day.isoformat(),
            "working_hours": {"start": "08:00", "end": "18:00"},
            "booked": [{
                "appointment_number": b.appointment_number,
                "patient_name": b.patient_name,
                "scheduled_at": b.scheduled_at,
                "ends_at": b.ends_at(),
                "duration_minutes": b.duration_minutes,
            } for b in booked],
            "slots": slots,
        })


class ClinicianListView(APIView):
    """Doctors and nurses who can be assigned appointments."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.APPOINTMENT_ROLES)
        accounts = User.objects(is_active=True,
                                role__in=[Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN])
        result = []
        for account in accounts.order_by("full_name"):
            staff = Staff.objects(user_id=str(account.id)).first()
            result.append({
                "user_id": str(account.id),
                "full_name": account.full_name,
                "role": account.role,
                "department_id": staff.department_id if staff else "",
                "department_name": staff.department_name if staff else "",
                "job_title": staff.job_title if staff else Role.LABELS.get(account.role, ""),
            })
        return Response({"clinicians": result})


class AppointmentStatsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.APPOINTMENT_ROLES, Role.HR_OFFICER)
        today_start = combine_local(now_utc().date(), time.min)
        tomorrow = today_start + timedelta(days=1)
        counts = {status: Appointment.objects(status=status).count() for status in STATUSES}
        return Response({
            "counts": counts,
            "today": Appointment.objects(scheduled_at__gte=today_start,
                                         scheduled_at__lt=tomorrow).count(),
            "today_completed": Appointment.objects(status="completed", scheduled_at__gte=today_start,
                                                   scheduled_at__lt=tomorrow).count(),
            "upcoming": Appointment.objects(scheduled_at__gte=now_utc(),
                                             status__in=["scheduled", "confirmed"]).count(),
        })
