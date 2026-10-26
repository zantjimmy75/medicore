import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarCheck,
  Clock,
  Download,
  FileText,
  Fingerprint,
  Flag,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserSearch,
} from 'lucide-react'
import api, { downloadFile, openPdfPreview } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useFetch } from '../hooks/useApi'
import Modal from '../components/Modal'
import QRScanner from '../components/QRScanner'
import StatCard from '../components/StatCard'
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
  Tabs,
  Textarea,
  Avatar,
} from '../components/ui'
import { formatDate, formatDateTime, formatTime, humanise, isoDaysAgo, todayISO } from '../utils/format'

const ATTENDANCE_STATUSES = ['present', 'late', 'completed', 'incomplete', 'absent', 'on_leave']
const METHODS = [
  ['qr_scan', 'ID card QR scan'],
  ['manual', 'Manual (officer entry)'],
  ['self_service', 'Self service'],
]

function CorrectionModal({ open, onClose, record, onSaved }) {
  const [form, setForm] = useState({ clock_in_at: '', clock_out_at: '', status: '', notes: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const toLocalInput = (value) => {
    if (!value) return ''
    const date = new Date(value)
    const offset = date.getTimezoneOffset()
    return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
  }

  useEffect(() => {
    if (!open || !record) return
    setForm({
      clock_in_at: toLocalInput(record.clock_in_at),
      clock_out_at: toLocalInput(record.clock_out_at),
      status: record.status || '',
      notes: record.notes || '',
      reason: '',
    })
    setMessage('')
  }, [open, record])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        reason: form.reason,
        clock_in_at: form.clock_in_at ? new Date(form.clock_in_at).toISOString() : undefined,
        clock_out_at: form.clock_out_at ? new Date(form.clock_out_at).toISOString() : undefined,
        status: form.status || undefined,
        notes: form.notes,
      }
      Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key])
      await api.post(`/attendance/${record.id}/correction/`, payload)
      onSaved?.()
    } catch (err) {
      setMessage(err.friendlyMessage || 'The correction could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Correct an attendance record"
      description={
        record
          ? `${record.staff_name} · ${record.staff_id} · ${record.work_date}. The original values are preserved in the correction trail.`
          : ''
      }
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="correction-form" className="btn-primary" disabled={busy || form.reason.trim().length < 5}>
            {busy ? 'Saving…' : 'Save correction'}
          </button>
        </>
      }
    >
      <form id="correction-form" className="space-y-3" onSubmit={submit}>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}
        {record?.corrections?.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-900">
            <p className="font-semibold">Previous corrections</p>
            <ul className="mt-1 space-y-1">
              {record.corrections.map((entry, index) => (
                <li key={index}>
                  {entry.corrected_by_name} · {formatDateTime(entry.corrected_at)}: {entry.reason}
                  {entry.changes && (
                    <span className="text-amber-800">
                      {' '}
                      ({Object.keys(entry.changes).join(', ')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Clock in" htmlFor="corr-in">
            <Input
              id="corr-in"
              type="datetime-local"
              value={form.clock_in_at}
              onChange={(event) => setForm((c) => ({ ...c, clock_in_at: event.target.value }))}
            />
          </Field>
          <Field label="Clock out" htmlFor="corr-out">
            <Input
              id="corr-out"
              type="datetime-local"
              value={form.clock_out_at}
              onChange={(event) => setForm((c) => ({ ...c, clock_out_at: event.target.value }))}
            />
          </Field>
          <Field label="Status" htmlFor="corr-status">
            <Select
              id="corr-status"
              value={form.status}
              onChange={(event) => setForm((c) => ({ ...c, status: event.target.value }))}
            >
              <option value="">Leave unchanged</option>
              {ATTENDANCE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (required, ≥ 5 characters)" htmlFor="corr-reason">
            <Input
              id="corr-reason"
              value={form.reason}
              onChange={(event) => setForm((c) => ({ ...c, reason: event.target.value }))}
              placeholder="e.g. Forgot to clock out"
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="corr-notes">
          <Textarea
            id="corr-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
          />
        </Field>
      </form>
    </Modal>
  )
}

function ClockStation({ onRecorded }) {
  const toast = useToast()
  const { user } = useAuth()
  const [mode, setMode] = useState('qr')
  const [badge, setBadge] = useState(null)
  const [scanToken, setScanToken] = useState('')
  const [pin, setPin] = useState('')
  const [staffQuery, setStaffQuery] = useState('')
  const [staffResults, setStaffResults] = useState([])
  const [chosenStaff, setChosenStaff] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [allowOutside, setAllowOutside] = useState(false)

  const canManage = ['super_admin', 'clinic_admin', 'hr_officer'].includes(user?.role)

  const resolveCard = useCallback(
    async (token) => {
      setBusy('resolve')
      setMessage('')
      setBadge(null)
      setScanToken(token)
      try {
        const { data } = await api.post('/staff/verify-card/', { token })
        setBadge(data)
        if (!data.valid) setMessage('This card is not valid (revoked, expired or employment ended).')
      } catch (err) {
        setMessage(err.friendlyMessage || 'That card could not be verified.')
      } finally {
        setBusy('')
      }
    },
    [],
  )

  const searchStaff = useCallback(async () => {
    setBusy('search')
    try {
      const { data } = await api.get('/staff/', {
        params: { search: staffQuery.trim(), active_only: 1, page_size: 8 },
      })
      setStaffResults(data.results || [])
    } catch (err) {
      setMessage(err.friendlyMessage || 'Staff search failed.')
    } finally {
      setBusy('')
    }
  }, [staffQuery])

  const clock = async (kind) => {
    setBusy(kind)
    setMessage('')
    try {
      const payload = { method: mode === 'manual' ? 'manual' : mode === 'self' ? 'self_service' : 'qr_scan' }
      if (mode === 'qr' && scanToken) payload.card_token = scanToken
      if (mode === 'manual' && chosenStaff) payload.staff_id = chosenStaff.staff_id
      if (pin) payload.pin = pin
      if (allowOutside) payload.allow_outside_roster = true
      const { data } = await api.post(`/attendance/clock-${kind}/`, payload)
      toast.success(data.message)
      setPin('')
      setBadge(null)
      setScanToken('')
      setChosenStaff(null)
      setStaffResults([])
      setStaffQuery('')
      onRecorded?.()
    } catch (err) {
      setMessage(err.friendlyMessage || `Clock-${kind} failed.`)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Clock station"
        description="Scan a staff ID card or record attendance manually. Every clock event is attributed to the operator."
        icon={Fingerprint}
      />
      <div className="p-5">
        <Tabs
          tabs={[
            { id: 'qr', label: 'Scan ID card' },
            { id: 'manual', label: 'Manual entry' },
            { id: 'self', label: 'Self service' },
          ]}
          active={mode}
          onChange={(value) => {
            setMode(value)
            setMessage('')
            setBadge(null)
            setChosenStaff(null)
          }}
        />

        <div className="mt-4 space-y-4">
          {message && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {message}
            </p>
          )}

          {mode === 'qr' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <QRScanner onDetected={resolveCard} busy={busy === 'resolve'} label="Scan staff card" />
              {badge && (
                <div className="rounded-xl border border-ink-200 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={badge.full_name} src={badge.photo_url} size="lg" />
                    <div>
                      <p className="text-base font-semibold text-ink-900">{badge.full_name}</p>
                      <p className="text-xs text-ink-500">
                        {badge.staff_id} · {badge.department} · {badge.job_title}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <StatusPill value={badge.card_status || (badge.valid ? 'active' : 'revoked')} />
                        {badge.valid && (
                          <span className="pill bg-emerald-100 text-emerald-800">
                            <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Verified
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {badge.attendance && (
                    <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-[11px] text-ink-600">
                      Today: {humanise(badge.attendance.duty_state)}
                      {badge.attendance.clocked_in_at ? ` · in ${formatTime(badge.attendance.clocked_in_at)}` : ''}
                      {badge.attendance.clocked_out_at ? ` · out ${formatTime(badge.attendance.clocked_out_at)}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'manual' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                    <input
                      type="search"
                      className="input pl-9"
                      placeholder="Search staff by name or staff ID"
                      value={staffQuery}
                      onChange={(event) => setStaffQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          searchStaff()
                        }
                      }}
                      aria-label="Search staff"
                    />
                  </div>
                  <button type="button" className="btn-outline" onClick={searchStaff} disabled={staffQuery.trim().length < 2}>
                    <UserSearch className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {staffResults.length > 0 && (
                  <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                    {staffResults.map((staff) => (
                      <li key={staff.id}>
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-50 ${
                            chosenStaff?.staff_id === staff.staff_id ? 'bg-medical-50' : ''
                          }`}
                          onClick={() => setChosenStaff(staff)}
                        >
                          <Avatar name={staff.full_name} src={staff.photo_url} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink-800">{staff.full_name}</span>
                            <span className="block font-mono text-[11px] text-ink-500">
                              {staff.staff_id} · {staff.department_name}
                            </span>
                          </span>
                          {chosenStaff?.staff_id === staff.staff_id && (
                            <BadgeCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={allowOutside}
                      onChange={(event) => setAllowOutside(event.target.checked)}
                    />
                    <span>
                      Record outside the roster
                      <span className="block text-[11px] text-amber-800">
                        Allows attendance when no shift is scheduled. Restricted to attendance officers and audited.
                      </span>
                    </span>
                  </label>
                )}
              </div>
              <div className="rounded-xl border border-ink-200 p-4">
                {chosenStaff ? (
                  <>
                    <p className="text-base font-semibold text-ink-900">{chosenStaff.full_name}</p>
                    <p className="text-xs text-ink-500">
                      {chosenStaff.staff_id} · {chosenStaff.department_name} · {chosenStaff.job_title}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-500">Select a staff member to continue.</p>
                )}
              </div>
            </div>
          )}

          {mode === 'self' && (
            <div className="rounded-xl border border-ink-200 p-4 text-sm text-ink-700">
              <p className="font-medium text-ink-900">Self service clock</p>
              <p className="mt-1 text-xs text-ink-500">
                Records attendance for your own linked staff profile. You can only clock yourself in or out.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-ink-100 pt-4 sm:flex-row sm:items-end">
            <Field label="Attendance PIN" htmlFor="clock-pin" className="sm:w-48" hint="Required when the staff member has a PIN set.">
              <Input
                id="clock-pin"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                autoComplete="off"
              />
            </Field>
            <div className="flex flex-1 flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => clock('in')}
                disabled={busy === 'in' || (mode === 'qr' ? !badge?.valid : mode === 'manual' ? !chosenStaff : false)}
              >
                <LogIn className="h-4 w-4" aria-hidden="true" /> {busy === 'in' ? 'Recording…' : 'Clock in'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => clock('out')}
                disabled={busy === 'out' || (mode === 'qr' ? !badge?.valid : mode === 'manual' ? !chosenStaff : false)}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> {busy === 'out' ? 'Recording…' : 'Clock out'}
              </button>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-ink-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
            Duplicate clock-ins are rejected by the server (one open session per staff, shift and day). Overnight
            shifts roll into the next calendar day automatically.
          </p>
        </div>
      </div>
    </Card>
  )
}

export default function Attendance() {
  const toast = useToast()
  const { user } = useAuth()
  const canManage = ['super_admin', 'clinic_admin', 'hr_officer'].includes(user?.role)

  const [tab, setTab] = useState('records')
  const [start, setStart] = useState(isoDaysAgo(6))
  const [end, setEnd] = useState(todayISO())
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [correctionTarget, setCorrectionTarget] = useState(null)
  const [busy, setBusy] = useState('')

  const { data: departments } = useFetch('/staff/departments/')
  const { data: mine, refresh: refreshMine } = useFetch('/attendance/mine/')
  const { data: today, refresh: refreshToday } = useFetch('/attendance/today/', {}, { enabled: canManage })
  const { data: report, refresh: refreshReport } = useFetch(
    '/attendance/reports/',
    { start, end, department_id: departmentId || undefined },
    { enabled: tab === 'summary' },
  )

  const records = useFetch('/attendance/', {
    start,
    end: end || undefined,
    department_id: departmentId || undefined,
    status: status || undefined,
    page,
    page_size: 15,
  })

  const afterChange = () => {
    records.refresh()
    refreshToday()
    refreshReport()
    refreshMine()
  }

  const flagMissing = async () => {
    setBusy('flag')
    try {
      const { data } = await api.post('/attendance/flag-missing-clockouts/')
      toast.success(data.message)
      afterChange()
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not flag missing clock-outs.')
    } finally {
      setBusy('')
    }
  }

  const exportReport = async (format) => {
    setBusy(format)
    try {
      await downloadFile(
        `/reports/attendance/?format=${format}&start=${start}&end=${end}${departmentId ? `&department_id=${departmentId}` : ''}`,
        `attendance-${start}-to-${end}.${format === 'csv' ? 'csv' : 'pdf'}`,
      )
      toast.success(`Attendance ${format.toUpperCase()} downloaded.`)
    } catch (err) {
      toast.error(err.friendlyMessage || 'Export failed.')
    } finally {
      setBusy('')
    }
  }

  const myToday = mine?.today
  const summary = report?.summary

  const columns = useMemo(
    () => [
      {
        key: 'staff_name',
        header: 'Staff',
        render: (row) => (
          <div>
            <p className="text-sm font-medium text-ink-800">{row.staff_name}</p>
            <p className="font-mono text-[11px] text-ink-500">{row.staff_id}</p>
          </div>
        ),
      },
      { key: 'work_date', header: 'Date', render: (row) => <span className="text-xs">{formatDate(row.work_date)}</span> },
      {
        key: 'shift',
        header: 'Shift',
        render: (row) => (
          <span className="text-xs text-ink-600">
            {row.shift_code || '—'}
            <span className="block text-[11px] text-ink-400">
              {row.shift_start}–{row.shift_end}
            </span>
          </span>
        ),
      },
      {
        key: 'clock_in_at',
        header: 'Clock in',
        render: (row) => (
          <span className="font-mono text-xs">
            {formatTime(row.clock_in_at)}
            <span className="block text-[11px] text-ink-400">{formatDate(row.clock_in_at)}</span>
          </span>
        ),
      },
      {
        key: 'clock_out_at',
        header: 'Clock out',
        render: (row) => (
          <span className="font-mono text-xs">
            {row.clock_out_at ? formatTime(row.clock_out_at) : <span className="text-amber-700">open</span>}
          </span>
        ),
      },
      { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
      {
        key: 'late_minutes',
        header: 'Late / hours',
        render: (row) => (
          <span className="text-xs text-ink-600">
            {row.late_minutes} min
            <span className="block text-[11px] text-ink-400">{row.total_hours || 0} h</span>
          </span>
        ),
      },
      { key: 'method', header: 'Method', render: (row) => <span className="text-xs">{humanise(row.method)}</span> },
      {
        key: 'corrections',
        header: 'Corrections',
        render: (row) =>
          canManage ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={(event) => {
                event.stopPropagation()
                setCorrectionTarget(row)
              }}
            >
              {row.correction_count > 0 ? `Corrected (${row.correction_count})` : 'Correct'}
            </button>
          ) : (
            <span className="text-xs text-ink-500">{row.correction_count || '—'}</span>
          ),
      },
    ],
    [canManage],
  )

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Clock staff in and out, review daily presence, correct records with an audit trail, and export HR reports."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Attendance' }]}
        actions={
          <>
            {canManage && (
              <button type="button" className="btn-outline" onClick={flagMissing} disabled={busy === 'flag'}>
                <Flag className="h-4 w-4" aria-hidden="true" /> {busy === 'flag' ? 'Flagging…' : 'Flag missing clock-outs'}
              </button>
            )}
            <button type="button" className="btn-outline" onClick={() => exportReport('csv')} disabled={busy === 'csv'}>
              <Download className="h-4 w-4" aria-hidden="true" /> CSV
            </button>
            <button type="button" className="btn-primary" onClick={() => exportReport('pdf')} disabled={busy === 'pdf'}>
              <FileText className="h-4 w-4" aria-hidden="true" /> PDF report
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present today"
          value={canManage ? today?.present ?? 0 : myToday?.clocked_in_at ? 1 : 0}
          icon={CalendarCheck}
          tone="teal"
          hint={`${today?.active_staff ?? 0} active staff`}
        />
        <StatCard label="Late today" value={today?.late ?? 0} icon={Clock} tone="amber" hint="After the grace period" />
        <StatCard label="Currently in" value={today?.currently_in ?? 0} icon={LogIn} tone="medical" hint="Open sessions" />
        <StatCard label="Incomplete" value={today?.incomplete ?? 0} icon={Flag} tone="red" hint="Missing clock-out" />
      </div>

      <div className="mt-5">
        <ClockStation onRecorded={afterChange} />
      </div>

      <Card className="mt-5">
        <div className="px-5 pt-3">
          <Tabs
            tabs={[
              { id: 'records', label: 'Attendance records' },
              { id: 'summary', label: 'Period summary' },
              { id: 'mine', label: 'My attendance' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'records' && (
          <>
            <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-3 lg:flex-row lg:items-end">
              <Field label="From" htmlFor="att-start">
                <Input id="att-start" type="date" value={start} onChange={(event) => { setStart(event.target.value); setPage(1) }} />
              </Field>
              <Field label="To" htmlFor="att-end">
                <Input id="att-end" type="date" value={end} onChange={(event) => { setEnd(event.target.value); setPage(1) }} />
              </Field>
              <Field label="Department" htmlFor="att-dept">
                <Select id="att-dept" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1) }}>
                  <option value="">All departments</option>
                  {(departments?.results || []).map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" htmlFor="att-status">
                <Select id="att-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
                  <option value="">Any status</option>
                  {ATTENDANCE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <button type="button" className="btn-outline" onClick={records.refresh}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload
              </button>
            </div>
            {records.error ? (
              <EmptyState title="Could not load attendance" description={records.error} />
            ) : (
              <>
                <DataTable
                  caption="Attendance records"
                  columns={columns}
                  rows={records.data?.results || []}
                  loading={records.loading}
                  empty={
                    <EmptyState
                      icon={Fingerprint}
                      title="No attendance records in this range"
                      description="Clock a staff member in above, or widen the date range."
                    />
                  }
                />
                <Pagination pagination={records.data?.pagination} onChange={setPage} />
              </>
            )}
          </>
        )}

        {tab === 'summary' && (
          <div className="p-5">
            {report.loading ? (
              <LoadingBlock rows={4} />
            ) : !summary ? (
              <EmptyState title="No summary available" description={report.error || 'Adjust the date range and try again.'} />
            ) : (
              <>
                <p className="mb-4 text-xs text-ink-500">
                  Period: {formatDate(report?.period?.start)} → {formatDate(report?.period?.end)}
                </p>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Records" value={summary.records} icon={Fingerprint} tone="medical" />
                  <StatCard label="Total hours" value={summary.total_hours} icon={Clock} tone="teal" />
                  <StatCard label="Late events" value={summary.late_events} icon={Clock} tone="amber" />
                  <StatCard label="Incomplete" value={summary.incomplete_records} icon={Flag} tone="red" />
                </div>
                <div className="mt-5">
                  <DataTable
                    caption="Period attendance"
                    columns={[
                      { key: 'staff_name', header: 'Staff', render: (row) => <span className="text-xs">{row.staff_name}</span> },
                      { key: 'work_date', header: 'Date', render: (row) => <span className="text-xs">{formatDate(row.work_date)}</span> },
                      { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                      { key: 'late_minutes', header: 'Late', render: (row) => <span className="text-xs">{row.late_minutes} min</span> },
                      { key: 'total_hours', header: 'Hours', render: (row) => <span className="text-xs">{row.total_hours}</span> },
                      { key: 'correction_count', header: 'Corrections', render: (row) => <span className="text-xs">{row.correction_count}</span> },
                    ]}
                    rows={report?.records || []}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'mine' && (
          <div className="p-5">
            {!mine?.staff ? (
              <EmptyState
                icon={UserSearch}
                title="No staff profile linked"
                description={mine?.message || 'Your login is not linked to a staff record, so attendance cannot be tracked for you.'}
              />
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-ink-200 p-4">
                  <p className="text-sm font-semibold text-ink-900">{mine.staff.full_name}</p>
                  <p className="text-xs text-ink-500">
                    {mine.staff.staff_id} · {mine.staff.department_name} · shift {mine.staff.shift_code || '—'}
                  </p>
                  <p className="mt-2 text-xs text-ink-600">
                    Today: <StatusPill value={myToday?.duty_state} />{' '}
                    {myToday?.clocked_in_at && `in ${formatTime(myToday.clocked_in_at)}`}
                    {myToday?.clocked_out_at && ` · out ${formatTime(myToday.clocked_out_at)}`}
                  </p>
                </div>
                <DataTable
                  caption="My attendance"
                  columns={[
                    { key: 'work_date', header: 'Date', render: (row) => <span className="text-xs">{formatDate(row.work_date)}</span> },
                    { key: 'clock_in_at', header: 'In', render: (row) => <span className="font-mono text-xs">{formatTime(row.clock_in_at)}</span> },
                    { key: 'clock_out_at', header: 'Out', render: (row) => <span className="font-mono text-xs">{formatTime(row.clock_out_at)}</span> },
                    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                    { key: 'total_hours', header: 'Hours', render: (row) => <span className="text-xs">{row.total_hours}</span> },
                  ]}
                  rows={mine.records || []}
                />
              </>
            )}
          </div>
        )}
      </Card>

      <CorrectionModal
        open={Boolean(correctionTarget)}
        onClose={() => setCorrectionTarget(null)}
        record={correctionTarget}
        onSaved={() => {
          setCorrectionTarget(null)
          toast.success('Correction saved with an audit entry.')
          afterChange()
        }}
      />
    </>
  )
}
