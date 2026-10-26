import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  Download,
  FileBarChart,
  FileText,
  FlaskConical,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  UserRound,
  Fingerprint,
} from 'lucide-react'
import api, { downloadFile, openPdfPreview } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useFetch } from '../hooks/useApi'
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatusPill,
  Tabs,
} from '../components/ui'
import { formatDateTime, humanise, isoDaysAgo, relativeTime, todayISO } from '../utils/format'

const REPORTS = [
  {
    id: 'attendance',
    title: 'Staff attendance',
    description:
      'Daily clock records with late minutes, early departures, total hours, method and corrections. No clinical data.',
    icon: Fingerprint,
    path: '/reports/attendance/',
    roles: ['super_admin', 'clinic_admin', 'hr_officer'],
    filters: ['dates', 'department'],
  },
  {
    id: 'patients',
    title: 'Patient register',
    description:
      'Registration activity for the period. Clinical columns are excluded for non-clinical roles by the server.',
    icon: UserRound,
    path: '/reports/patients/',
    roles: ['super_admin', 'clinic_admin', 'receptionist', 'doctor', 'nurse'],
    filters: ['dates', 'include_clinical'],
  },
  {
    id: 'laboratory',
    title: 'Laboratory activity',
    description: 'Requests, turnaround and released reports with analyte-level flags.',
    icon: FlaskConical,
    path: '/reports/laboratory/',
    roles: ['super_admin', 'clinic_admin', 'lab_scientist', 'doctor', 'nurse'],
    filters: ['dates', 'status'],
  },
  {
    id: 'consultations',
    title: 'Consultations',
    description: 'Clinical encounters for the period. Restricted to clinical roles and administrators.',
    icon: Stethoscope,
    path: '/reports/consultations/',
    roles: ['super_admin', 'clinic_admin', 'doctor', 'nurse'],
    filters: ['dates', 'include_clinical'],
  },
]

