import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  CreditCard,
  Edit3,
  FileDown,
  FlaskConical,
  HeartPulse,
  History,
  PenLine,
  Printer,
  Stethoscope,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import api, { downloadFile, openPdfPreview } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import DeregistrationPanel from './DeregistrationPanel'
import { useToast } from '../../context/ToastContext'
import Modal, { ConfirmDialog } from '../../components/Modal'
import IDCardPreview from '../../components/IDCardPreview'
import {
  Avatar,
  Card,
  CardHeader,
  DataTable,
  DefinitionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatusPill,
  Tabs,
  Textarea,
} from '../../components/ui'
import {
  ageFrom,
  formatDate,
  formatDateTime,
  formatTime,
  humanise,
  relativeTime,
  todayISO,
} from '../../utils/format'
import MedicalHistoryPanel from './MedicalHistoryPanel'
import ConsultationModal from './ConsultationModal'
import VitalsModal from './VitalsModal'
import LabOrderModal from './LabOrderModal'
import AppointmentFormModal from '../appointments/AppointmentFormModal'

const CLINICAL_ROLES = ['super_admin', 'clinic_admin', 'doctor', 'nurse']
const CAN_ISSUE_CARD = ['super_admin', 'clinic_admin', 'receptionist']

function EditPatientModal({ open, onClose, patient, onSaved }) {
  const [form, setForm] = useState({})
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !patient) return
    setForm({
      full_name: patient.full_name || '',
      phone: patient.phone || '',
      email: patient.email || '',
      address: patient.address || '',
      date_of_birth: patient.date_of_birth || '',
      sex: patient.sex || '',
      blood_group: patient.blood_group || '',
      known_allergies: patient.known_allergies || '',
      existing_conditions: patient.existing_conditions || '',
      next_of_kin_name: patient.next_of_kin_name || '',
      next_of_kin_phone: patient.next_of_kin_phone || '',
      next_of_kin_relationship: patient.next_of_kin_relationship || '',
      insurance_provider: patient.insurance_provider || '',
      insurance_number: patient.insurance_number || '',
      status: patient.status || 'active',
    })
    setReason('')
    setMessage('')
  }, [open, patient])

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = { ...form }
      if (reason.trim()) payload.change_reason = reason.trim()
      await api.patch(`/patients/${patient.patient_number}/`, payload)
      onSaved?.()
    } catch (err) {
      setMessage(err.friendlyMessage || 'Changes could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit patient record"
      description="Field-level changes are written to the patient change history with your name and reason."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="edit-patient-form" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-patient-form" className="space-y-4" onSubmit={submit}>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="ep-name">
            <Input id="ep-name" value={form.full_name} onChange={set('full_name')} />
          </Field>
          <Field label="Status" htmlFor="ep-status">
            <Select id="ep-status" value={form.status} onChange={set('status')}>
              {['active', 'inactive', 'deceased', 'transferred'].map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="ep-phone">
            <Input id="ep-phone" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" htmlFor="ep-email">
            <Input id="ep-email" type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Date of birth" htmlFor="ep-dob">
            <Input id="ep-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
          </Field>
          <Field label="Sex" htmlFor="ep-sex">
            <Select id="ep-sex" value={form.sex} onChange={set('sex')}>
              <option value="">Not recorded</option>
              {['male', 'female', 'other', 'undisclosed'].map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Address" htmlFor="ep-address" className="sm:col-span-2">
            <Textarea id="ep-address" rows={2} value={form.address} onChange={set('address')} />
          </Field>
        </div>
        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Clinical baseline</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Blood group" htmlFor="ep-blood">
              <Select id="ep-blood" value={form.blood_group} onChange={set('blood_group')}>
                {['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'].map((value) => (
                  <option key={value || 'none'} value={value}>
                    {value || 'Not known'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Known allergies" htmlFor="ep-allergies" className="sm:col-span-2">
              <Input id="ep-allergies" value={form.known_allergies} onChange={set('known_allergies')} />
            </Field>
            <Field label="Existing conditions" htmlFor="ep-conditions" className="sm:col-span-3">
              <Textarea id="ep-conditions" rows={2} value={form.existing_conditions} onChange={set('existing_conditions')} />
            </Field>
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Next of kin" htmlFor="ep-kin">
            <Input id="ep-kin" value={form.next_of_kin_name} onChange={set('next_of_kin_name')} />
          </Field>
          <Field label="Kinship" htmlFor="ep-kin-rel">
            <Input id="ep-kin-rel" value={form.next_of_kin_relationship} onChange={set('next_of_kin_relationship')} />
          </Field>
          <Field label="Kin phone" htmlFor="ep-kin-phone">
            <Input id="ep-kin-phone" value={form.next_of_kin_phone} onChange={set('next_of_kin_phone')} />
          </Field>
        </div>
        <Field
          label="Reason for change"
          htmlFor="ep-reason"
          hint="Optional but strongly recommended — stored with the change history and audit trail."
        >
          <Input id="ep-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

export default function PatientDetail() {
  const { patientRef } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const cardRef = useRef(null)

  const [patient, setPatient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState('')

  const [consultations, setConsultations] = useState([])
  const [vitals, setVitals] = useState([])
  const [labRequests, setLabRequests] = useState([])
  const [appointments, setAppointments] = useState([])
  const [cardPreview, setCardPreview] = useState(null)

  const [editOpen, setEditOpen] = useState(false)
  const [consultationOpen, setConsultationOpen] = useState(false)
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const [labOpen, setLabOpen] = useState(false)
  const [appointmentOpen, setAppointmentOpen] = useState(false)
  const [amendTarget, setAmendTarget] = useState(null)
  const [amendReason, setAmendReason] = useState('')
  const [amendField, setAmendField] = useState('assessment')
  const [amendValue, setAmendValue] = useState('')
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  const canClinical = CLINICAL_ROLES.includes(user?.role)
  const canWriteClinical = ['super_admin', 'clinic_admin', 'doctor', 'nurse'].includes(user?.role)
  const canEdit = ['super_admin', 'clinic_admin', 'receptionist', 'nurse', 'doctor'].includes(user?.role)
  const canIssueCard = CAN_ISSUE_CARD.includes(user?.role)

  const loadPatient = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/patients/${patientRef}/`)
      setPatient(data.patient)
      if (data.patient?.active_card) {
        try {
          const preview = await api.get(`/patients/${patientRef}/id-card/preview/`)
          setCardPreview(preview.data)
        } catch {
          setCardPreview(null)
        }
      } else {
        setCardPreview(null)
      }
    } catch (err) {
      setError(err.friendlyMessage || 'This patient record could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [patientRef])

  const loadClinical = useCallback(async () => {
    if (!canClinical) return
    const [consult, vitalsRes] = await Promise.all([
      api.get(`/patients/${patientRef}/consultations/`, { params: { limit: 50 } }).catch(() => ({ data: { results: [] } })),
      api.get(`/patients/${patientRef}/vital-signs/`).catch(() => ({ data: { results: [] } })),
    ])
    setConsultations(consult.data.results || [])
    setVitals(vitalsRes.data.results || [])
  }, [patientRef, canClinical])

  const loadRelated = useCallback(
    async (docId) => {
      if (!docId) return
      const [labs, appts] = await Promise.all([
        ['super_admin', 'clinic_admin', 'lab_scientist', 'doctor', 'nurse'].includes(user?.role)
          ? api.get('/laboratory/requests/', { params: { patient_doc_id: docId, page_size: 20 } }).catch(() => ({ data: { results: [] } }))
          : Promise.resolve({ data: { results: [] } }),
        api.get('/appointments/', { params: { patient_doc_id: docId, page_size: 20, past: 1 } }).catch(() => ({ data: { results: [] } })),
      ])
      setLabRequests(labs.data.results || [])
      setAppointments(appts.data.results || [])
    },
    [user?.role],
  )

  useEffect(() => {
    loadPatient()
  }, [loadPatient])

  useEffect(() => {
    if (!patient) return
    loadRelated(patient.id)
    loadClinical()
  }, [patient, loadRelated, loadClinical])

  const refreshAll = async () => {
    await loadPatient()
    await loadClinical()
    if (patient?.id) await loadRelated(patient.id)
  }

  const issueCard = async () => {
    setBusy('card')
    try {
      const { data } = await api.post(`/patients/${patientRef}/id-card/`, { reason: 'issued' })
      toast.success(`Card ${data.card.card_number} issued.`)
      await loadPatient()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The card could not be issued.')
    } finally {
      setBusy('')
    }
  }

  const revokeCard = async () => {
    if (!patient?.active_card || revokeReason.trim().length < 4) return
    setBusy('revoke')
    try {
      await api.post(`/patients/${patientRef}/id-card/${patient.active_card.id}/revoke/`, {
        reason: revokeReason.trim(),
      })
      toast.success('Card revoked. The QR code no longer verifies.')
      setRevokeOpen(false)
      setRevokeReason('')
      await loadPatient()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The card could not be revoked.')
    } finally {
      setBusy('')
    }
  }

  const submitAmendment = async () => {
    if (!amendTarget || amendReason.trim().length < 5) return
    setBusy('amend')
    try {
      await api.patch(`/patients/${patientRef}/consultations/${amendTarget.id}/`, {
        action: 'amend',
        reason: amendReason.trim(),
        changes: { [amendField]: amendValue },
      })
      toast.success('Amendment recorded. The original entry is preserved in the amendment trail.')
      setAmendTarget(null)
      setAmendReason('')
      setAmendValue('')
      await loadClinical()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The amendment could not be recorded.')
    } finally {
      setBusy('')
    }
  }

  const finaliseConsultation = async (consultation) => {
    setBusy(consultation.id)
    try {
      await api.patch(`/patients/${patientRef}/consultations/${consultation.id}/`, { action: 'finalize' })
      toast.success('Consultation finalised.')
      await loadClinical()
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not finalise the consultation.')
    } finally {
      setBusy('')
    }
  }

  const vitalsChart = useMemo(
    () =>
      [...vitals]
        .reverse()
        .slice(-12)
        .map((row) => ({
          label: new Date(row.recorded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          systolic: row.systolic,
          diastolic: row.diastolic,
          pulse: row.pulse,
          temperature: row.temperature_c,
          weight: row.weight_kg,
        })),
    [vitals],
  )

  if (loading) {
    return (
      <Card>
        <LoadingBlock rows={6} label="Opening patient record…" />
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <ErrorState message={error} onRetry={loadPatient} />
      </Card>
    )
  }

  if (!patient) return null

  const cardForPreview = cardPreview
    ? {
        ...cardPreview.patient,
        ...cardPreview.card,
        full_name: cardPreview.patient?.full_name,
        photo_url: cardPreview.patient?.photo_url,
        registration_date: cardPreview.patient?.registration_date,
      }
    : null

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(canClinical
      ? [
          { id: 'history', label: 'Medical history' },
          { id: 'consultations', label: 'Consultations', count: consultations.length },
          { id: 'vitals', label: 'Vital signs', count: vitals.length },
        ]
      : []),
    { id: 'laboratory', label: 'Laboratory', count: labRequests.length },
    { id: 'appointments', label: 'Appointments', count: appointments.length },
    { id: 'card', label: 'ID card' },
    ...(user?.permissions?.can_request_patient_deregistration ||
    user?.permissions?.can_decide_patient_deregistration
      ? [{ id: 'deregistration', label: 'Deregistration' }]
      : []),
  ]

  return (
    <>
      <PageHeader
        title={patient.full_name}
        description={`${patient.sex ? humanise(patient.sex) : 'Sex not recorded'}${patient.age != null ? ` · ${patient.age} years` : ''} · registered ${formatDate(patient.registration_date)}`}
        breadcrumbs={[{ label: 'Patients', to: '/patients' }, { label: patient.patient_number }]}
        meta={
          <>
            <span className="font-mono text-ink-700">{patient.patient_number}</span>
            <span className="text-ink-400">·</span>
            <StatusPill value={patient.status} />
            {patient.blood_group && <span className="pill bg-red-100 text-red-800">{patient.blood_group}</span>}
            {patient.known_allergies && (
              <span className="pill bg-amber-100 text-amber-900">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Allergy: {patient.known_allergies}
              </span>
            )}
            {patient.duplicate_of && (
              <span className="pill bg-ink-200 text-ink-700">Duplicate of {patient.duplicate_of}</span>
            )}
          </>
        }
        actions={
          <>
            <button type="button" className="btn-outline" onClick={() => navigate('/patients')}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
            {canEdit && (
              <button type="button" className="btn-outline" onClick={() => setEditOpen(true)}>
                <Edit3 className="h-4 w-4" aria-hidden="true" /> Edit
              </button>
            )}
            {canWriteClinical && (
              <button type="button" className="btn-primary" onClick={() => setConsultationOpen(true)}>
                <Stethoscope className="h-4 w-4" aria-hidden="true" /> New consultation
              </button>
            )}
          </>
        }
      />

      <Card className="mb-5">
        <div className="px-5 pt-3">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="p-5">
          {tab === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="flex flex-col gap-5 sm:flex-row">
                  <Avatar name={patient.full_name} src={patient.photo_url} size="xl" />
                  <div className="flex-1">
                    <DefinitionList
                      items={[
                        { label: 'Patient number', value: patient.patient_number, mono: true },
                        { label: 'Date of birth', value: patient.date_of_birth ? formatDate(patient.date_of_birth) : patient.estimated_age ? `Estimated age ${patient.estimated_age}` : '—' },
                        { label: 'Sex', value: humanise(patient.sex) },
                        { label: 'Phone', value: patient.phone || '—' },
                        { label: 'Email', value: patient.email || '—' },
                        { label: 'National ID', value: patient.national_id || '—' },
                        { label: 'Address', value: patient.address || '—' },
                        { label: 'Blood group', value: patient.blood_group || '—' },
                        { label: 'Known allergies', value: patient.known_allergies || 'None recorded' },
                        { label: 'Existing conditions', value: patient.existing_conditions || 'None recorded' },
                        { label: 'Next of kin', value: patient.next_of_kin_name ? `${patient.next_of_kin_name}${patient.next_of_kin_relationship ? ` (${patient.next_of_kin_relationship})` : ''}` : '—' },
                        { label: 'Next of kin phone', value: patient.next_of_kin_phone || '—' },
                        { label: 'Insurance', value: patient.insurance_provider ? `${patient.insurance_provider} · ${patient.insurance_number || 'no number'}` : '—' },
                        { label: 'Registered by', value: patient.created_by_name || '—' },
                        { label: 'Registration date', value: formatDateTime(patient.registration_date) },
                        { label: 'Last visit', value: patient.last_visit_at ? formatDateTime(patient.last_visit_at) : 'None recorded' },
                      ]}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-ink-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Clinical activity</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
                    <li className="flex justify-between">
                      <span>Consultations</span>
                      <span className="font-semibold">{patient.stats?.consultations ?? 0}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Appointments</span>
                      <span className="font-semibold">{patient.stats?.appointments ?? 0}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Last consultation</span>
                      <span className="font-medium">
                        {patient.stats?.last_consultation_at ? relativeTime(patient.stats.last_consultation_at) : '—'}
                      </span>
                    </li>
                  </ul>
                  {canClinical && (
                    <button
                      type="button"
                      className="btn-outline btn-sm mt-3 w-full"
                      onClick={() =>
                        openPdfPreview(`/patients/${patientRef}/summary/pdf/`).catch((err) =>
                          toast.error(err.friendlyMessage || 'PDF could not be generated.'),
                        )
                      }
                    >
                      <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> Clinical summary PDF
                    </button>
                  )}
                </div>

                {patient.change_history?.length > 0 && (
                  <div className="rounded-xl border border-ink-200 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                      <History className="h-3.5 w-3.5" aria-hidden="true" /> Change history
                    </p>
                    <ul className="mt-2 space-y-2 text-xs">
                      {patient.change_history.slice(0, 5).map((entry, index) => (
                        <li key={index} className="border-b border-ink-100 pb-1.5 last:border-0">
                          <p className="text-ink-700">
                            {entry.changes?.map((change) => humanise(change.field)).join(', ')}
                          </p>
                          <p className="text-ink-500">
                            {entry.changed_by_name} · {relativeTime(entry.created_at)}
                          </p>
                          {entry.reason && <p className="italic text-ink-500">“{entry.reason}”</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'history' && canClinical && (
            <MedicalHistoryPanel patientRef={patientRef} canWrite={canWriteClinical} />
          )}

          {tab === 'consultations' && canClinical && (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-600">
                  Finalised consultations are read-only; corrections are recorded as amendments.
                </p>
                {canWriteClinical && (
                  <button type="button" className="btn-primary btn-sm" onClick={() => setConsultationOpen(true)}>
                    <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Record consultation
                  </button>
                )}
              </div>
              {consultations.length === 0 ? (
                <EmptyState
                  icon={Stethoscope}
                  title="No consultations recorded"
                  description="Consultations appear here once a clinician records the encounter."
                />
              ) : (
                <ul className="space-y-3">
                  {consultations.map((entry) => (
                    <li key={entry.id} className="rounded-xl border border-ink-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink-900">
                            {formatDateTime(entry.consulted_at)} · {humanise(entry.consultation_type)}
                          </p>
                          <p className="text-xs text-ink-500">
                            {entry.attending_name} ({humanise(entry.attending_role)}) · {entry.consultation_number}
                            {entry.department_name ? ` · ${entry.department_name}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusPill value={entry.status} />
                          {canWriteClinical && entry.status !== 'finalized' && (
                            <button
                              type="button"
                              className="btn-outline btn-sm"
                              onClick={() => finaliseConsultation(entry)}
                              disabled={busy === entry.id}
                            >
                              Finalise
                            </button>
                          )}
                          {canWriteClinical && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => {
                                setAmendTarget(entry)
                                setAmendField('assessment')
                                setAmendValue(entry.assessment || '')
                                setAmendReason('')
                              }}
                            >
                              Amend
                            </button>
                          )}
                        </div>
                      </div>

                      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                        {[
                          ['Chief complaint', entry.chief_complaint],
                          ['Examination findings', entry.examination_findings],
                          ['Assessment', entry.assessment],
                          ['Treatment plan', entry.treatment_plan],
                          ['Investigations requested', entry.investigations_requested],
                          ['Follow-up', entry.follow_up_instructions || (entry.follow_up_date ? `Date: ${formatDate(entry.follow_up_date)}` : '')],
                        ]
                          .filter(([, value]) => value)
                          .map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                              <dd className="whitespace-pre-wrap text-sm text-ink-800">{value}</dd>
                            </div>
                          ))}
                      </dl>

                      {entry.diagnosis?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {entry.diagnosis.map((diagnosis, index) => (
                            <span key={index} className="pill bg-medical-100 text-medical-800">
                              {diagnosis.text} · {humanise(diagnosis.certainty)}
                            </span>
                          ))}
                        </div>
                      )}

                      {entry.prescriptions?.length > 0 && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-ink-200">
                          <table className="table text-xs">
                            <thead>
                              <tr>
                                <th>Drug</th>
                                <th>Dose</th>
                                <th>Route</th>
                                <th>Frequency</th>
                                <th>Duration</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entry.prescriptions.map((row, index) => (
                                <tr key={index}>
                                  <td>{row.drug}</td>
                                  <td>{row.dose || '—'}</td>
                                  <td>{row.route || '—'}</td>
                                  <td>{row.frequency || '—'}</td>
                                  <td>{row.duration || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {entry.vital_signs && (
                        <p className="mt-3 text-[11px] text-ink-500">
                          Vitals: BP {entry.vital_signs.blood_pressure || '—'} · pulse {entry.vital_signs.pulse || '—'} · temp{' '}
                          {entry.vital_signs.temperature_c || '—'} °C · SpO₂ {entry.vital_signs.oxygen_saturation || '—'}%
                        </p>
                      )}

                      {entry.amendments?.length > 0 && (
                        <details className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                          <summary className="cursor-pointer font-semibold">
                            {entry.amendments.length} amendment(s) — original values retained
                          </summary>
                          <ul className="mt-2 space-y-2">
                            {entry.amendments.map((amendment, index) => (
                              <li key={index}>
                                <p className="font-medium">
                                  {amendment.amended_by_name} · {formatDateTime(amendment.amended_at)}
                                </p>
                                <p>Reason: {amendment.reason}</p>
                                <ul className="mt-1 space-y-0.5">
                                  {amendment.changes?.map((change) => (
                                    <li key={change.field}>
                                      {humanise(change.field)}: <span className="line-through">{String(change.from || 'empty').slice(0, 80)}</span> →{' '}
                                      <span className="font-medium">{String(change.to || 'empty').slice(0, 80)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'vitals' && canClinical && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink-600">Chronological measurements recorded by clinical staff.</p>
                {canWriteClinical && (
                  <button type="button" className="btn-primary btn-sm" onClick={() => setVitalsOpen(true)}>
                    <HeartPulse className="h-3.5 w-3.5" aria-hidden="true" /> Record vitals
                  </button>
                )}
              </div>

              {vitals.length > 1 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-ink-200 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Blood pressure & pulse</p>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={vitalsChart} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid stroke="#EEF2F7" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: 10, fontSize: 11 }} />
                          <Legend formatter={(value) => <span className="text-[11px]">{value}</span>} />
                          <Line type="monotone" dataKey="systolic" stroke="#1565C0" strokeWidth={2} connectNulls />
                          <Line type="monotone" dataKey="diastolic" stroke="#009688" strokeWidth={2} connectNulls />
                          <Line type="monotone" dataKey="pulse" stroke="#F59E0B" strokeWidth={2} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Weight & temperature</p>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={vitalsChart} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid stroke="#EEF2F7" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: 10, fontSize: 11 }} />
                          <Legend formatter={(value) => <span className="text-[11px]">{value}</span>} />
                          <Bar dataKey="weight" fill="#1565C0" radius={[3, 3, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="temperature" fill="#009688" radius={[3, 3, 0, 0]} maxBarSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              <DataTable
                caption="Vital signs"
                columns={[
                  { key: 'recorded_at', header: 'Recorded', render: (row) => <span className="text-xs">{formatDateTime(row.recorded_at)}</span> },
                  { key: 'blood_pressure', header: 'BP', render: (row) => <span className="text-xs font-medium">{row.blood_pressure || '—'}</span> },
                  { key: 'pulse', header: 'Pulse', render: (row) => <span className="text-xs">{row.pulse ?? '—'}</span> },
                  { key: 'temperature_c', header: 'Temp °C', render: (row) => <span className="text-xs">{row.temperature_c ?? '—'}</span> },
                  { key: 'respiratory_rate', header: 'RR', render: (row) => <span className="text-xs">{row.respiratory_rate ?? '—'}</span> },
                  { key: 'oxygen_saturation', header: 'SpO₂', render: (row) => <span className="text-xs">{row.oxygen_saturation ?? '—'}</span> },
                  { key: 'weight_kg', header: 'Weight', render: (row) => <span className="text-xs">{row.weight_kg ?? '—'}</span> },
                  { key: 'bmi', header: 'BMI', render: (row) => <span className="text-xs">{row.bmi ?? '—'}</span> },
                  { key: 'recorded_by_name', header: 'By', render: (row) => <span className="text-xs text-ink-500">{row.recorded_by_name}</span> },
                ]}
                rows={vitals}
                empty={<EmptyState icon={Activity} title="No vital signs recorded" description="Vitals recorded during consultations appear here." />}
              />
            </div>
          )}

          {tab === 'laboratory' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-600">
                  Requests move through specimen collection, result entry, verification and release.
                </p>
                {['super_admin', 'clinic_admin', 'doctor', 'nurse'].includes(user?.role) && (
                  <button type="button" className="btn-primary btn-sm" onClick={() => setLabOpen(true)}>
                    <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Order tests
                  </button>
                )}
              </div>
              <DataTable
                caption="Laboratory requests"
                columns={[
                  {
                    key: 'request_number',
                    header: 'Request',
                    render: (row) => (
                      <div>
                        <p className="font-mono text-xs font-semibold text-ink-800">{row.request_number}</p>
                        <p className="text-[11px] text-ink-500">{row.tests?.join(', ')}</p>
                      </div>
                    ),
                  },
                  { key: 'priority', header: 'Priority', render: (row) => <StatusPill value={row.priority} /> },
                  { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                  { key: 'result_count', header: 'Results', render: (row) => <span className="text-xs">{row.verified_count}/{row.result_count} verified</span> },
                  { key: 'requested_at', header: 'Requested', render: (row) => <span className="text-xs">{formatDateTime(row.requested_at)}</span> },
                ]}
                rows={labRequests}
                empty={
                  <EmptyState
                    icon={FlaskConical}
                    title="No laboratory requests"
                    description="Order tests from a consultation to start the laboratory workflow."
                  />
                }
              />
              {['super_admin', 'clinic_admin', 'lab_scientist', 'doctor', 'nurse'].includes(user?.role) && (
                <Link to="/laboratory" className="text-xs font-medium text-medical-700 hover:underline">
                  Open the laboratory workspace →
                </Link>
              )}
            </div>
          )}

          {tab === 'appointments' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-600">Booked visits and their current status.</p>
                {['super_admin', 'clinic_admin', 'receptionist', 'doctor', 'nurse', 'hr_officer'].includes(user?.role) && (
                  <button type="button" className="btn-primary btn-sm" onClick={() => setAppointmentOpen(true)}>
                    <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Book appointment
                  </button>
                )}
              </div>
              <DataTable
                caption="Appointments"
                columns={[
                  { key: 'appointment_number', header: 'Ref', render: (row) => <span className="font-mono text-xs">{row.appointment_number}</span> },
                  { key: 'scheduled_at', header: 'When', render: (row) => <span className="text-xs">{formatDate(row.scheduled_at)} · {formatTime(row.scheduled_at)}</span> },
                  { key: 'clinician_name', header: 'Clinician', render: (row) => <span className="text-xs">{row.clinician_name}</span> },
                  { key: 'reason', header: 'Reason', render: (row) => <span className="text-xs text-ink-600">{row.reason || '—'}</span> },
                  { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                ]}
                rows={appointments}
                empty={<EmptyState icon={CalendarPlus} title="No appointments" description="Book a visit to see it here." />}
              />
            </div>
          )}

          {tab === 'deregistration' && (
            <DeregistrationPanel
              patientRef={patientRef}
              patientStatus={patient?.status}
              onChanged={loadPatient}
            />
          )}

          {tab === 'card' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                {cardPreview && cardForPreview ? (
                  <IDCardPreview
                    ref={cardRef}
                    card={cardForPreview}
                    kind="patient"
                    qrDataUri={cardPreview.qr_data_uri}
                    clinic={cardPreview.clinic}
                    verifyUrl={cardPreview.verify_url}
                  />
                ) : (
                  <EmptyState
                    icon={CreditCard}
                    title="No active patient card"
                    description={
                      canIssueCard
                        ? 'Issue a card to generate the QR code and printable CR80 PDF.'
                        : 'Reception or a clinic administrator can issue a patient card.'
                    }
                  />
                )}
                {cardPreview && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-outline btn-sm" onClick={() => window.print()}>
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
                    </button>
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      onClick={() =>
                        openPdfPreview(`/patients/${patientRef}/id-card/pdf/`).catch((err) =>
                          toast.error(err.friendlyMessage || 'PDF could not be generated.'),
                        )
                      }
                    >
                      <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> Preview PDF
                    </button>
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      onClick={() =>
                        downloadFile(`/patients/${patientRef}/id-card/pdf/`, `patient-card-${patient.patient_number}.pdf`).catch(
                          (err) => toast.error(err.friendlyMessage || 'Download failed.'),
                        )
                      }
                    >
                      <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> Download
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {canIssueCard && (
                  <button
                    type="button"
                    className="btn-primary w-full"
                    onClick={issueCard}
                    disabled={busy === 'card' || !['active', 'inactive'].includes(patient.status)}
                  >
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                    {patient.active_card ? 'Reissue card (revokes current)' : 'Issue patient card'}
                  </button>
                )}
                {canIssueCard && patient.active_card && (
                  <button
                    type="button"
                    className="btn-outline w-full text-red-700"
                    onClick={() => setRevokeOpen(true)}
                  >
                    Revoke current card
                  </button>
                )}
                <div className="rounded-xl border border-ink-200 p-4 text-xs leading-relaxed text-ink-600">
                  <p className="mb-1 font-semibold text-ink-700">What the QR code contains</p>
                  <p>
                    An opaque, revocable token only. Scanning it opens a public verification page that
                    confirms the card is valid and shows the patient number — no diagnosis, contact
                    details or history is exposed.
                  </p>
                  {patient.active_card && (
                    <dl className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-ink-400">Card number</dt>
                        <dd className="font-mono text-[11px] text-ink-700">{patient.active_card.card_number}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-ink-400">Issued</dt>
                        <dd className="text-[11px] text-ink-700">{formatDate(patient.active_card.issued_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-ink-400">Expires</dt>
                        <dd className="text-[11px] text-ink-700">{formatDate(patient.active_card.expires_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-ink-400">Scans</dt>
                        <dd className="text-[11px] text-ink-700">{patient.active_card.scan_count}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <EditPatientModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        patient={patient}
        onSaved={async () => {
          setEditOpen(false)
          toast.success('Patient record updated.')
          await refreshAll()
        }}
      />

      <ConsultationModal
        open={consultationOpen}
        onClose={() => setConsultationOpen(false)}
        patientRef={patientRef}
        onSaved={async (consultation) => {
          setConsultationOpen(false)
          toast.success(`Consultation ${consultation.consultation_number} saved as ${consultation.status}.`)
          setTab('consultations')
          await refreshAll()
        }}
      />

      <VitalsModal
        open={vitalsOpen}
        onClose={() => setVitalsOpen(false)}
        patientRef={patientRef}
        onSaved={async () => {
          setVitalsOpen(false)
          toast.success('Vital signs recorded.')
          await loadClinical()
        }}
      />

      <LabOrderModal
        open={labOpen}
        onClose={() => setLabOpen(false)}
        patient={patient}
        onSaved={async (request) => {
          setLabOpen(false)
          toast.success(`Laboratory request ${request.request_number} created.`)
          setTab('laboratory')
          await loadRelated(patient.id)
        }}
      />

      <AppointmentFormModal
        open={appointmentOpen}
        onClose={() => setAppointmentOpen(false)}
        patient={patient}
        onBooked={async (appointment) => {
          setAppointmentOpen(false)
          toast.success(`Appointment ${appointment.appointment_number} booked for ${formatDate(appointment.scheduled_at)}.`)
          setTab('appointments')
          await loadRelated(patient.id)
        }}
      />

      <Modal
        open={Boolean(amendTarget)}
        onClose={() => setAmendTarget(null)}
        size="md"
        title="Amend a consultation"
        description="The consultation remains in the record. Your amendment is appended with the previous value, your name, the timestamp and the reason."
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setAmendTarget(null)} disabled={busy === 'amend'}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitAmendment}
              disabled={amendReason.trim().length < 5 || busy === 'amend'}
            >
              {busy === 'amend' ? 'Saving…' : 'Record amendment'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Field to amend" htmlFor="amend-field">
            <Select
              id="amend-field"
              value={amendField}
              onChange={(event) => {
                const field = event.target.value
                setAmendField(field)
                setAmendValue(amendTarget?.[field] || '')
              }}
            >
              {[
                ['chief_complaint', 'Chief complaint'],
                ['history_of_present_illness', 'History of present illness'],
                ['examination_findings', 'Examination findings'],
                ['assessment', 'Assessment'],
                ['treatment_plan', 'Treatment plan'],
                ['follow_up_instructions', 'Follow-up instructions'],
                ['notes', 'Notes'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Corrected value" htmlFor="amend-value">
            <Textarea
              id="amend-value"
              rows={4}
              value={amendValue}
              onChange={(event) => setAmendValue(event.target.value)}
            />
          </Field>
          <Field label="Reason (required, ≥ 5 characters)" htmlFor="amend-reason">
            <Textarea
              id="amend-reason"
              rows={2}
              value={amendReason}
              onChange={(event) => setAmendReason(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        size="sm"
        title="Revoke patient card"
        description="The QR code stops verifying immediately. Issue a replacement afterwards if needed."
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setRevokeOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={revokeCard} disabled={revokeReason.trim().length < 4 || busy === 'revoke'}>
              {busy === 'revoke' ? 'Revoking…' : 'Revoke card'}
            </button>
          </>
        }
      >
        <Field label="Reason (audited)" htmlFor="revoke-card-reason" required>
          <Textarea
            id="revoke-card-reason"
            rows={2}
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
          />
        </Field>
      </Modal>
    </>
  )
}
