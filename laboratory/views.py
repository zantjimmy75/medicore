from __future__ import annotations

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.throttles import WriteThrottle
from apps.core.audit import log_action
from apps.core.exceptions import APIError, Conflict, Forbidden, NotFound
from apps.core.files import save_upload
from apps.core.pdf import render_lab_report_pdf, render_table_pdf
from apps.core.permissions import Role, require_roles
from apps.core.utils import generate_id, now_utc, paginate, parse_bool
from apps.laboratory.documents import (
    PRIORITIES,
    REQUEST_STATUS,
    SPECIMEN_TYPES,
    LabReport,
    LabRequest,
    LabResult,
    LabTest,
)
from apps.laboratory.services import (
    STATUS_LABELS,
    enter_result,
    release_request,
    report_payload,
    transition,
    verify_result,
)
from apps.patients.documents import Patient
from apps.staff.documents import Staff


# ---------------------------------------------------------------- catalogue
class LabTestSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=24)
    name = serializers.CharField(max_length=120)
    category = serializers.CharField(max_length=60, required=False, default="General")
    specimen_type = serializers.ChoiceField(choices=SPECIMEN_TYPES, required=False,
                                            default="whole_blood")
    unit = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    result_type = serializers.ChoiceField(choices=["numeric", "qualitative", "text"],
                                          required=False, default="numeric")
    ref_low = serializers.FloatField(required=False, allow_null=True)
    ref_high = serializers.FloatField(required=False, allow_null=True)
    ref_text = serializers.CharField(required=False, allow_blank=True, default="")
    qualitative_options = serializers.ListField(child=serializers.CharField(), required=False,
                                                 default=list)
    normal_values = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    components = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    turnaround_hours = serializers.IntegerField(required=False, min_value=1, max_value=720, default=24)
    is_active = serializers.BooleanField(required=False, default=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_code(self, value):
        return value.strip().upper().replace(" ", "_")

    def validate(self, attrs):
        if (attrs.get("ref_low") is not None and attrs.get("ref_high") is not None
                and attrs["ref_low"] > attrs["ref_high"]):
            raise serializers.ValidationError({"ref_low": ["Lower bound cannot exceed upper bound."]})
        return attrs


class LabTestListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = LabTest.objects()
        if not parse_bool(request.query_params.get("include_inactive"), False):
            qs = qs.filter(is_active=True)
        if request.query_params.get("category"):
            qs = qs.filter(category=request.query_params["category"])
        if request.query_params.get("search"):
            term = request.query_params["search"]
            qs = qs.filter(__raw__={"$or": [
                {"name": {"$regex": term, "$options": "i"}},
                {"code": {"$regex": term, "$options": "i"}},
            ]})
        tests = [t.to_dict() for t in qs.order_by("category", "name")]
        categories = sorted({t["category"] for t in tests})
        return Response({"tests": tests, "categories": categories, "total": len(tests)})

    def post(self, request):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST)
        serializer = LabTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if LabTest.objects(code=data["code"]).first():
            raise Conflict("A test with this code already exists.", code="duplicate_test")
        test = LabTest(**data)
        test.save()
        log_action(action="lab_test.created", request=request, actor=request.user,
                   target_type="lab_test", target_id=str(test.id),
                   description=f"Created test {test.code}")
        return Response({"test": test.to_dict()}, status=201)


class LabTestDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, test_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST)
        test = LabTest.objects(id=test_id).first()
        if not test:
            raise NotFound("Test not found.")
        payload = {**test.to_dict(), **(request.data or {})}
        serializer = LabTestSerializer(data=payload, partial=True)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(test, field, value)
        test.updated_at = now_utc()
        test.save()
        log_action(action="lab_test.updated", request=request, actor=request.user,
                   target_type="lab_test", target_id=str(test.id),
                   description=f"Updated {test.code}")
        return Response({"test": test.to_dict()})


# ----------------------------------------------------------------- requests
class LabTestOrderSerializer(serializers.Serializer):
    code = serializers.CharField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class LabRequestCreateSerializer(serializers.Serializer):
    patient_number = serializers.CharField(required=False, allow_blank=True, default="")
    patient_doc_id = serializers.CharField(required=False, allow_blank=True, default="")
    tests = serializers.ListField(child=LabTestOrderSerializer(), allow_empty=False)
    priority = serializers.ChoiceField(choices=PRIORITIES, required=False, default="routine")
    clinical_indication = serializers.CharField(required=False, allow_blank=True, max_length=1000,
                                                 default="")
    specimen_type = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")
    consultation_doc_id = serializers.CharField(required=False, allow_blank=True, default="")


class LabRequestListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    def get(self, request):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST,
                      Role.DOCTOR, Role.NURSE)
        p = request.query_params
        qs = LabRequest.objects()
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("priority"):
            qs = qs.filter(priority=p["priority"])
        if p.get("patient_doc_id"):
            qs = qs.filter(patient_doc_id=p["patient_doc_id"])
        if p.get("patient_number"):
            qs = qs.filter(patient_number=p["patient_number"])
        if p.get("mine") and parse_bool(p["mine"]):
            qs = qs.filter(ordering_user_id=str(request.user.id))
        if p.get("search"):
            term = p["search"]
            qs = qs.filter(__raw__={"$or": [
                {"request_number": {"$regex": term, "$options": "i"}},
                {"patient_name": {"$regex": term, "$options": "i"}},
                {"patient_number": {"$regex": term, "$options": "i"}},
            ]})
        if p.get("start") or p.get("end"):
            from apps.core.utils import date_range_bounds

            s, e = date_range_bounds(p.get("start"), p.get("end"))
            if s:
                qs = qs.filter(requested_at__gte=s)
            if e:
                qs = qs.filter(requested_at__lt=e)
        qs = qs.order_by("-requested_at")
        return Response(paginate(qs, p.get("page"), p.get("page_size"), lambda r: r.to_summary()))

    def post(self, request):
        require_roles(request.user, Role.DOCTOR, Role.NURSE, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        serializer = LabRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        patient = None
        if data.get("patient_doc_id"):
            patient = Patient.objects(id=data["patient_doc_id"]).first()
        elif data.get("patient_number"):
            patient = Patient.objects(patient_number=data["patient_number"]).first()
        if not patient:
            raise NotFound("Patient not found.")

        ordered, specimen_types = [], []
        for item in data["tests"]:
            test = LabTest.objects(code=item["code"], is_active=True).first()
            if not test:
                raise APIError(f"Test '{item['code']}' is not available.", code="invalid_test",
                               status_code=400)
            ordered.append({
                "test_id": str(test.id), "code": test.code, "name": test.name,
                "category": test.category, "unit": test.unit,
                "reference_interval": test.reference_interval(),
                "specimen_type": test.specimen_type, "notes": item.get("notes", ""),
            })
            specimen_types.append(test.specimen_type)

        staff = Staff.objects(user_id=str(request.user.id)).first()
        lab_request = LabRequest(
            request_number=generate_id("LAB", pad=5),
            patient_doc_id=str(patient.id),
            patient_number=patient.patient_number,
            patient_name=patient.full_name,
            patient_sex=patient.sex,
            patient_age=patient.age(),
            ordering_user_id=str(request.user.id),
            ordering_clinician=request.user.full_name,
            ordering_department=staff.department_name if staff else "",
            consultation_doc_id=data.get("consultation_doc_id", ""),
            priority=data.get("priority", "routine"),
            clinical_indication=data.get("clinical_indication", ""),
            specimen_type=data.get("specimen_type") or ",".join(sorted(set(specimen_types))),
            notes=data.get("notes", ""),
            tests=ordered,
            status="requested",
            status_history=[{"status": "requested", "previous": None, "at": now_utc(),
                             "by": str(request.user.id), "by_name": request.user.full_name,
                             "reason": "Request created"}],
        )
        lab_request.save()
        log_action(action="lab_request.created", request=request, actor=request.user,
                   target_type="lab_request", target_id=str(lab_request.id),
                   patient_id=str(patient.id),
                   description=f"{lab_request.request_number}: {len(ordered)} test(s)")
        return Response({"request": lab_request.to_dict()}, status=201)


def _request_or_404(request_ref: str) -> LabRequest:
    lab_request = LabRequest.objects(request_number=request_ref).first()
    if not lab_request and len(request_ref) == 24:
        lab_request = LabRequest.objects(id=request_ref).first()
    if not lab_request:
        raise NotFound("Laboratory request not found.")
    return lab_request


class LabRequestDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, request_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST,
                      Role.DOCTOR, Role.NURSE)
        lab_request = _request_or_404(request_ref)
        payload = lab_request.to_dict()
        payload["reports"] = [r.to_dict() for r in
                              LabReport.objects(request_doc_id=str(lab_request.id)).order_by("-version")]
        return Response({"request": payload})

    def patch(self, request, request_ref):
        """Workflow actions: collect sample, start processing, cancel, release."""
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST,
                      Role.DOCTOR, Role.NURSE)
        lab_request = _request_or_404(request_ref)
        action = (request.data or {}).get("action", "")
        reason = ((request.data or {}).get("reason") or "").strip()

        if action == "collect_sample":
            require_roles(request.user, Role.LAB_SCIENTIST, Role.NURSE, Role.SUPER_ADMIN,
                          Role.CLINIC_ADMIN)
            if lab_request.status != "requested":
                raise Conflict("Sample has already been recorded for this request.",
                               code="invalid_transition")
            lab_request.specimen_collected_at = now_utc()
            lab_request.specimen_collected_by = request.user.full_name
            lab_request.specimen_type = ((request.data or {}).get("specimen_type")
                                         or lab_request.specimen_type)
            lab_request.save()
            transition(lab_request, "sample_collected", request.user, reason="Specimen collected")

        elif action == "start_processing":
            require_roles(request.user, Role.LAB_SCIENTIST, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
            transition(lab_request, "processing", request.user, reason="Processing started")

        elif action == "cancel":
            if len(reason) < 4:
                raise APIError("A cancellation reason is required.", code="reason_required",
                               status_code=400)
            if lab_request.status == "released":
                raise Conflict("Released reports cannot be cancelled.", code="already_released")
            transition(lab_request, "cancelled", request.user, reason=reason)

        elif action == "release":
            require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST)
            report = release_request(request_doc=lab_request, actor=request.user, request=request)
            log_action(action="lab_request.released", request=request, actor=request.user,
                       target_type="lab_report", target_id=str(report.id),
                       patient_id=lab_request.patient_doc_id,
                       description=f"Released {report.report_number}")
            return Response({"request": lab_request.to_dict(), "report": report.to_dict(),
                             "message": "Report released."})

        else:
            raise APIError("action must be one of collect_sample, start_processing, cancel, release.",
                           code="invalid_action", status_code=400)

        log_action(action=f"lab_request.{action}", request=request, actor=request.user,
                   target_type="lab_request", target_id=str(lab_request.id),
                   patient_id=lab_request.patient_doc_id, description=reason or action)
        return Response({"request": lab_request.to_dict()})


class LabResultCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, request_ref):
        require_roles(request.user, Role.LAB_SCIENTIST, Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
        lab_request = _request_or_404(request_ref)
        payload = request.data or {}
        if not payload.get("test_code"):
            raise APIError("test_code is required.", code="missing_test", status_code=400)
        result = enter_result(request_doc=lab_request, payload=payload, actor=request.user,
                              request=request)

        if request.FILES.get("attachment"):
            try:
                meta = save_upload(request.FILES["attachment"], kind="document",
                                   owner_ref=lab_request.request_number)
            except ValueError as exc:
                raise APIError(str(exc), code="invalid_upload", status_code=400) from exc
            meta["uploaded_at"] = now_utc()
            meta["uploaded_by_name"] = request.user.full_name
            result.attachments = list(result.attachments or []) + [meta]
            result.save()

        log_action(action="lab_result.entered", request=request, actor=request.user,
                   target_type="lab_result", target_id=str(result.id),
                   patient_id=lab_request.patient_doc_id,
                   description=f"{result.test_name} entered for {lab_request.request_number}",
                   meta={"flag": result.flag})
        return Response({"result": result.to_dict(), "request": lab_request.to_dict()}, status=201)


class LabResultVerifyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, result_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST)
        result = LabResult.objects(id=result_id).first()
        if not result:
            raise NotFound("Result not found.")
        result = verify_result(result=result, actor=request.user,
                               comments=(request.data or {}).get("comments", ""))
        log_action(action="lab_result.verified", request=request, actor=request.user,
                   target_type="lab_result", target_id=str(result.id),
                   patient_id=result.patient_doc_id, description=f"Verified {result.test_name}")
        return Response({"result": result.to_dict(), "message": "Result verified."})


class LabResultReleaseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, result_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST)
        result = LabResult.objects(id=result_id).first()
        if not result:
            raise NotFound("Result not found.")
        lab_request = LabRequest.objects(id=result.request_doc_id).first()
        if not lab_request:
            raise NotFound("Parent request not found.")
        report = release_request(request_doc=lab_request, actor=request.user, request=request)
        log_action(action="lab_result.released", request=request, actor=request.user,
                   target_type="lab_report", target_id=str(report.id),
                   patient_id=lab_request.patient_doc_id,
                   description=f"Released {report.report_number} via result action")
        return Response({"report": report.to_dict(), "request": lab_request.to_dict(),
                         "message": "Report released."})


class LabReportListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST,
                      Role.DOCTOR, Role.NURSE)
        p = request.query_params
        qs = LabReport.objects()
        if p.get("patient_doc_id"):
            qs = qs.filter(patient_doc_id=p["patient_doc_id"])
        if p.get("patient_number"):
            qs = qs.filter(patient_number=p["patient_number"])
        return Response({"reports": [r.to_dict() for r in qs.order_by("-generated_at").limit(100)]})


class LabReportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, report_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST,
                      Role.DOCTOR, Role.NURSE)
        report = LabReport.objects(id=report_id).first()
        if not report:
            raise NotFound("Report not found.")
        lab_request = LabRequest.objects(id=report.request_doc_id).first()
        if not lab_request:
            raise NotFound("Parent request not found.")
        payload = report_payload(lab_request, report)
        log_action(action="lab_report.viewed", request=request, actor=request.user,
                   target_type="lab_report", target_id=str(report.id),
                   patient_id=report.patient_doc_id)
        return Response({"report": report.to_dict(), "payload": payload,
                         "request": lab_request.to_dict()})


class LabReportPdfView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, report_id):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST,
                      Role.DOCTOR, Role.NURSE)
        report = LabReport.objects(id=report_id).first()
        if not report:
            raise NotFound("Report not found.")
        lab_request = LabRequest.objects(id=report.request_doc_id).first()
        if not lab_request:
            raise NotFound("Parent request not found.")
        # Access control: doctors/nurses must be able to view the patient's record
        from apps.core.permissions import can_view_medical_record

        patient = Patient.objects(id=report.patient_doc_id).first()
        if request.user.role not in Role.LAB_ROLES and not can_view_medical_record(request.user, patient):
            raise Forbidden("You cannot download this report.")
        if report.status != "released" and request.user.role not in Role.LAB_ROLES:
            raise Forbidden("This report has not been released to clinical staff yet.")

        pdf = render_lab_report_pdf(report_payload(lab_request, report))
        report.download_count = (report.download_count or 0) + 1
        report.save()
        log_action(action="lab_report.downloaded", request=request, actor=request.user,
                   target_type="lab_report", target_id=str(report.id),
                   patient_id=report.patient_doc_id,
                   description=f"Downloaded {report.report_number}")
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="lab-report-{lab_request.request_number}.pdf"'
        )
        return response


class LabRequestPreliminaryPdfView(APIView):
    """Printable *preliminary* report for internal laboratory use."""

    permission_classes = [IsAuthenticated]

    def get(self, request, request_ref):
        require_roles(request.user, Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.LAB_SCIENTIST)
        lab_request = _request_or_404(request_ref)
        pdf = render_lab_report_pdf(report_payload(lab_request))
        log_action(action="lab_report.preliminary_downloaded", request=request, actor=request.user,
                   target_type="lab_request", target_id=str(lab_request.id),
                   patient_id=lab_request.patient_doc_id)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="lab-preliminary-{lab_request.request_number}.pdf"'
        )
        return response


class LabWorkloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_roles(request.user, *Role.LAB_ROLES, Role.DOCTOR, Role.NURSE)
        counts = {status: LabRequest.objects(status=status).count() for status in REQUEST_STATUS}
        recent = LabRequest.objects().order_by("-requested_at").limit(10)
        return Response({
            "counts": counts,
            "labels": STATUS_LABELS,
            "pending": counts.get("requested", 0) + counts.get("sample_collected", 0)
                       + counts.get("processing", 0),
            "awaiting_verification": counts.get("awaiting_verification", 0),
            "released_last_7d": LabReport.objects().count(),
            "recent_requests": [r.to_summary() for r in recent],
            "reports": [r.to_dict() for r in LabReport.objects().order_by("-generated_at").limit(10)],
        })
