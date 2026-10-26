import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  FlaskConical,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import StatCard from '../components/StatCard'
import {
  Avatar,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from '../components/ui'
import { formatDateTime, formatTime, humanise, relativeTime } from '../utils/format'
import { ROLE_LABELS } from '../utils/permissions'

const PIE_COLORS = ['#94A3B8', '#38BDF8', '#F59E0B', '#8B5CF6', '#F59E0B', '#14B8A6', '#059669', '#EF4444']

function ChartCard({ title, description, children, actions }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <div className="h-64 px-2 py-4">{children}</div>
    </Card>
  )
}

const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12, boxShadow: '0 10px 30px -12px rgba(15,23,42,0.3)' },
  labelStyle: { fontSize: 11, color: '#64748B' },
}

export default function Dashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [personal, setPersonal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [summary, mine] = await Promise.all([
        api.get('/dashboard/summary/'),
        api.get('/dashboard/me/'),
      ])
      setData(summary.data)
      setPersonal(mine.data)
    } catch (err) {
      setError(err.friendlyMessage || 'Unable to load the dashboard.')
      toast.error(err.friendlyMessage || 'Unable to load the dashboard.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  if (error && !data) {
    return (
      <Card>
        <ErrorState message={error} onRetry={load} />
      </Card>
    )
  }

  const cards = data?.cards || {}
  const trends = data?.trends || {}
  const attendanceSeries = (trends.attendance || []).map((row) => ({
    ...row,
    label: new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short' }),
  }))
  const patientSeries = (trends.patients || []).map((row) => ({
    ...row,
    label: new Date(row.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  }))
  const labSeries = (trends.laboratory || []).map((row) => ({
    ...row,
    label: new Date(row.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  }))

  return (
    <>
      <PageHeader
        title={`Good day, ${user?.full_name?.split(' ')[0] || 'colleague'}`}
        description={`Live clinic overview for ${new Date(data?.date || Date.now()).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}. All figures are read from the clinic database in real time.`}
        meta={
          <>
            <span className="pill bg-medical-100 text-medical-800">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {ROLE_LABELS[user?.role]}
            </span>
            <span className="text-ink-400">·</span>
            <span>Updated {data ? relativeTime(data.generated_at) : '—'}</span>
          </>
        }
        actions={
          <>
            {user?.permissions?.can_register_patients && (
              <Link to="/patients?new=1" className="btn-primary">
                <UserPlus className="h-4 w-4" aria-hidden="true" /> Register patient
              </Link>
            )}
            {['super_admin', 'clinic_admin', 'receptionist', 'doctor', 'nurse', 'hr_officer'].includes(user?.role) && (
              <Link to="/appointments?new=1" className="btn-outline">
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Book appointment
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Registered patients"
          value={cards.total_patients?.toLocaleString()}
          icon={UserRound}
          tone="medical"
          hint={`${cards.new_patients_today ?? 0} registered today`}
          loading={loading}
        />
        <StatCard
          label="Active staff"
          value={cards.active_staff?.toLocaleString()}
          icon={Users}
          tone="teal"
          hint={`${cards.staff_present_today ?? 0} present today`}
          loading={loading}
        />
        <StatCard
          label="On duty now"
          value={cards.staff_on_duty ?? 0}
          icon={Activity}
          tone="violet"
          hint={`${cards.staff_currently_clocked_in ?? 0} clocked in`}
          loading={loading}
        />
        <StatCard
          label="Appointments today"
          value={cards.appointments_today ?? 0}
          icon={CalendarClock}
          tone="amber"
          hint={`${cards.appointments_completed_today ?? 0} consultations recorded`}
          loading={loading}
        />
        <StatCard
          label="Late arrivals today"
          value={cards.staff_late_today ?? 0}
          icon={Clock}
          tone="amber"
          hint={`${cards.staff_absent_today ?? 0} absent · ${cards.staff_incomplete_records ?? 0} incomplete`}
          loading={loading}
        />
        <StatCard
          label="Laboratory pending"
          value={cards.lab_pending ?? 0}
          icon={FlaskConical}
          tone="slate"
          hint="Requests not yet resulted"
          loading={loading}
        />
        <StatCard
          label="Awaiting verification"
          value={cards.lab_awaiting_verification ?? 0}
          icon={Stethoscope}
          tone="red"
          hint="Held back until a scientist verifies"
          loading={loading}
        />
        <StatCard
          label="Reports released (7d)"
          value={cards.lab_released_7d ?? 0}
          icon={CheckCircle2}
          tone="teal"
          hint="Released to authorised clinicians"
          loading={loading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard
            title="Patient registrations"
            description="New patient records created per day (last 7 days)"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={patientSeries} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="patientsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1565C0" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1565C0" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF2F7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(value) => [`${value} patients`, 'Registrations']} />
                <Area type="monotone" dataKey="registrations" stroke="#1565C0" strokeWidth={2.5} fill="url(#patientsFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <Card>
          <CardHeader title="Laboratory workload" description="Requests by workflow status" />
          {loading ? (
            <LoadingBlock rows={3} />
          ) : (
            <div className="h-64 px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(data?.lab_status_breakdown || []).filter((row) => row.count > 0)}
                    dataKey="count"
                    nameKey="status"
                    innerRadius="52%"
                    outerRadius="82%"
                    paddingAngle={2}
                  >
                    {(data?.lab_status_breakdown || [])
                      .filter((row) => row.count > 0)
                      .map((entry, index) => (
                        <Cell key={entry.status} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(value, name) => [`${value}`, humanise(name)]} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => <span className="text-[11px] text-ink-600">{humanise(value)}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Staff attendance" description="Present vs late, last 7 days">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={attendanceSeries} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend formatter={(value) => <span className="text-[11px] text-ink-600">{humanise(value)}</span>} />
              <Bar dataKey="present" name="present" fill="#009688" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="late" name="late" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Laboratory throughput" description="Requested vs released reports">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={labSeries} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend formatter={(value) => <span className="text-[11px] text-ink-600">{humanise(value)}</span>} />
              <Line type="monotone" dataKey="requested" stroke="#1565C0" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="released" stroke="#14B8A6" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Who is on duty now"
            description="Combines the roster, clock-in records and the clinic time zone"
            actions={
              <Link to="/duty-roster" className="btn-ghost btn-sm">
                Open roster
              </Link>
            }
          />
          {loading ? (
            <LoadingBlock rows={4} />
          ) : data?.duty?.on_duty?.length ? (
            <ul className="divide-y divide-ink-100">
              {data.duty.on_duty.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={entry.full_name} src={entry.photo_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{entry.full_name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {entry.job_title} · {entry.department_name}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusPill value={entry.duty_state} />
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      in {formatTime(entry.clock_in_at)} · out {entry.shift_end || '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Users}
              title="Nobody is clocked in"
              description="Staff appear here once they clock in from the attendance page or by scanning their ID card."
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Department snapshot" description="Staff establishment and current presence" />
          {loading ? (
            <LoadingBlock rows={4} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {(data?.departments || []).slice(0, 7).map((dept) => (
                <li key={dept.department} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{dept.department}</p>
                    <p className="text-[11px] text-ink-500">{dept.staff} staff member(s)</p>
                  </div>
                  <span className="pill bg-emerald-100 text-emerald-800">{dept.on_duty ?? 0} on duty</span>
                </li>
              ))}
              {!data?.departments?.length && <EmptyState title="No departments configured" />}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent laboratory requests"
            description="Newest requests across the clinic"
            actions={
              ['super_admin', 'clinic_admin', 'lab_scientist', 'doctor', 'nurse'].includes(user?.role) && (
                <Link to="/laboratory" className="btn-ghost btn-sm">
                  View all
                </Link>
              )
            }
          />
          <DataTable
            loading={loading}
            caption="Recent laboratory requests"
            columns={[
              {
                key: 'request_number',
                header: 'Request',
                render: (row) => (
                  <div>
                    <p className="font-mono text-xs font-semibold text-ink-800">{row.request_number}</p>
                    <p className="text-[11px] text-ink-500">{row.patient_name}</p>
                  </div>
                ),
              },
              {
                key: 'tests',
                header: 'Tests',
                render: (row) => <span className="text-xs text-ink-600">{row.tests?.join(', ')}</span>,
              },
              { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
              {
                key: 'requested_at',
                header: 'Requested',
                render: (row) => <span className="text-xs text-ink-500">{relativeTime(row.requested_at)}</span>,
              },
            ]}
            rows={data?.recent_lab_requests || []}
            empty={<EmptyState title="No laboratory requests yet" description="Requests appear here as soon as a clinician orders a test." />}
          />
        </Card>

        <Card>
          <CardHeader title="Recent patient registrations" description="Latest records added to the register" />
          <DataTable
            loading={loading}
            caption="Recent patient registrations"
            columns={[
              {
                key: 'full_name',
                header: 'Patient',
                render: (row) => (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={row.full_name} src={row.photo_url} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-ink-800">{row.full_name}</p>
                      <p className="font-mono text-[11px] text-ink-500">{row.patient_number}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'registration_date',
                header: 'Registered',
                render: (row) => <span className="text-xs text-ink-500">{formatDateTime(row.registration_date)}</span>,
              },
              { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
            ]}
            rows={data?.recent_patients || []}
            empty={<EmptyState title="No patients registered yet" />}
          />
        </Card>
      </div>

      {['super_admin', 'clinic_admin'].includes(user?.role) && data?.recent_activity?.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Audit activity" description="Most recent recorded actions (references only, no clinical values)" />
          <ul className="divide-y divide-ink-100">
            {data.recent_activity.map((entry, index) => (
              <li key={index} className="flex items-start gap-3 px-5 py-2.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${entry.outcome === 'failure' ? 'bg-red-500' : 'bg-teal-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-700">
                    <span className="font-medium">{entry.actor_name || 'System'}</span>{' '}
                    <span className="text-ink-500">{humanise(entry.action)}</span>
                  </p>
                  {entry.description && <p className="truncate text-[11px] text-ink-500">{entry.description}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
