import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarPlus, CheckCircle2, Clock, RefreshCw, Search, XCircle } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useDebounced } from '../hooks/useApi'
import Modal from '../components/Modal'
import SearchBar from '../components/SearchBar'
import StatCard from '../components/StatCard'
import AppointmentFormModal from './appointments/AppointmentFormModal'
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  NoResults,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
  LoadingBlock,
} from '../components/ui'
import { formatDate, formatTime, humanise, todayISO } from '../utils/format'

const STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'missed']

export default function Appointments() {
  const toast = useToast()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()

  const [view, setView] = useState('upcoming')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [bookOpen, setBookOpen] = useState(params.get('new') === '1')
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)
  const [active, setActive] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState('')
  const debouncedSearch = useDebounced(search)

  const canBook = ['super_admin', 'clinic_admin', 'receptionist', 'doctor', 'nurse', 'hr_officer'].includes(user?.role)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = {
        page,
        page_size: 15,
        status: status || undefined,
        search: debouncedSearch || undefined,
      }
      if (date) {
        query.date = date
      } else if (view === 'upcoming') {
        query.upcoming = 1
      } else if (view === 'past') {
        query.past = 1
      }
      if (user?.role === 'doctor' && view === 'mine') query.mine = 1
      const { data } = await api.get('/appointments/', { params: query })
      setRows(data.results || [])
      setPagination(data.pagination)
    } catch (err) {
      setError(err.friendlyMessage || 'Appointments could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [page, status, debouncedSearch, date, view, user?.role])

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/appointments/stats/')
      setStats(data)
    } catch {
      setStats(null)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const grouped = useMemo(() => {
    const groups = new Map()
    rows.forEach((row) => {
      const key = new Date(row.scheduled_at).toDateString()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    })
    return [...groups.entries()]
  }, [rows])

  const closeBooking = () => {
    setBookOpen(false)
    if (params.get('new')) {
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }

  const changeStatus = async (appointment, nextStatus, reason) => {
    setBusy(appointment.id)
    try {
      await api.patch(`/appointments/${appointment.id}/`, {
        status: nextStatus,
        cancellation_reason: reason || undefined,
      })
      toast.success(`Appointment ${appointment.appointment_number} marked ${nextStatus}.`)
      setActive(null)
      setCancelReason('')
      await load()
      loadStats()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The appointment could not be updated.')
    } finally {
      setBusy('')
    }
  }

  const columns = [
    {
      key: 'appointment_number',
      header: 'Appointment',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-ink-800">{row.appointment_number}</p>
          <p className="text-[11px] text-ink-500">{humanise(row.duration_minutes ? `${row.duration_minutes} min` : '')}</p>
        </div>
      ),
    },
    {
      key: 'patient_name',
      header: 'Patient',
      render: (row) => (
        <div>
          <p className="text-sm font-medium text-ink-800">{row.patient_name}</p>
          <p className="font-mono text-[11px] text-ink-500">{row.patient_number}</p>
        </div>
      ),
    },
    {
      key: 'scheduled_at',
      header: 'When',
      render: (row) => (
        <div>
          <p className="text-xs font-medium text-ink-800">{formatTime(row.scheduled_at)}</p>
          <p className="text-[11px] text-ink-500">{formatDate(row.scheduled_at)}</p>
        </div>
      ),
    },
    { key: 'clinician_name', header: 'Clinician', render: (row) => <span className="text-xs">{row.clinician_name}</span> },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => <span className="line-clamp-2 text-xs text-ink-600">{row.reason || '—'}</span>,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Book visits against real clinician availability. Conflicts are detected server-side; overrides are audited."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Appointments' }]}
        actions={
          <>
            <button type="button" className="btn-outline" onClick={() => { load(); loadStats() }}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </button>
            {canBook && (
              <button type="button" className="btn-primary" onClick={() => setBookOpen(true)}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Book appointment
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today" value={stats?.today ?? '—'} icon={Clock} tone="medical" hint={`${stats?.today_completed ?? 0} completed`} />
        <StatCard label="Upcoming" value={stats?.upcoming ?? '—'} icon={CalendarPlus} tone="teal" hint="Scheduled or confirmed" />
        <StatCard label="Attended" value={stats?.counts?.completed ?? '—'} icon={CheckCircle2} tone="violet" hint="All time" />
        <StatCard label="Cancelled" value={stats?.counts?.cancelled ?? '—'} icon={XCircle} tone="red" hint={`${stats?.counts?.missed ?? 0} missed`} />
      </div>

      <Card className="mt-5 mb-5 card-pad">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
            {[
              ['upcoming', 'Upcoming'],
              ['today', 'Today'],
              ['past', 'Past'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setView(value)
                  setPage(1)
                  setDate(value === 'today' ? todayISO() : '')
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  (value === 'today' ? date === todayISO() : view === value && !date)
                    ? 'bg-white text-medical-700 shadow-sm'
                    : 'text-ink-600 hover:text-ink-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <SearchBar
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Search patient, clinician or reference"
            className="flex-1"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Field label="Specific date" htmlFor="appt-filter-date">
              <Input
                id="appt-filter-date"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value)
                  setPage(1)
                }}
              />
            </Field>
            <Field label="Status" htmlFor="appt-filter-status">
              <Select
                id="appt-filter-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">Any status</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      {error ? (
        <Card>
          <EmptyState title="Could not load appointments" description={error} action={<button type="button" className="btn-outline btn-sm" onClick={load}>Try again</button>} />
        </Card>
      ) : loading ? (
        <Card>
          <LoadingBlock rows={5} label="Loading appointments…" />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          {search || status || date ? (
            <NoResults query={search} onClear={() => { setSearch(''); setStatus(''); setDate(''); setView('upcoming') }} />
          ) : (
            <EmptyState
              icon={CalendarPlus}
              title="No appointments in this view"
              description="Book a visit — availability comes from the clinician's real bookings."
              action={canBook && <button type="button" className="btn-primary" onClick={() => setBookOpen(true)}>Book appointment</button>}
            />
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, entries]) => (
            <Card key={day}>
              <CardHeader
                title={new Date(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                description={`${entries.length} appointment(s)`}
              />
              <DataTable
                caption={`Appointments for ${day}`}
                columns={columns}
                rows={entries}
                onRowClick={(row) => setActive(row)}
              />
            </Card>
          ))}
          <Card>
            <Pagination pagination={pagination} onChange={setPage} />
          </Card>
        </div>
      )}

      <AppointmentFormModal
        open={bookOpen}
        onClose={closeBooking}
        onBooked={(appointment) => {
          closeBooking()
          toast.success(
            `Booked ${appointment.appointment_number} for ${appointment.patient_name} on ${formatDate(appointment.scheduled_at)} at ${formatTime(appointment.scheduled_at)}.`,
          )
          load()
          loadStats()
        }}
      />

      <Modal
        open={Boolean(active)}
        onClose={() => {
          setActive(null)
          setCancelReason('')
        }}
        size="md"
        title={active ? `Appointment ${active.appointment_number}` : ''}
        description={active ? `${active.patient_name} with ${active.clinician_name}` : ''}
      >
        {active && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-500">When</dt>
                <dd className="text-ink-800">
                  {formatDate(active.scheduled_at)} · {formatTime(active.scheduled_at)}–{formatTime(active.ends_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-500">Status</dt>
                <dd>
                  <StatusPill value={active.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-500">Department</dt>
                <dd className="text-ink-800">{active.department_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-500">Booked by</dt>
                <dd className="text-ink-800">{active.created_by_name || '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ink-500">Reason</dt>
                <dd className="text-ink-800">{active.reason || '—'}</dd>
              </div>
              {active.notes && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-ink-500">Notes</dt>
                  <dd className="text-ink-800">{active.notes}</dd>
                </div>
              )}
              {active.cancellation_reason && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-ink-500">Cancellation reason</dt>
                  <dd className="text-red-700">{active.cancellation_reason}</dd>
                </div>
              )}
            </dl>

            {active.status_history?.length > 0 && (
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Status history</p>
                <ul className="mt-1.5 space-y-1 text-[11px] text-ink-600">
                  {active.status_history.map((entry, index) => (
                    <li key={index}>
                      {entry.previous ? `${humanise(entry.previous)} → ` : ''}
                      <span className="font-medium text-ink-800">{humanise(entry.status)}</span> · {entry.by_name} ·{' '}
                      {formatTime(entry.at)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!['completed', 'cancelled'].includes(active.status) && canBook && (
              <div className="space-y-2 border-t border-ink-100 pt-3">
                <div className="flex flex-wrap gap-2">
                  {active.status === 'scheduled' && (
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      onClick={() => changeStatus(active, 'confirmed')}
                      disabled={busy === active.id}
                    >
                      Confirm
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => changeStatus(active, 'completed')}
                    disabled={busy === active.id}
                  >
                    Mark attended
                  </button>
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    onClick={() => changeStatus(active, 'missed')}
                    disabled={busy === active.id || cancelReason.trim().length < 4}
                  >
                    Mark missed
                  </button>
                </div>
                <Field label="Reason (required to cancel or mark missed)" htmlFor="cancel-reason">
                  <Input
                    id="cancel-reason"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                  />
                </Field>
                <button
                  type="button"
                  className="btn-danger btn-sm w-full"
                  onClick={() => changeStatus(active, 'cancelled', cancelReason)}
                  disabled={busy === active.id || cancelReason.trim().length < 4}
                >
                  Cancel appointment
                </button>
              </div>
            )}

            {active.status === 'completed' && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                Attended — a consultation record was created for this visit.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
