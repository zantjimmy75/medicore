from __future__ import annotations

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import log_action
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.permissions import Role, can_view_medical_record, require_roles
from apps.core.utils import generate_id, now_utc, parse_bool, to_utc
from apps.medical_records.documents import Consultation, MedicalHistory, VitalSigns
from apps.patients.documents import Patient


def _patient_or_404(patient_ref: str) -> Patient:
    patient = Patient.objects(patient_number=patient_ref).first()
    if not patient and len(patient_ref) == 24:
        try:
            patient = Patient.objects(id=patient_ref).first()
        except Exception:  # noqa: BLE001
            patient = None
    if not patient:
        raise NotFound("Patient not found.")
    return patient


def _require_medical_read(user, patient):
    if not can_view_medical_record(user, patient):
        log_action(action="medical.access_denied", actor=user, target_type="patient",
                   target_id=str(patient.id), patient_id=str(patient.id),
                   description="Attempted access to medical record without permission",
                   outcome="failure")
        raise Forbidden("Your role does not permit access to clinical records.")


def _require_medical_write(user):
    require_roles(user, Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)


# -------------------------------------------------------------- medical hx
MEDICAL_FIELDS = MedicalHistory.FIELDS


class MedicalHistorySerializer(serializers.Serializer):
    presenting_complaint = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    history_of_present_illness = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    past_medical_conditions = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    past_surgeries = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    allergies = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    allergy_reactions = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    current_medications = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    past_medications = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    family_history = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    social_history = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    previous_diagnoses = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    immunizations = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    risk_factors = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    clinical_notes = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    treatment_followup_plan = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    amendment_reason = serializers.CharField(required=False, allow_blank=True, default="")
    finalize = serializers.BooleanField(required=False, default=False)


class MedicalHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_read(request.user, patient)
        record = MedicalHistory.objects(patient_doc_id=str(patient.id)).first()
        log_action(action="medical_history.viewed", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(patient.id))
        return Response({
            "patient": patient.to_summary(include_clinical=True),
            "medical_history": record.to_dict() if record else None,
            "exists": bool(record),
        })

    def post(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_write(request.user)
        _require_medical_read(request.user, patient)
        serializer = MedicalHistorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        reason = data.pop("amendment_reason", "")
        finalize = data.pop("finalize", False)

        record = MedicalHistory.objects(patient_doc_id=str(patient.id)).first()
        created_now = False
        if not record:
            record = MedicalHistory(
                patient_doc_id=str(patient.id),
                patient_number=patient.patient_number,
                created_by=str(request.user.id),
                created_by_name=request.user.full_name,
            )
            created_now = True

        if record.status == "finalized":
            if not reason or len(reason) < 5:
                raise APIError(
                    "This medical history is finalised. Provide an amendment reason of at least 5 characters.",
                    code="amendment_reason_required", status_code=400,
                )
            before = {f: getattr(record, f, "") for f in MEDICAL_FIELDS}
            changes = [
                {"field": f, "from": before[f], "to": data[f]}
                for f in data if f in MEDICAL_FIELDS and str(before.get(f, "")) != str(data[f])
            ]
            if not changes:
                raise APIError("No changes detected.", code="no_changes", status_code=400)
            for field, value in data.items():
                setattr(record, field, value)
            record.version = (record.version or 1) + 1
            record.amendments = list(record.amendments or []) + [{
                "amended_at": now_utc(),
                "amended_by": str(request.user.id),
                "amended_by_name": request.user.full_name,
                "reason": reason,
                "changes": changes,
                "previous_version": record.version - 1,
            }]
            record.updated_by = str(request.user.id)
            record.updated_by_name = request.user.full_name
            record.updated_at = now_utc()
            record.save()
            log_action(action="medical_history.amended", request=request, actor=request.user,
                       target_type="medical_history", target_id=str(record.id),
                       patient_id=str(patient.id),
                       description=f"Amended fields: {', '.join(c['field'] for c in changes)}",
                       meta={"reason": reason})
            return Response({"medical_history": record.to_dict(), "amended": True})

        for field, value in data.items():
            setattr(record, field, value)
        record.updated_by = str(request.user.id)
        record.updated_by_name = request.user.full_name
        record.updated_at = now_utc()
        if finalize:
            record.status = "finalized"
            record.finalized_at = now_utc()
            record.finalized_by = str(request.user.id)
            record.finalized_by_name = request.user.full_name
        record.save()
        log_action(action="medical_history.finalized" if finalize else "medical_history.updated",
                   request=request, actor=request.user,
                   target_type="medical_history", target_id=str(record.id),
                   patient_id=str(patient.id),
                   description=f"Fields: {', '.join(data.keys()) or 'none'}")
        return Response({"medical_history": record.to_dict(),
                         "created": created_now}, status=201 if created_now else 200)


class MedicalHistoryAmendView(APIView):
    """Explicit amendment endpoint (same rules as POST on a finalised record)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_write(request.user)
        record = MedicalHistory.objects(patient_doc_id=str(patient.id)).first()
        if not record:
            raise NotFound("No medical history on file for this patient.")
        reason = (request.data or {}).get("reason", "").strip()
        if len(reason) < 5:
            raise APIError("An amendment reason of at least 5 characters is required.",
                           code="amendment_reason_required", status_code=400)
        field = (request.data or {}).get("field")
        value = (request.data or {}).get("value", "")
        if field not in MEDICAL_FIELDS:
            raise APIError("Unknown field for amendment.", code="invalid_field", status_code=400)
        before = getattr(record, field, "")
        if str(before) == str(value):
            raise APIError("The new value is identical to the current value.",
                           code="no_changes", status_code=400)
        setattr(record, field, value)
        record.version = (record.version or 1) + 1
        record.amendments = list(record.amendments or []) + [{
            "amended_at": now_utc(),
            "amended_by": str(request.user.id),
            "amended_by_name": request.user.full_name,
            "reason": reason,
            "changes": [{"field": field, "from": before, "to": value}],
            "previous_version": record.version - 1,
        }]
        record.updated_by = str(request.user.id)
        record.updated_by_name = request.user.full_name
        record.updated_at = now_utc()
        record.save()
        log_action(action="medical_history.amended", request=request, actor=request.user,
                   target_type="medical_history", target_id=str(record.id),
                   patient_id=str(patient.id), description=f"Amended {field}",
                   meta={"reason": reason})
        return Response({"medical_history": record.to_dict()})


# ------------------------------------------------------------- consultations
class PrescriptionSerializer(serializers.Serializer):
    drug = serializers.CharField(max_length=120)
    dose = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    route = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    frequency = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    duration = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class DiagnosisSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=300)
    certainty = serializers.ChoiceField(choices=["provisional", "confirmed", "differential"],
                                        required=False, default="provisional")


class ConsultationSerializer(serializers.Serializer):
    consulted_at = serializers.DateTimeField(required=False)
    consultation_type = serializers.ChoiceField(
        choices=["outpatient", "follow_up", "emergency", "teleconsult"], required=False,
        default="outpatient")
    chief_complaint = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    history_of_present_illness = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    examination_findings = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    assessment = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    diagnosis = DiagnosisSerializer(many=True, required=False, default=list)
    treatment_plan = serializers.CharField(required=False, allow_blank=True, max_length=8000)
    prescriptions = PrescriptionSerializer(many=True, required=False, default=list)
    investigations_requested = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    follow_up_instructions = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    follow_up_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    appointment_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    department_name = serializers.CharField(required=False, allow_blank=True, default="")
    finalize = serializers.BooleanField(required=False, default=False)


class ConsultationListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_read(request.user, patient)
        qs = Consultation.objects(patient_doc_id=str(patient.id)).order_by("-consulted_at")
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        if start or end:
            from apps.core.utils import date_range_bounds

            s, e = date_range_bounds(start, end)
            if s:
                qs = qs.filter(consulted_at__gte=s)
            if e:
                qs = qs.filter(consulted_at__lt=e)
        limit = min(100, int(request.query_params.get("limit", 50) or 50))
        log_action(action="consultations.viewed", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(patient.id))
        return Response({"results": [c.to_dict() for c in qs.limit(limit)],
                         "total": qs.count()})

    def post(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_write(request.user)
        _require_medical_read(request.user, patient)
        serializer = ConsultationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        finalize = data.pop("finalize", False)

        from apps.staff.documents import Staff

        staff = Staff.objects(user_id=str(request.user.id), is_deleted__ne=True).first()
        consultation = Consultation(
            consultation_number=generate_id("CON", pad=5),
            patient_doc_id=str(patient.id),
            patient_number=patient.patient_number,
            patient_name=patient.full_name,
            consulted_at=to_utc(data.get("consulted_at")) if data.get("consulted_at") else now_utc(),
            consultation_type=data.get("consultation_type", "outpatient"),
            attending_user_id=str(request.user.id),
            attending_name=request.user.full_name,
            attending_role=request.user.role,
            department_name=data.get("department_name") or (staff.department_name if staff else ""),
            chief_complaint=data.get("chief_complaint", ""),
            history_of_present_illness=data.get("history_of_present_illness", ""),
            examination_findings=data.get("examination_findings", ""),
            assessment=data.get("assessment", ""),
            diagnosis=[dict(d) for d in data.get("diagnosis", [])],
            treatment_plan=data.get("treatment_plan", ""),
            prescriptions=[dict(p) for p in data.get("prescriptions", [])],
            investigations_requested=data.get("investigations_requested", ""),
            follow_up_instructions=data.get("follow_up_instructions", ""),
            follow_up_date=data.get("follow_up_date"),
            notes=data.get("notes", ""),
            appointment_doc_id=data.get("appointment_doc_id", ""),
            status="finalized" if finalize else "draft",
            finalized_at=now_utc() if finalize else None,
            finalized_by_name=request.user.full_name if finalize else "",
        )
        consultation.save()

        patient.last_visit_at = consultation.consulted_at
        patient.last_visit_type = "consultation"
        patient.save()

        if consultation.appointment_doc_id:
            from apps.appointments.documents import Appointment

            appt = Appointment.objects(id=consultation.appointment_doc_id).first()
            if appt:
                appt.status = "completed"
                appt.consultation_doc_id = str(consultation.id)
                appt.updated_at = now_utc()
                appt.save()

        log_action(action="consultation.created", request=request, actor=request.user,
                   target_type="consultation", target_id=str(consultation.id),
                   patient_id=str(patient.id),
                   description=f"Consultation {consultation.consultation_number}"
                               f" ({'finalised' if finalize else 'draft'})")
        return Response({"consultation": consultation.to_dict()}, status=201)


class ConsultationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref, consultation_id):
        patient = _patient_or_404(patient_ref)
        _require_medical_read(request.user, patient)
        consultation = Consultation.objects(id=consultation_id, patient_doc_id=str(patient.id)).first()
        if not consultation:
            raise NotFound("Consultation not found for this patient.")
        return Response({"consultation": consultation.to_dict()})

    def patch(self, request, patient_ref, consultation_id):
        patient = _patient_or_404(patient_ref)
        _require_medical_write(request.user)
        consultation = Consultation.objects(id=consultation_id, patient_doc_id=str(patient.id)).first()
        if not consultation:
            raise NotFound("Consultation not found for this patient.")
        action = (request.data or {}).get("action", "update")

        if consultation.status == "finalized":
            if action != "amend":
                raise Conflict("This consultation is finalised. Use action='amend' with a reason.",
                               code="consultation_finalized")
            reason = ((request.data or {}).get("reason") or "").strip()
            if len(reason) < 5:
                raise APIError("An amendment reason of at least 5 characters is required.",
                               code="amendment_reason_required", status_code=400)
            changes = dict((request.data or {}).get("changes") or {})
            allowed = {"chief_complaint", "history_of_present_illness", "examination_findings",
                       "assessment", "treatment_plan", "follow_up_instructions", "notes",
                       "diagnosis", "prescriptions"}
            diff = []
            for field, value in changes.items():
                if field not in allowed:
                    continue
                before = getattr(consultation, field, None)
                diff.append({"field": field, "from": before, "to": value})
                setattr(consultation, field, value)
            if not diff:
                raise APIError("No valid changes supplied.", code="no_changes", status_code=400)
            consultation.amendments = list(consultation.amendments or []) + [{
                "amended_at": now_utc(),
                "amended_by": str(request.user.id),
                "amended_by_name": request.user.full_name,
                "reason": reason,
                "changes": diff,
            }]
            consultation.status = "amended"
            consultation.updated_at = now_utc()
            consultation.save()
            log_action(action="consultation.amended", request=request, actor=request.user,
                       target_type="consultation", target_id=str(consultation.id),
                       patient_id=str(patient.id), meta={"reason": reason})
            return Response({"consultation": consultation.to_dict()})

        if action == "finalize":
            consultation.status = "finalized"
            consultation.finalized_at = now_utc()
            consultation.finalized_by_name = request.user.full_name
            consultation.updated_at = now_utc()
            consultation.save()
            log_action(action="consultation.finalized", request=request, actor=request.user,
                       target_type="consultation", target_id=str(consultation.id),
                       patient_id=str(patient.id))
            return Response({"consultation": consultation.to_dict()})

        serializer = ConsultationSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            if field == "finalize":
                continue
            if field == "consulted_at":
                value = to_utc(value)
            if field in {"diagnosis", "prescriptions"}:
                value = [dict(v) for v in value]
            setattr(consultation, field, value)
        consultation.updated_at = now_utc()
        consultation.save()
        log_action(action="consultation.updated", request=request, actor=request.user,
                   target_type="consultation", target_id=str(consultation.id),
                   patient_id=str(patient.id),
                   description=f"Fields: {', '.join(serializer.validated_data.keys())}")
        return Response({"consultation": consultation.to_dict()})


# ------------------------------------------------------------- vital signs
class VitalSignsSerializer(serializers.Serializer):
    consultation_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    recorded_at = serializers.DateTimeField(required=False)
    systolic = serializers.IntegerField(required=False, allow_null=True, min_value=40, max_value=300)
    diastolic = serializers.IntegerField(required=False, allow_null=True, min_value=20, max_value=200)
    pulse = serializers.IntegerField(required=False, allow_null=True, min_value=20, max_value=250)
    temperature_c = serializers.FloatField(required=False, allow_null=True, min_value=25, max_value=45)
    respiratory_rate = serializers.IntegerField(required=False, allow_null=True, min_value=4, max_value=80)
    oxygen_saturation = serializers.IntegerField(required=False, allow_null=True, min_value=40, max_value=100)
    weight_kg = serializers.FloatField(required=False, allow_null=True, min_value=0.3, max_value=400)
    height_cm = serializers.FloatField(required=False, allow_null=True, min_value=20, max_value=250)
    pain_score = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=10)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate(self, attrs):
        values = [attrs.get(k) for k in ("systolic", "diastolic", "pulse", "temperature_c",
                                        "respiratory_rate", "oxygen_saturation", "weight_kg",
                                        "height_cm")]
        if all(v is None for v in values):
            raise serializers.ValidationError(
                {"non_field_errors": ["Record at least one vital sign measurement."]}
            )
        if attrs.get("systolic") and attrs.get("diastolic") and attrs["systolic"] <= attrs["diastolic"]:
            raise serializers.ValidationError(
                {"systolic": ["Systolic pressure must be greater than diastolic pressure."]}
            )
        return attrs


class VitalSignsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_read(request.user, patient)
        qs = VitalSigns.objects(patient_doc_id=str(patient.id)).order_by("-recorded_at").limit(50)
        return Response({"results": [v.to_dict() for v in qs]})

    def post(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_write(request.user)
        serializer = VitalSignsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        vitals = VitalSigns(
            patient_doc_id=str(patient.id),
            patient_number=patient.patient_number,
            recorded_by=str(request.user.id),
            recorded_by_name=request.user.full_name,
            recorded_by_role=request.user.role,
            recorded_at=to_utc(data.pop("recorded_at")) if data.get("recorded_at") else now_utc(),
            **{k: v for k, v in data.items() if k != "recorded_at"},
        )
        vitals.save()
        log_action(action="vital_signs.recorded", request=request, actor=request.user,
                   target_type="vital_signs", target_id=str(vitals.id),
                   patient_id=str(patient.id))
        return Response({"vital_signs": vitals.to_dict()}, status=201)


# ------------------------------------------------------------ clinical PDF
class ClinicalSummaryPdfView(APIView):
    """Printable clinical summary for authorised clinical staff only."""

    permission_classes = [IsAuthenticated]

    def get(self, request, patient_ref):
        patient = _patient_or_404(patient_ref)
        _require_medical_read(request.user, patient)

        from apps.core.documents import ClinicSettings
        from apps.core.pdf import render_table_pdf

        clinic = ClinicSettings.load()
        consultations = list(
            Consultation.objects(patient_doc_id=str(patient.id)).order_by("-consulted_at").limit(20)
        )
        history = MedicalHistory.objects(patient_doc_id=str(patient.id)).first()

        rows = [
            [
                c.consulted_at.strftime("%d %b %Y %H:%M") if c.consulted_at else "",
                c.attending_name,
                (c.chief_complaint or "")[:120],
                ", ".join(d.get("text", "") for d in (c.diagnosis or []))[:120],
                (c.treatment_plan or "")[:160],
                c.status,
            ]
            for c in consultations
        ]
        if not rows:
            rows = [["No consultations recorded", "", "", "", "", ""]]

        allergies = (patient.known_allergies or (history.allergies if history else "")) or "not recorded"
        pdf = render_table_pdf(
            title=f"Clinical Summary - {patient.full_name} ({patient.patient_number})",
            subtitle=(
                f"Sex: {patient.sex or 'not recorded'} | Age: {patient.age() or '-'} | "
                f"Blood group: {patient.blood_group or 'not recorded'} | Allergies: {allergies}"
            ),
            headers=["Date", "Clinician", "Presenting complaint", "Diagnosis", "Plan", "Status"],
            rows=rows,
            clinic=clinic.to_public(),
            footer_note="Clinical document - authorised clinical staff only.",
        )
        log_action(action="clinical_summary.downloaded", request=request, actor=request.user,
                   target_type="patient", target_id=str(patient.id), patient_id=str(patient.id))
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="clinical-summary-{patient.patient_number}.pdf"'
        )
        return response


class MyConsultationsView(APIView):
    """Recent consultations authored by the signed-in clinician."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, Role.DOCTOR, Role.NURSE, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        qs = Consultation.objects(attending_user_id=str(request.user.id)).order_by("-consulted_at")
        limit = min(50, int(request.query_params.get("limit", 20) or 20))
        return Response({
            "results": [c.to_dict() for c in qs.limit(limit)],
            "total": qs.count(),
        })
