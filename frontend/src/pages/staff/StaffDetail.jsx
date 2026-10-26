import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CreditCard,
  Edit3,
  FileDown,
  KeyRound,
  Printer,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react'
import api, { downloadFile, openPdfPreview } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useFetch } from '../../hooks/useApi'
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
  Textarea,
} from '../../components/ui'
import { ageFrom, formatDate, formatDateTime, formatTime, humanise } from '../../utils/format'
import { ROLE_LABELS } from '../../utils/permissions'

const GENDERS = ['male', 'female', 'other', 'undisclosed']
const EMPLOYMENT = ['active', 'on_leave', 'suspended', 'resigned', 'terminated', 'retired']

function EditStaffModal({ open, onClose, staff, departments, shifts, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open || !staff) return
    setForm({
      full_name: staff.full_name || '',
      email: staff.email || '',
      phone: staff.phone || '',
      gender: staff.gender || '',
      date_of_birth: staff.date_of_birth || '',
      address: staff.address || '',
      emergency_contact_name: staff.emergency_contact_name || '',
      emergency_contact_phone: staff.emergency_contact_phone || '',
      emergency_contact_relationship: staff.emergency_contact_relationship || '',
      department_id: staff.department_id || '',
      job_title: staff.job_title || '',
      professional_reg_number: staff.professional_reg_number || '',
      employment_date: staff.employment_date || '',
      employment_status: staff.employment_status || 'active',
      shift_id: staff.shift_id || '',
      role: staff.role || 'nurse',
      notes: staff.notes || '',
    })
    setMessage('')
  }, [open, staff])

  const set = (field) => (event) => setForm((c) => ({ ...c, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = { ...form }
      Object.keys(payload).forEach((key) => {
        if (payload[key] === '') payload[key] = null
      })
      await api.patch(`/staff/${staff.staff_id}/`, payload)
      onSaved?.()
    } catch (err) {
      setMessage(err.friendlyMessage || 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit staff record"
      description="Changes are written to the audit log. Role changes also update the linked login account."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="edit-staff-form" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-staff-form" className="space-y-4" onSubmit={submit}>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="edit-name" required>
            <Input id="edit-name" value={form.full_name} onChange={set('full_name')} required />
          </Field>
          <Field label="Email" htmlFor="edit-email" required>
            <Input id="edit-email" type="email" value={form.email} onChange={set('email')} required />
          </Field>
          <Field label="Phone" htmlFor="edit-phone">
            <Input id="edit-phone" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Gender" htmlFor="edit-gender">
            <Select id="edit-gender" value={form.gender} onChange={set('gender')}>
              <option value="">Not recorded</option>
              {GENDERS.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of birth" htmlFor="edit-dob">
            <Input id="edit-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
          </Field>
          <Field label="Employment date" htmlFor="edit-empdate">
            <Input id="edit-empdate" type="date" value={form.employment_date} onChange={set('employment_date')} />
          </Field>
          <Field label="Department" htmlFor="edit-department">
            <Select id="edit-department" value={form.department_id} onChange={set('department_id')}>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title" htmlFor="edit-title">
            <Input id="edit-title" value={form.job_title} onChange={set('job_title')} />
          </Field>
          <Field label="System role" htmlFor="edit-role">
            <Select id="edit-role" value={form.role} onChange={set('role')}>
              {Object.entries(ROLE_LABELS)
                .filter(([value]) => {
                  const assignable = user?.permissions?.assignable_staff_roles
                  // Always keep the person's current role visible even if this
                  // account could not assign it.
                  return !assignable || assignable.includes(value) || value === staff.role
                })
                .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employment status" htmlFor="edit-status">
            <Select id="edit-status" value={form.employment_status} onChange={set('employment_status')}>
              {EMPLOYMENT.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default shift" htmlFor="edit-shift">
            <Select id="edit-shift" value={form.shift_id} onChange={set('shift_id')}>
              <option value="">No default shift</option>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} ({shift.start_time}–{shift.end_time})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Professional registration" htmlFor="edit-reg">
            <Input id="edit-reg" value={form.professional_reg_number} onChange={set('professional_reg_number')} />
          </Field>
        </div>
        <Field label="Home address" htmlFor="edit-address">
          <Textarea id="edit-address" rows={2} value={form.address} onChange={set('address')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Emergency contact" htmlFor="edit-ec-name">
            <Input id="edit-ec-name" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} />
          </Field>
          <Field label="Emergency phone" htmlFor="edit-ec-phone">
            <Input id="edit-ec-phone" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
          </Field>
          <Field label="Relationship" htmlFor="edit-ec-rel">
            <Input id="edit-ec-rel" value={form.emergency_contact_relationship} onChange={set('emergency_contact_relationship')} />
          </Field>
        </div>
        <Field label="Internal notes" htmlFor="edit-notes" hint="Visible to administrators only. Do not record health information.">
          <Textarea id="edit-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </form>
    </Modal>
  )
}

export default function StaffDetail() {
  const { staffId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const cardRef = useRef(null)

  const [staff, setStaff] = useState(null)
  const [cards, setCards] = useState([])
  const [cardPreview, setCardPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState(null)

  const { data: departments } = useFetch('/staff/departments/')
  const { data: shiftData } = useFetch('/staff/shifts/')

  const canManage = Boolean(user?.permissions?.can_manage_staff)
  // Staff may see only their own ID card, QR preview and card history. HR and
  // administrators see everyone's because issuing cards is their job. The API
  // enforces this; these flags only decide what to render.
  const isOwnCard = Boolean(user?.id) && user.id === staff?.user_id
  const canViewAnyCard = Boolean(user?.permissions?.can_view_any_staff_card)
  const canViewCards = canViewAnyCard || isOwnCard
  const canCards = Boolean(user?.permissions?.can_register_staff) && !isOwnCard

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/staff/${staffId}/`)
      setStaff(data.staff)
      const ownRecord =
        Boolean(user?.id) && String(user.id) === String(data.staff?.user_id)
      const mayViewCards =
        Boolean(user?.permissions?.can_view_any_staff_card) || ownRecord
      if (mayViewCards) {
        const cardResponse = await api
          .get(`/staff/${staffId}/id-card/`)
          .catch(() => ({ data: { cards: [] } }))
        setCards(cardResponse.data.cards || [])
      } else {
        setCards([])
      }
      if (mayViewCards && data.staff?.active_card) {
        try {
          const preview = await api.get(`/staff/${staffId}/id-card/preview/`)
          setCardPreview(preview.data)
        } catch {
          setCardPreview(null)
        }
      } else {
        setCardPreview(null)
      }
    } catch (err) {
      setError(err.friendlyMessage || 'Unable to load this staff record.')
    } finally {
      setLoading(false)
    }
  }, [staffId])

  useEffect(() => {
    load()
  }, [load])

  const run = async (label, fn, successMessage) => {
    setBusy(label)
    try {
      await fn()
      if (successMessage) toast.success(successMessage)
      await load()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The action could not be completed.')
    } finally {
      setBusy('')
    }
  }

  const approve = (decision, note) =>
    run(
      decision,
      () => api.post(`/staff/${staffId}/approval/`, { decision }),
      note,
    )

  const issueCard = () =>
    run(
      'issue',
      async () => {
        const { data } = await api.post(`/staff/${staffId}/id-card/`, { reason: 'issued' })
        toast.success(`Card ${data.card.card_number} issued. Print or download the PDF to hand it over.`)
      },
    )

  const revokeCard = async () => {
    if (!revokeTarget || revokeReason.trim().length < 4) return
    setBusy('revoke')
    try {
      await api.post(`/staff/${staffId}/id-card/${revokeTarget.id}/revoke/`, { reason: revokeReason.trim() })
      toast.success(`Card ${revokeTarget.card_number} revoked. Any scan of it will now fail.`)
      setRevokeTarget(null)
      setRevokeReason('')
      await load()
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not revoke this card.')
    } finally {
      setBusy('')
    }
  }

  const setAttendancePin = async (event) => {
    event.preventDefault()
    setBusy('pin')
    try {
      await api.post(`/staff/${staffId}/attendance-pin/`, { pin })
      toast.success('Attendance PIN updated. Share it with the staff member privately.')
      setPinOpen(false)
      setPin('')
      await load()
    } catch (err) {
      toast.error(err.friendlyMessage || 'PIN could not be set.')
    } finally {
      setBusy('')
    }
  }

  const cardForPreview = useMemo(() => {
    if (!cardPreview) return null
    return {
      ...cardPreview.staff,
      ...cardPreview.card,
      full_name: cardPreview.staff?.full_name,
      photo_url: cardPreview.staff?.photo_url,
      department_name: cardPreview.staff?.department_name,
      job_title: cardPreview.staff?.job_title,
    }
  }, [cardPreview])

  if (loading) {
    return (
      <Card>
        <LoadingBlock rows={6} label="Loading staff record…" />
      </Card>
    )
  }
  if (error) {
    return (
      <Card>
        <ErrorState message={error} onRetry={load} />
      </Card>
    )
  }
  if (!staff) return null

  const today = staff.attendance_today || null
  const records = today?.recent_records || []

  return (
    <>
      <PageHeader
        title={staff.full_name}
        description={`${staff.job_title} · ${staff.department_name || 'No department'} · ${ROLE_LABELS[staff.role] || staff.role}`}
        breadcrumbs={[{ label: 'Staff', to: '/staff' }, { label: staff.staff_id }]}
        meta={
          <>
            <span className="font-mono text-ink-700">{staff.staff_id}</span>
            <span className="text-ink-400">·</span>
            <StatusPill value={staff.employment_status} />
            <StatusPill value={staff.status} />
            {staff.has_attendance_pin ? (
              <span className="pill bg-emerald-100 text-emerald-800">PIN set</span>
            ) : (
              <span className="pill bg-amber-100 text-amber-800">No attendance PIN</span>
            )}
          </>
        }
        actions={
          <>
            <button type="button" className="btn-outline" onClick={() => navigate('/staff')}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
            {canManage && (
              <button type="button" className="btn-outline" onClick={() => setEditOpen(true)}>
                <Edit3 className="h-4 w-4" aria-hidden="true" /> Edit
              </button>
            )}
            {canManage && (
              <button type="button" className="btn-outline" onClick={() => setPinOpen(true)}>
                <KeyRound className="h-4 w-4" aria-hidden="true" /> Attendance PIN
              </button>
            )}
            {canCards && staff.status !== 'approved' && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setApprovalTarget({ decision: 'approve', label: 'Approve staff member' })}
                disabled={busy === 'approve'}
              >
                <UserCheck className="h-4 w-4" aria-hidden="true" /> Approve
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Profile" description="Identity and contact information held for this staff member" />
            <div className="flex flex-col gap-5 p-5 sm:flex-row">
              <Avatar name={staff.full_name} src={staff.photo_url} size="xl" />
              <div className="min-w-0 flex-1">
                <DefinitionList
                  columns={2}
                  items={[
                    { label: 'Staff ID', value: <span className="font-mono">{staff.staff_id}</span> },
                    { label: 'System role', value: ROLE_LABELS[staff.role] || staff.role },
                    { label: 'Department', value: staff.department_name || '—' },
                    { label: 'Job title', value: staff.job_title || '—' },
                    { label: 'Gender', value: humanise(staff.gender) },
                    {
                      label: 'Date of birth',
                      value: staff.date_of_birth
                        ? `${formatDate(staff.date_of_birth)} (${ageFrom(staff.date_of_birth)} yrs)`
                        : '—',
                    },
                    { label: 'Phone', value: staff.phone || '—' },
                    { label: 'Email', value: staff.email || '—' },
                    { label: 'Home address', value: staff.address || '—' },
                    { label: 'Employment date', value: formatDate(staff.employment_date) },
                    { label: 'Professional registration', value: staff.professional_reg_number || '—' },
                    { label: 'Default shift', value: staff.shift_code || '—' },
                    { label: 'Emergency contact', value: staff.emergency_contact_name || '—' },
                    {
                      label: 'Emergency phone',
                      value: staff.emergency_contact_phone
                        ? `${staff.emergency_contact_phone}${staff.emergency_contact_relationship ? ` (${staff.emergency_contact_relationship})` : ''}`
                        : '—',
                    },
                    { label: 'Record created', value: formatDateTime(staff.created_at) },
                    { label: 'Last updated', value: formatDateTime(staff.updated_at) },
                  ]}
                />
              </div>
            </div>
            {staff.notes && (
              <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-600">
                <span className="font-semibold text-ink-700">Internal notes:</span> {staff.notes}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Attendance today"
              description="Live view of the current shift assignment and clock records"
            />
            {today ? (
              <div className="grid gap-4 p-5 sm:grid-cols-3">
                <div className="rounded-xl border border-ink-200 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-500">Shift</p>
                  <p className="mt-1 text-sm font-semibold text-ink-800">
                    {today.shift_code || (today.scheduled ? 'Scheduled' : 'Not rostered')}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {formatTime(today.scheduled_start)}–{formatTime(today.scheduled_end)}
                  </p>
                </div>
                <div className="rounded-xl border border-ink-200 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-500">Duty state</p>
                  <p className="mt-1">
                    <StatusPill value={today.duty_state || today.status} />
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {today.clocked_in_at
                      ? `In ${formatTime(today.clocked_in_at)}${today.clocked_out_at ? ` · Out ${formatTime(today.clocked_out_at)}` : ''}`
                      : 'No clock-in recorded'}
                  </p>
                </div>
                <div className="rounded-xl border border-ink-200 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-500">Hours today</p>
                  <p className="mt-1 text-sm font-semibold text-ink-800">{today.total_hours ?? 0}</p>
                  <p className="text-[11px] text-ink-500">Late {today.late_minutes ?? 0} min</p>
                </div>
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-ink-500">No attendance snapshot available.</p>
            )}
            <div className="border-t border-ink-100">
              <DataTable
                caption="Recent attendance"
                columns={[
                  { key: 'work_date', header: 'Date' },
                  {
                    key: 'clock_in_at',
                    header: 'Clock in',
                    render: (row) => <span className="font-mono text-xs">{formatTime(row.clock_in_at)}</span>,
                  },
                  {
                    key: 'clock_out_at',
                    header: 'Clock out',
                    render: (row) => <span className="font-mono text-xs">{formatTime(row.clock_out_at)}</span>,
                  },
                  { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                  {
                    key: 'late_minutes',
                    header: 'Late',
                    render: (row) => <span className="text-xs">{row.late_minutes} min</span>,
                  },
                  {
                    key: 'total_hours',
                    header: 'Hours',
                    render: (row) => <span className="text-xs">{row.total_hours || 0}</span>,
                  },
                  { key: 'method', header: 'Method', render: (row) => <span className="text-xs">{humanise(row.method)}</span> },
                ]}
                rows={records.slice(0, 10)}
                empty={<EmptyState title="No attendance recorded yet" description="Clock-ins appear here once the staff member scans their card or an officer records them." />}
              />
            </div>
          </Card>

          {canViewCards ? (
          <Card>
            <CardHeader title="ID card history" description="Every card issued for this staff member, including revoked and replaced cards" />
            <DataTable
              caption="ID card history"
              columns={[
                {
                  key: 'card_number',
                  header: 'Card',
                  render: (row) => (
                    <div>
                      <p className="font-mono text-xs font-semibold text-ink-800">{row.card_number}</p>
                      <p className="text-[11px] text-ink-500">ref {row.token_prefix}…</p>
                    </div>
                  ),
                },
                { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                { key: 'issued_at', header: 'Issued', render: (row) => <span className="text-xs">{formatDate(row.issued_at)}</span> },
                { key: 'expires_at', header: 'Expires', render: (row) => <span className="text-xs">{formatDate(row.expires_at)}</span> },
                { key: 'scan_count', header: 'Scans', render: (row) => <span className="text-xs">{row.scan_count}</span> },
                {
                  key: 'last_verified_at',
                  header: 'Last verified',
                  render: (row) => <span className="text-xs">{row.last_verified_at ? formatDateTime(row.last_verified_at) : '—'}</span>,
                },
              ]}
              rows={cards}
              empty={<EmptyState icon={CreditCard} title="No card issued" description="Approve the staff member, then issue a QR-verified ID card." />}
            />
          </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {canViewCards ? (
          <Card>
            <CardHeader
              title="QR ID card"
              description="CR80 size · printable at exact scale"
              actions={
                canCards && staff.status === 'approved' && (
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    onClick={issueCard}
                    disabled={busy === 'issue'}
                    title={staff.active_card ? 'Replaces the current card and revokes it' : 'Issue the first card'}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    {staff.active_card ? 'Regenerate' : 'Issue'}
                  </button>
                )
              }
            />
            <div className="p-5">
              {cardPreview && cardForPreview ? (
                <IDCardPreview
                  ref={cardRef}
                  card={cardForPreview}
                  kind="staff"
                  qrDataUri={cardPreview.qr_data_uri}
                  clinic={cardPreview.clinic}
                  verifyUrl={cardPreview.verify_url}
                />
              ) : (
                <EmptyState
                  icon={ShieldCheck}
                  title={staff.status === 'approved' ? 'No active card' : 'Card locked until approval'}
                  description={
                    staff.status === 'approved'
                      ? 'Issue a card to generate the QR code and printable PDF.'
                      : 'Approve this staff member first — cards cannot be issued for unapproved records.'
                  }
                />
              )}
            </div>
            {cardPreview && (
              <div className="flex flex-wrap gap-2 border-t border-ink-100 px-5 py-3">
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => cardRef.current && window.print()}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
                </button>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() =>
                    openPdfPreview(`/staff/${staffId}/id-card/pdf/`).catch((err) =>
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
                    downloadFile(`/staff/${staffId}/id-card/pdf/`, `staff-card-${staff.staff_id}.pdf`).catch((err) =>
                      toast.error(err.friendlyMessage || 'Download failed.'),
                    )
                  }
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> Download
                </button>
                {canCards && staff.active_card && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-red-700"
                    onClick={() => setRevokeTarget(staff.active_card)}
                  >
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Revoke
                  </button>
                )}
              </div>
            )}
            {cardPreview?.verify_url && (
              <p className="border-t border-ink-100 bg-ink-50 px-5 py-3 text-[11px] text-ink-500">
                Public verification link:{' '}
                <Link to={`/verify/staff/${cardPreview.card.token}`} className="break-all text-medical-700 hover:underline">
                  {cardPreview.verify_url}
                </Link>
              </p>
            )}
          </Card>
          ) : null}

          <Card>
            <CardHeader title="Administrative actions" description="Each action is audit-logged" />
            <div className="space-y-2 p-5">
              {canCards && staff.status === 'approved' && (
                <button
                  type="button"
                  className="btn-outline w-full justify-start"
                  onClick={() => setApprovalTarget({ decision: 'deactivate', label: 'Suspend employment' })}
                >
                  <UserX className="h-4 w-4" aria-hidden="true" /> Suspend employment
                </button>
              )}
              {canCards && staff.employment_status === 'suspended' && (
                <button
                  type="button"
                  className="btn-outline w-full justify-start"
                  onClick={() => approve('reactivate', 'Staff member reactivated.')}
                >
                  <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Reactivate
                </button>
              )}
              {canCards && staff.status === 'pending' && (
                <button
                  type="button"
                  className="btn-outline w-full justify-start"
                  onClick={() => setApprovalTarget({ decision: 'reject', label: 'Reject registration' })}
                >
                  <Ban className="h-4 w-4" aria-hidden="true" /> Reject registration
                </button>
              )}
              <button
                type="button"
                className="btn-outline w-full justify-start"
                onClick={() => api.get('/staff/shifts/').then(({ data }) => toast.info(`${data.results.length} shift templates configured.`))}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload reference data
              </button>
              {['super_admin', 'clinic_admin'].includes(user?.role) && (
                <button
                  type="button"
                  className="btn-ghost w-full justify-start text-red-700"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Archive staff record
                </button>
              )}
              <p className="pt-2 text-[11px] leading-relaxed text-ink-500">
                Archiving revokes all active cards, disables the linked login account and keeps the
                attendance history for statutory retention. Records are never deleted outright.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <EditStaffModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        staff={staff}
        departments={departments?.results || []}
        shifts={shiftData?.results || []}
        onSaved={() => {
          setEditOpen(false)
          toast.success('Staff record updated.')
          load()
        }}
      />

      <Modal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        size="sm"
        title="Set attendance PIN"
        description="Used together with the ID card QR code when clocking in or out."
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setPinOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="pin-form" className="btn-primary" disabled={busy === 'pin' || pin.length < 4}>
              {busy === 'pin' ? 'Saving…' : 'Set PIN'}
            </button>
          </>
        }
      >
        <form id="pin-form" onSubmit={setAttendancePin} className="space-y-3">
          <Field label="New PIN (4–8 digits)" htmlFor="staff-pin" required hint="Never share this PIN in email or chat. Hand it over in person.">
            <Input
              id="staff-pin"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              autoComplete="off"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        size="sm"
        title={`Revoke card ${revokeTarget?.card_number || ''}`}
        description="The QR code immediately stops verifying. A replacement card must be issued separately."
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={revokeCard}
              disabled={revokeReason.trim().length < 4 || busy === 'revoke'}
            >
              {busy === 'revoke' ? 'Revoking…' : 'Revoke card'}
            </button>
          </>
        }
      >
        <Field label="Reason (audited)" htmlFor="revoke-reason" required hint="At least 4 characters, e.g. “Card lost”.">
          <Textarea
            id="revoke-reason"
            rows={2}
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(approvalTarget)}
        title={approvalTarget?.label || ''}
        message={
          approvalTarget?.decision === 'approve'
            ? 'Approving allows ID-card issuance and attendance recording. The action is audit-logged.'
            : approvalTarget?.decision === 'deactivate'
              ? 'Suspending employment revokes all active cards and disables the login account.'
              : 'Rejecting prevents card issuance until the record is reviewed again.'
        }
        confirmLabel={approvalTarget?.label || 'Confirm'}
        onClose={() => setApprovalTarget(null)}
        onConfirm={() => {
          const decision = approvalTarget?.decision
          setApprovalTarget(null)
          approve(decision, `Staff record updated (${decision}).`)
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Archive this staff record?"
        message="The record is retained for audit and statutory purposes, but removed from active lists. All cards are revoked and the login account disabled."
        confirmLabel="Archive record"
        destructive
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleteOpen(false)
          await run(
            'delete',
            async () => {
              await api.delete(`/staff/${staffId}/`)
              toast.success('Staff record archived.')
              navigate('/staff')
            },
          )
        }}
      />
    </>
  )
}
