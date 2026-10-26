import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  FileText,
  Moon,
  RefreshCw,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import api, { downloadFile } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useFetch } from '../hooks/useApi'
import Modal, { ConfirmDialog } from '../components/Modal'
import StatCard from '../components/StatCard'
import {
  Avatar,
  Card,
  CardHeader,
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
  Spinner,
} from '../components/ui'
import { formatDate, formatDateTime, formatTime, humanise, todayISO } from '../utils/format'

function startOfWeek(iso) {
  const date = new Date(`${iso}T00:00:00`)
  const day = (date.getDay() + 6) % 7 // Monday = 0
  date.setDate(date.getDate() - day)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function AssignModal({ open, onClose, shifts, departments, weekStart, onSaved }) {
  const [mode, setMode] = useState('single')
  const [staffQuery, setStaffQuery] = useState('')
  const [staffResults, setStaffResults] = useState([])
  const [selected, setSelected] = useState([])
  const [form, setForm] = useState({
    shift_id: '',
    work_date: weekStart,
    start_date: weekStart,
    end_date: addDays(weekStart, 6),
    skip_weekends: true,
    notes: '',
    is_public_holiday: false,
  })
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setMode('single')
    setStaffQuery('')
    setStaffResults([])
    setSelected([])
    setForm((current) => ({
      ...current,
      shift_id: shifts[0]?.id || '',
      work_date: weekStart,
      start_date: weekStart,
      end_date: addDays(weekStart, 6),
    }))
    setMessage('')
  }, [open, weekStart, shifts])

  const search = async () => {
    setSearching(true)
    try {
      const { data } = await api.get('/staff/', { params: { search: staffQuery.trim(), active_only: 1, page_size: 10 } })
      setStaffResults(data.results || [])
    } finally {
      setSearching(false)
    }
  }

  const toggleStaff = (staff) => {
    setSelected((current) =>
      current.some((row) => row.staff_id === staff.staff_id)
        ? current.filter((row) => row.staff_id !== staff.staff_id)
        : [...current, staff],
    )
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'single') {
        if (selected.length !== 1) {
          setMessage('Select exactly one staff member for a single assignment.')
          setBusy(false)
          return
        }
        const { data } = await api.post('/duty-roster/', {
          staff_doc_id: selected[0].id,
          shift_id: form.shift_id,
          work_date: form.work_date,
          notes: form.notes,
          is_public_holiday: form.is_public_holiday,
        })
        onSaved?.(data.assignment, `${selected[0].full_name} rostered.`)
      } else {
        if (selected.length === 0) {
          setMessage('Select at least one staff member.')
          setBusy(false)
          return
        }
        const dates = []
        const cursor = new Date(`${form.start_date}T00:00:00`)
        const limit = new Date(`${form.end_date}T00:00:00`)
        while (cursor <= limit && dates.length < 62) {
          const weekday = cursor.getDay()
          if (!(form.skip_weekends && (weekday === 0 || weekday === 6))) {
            dates.push(cursor.toISOString().slice(0, 10))
          }
          cursor.setDate(cursor.getDate() + 1)
        }
        const { data } = await api.post('/duty-roster/', {
          staff_doc_ids: selected.map((row) => row.id),
          shift_id: form.shift_id,
          dates,
        })
        onSaved?.(null, data.message || `${data.created?.length || 0} assignments created.`)
      }
    } catch (err) {
      setMessage(err.friendlyMessage || 'The roster assignment could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Assign shifts"
      description="Create one assignment or publish a whole block of dates. Duplicate assignments are skipped, never duplicated."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="assign-form" className="btn-primary" disabled={busy}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" /> {busy ? 'Saving…' : 'Save assignment(s)'}
          </button>
        </>
      }
    >
      <form id="assign-form" className="space-y-4" onSubmit={submit}>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}
        <Tabs
          tabs={[
            { id: 'single', label: 'Single assignment' },
            { id: 'bulk', label: 'Bulk publish' },
          ]}
          active={mode}
          onChange={setMode}
        />

        <div className="rounded-xl border border-ink-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Staff {selected.length > 0 && <span className="ml-1 text-medical-700">({selected.length} selected)</span>}
          </p>
          <div className="flex gap-2">
            <input
              type="search"
              className="input"
              placeholder="Search active staff by name or staff ID"
              value={staffQuery}
              onChange={(event) => setStaffQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  search()
                }
              }}
              aria-label="Search staff"
            />
            <button type="button" className="btn-outline" onClick={search} disabled={staffQuery.trim().length < 2 || searching}>
              {searching ? <Spinner /> : 'Search'}
            </button>
          </div>
          {staffResults.length > 0 && (
            <ul className="mt-2 max-h-48 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-200">
              {staffResults.map((staff) => {
                const isSelected = selected.some((row) => row.staff_id === staff.staff_id)
                return (
                  <li key={staff.staff_id}>
                    <label className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${isSelected ? 'bg-medical-50' : 'hover:bg-ink-50'}`}>
                      <input
                        type={mode === 'single' ? 'radio' : 'checkbox'}
                        name="roster-staff"
                        checked={isSelected}
                        onChange={() => (mode === 'single' ? setSelected([staff]) : toggleStaff(staff))}
                      />
                      <Avatar name={staff.full_name} src={staff.photo_url} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-800">{staff.full_name}</span>
                        <span className="block font-mono text-[11px] text-ink-500">
                          {staff.staff_id} · {staff.department_name} · {staff.job_title}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shift" htmlFor="assign-shift" required>
            <Select
              id="assign-shift"
              value={form.shift_id}
              onChange={(event) => setForm((c) => ({ ...c, shift_id: event.target.value }))}
              required
            >
              <option value="">Select a shift</option>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} ({shift.start_time}–{shift.end_time}){shift.is_overnight ? ' · overnight' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'single' ? (
            <Field label="Date" htmlFor="assign-date" required>
              <Input
                id="assign-date"
                type="date"
                value={form.work_date}
                onChange={(event) => setForm((c) => ({ ...c, work_date: event.target.value }))}
                required
              />
            </Field>
          ) : (
            <>
              <Field label="From" htmlFor="assign-start" required>
                <Input
                  id="assign-start"
                  type="date"
                  value={form.start_date}
                  onChange={(event) => setForm((c) => ({ ...c, start_date: event.target.value }))}
                  required
                />
              </Field>
              <Field label="To" htmlFor="assign-end" required hint="Maximum span is validated server-side.">
                <Input
                  id="assign-end"
                  type="date"
                  value={form.end_date}
                  onChange={(event) => setForm((c) => ({ ...c, end_date: event.target.value }))}
                  required
                />
              </Field>
            </>
          )}
        </div>

        {mode === 'bulk' && (
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.skip_weekends}
              onChange={(event) => setForm((c) => ({ ...c, skip_weekends: event.target.checked }))}
            />
            <span>
              Skip weekends
              <span className="block text-[11px] text-ink-500">Saturday and Sunday are excluded from the block.</span>
            </span>
          </label>
        )}

        {mode === 'single' && (
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.is_public_holiday}
              onChange={(event) => setForm((c) => ({ ...c, is_public_holiday: event.target.checked }))}
            />
            <span>
              Public holiday
              <span className="block text-[11px] text-ink-500">Flagged in the roster and the printable PDF.</span>
            </span>
          </label>
        )}

        <Field label="Notes" htmlFor="assign-notes">
          <Textarea
            id="assign-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
          />
        </Field>
        <p className="text-[11px] text-ink-500">
          Departments available for filtering: {(departments?.results || []).length}. Overnight shifts (end time ≤ start time)
          span into the next calendar day and are handled by the clock automatically.
        </p>
      </form>
    </Modal>
  )
}

export default function DutyRoster() {
  const toast = useToast()
  const { user } = useAuth()
  const canManage = ['super_admin', 'clinic_admin', 'hr_officer'].includes(user?.role)

  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayISO()))
  const [tab, setTab] = useState('roster')
  const [departmentId, setDepartmentId] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [busy, setBusy] = useState('')
  const [onDuty, setOnDuty] = useState(null)
  const [onDutyLoading, setOnDutyLoading] = useState(true)
  const [onDutyError, setOnDutyError] = useState('')

  const weekEnd = addDays(weekStart, 6)

  const { data: shifts } = useFetch('/staff/shifts/')
  const { data: departments } = useFetch('/staff/departments/')
  const roster = useFetch('/duty-roster/', {
    start: weekStart,
    end: weekEnd,
    department_id: departmentId || undefined,
    shift_id: shiftId || undefined,
  })

  const loadOnDuty = useCallback(async () => {
    setOnDutyLoading(true)
    setOnDutyError('')
    try {
      const { data } = await api.get('/duty-roster/on-duty/', {
        params: { department_id: departmentId || undefined },
      })
      setOnDuty(data)
    } catch (err) {
      setOnDutyError(err.friendlyMessage || 'The live duty board could not be loaded.')
    } finally {
      setOnDutyLoading(false)
    }
  }, [departmentId])

  useEffect(() => {
    loadOnDuty()
    const timer = window.setInterval(loadOnDuty, 60_000)
    return () => window.clearInterval(timer)
  }, [loadOnDuty])

  const byDate = useMemo(() => {
    const groups = new Map()
    ;(roster.data?.assignments || []).forEach((row) => {
      if (!groups.has(row.work_date)) groups.set(row.work_date, [])
      groups.get(row.work_date).push(row)
    })
    return groups
  }, [roster.data])

  const cancelAssignment = async () => {
    if (!cancelTarget) return
    setBusy('cancel')
    try {
      await api.delete(`/duty-roster/${cancelTarget.id}/`)
      toast.success('Roster entry cancelled.')
      setCancelTarget(null)
      roster.refresh()
      loadOnDuty()
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this assignment.')
    } finally {
      setBusy('')
    }
  }

  const exportPdf = async () => {
    setBusy('pdf')
    try {
      await downloadFile(`/duty-roster/pdf/?start=${weekStart}&end=${weekEnd}`, `duty-roster-${weekStart}.pdf`)
      toast.success('Roster PDF downloaded.')
    } catch (err) {
      toast.error(err.friendlyMessage || 'Export failed.')
    } finally {
      setBusy('')
    }
  }

  const counts = onDuty?.counts || {}

  return (
    <>
      <PageHeader
        title="Duty roster & live duty board"
        description="Plan shifts, publish them in bulk and see who is scheduled, late, clocked in, on duty or finished — computed from the roster plus real clock records."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Duty roster' }]}
        meta={
          <>
            <span>
              Week {formatDate(weekStart)} → {formatDate(weekEnd)}
            </span>
            <span className="text-ink-400">·</span>
            <span>{roster.data?.total ?? 0} assignments</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn-outline" onClick={exportPdf} disabled={busy === 'pdf'}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Roster PDF
            </button>
            <button type="button" className="btn-outline" onClick={() => { roster.refresh(); loadOnDuty() }}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </button>
            {canManage && (
              <button type="button" className="btn-primary" onClick={() => setAssignOpen(true)}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Assign shifts
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label="On duty now" value={counts.on_duty ?? 0} icon={Activity} tone="teal" hint="Clocked in and active" />
        <StatCard label="Scheduled" value={counts.scheduled ?? 0} icon={CalendarDays} tone="medical" hint="Shift not started" />
        <StatCard label="Late" value={counts.late ?? 0} icon={Clock} tone="amber" hint="Past grace, no clock-in" />
        <StatCard label="Absent" value={counts.absent ?? 0} icon={UserMinus} tone="red" hint="Shift ended, no record" />
        <StatCard label="Completed" value={counts.completed ?? 0} icon={CheckCircle2} tone="violet" hint="Clocked out" />
      </div>

      <Card className="mt-5">
        <div className="px-5 pt-3">
          <Tabs
            tabs={[
              { id: 'roster', label: 'Weekly roster' },
              { id: 'live', label: 'Live duty board' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-3 lg:flex-row lg:items-end">
          <Field label="Department" htmlFor="roster-dept">
            <Select id="roster-dept" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">All departments</option>
              {(departments?.results || []).map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Shift" htmlFor="roster-shift">
            <Select
              id="roster-shift"
              value={shiftId}
              onChange={(event) => {
                setShiftId(event.target.value)
                roster.refresh()
              }}
            >
              <option value="">All shifts</option>
              {(shifts?.results || []).map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} ({shift.start_time}–{shift.end_time})
                </option>
              ))}
            </Select>
          </Field>
          {tab === 'roster' && (
            <div className="flex items-center gap-2">
              <button type="button" className="btn-outline btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                ← Previous week
              </button>
              <button type="button" className="btn-outline btn-sm" onClick={() => setWeekStart(startOfWeek(todayISO()))}>
                This week
              </button>
              <button type="button" className="btn-outline btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                Next week →
              </button>
            </div>
          )}
          <div className="lg:ml-auto">
            <label className="label" htmlFor="roster-jump">
              Jump to week of
            </label>
            <Input
              id="roster-jump"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(startOfWeek(event.target.value || todayISO()))}
            />
          </div>
        </div>

        {tab === 'roster' && (
          <div className="p-5">
            {roster.loading ? (
              <LoadingBlock rows={6} label="Loading roster…" />
            ) : roster.error ? (
              <ErrorState message={roster.error} onRetry={roster.refresh} />
            ) : (roster.data?.assignments || []).length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No shifts published for this week"
                description="Assign staff to shifts to build the roster. Attendance can then be matched to the schedule automatically."
                action={
                  canManage && (
                    <button type="button" className="btn-primary" onClick={() => setAssignOpen(true)}>
                      Assign shifts
                    </button>
                  )
                }
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-7">
                {Array.from({ length: 7 }).map((_, index) => {
                  const date = addDays(weekStart, index)
                  const entries = byDate.get(date) || []
                  const isToday = date === todayISO()
                  return (
                    <div
                      key={date}
                      className={`rounded-xl border p-3 ${isToday ? 'border-medical-400 bg-medical-50/40' : 'border-ink-200'}`}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                        {new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}
                      </p>
                      <p className={`text-sm font-semibold ${isToday ? 'text-medical-800' : 'text-ink-800'}`}>
                        {new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {entries.length === 0 && <li className="text-[11px] text-ink-400">No shifts</li>}
                        {entries.map((entry) => (
                          <li key={entry.id} className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-ink-100">
                            <p className="truncate text-[12px] font-medium text-ink-800">{entry.staff_name}</p>
                            <p className="truncate text-[10px] text-ink-500">
                              {entry.shift_name} · {entry.shift_start}–{entry.shift_end}
                              {entry.is_overnight && (
                                <span className="ml-1 inline-flex items-center gap-0.5 text-violet-700">
                                  <Moon className="h-2.5 w-2.5" aria-hidden="true" />overnight
                                </span>
                              )}
                            </p>
                            {entry.department_name && (
                              <p className="truncate text-[10px] text-ink-400">{entry.department_name}</p>
                            )}
                            {entry.is_public_holiday && (
                              <p className="mt-0.5 text-[10px] font-semibold text-amber-700">Public holiday</p>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 hover:underline"
                                onClick={() => setCancelTarget(entry)}
                              >
                                <Trash2 className="h-2.5 w-2.5" aria-hidden="true" /> Remove
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'live' && (
          <div className="p-5">
            {onDutyLoading && !onDuty ? (
              <LoadingBlock rows={5} label="Checking who is on duty…" />
            ) : onDutyError ? (
              <ErrorState message={onDutyError} onRetry={loadOnDuty} />
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <StatusPill value="on_duty" /> = clocked in · <StatusPill value="scheduled" /> = shift not
                  started · <StatusPill value="late" /> = past grace period without a clock-in ·{' '}
                  <StatusPill value="completed" /> = clocked out · <StatusPill value="absent" /> = no record
                  <span className="ml-auto">{onDuty?.generated_at ? `Updated ${formatDateTime(onDuty.generated_at)}` : ''}</span>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader title={`On duty (${onDuty?.on_duty?.length || 0})`} description="Clocked in right now" icon={Activity} />
                    <ul className="divide-y divide-ink-100">
                      {(onDuty?.on_duty || []).map((entry) => (
                        <li key={entry.id + (entry.assignment_id || '')} className="flex items-center gap-3 px-5 py-2.5">
                          <Avatar name={entry.full_name} src={entry.photo_url} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-800">{entry.full_name}</p>
                            <p className="truncate text-[11px] text-ink-500">
                              {entry.department_name} · {entry.shift_name || entry.shift_code}
                              {entry.unrostered ? ' · unrostered' : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] text-ink-600">in {formatTime(entry.clock_in_at)}</p>
                            <p className="text-[11px] text-ink-400">ends {entry.shift_end || '—'}</p>
                          </div>
                        </li>
                      ))}
                      {!onDuty?.on_duty?.length && (
                        <EmptyState icon={Users} title="Nobody is clocked in" description="Staff appear here as soon as they clock in." />
                      )}
                    </ul>
                  </Card>

                  <div className="space-y-4">
                    <Card>
                      <CardHeader title={`Late (${onDuty?.late?.length || 0})`} description="Past the grace period, no clock-in" icon={Clock} />
                      <ul className="divide-y divide-ink-100">
                        {(onDuty?.late || []).map((entry) => (
                          <li key={entry.id + (entry.assignment_id || '')} className="flex items-center justify-between gap-3 px-5 py-2">
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink-800">{entry.full_name}</span>
                              <span className="block text-[11px] text-ink-500">
                                {entry.shift_name} · starts {entry.shift_start}
                              </span>
                            </span>
                            <StatusPill value="late" />
                          </li>
                        ))}
                        {!onDuty?.late?.length && <li className="px-5 py-3 text-xs text-ink-500">Nobody is late.</li>}
                      </ul>
                    </Card>
                    <Card>
                      <CardHeader title={`Scheduled (${onDuty?.scheduled?.length || 0})`} description="Shift has not started yet" icon={CalendarDays} />
                      <ul className="divide-y divide-ink-100">
                        {(onDuty?.scheduled || []).map((entry) => (
                          <li key={entry.id + (entry.assignment_id || '')} className="flex items-center justify-between gap-3 px-5 py-2">
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink-800">{entry.full_name}</span>
                              <span className="block text-[11px] text-ink-500">
                                {entry.shift_name} · {formatTime(entry.starts_at)}
                              </span>
                            </span>
                            <StatusPill value="scheduled" />
                          </li>
                        ))}
                        {!onDuty?.scheduled?.length && <li className="px-5 py-3 text-xs text-ink-500">No upcoming shifts today.</li>}
                      </ul>
                    </Card>
                    <Card>
                      <CardHeader title={`Absent / completed (${(onDuty?.absent?.length || 0) + (onDuty?.completed?.length || 0)})`} description="Finished shifts and no-shows" icon={CheckCircle2} />
                      <ul className="divide-y divide-ink-100">
                        {(onDuty?.completed || []).map((entry) => (
                          <li key={`c-${entry.id}${entry.assignment_id || ''}`} className="flex items-center justify-between gap-3 px-5 py-2">
                            <span className="truncate text-sm text-ink-800">{entry.full_name}</span>
                            <span className="flex items-center gap-2">
                              <span className="text-[11px] text-ink-500">{entry.total_hours || 0} h</span>
                              <StatusPill value="completed" />
                            </span>
                          </li>
                        ))}
                        {(onDuty?.absent || []).map((entry) => (
                          <li key={`a-${entry.id}${entry.assignment_id || ''}`} className="flex items-center justify-between gap-3 px-5 py-2">
                            <span className="truncate text-sm text-ink-800">{entry.full_name}</span>
                            <StatusPill value="absent" />
                          </li>
                        ))}
                        {!onDuty?.completed?.length && !onDuty?.absent?.length && (
                          <li className="px-5 py-3 text-xs text-ink-500">No completed or absent shifts today.</li>
                        )}
                      </ul>
                    </Card>
                  </div>
                </div>

                {onDuty?.departments?.length > 0 && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {onDuty.departments.map((dept) => (
                      <div key={dept.department} className="rounded-xl border border-ink-200 p-3">
                        <p className="text-xs font-semibold text-ink-800">{dept.department}</p>
                        <p className="text-lg font-semibold text-teal-700">{dept.on_duty}</p>
                        <p className="truncate text-[11px] text-ink-500">{(dept.names || []).join(', ')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {canManage && (
        <AssignModal
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          shifts={shifts?.results || []}
          departments={departments}
          weekStart={weekStart}
          onSaved={(assignment, message) => {
            setAssignOpen(false)
            toast.success(message || 'Roster updated.')
            roster.refresh()
            loadOnDuty()
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Remove this roster entry?"
        message={
          cancelTarget
            ? `${cancelTarget.staff_name} · ${cancelTarget.shift_name} on ${formatDate(cancelTarget.work_date)} will be removed from the roster. Existing attendance records are not deleted.`
            : ''
        }
        confirmLabel="Remove entry"
        destructive
        busy={busy === 'cancel'}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancelAssignment}
      />
    </>
  )
}