function ReportCard({ report, user, toast, shared }) {
  const [start, setStart] = useState(shared.start)
  const [end, setEnd] = useState(shared.end)
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState('')
  const [includeClinical, setIncludeClinical] = useState(false)
  const [busy, setBusy] = useState('')
  const { data: departments } = useFetch('/staff/departments/')

  const allowed = report.roles.includes(user?.role)

  const buildQuery = (format) => {
    const params = new URLSearchParams({ format, start, end })
    if (departmentId) params.set('department_id', departmentId)
    if (status) params.set('status', status)
    if (includeClinical) params.set('include_clinical', 'true')
    return params.toString()
  }

  const run = async (format, preview = false) => {
    setBusy(format)
    try {
      const url = `${report.path}?${buildQuery(format)}`
      if (preview) {
        await openPdfPreview(url)
      } else {
        await downloadFile(url, `${report.id}-${start}-to-${end}.${format === 'csv' ? 'csv' : 'pdf'}`)
        toast.success(`${report.title} exported as ${format.toUpperCase()}.`)
      }
    } catch (err) {
      toast.error(err.friendlyMessage || 'The export could not be generated.')
    } finally {
      setBusy('')
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <report.icon className="h-4 w-4 text-medical-600" aria-hidden="true" /> {report.title}
          </span>
        }
        description={report.description}
      />
      {!allowed ? (
        <div className="flex items-start gap-2 p-5 text-sm text-ink-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          Your role cannot export this report. The API enforces the same restriction.
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" htmlFor={`${report.id}-start`}>
              <Input
                id={`${report.id}-start`}
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                max={todayISO()}
              />
            </Field>
            <Field label="To" htmlFor={`${report.id}-end`}>
              <Input
                id={`${report.id}-end`}
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                max={todayISO()}
              />
            </Field>
            {report.filters.includes('department') && (
              <Field label="Department" htmlFor={`${report.id}-dept`}>
                <Select
                  id={`${report.id}-dept`}
                  value={departmentId}
                  onChange={(event) => setDepartmentId(event.target.value)}
                >
                  <option value="">All departments</option>
                  {(departments?.results || []).map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {report.filters.includes('status') && (
              <Field label="Status" htmlFor={`${report.id}-status`}>
                <Select id={`${report.id}-status`} value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">Any status</option>
                  {['requested', 'sample_collected', 'processing', 'awaiting_verification', 'verified', 'released', 'cancelled'].map(
                    (value) => (
                      <option key={value} value={value}>
                        {humanise(value)}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
            )}
          </div>

          {report.filters.includes('include_clinical') && ['super_admin', 'clinic_admin', 'doctor', 'nurse'].includes(user?.role) && (
            <label className="flex items-start gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeClinical}
                onChange={(event) => setIncludeClinical(event.target.checked)}
              />
              <span>
                Include clinical columns
                <span className="block text-[11px] text-ink-500">
                  Adds diagnosis and clinical fields. Available to clinical roles only; the request is audit-logged.
                </span>
              </span>
            </label>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={() => run('csv')} disabled={busy === 'csv'}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> {busy === 'csv' ? 'Exporting…' : 'CSV'}
            </button>
            <button type="button" className="btn-outline btn-sm" onClick={() => run('pdf')} disabled={busy === 'pdf'}>
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {busy === 'pdf' ? 'Building…' : 'PDF download'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => run('pdf', true)} disabled={busy === 'pdf'}>
              Preview PDF
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function AuditTrail() {
  const { user } = useAuth()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [outcome, setOutcome] = useState('')
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [logs, summaryRes] = await Promise.all([
        api.get('/audit-logs/', { params: { action: action || undefined, outcome: outcome || undefined, page, page_size: 25 } }),
        api.get('/audit-logs/summary/').catch(() => ({ data: null })),
      ])
      setRows(logs.data.results || [])
      setSummary(summaryRes.data)
    } catch (err) {
      toast.error(err.friendlyMessage || 'Audit logs could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [action, outcome, page, toast])

  useEffect(() => {
    load()
  }, [load])

  if (!['super_admin', 'clinic_admin'].includes(user?.role)) {
    return (
      <div className="p-5 text-sm text-ink-600">
        The audit trail is visible to administrators only. Every action is still recorded for compliance.
      </div>
    )
  }

  return (
    <div className="p-5">
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-ink-200 p-3">
          <p className="text-[11px] uppercase tracking-wide text-ink-500">Total events</p>
          <p className="text-xl font-semibold text-ink-900">{summary?.total ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-ink-200 p-3">
          <p className="text-[11px] uppercase tracking-wide text-ink-500">Failures (7d)</p>
          <p className="text-xl font-semibold text-red-700">{summary?.failures ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-ink-200 p-3 sm:col-span-2">
          <p className="text-[11px] uppercase tracking-wide text-ink-500">Top actions (7d)</p>
          <p className="truncate text-xs text-ink-700">
            {(summary?.top_actions || []).slice(0, 4).map((row) => `${row.action} (${row.count})`).join(' · ') || '—'}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Action filter" htmlFor="audit-action">
          <Input
            id="audit-action"
            placeholder="e.g. staff, patient, lab"
            value={action}
            onChange={(event) => {
              setAction(event.target.value)
              setPage(1)
            }}
          />
        </Field>
        <Field label="Outcome" htmlFor="audit-outcome">
          <Select
            id="audit-outcome"
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value)
              setPage(1)
            }}
          >
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </Select>
        </Field>
        <button type="button" className="btn-outline" onClick={load}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload
        </button>
      </div>

      <DataTable
        caption="Audit log"
        loading={loading}
        columns={[
          { key: 'created_at', header: 'When', render: (row) => <span className="text-xs" title={formatDateTime(row.created_at)}>{relativeTime(row.created_at)}</span> },
          {
            key: 'actor_name',
            header: 'Actor',
            render: (row) => (
              <div>
                <p className="text-sm text-ink-800">{row.actor_name}</p>
                <p className="text-[11px] text-ink-500">{humanise(row.actor_role)}</p>
              </div>
            ),
          },
          { key: 'action', header: 'Action', render: (row) => <span className="font-mono text-[11px] text-ink-700">{row.action}</span> },
          { key: 'description', header: 'Description', render: (row) => <span className="text-xs text-ink-600">{row.description || '—'}</span> },
          { key: 'target_type', header: 'Target', render: (row) => <span className="text-[11px] text-ink-500">{row.target_type || '—'}</span> },
          { key: 'outcome', header: 'Outcome', render: (row) => <StatusPill value={row.outcome} /> },
        ]}
        rows={rows}
        empty={<EmptyState title="No audit events match" description="Try clearing the filters." />}
      />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-ink-500">Page {page}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-outline btn-sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </button>
          <button type="button" className="btn-outline btn-sm" disabled={(rows.length || 0) < 25} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        Audit entries record who did what, when and from which request. Clinical values are deliberately not
        copied into the log — only references and descriptions — so the trail itself does not become a
        secondary store of patient data.
      </p>
    </div>
  )
}

export default function Reports() {
  const { user } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('exports')
  const [range, setRange] = useState({ start: isoDaysAgo(29), end: todayISO() })
  const [departments, setDepartments] = useState([])

  useEffect(() => {
    api
      .get('/reports/departments/')
      .then(({ data }) => setDepartments(data.departments || []))
      .catch(() => setDepartments([]))
  }, [])

  return (
    <>
      <PageHeader
        title="Reports & audit"
        description="Export operational reports as CSV or PDF. Clinical columns are gated by role on the server, and every export is audit-logged."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Reports' }]}
        actions={
          <button
            type="button"
            className="btn-outline"
            onClick={() =>
              downloadFile(`/reports/attendance/?format=csv&start=${range.start}&end=${range.end}`, `attendance-${range.start}.csv`).catch(
                (err) => toast.error(err.friendlyMessage || 'Export failed.'),
              )
            }
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Quick attendance CSV
          </button>
        }
      />

      <Card className="mb-5 card-pad">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Reporting period from" htmlFor="global-start">
            <Input id="global-start" type="date" value={range.start} max={range.end} onChange={(event) => setRange((r) => ({ ...r, start: event.target.value }))} />
          </Field>
          <Field label="to" htmlFor="global-end">
            <Input id="global-end" type="date" value={range.end} max={todayISO()} onChange={(event) => setRange((r) => ({ ...r, end: event.target.value }))} />
          </Field>
          <p className="text-xs text-ink-500">
            Each report card below starts from this period — adjust it per report if needed.
          </p>
        </div>
      </Card>

      <Card>
        <div className="px-5 pt-3">
          <Tabs
            tabs={[
              { id: 'exports', label: 'Exports' },
              { id: 'departments', label: 'Departments' },
              { id: 'audit', label: 'Audit trail' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'exports' && (
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            {REPORTS.map((report) => (
              <ReportCard key={report.id} report={report} user={user} toast={toast} shared={range} />
            ))}
          </div>
        )}

        {tab === 'departments' && (
          <div className="p-5">
            {departments.length === 0 ? (
              <LoadingBlock rows={3} label="Loading department summary…" />
            ) : (
              <DataTable
                caption="Department staffing summary"
                columns={[
                  {
                    key: 'department',
                    header: 'Department',
                    render: (row) => (
                      <span className="flex items-center gap-2 text-sm text-ink-800">
                        <Building2 className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" /> {row.department}
                      </span>
                    ),
                  },
                  { key: 'staff', header: 'Approved staff', render: (row) => <span className="text-sm">{row.staff}</span> },
                  { key: 'active', header: 'Active', render: (row) => <span className="text-sm">{row.active}</span> },
                  {
                    key: 'ratio',
                    header: 'Active %',
                    render: (row) => (
                      <span className="text-xs">{row.staff ? Math.round((row.active / row.staff) * 100) : 0}%</span>
                    ),
                  },
                ]}
                rows={departments}
              />
            )}
          </div>
        )}

        {tab === 'audit' && <AuditTrail />}
      </Card>
    </>
  )
}
