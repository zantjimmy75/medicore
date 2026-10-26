import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Beaker,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  TestTube,
  XCircle,
} from 'lucide-react'
import api, { downloadFile, openPdfPreview } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useDebounced } from '../hooks/useApi'
import Modal from '../components/Modal'
import SearchBar from '../components/SearchBar'
import StatCard from '../components/StatCard'
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
  Tabs,
  Textarea,
} from '../components/ui'
import { formatDate, formatDateTime, formatTime, humanise } from '../utils/format'

const STATUS_ORDER = [
  'requested',
  'sample_collected',
  'processing',
  'awaiting_verification',
  'verified',
  'released',
  'cancelled',
]

const LAB_ROLES = ['super_admin', 'clinic_admin', 'lab_scientist']
const ORDER_ROLES = ['super_admin', 'clinic_admin', 'doctor', 'nurse']

function flagStyle(flag) {
  if (flag === 'high') return 'bg-red-100 text-red-800'
  if (flag === 'low') return 'bg-amber-100 text-amber-900'
  if (flag === 'normal') return 'bg-emerald-100 text-emerald-800'
  return 'bg-ink-100 text-ink-600'
}

/* ------------------------------------------------------------- result entry */
function ResultEntryForm({ request, onSaved }) {
  const toast = useToast()
  const [testCode, setTestCode] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [comments, setComments] = useState('')
  const [amendmentReason, setAmendmentReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const tests = request?.tests_detail || []
  const selectedTest = tests.find((test) => test.code === testCode)
  const existing = (request?.results || []).find((result) => result.test_code === testCode)
  const needsAmendmentReason = existing && ['verified', 'released'].includes(existing.status)

  useEffect(() => {
    if (!tests.length) return
    const pending = tests.find(
      (test) => !(request.results || []).some((result) => result.test_code === test.code),
    )
    setTestCode((pending || tests[0]).code)
  }, [request, tests])

  useEffect(() => {
    if (!selectedTest) return
    setUnit(selectedTest.unit || '')
    const current = (request?.results || []).find((result) => result.test_code === selectedTest.code)
    setValue(current?.value || '')
    setComments(current?.comments || '')
  }, [selectedTest, request])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = { test_code: testCode, value, unit, comments }
      if (needsAmendmentReason) payload.amendment_reason = amendmentReason
      const numeric = Number(value)
      if (value.trim() !== '' && !Number.isNaN(numeric)) payload.numeric_value = numeric
      await api.post(`/laboratory/requests/${request.request_number}/results/`, payload)
      toast.success('Result saved and sent for verification.')
      setValue('')
      setComments('')
      setAmendmentReason('')
      onSaved?.()
    } catch (err) {
      setMessage(err.friendlyMessage || 'The result could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  if (!tests.length) return null

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-ink-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Enter / amend a result</p>
      {message && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {message}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Test" htmlFor="result-test">
          <Select id="result-test" value={testCode} onChange={(event) => setTestCode(event.target.value)}>
            {tests.map((test) => {
              const done = (request.results || []).find((result) => result.test_code === test.code)
              return (
                <option key={test.code} value={test.code}>
                  {test.name}
                  {done ? ` (${humanise(done.status)})` : ''}
                </option>
              )
            })}
          </Select>
        </Field>
        <Field
          label="Value"
          htmlFor="result-value"
          hint={selectedTest?.reference_interval ? `Reference: ${selectedTest.reference_interval}` : undefined}
        >
          <Input id="result-value" value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. 5.4 or Negative" />
        </Field>
        <Field label="Unit" htmlFor="result-unit">
          <Input id="result-unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
        </Field>
      </div>
      <Field label="Comments" htmlFor="result-comments">
        <Textarea id="result-comments" rows={2} value={comments} onChange={(event) => setComments(event.target.value)} />
      </Field>
      {needsAmendmentReason && (
        <Field label="Amendment reason (required)" htmlFor="result-amendment" hint="The previous value, flag and verifier are preserved.">
          <Input
            id="result-amendment"
            value={amendmentReason}
            onChange={(event) => setAmendmentReason(event.target.value)}
          />
        </Field>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-primary btn-sm"
          disabled={busy || !value.trim() || (needsAmendmentReason && amendmentReason.trim().length < 5)}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? 'Saving…' : 'Save result'}
        </button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------- request view */
function RequestDetail({ requestRef, onClose, onChanged }) {
  const toast = useToast()
  const { user } = useAuth()
  const [request, setRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const isLab = LAB_ROLES.includes(user?.role)

  const load = useCallback(async () => {
    if (!requestRef) return
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/laboratory/requests/${requestRef}/`)
      setRequest(data.request)
    } catch (err) {
      setError(err.friendlyMessage || 'This request could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [requestRef])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action, label, body = {}) => {
    setBusy(label)
    try {
      const { data } = await api.patch(`/laboratory/requests/${requestRef}/`, { action, ...body })
      if (data.request) setRequest({ ...data.request, reports: data.request.reports || request?.reports || [] })
      toast.success(
        action === 'release'
          ? `Report released.${data.report ? ` ${data.report.report_number}` : ''}`
          : `Request updated: ${humanise(action)}.`,
      )
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The laboratory action failed.')
    } finally {
      setBusy('')
    }
  }

  const verify = async (result) => {
    setBusy(result.id)
    try {
      await api.post(`/laboratory/results/${result.id}/verify/`, { comments: '' })
      toast.success(`${result.test_name} verified.`)
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.friendlyMessage || 'Verification failed.')
    } finally {
      setBusy('')
    }
  }

  const status = request?.status
  const results = request?.results || []
  const allVerified = results.length > 0 && results.every((result) => ['verified', 'released'].includes(result.status))

  return (
    <Modal
      open={Boolean(requestRef)}
      onClose={onClose}
      size="xl"
      title={request ? `Laboratory request ${request.request_number}` : 'Laboratory request'}
      description={request ? `${request.patient_name} · ${request.patient_number} · ${request.patient_sex || 'sex not recorded'}${request.patient_age != null ? ` · ${request.patient_age} yrs` : ''}` : ''}
      footer={
        <button type="button" className="btn-outline" onClick={onClose}>
          Close
        </button>
      }
    >
      {loading ? (
        <LoadingBlock rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        request && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill value={request.status} />
              <StatusPill value={request.priority} />
              <span className="text-xs text-ink-500">
                Requested {formatDateTime(request.requested_at)} by {request.ordering_clinician}
              </span>
              {request.specimen_collected_at && (
                <span className="text-xs text-ink-500">
                  · Specimen {formatTime(request.specimen_collected_at)} ({request.specimen_type})
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {status === 'requested' && isLab && (
                <button type="button" className="btn-outline btn-sm" onClick={() => act('collect_sample', 'collect')} disabled={busy === 'collect'}>
                  <TestTube className="h-3.5 w-3.5" aria-hidden="true" /> Record specimen collection
                </button>
              )}
              {status === 'sample_collected' && isLab && (
                <button type="button" className="btn-outline btn-sm" onClick={() => act('start_processing', 'process')} disabled={busy === 'process'}>
                  <Beaker className="h-3.5 w-3.5" aria-hidden="true" /> Start processing
                </button>
              )}
              {isLab && ['results_entered', 'awaiting_verification', 'verified'].includes(status) && (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => act('release', 'release')}
                  disabled={busy === 'release' || !allVerified}
                  title={allVerified ? 'Release the report' : 'All results must be verified first'}
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Release report
                </button>
              )}
              {status !== 'released' && status !== 'cancelled' && (
                <button type="button" className="btn-ghost btn-sm text-red-700" onClick={() => setCancelOpen(true)}>
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cancel request
                </button>
              )}
              {isLab && !['released', 'cancelled'].includes(status) && (
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() =>
                    openPdfPreview(`/laboratory/requests/${request.request_number}/preliminary-pdf/`).catch((err) =>
                      toast.error(err.friendlyMessage || 'PDF could not be generated.'),
                    )
                  }
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Preliminary PDF
                </button>
              )}
            </div>

            <div className="rounded-xl border border-ink-200">
              <table className="table text-xs">
                <caption className="sr-only">Requested tests and results</caption>
                <thead>
                  <tr>
                    <th scope="col">Test</th>
                    <th scope="col">Result</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Flag</th>
                    <th scope="col">Status</th>
                    <th scope="col">Entered / verified</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {(request.tests_detail || []).map((test) => {
                    const result = results.find((row) => row.test_code === test.code)
                    return (
                      <tr key={test.code}>
                        <td>
                          <span className="font-medium text-ink-800">{test.name}</span>
                          <span className="block font-mono text-[11px] text-ink-500">{test.code}</span>
                        </td>
                        <td>
                          {result ? (
                            <span className="font-mono text-xs font-semibold text-ink-900">
                              {result.value} {result.unit}
                            </span>
                          ) : (
                            <span className="text-ink-400">pending</span>
                          )}
                        </td>
                        <td className="text-[11px] text-ink-600">{test.reference_interval || result?.reference_interval || '—'}</td>
                        <td>{result ? <span className={`pill ${flagStyle(result.flag)}`}>{humanise(result.flag || 'n/a')}</span> : '—'}</td>
                        <td>{result ? <StatusPill value={result.status} /> : <span className="text-[11px] text-ink-400">not entered</span>}</td>
                        <td className="text-[11px] text-ink-500">
                          {result?.entered_by_name || '—'}
                          {result?.verified_by_name ? (
                            <span className="block text-emerald-700">verified by {result.verified_by_name}</span>
                          ) : null}
                        </td>
                        <td>
                          {result && isLab && !['verified', 'released'].includes(result.status) && (
                            <button
                              type="button"
                              className="btn-outline btn-sm"
                              onClick={() => verify(result)}
                              disabled={busy === result.id}
                            >
                              Verify
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {results.some((row) => row.amendments?.length) && (
              <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-900">
                <p className="font-semibold">Amendments</p>
                <ul className="mt-1 space-y-1">
                  {results.flatMap((row) =>
                    (row.amendments || []).map((amendment, index) => (
                      <li key={`${row.id}-${index}`}>
                        {row.test_name}: {amendment.previous_value} → {row.value} · {amendment.amended_by_name} ·{' '}
                        {formatDateTime(amendment.amended_at)} · “{amendment.reason}”
                      </li>
                    )),
                  )}
                </ul>
              </div>
            )}

            {isLab && !['released', 'cancelled'].includes(status) && <ResultEntryForm request={request} onSaved={load} />}

            {request.reports?.length > 0 && (
              <div className="rounded-xl border border-ink-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Released reports</p>
                <ul className="mt-2 space-y-2">
                  {request.reports.map((report) => (
                    <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2">
                      <span className="text-xs">
                        <span className="font-mono font-semibold text-ink-800">{report.report_number}</span> · version{' '}
                        {report.version} · released {formatDateTime(report.generated_at)} by {report.released_by_name || report.generated_by_name}
                      </span>
                      <button
                        type="button"
                        className="btn-outline btn-sm"
                        onClick={() =>
                          openPdfPreview(`/laboratory/reports/${report.id}/pdf/`).catch((err) =>
                            toast.error(err.friendlyMessage || 'PDF could not be generated.'),
                          )
                        }
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> PDF
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {request.status_history?.length > 0 && (
              <details className="rounded-lg bg-ink-50 p-3 text-[11px] text-ink-600">
                <summary className="cursor-pointer font-semibold text-ink-700">Workflow history</summary>
                <ul className="mt-1.5 space-y-0.5">
                  {request.status_history.map((entry, index) => (
                    <li key={index}>
                      {humanise(entry.status)} · {entry.by_name} · {formatDateTime(entry.at)}
                      {entry.reason ? ` — ${entry.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {request.clinical_indication && (
              <p className="rounded-lg bg-medical-50 px-3 py-2 text-xs text-medical-900">
                <span className="font-semibold">Clinical indication:</span> {request.clinical_indication}
              </p>
            )}
          </div>
        )
      )}

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        size="sm"
        title="Cancel this laboratory request"
        description="The request is retained in the audit trail with your reason. Results already released are unaffected."
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setCancelOpen(false)}>
              Keep request
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={cancelReason.trim().length < 4 || busy === 'cancel'}
              onClick={async () => {
                setCancelOpen(false)
                await act('cancel', 'cancel', { reason: cancelReason.trim() })
                setCancelReason('')
              }}
            >
              Cancel request
            </button>
          </>
        }
      >
        <Field label="Reason (required)" htmlFor="lab-cancel-reason">
          <Textarea id="lab-cancel-reason" rows={2} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
        </Field>
      </Modal>
    </Modal>
  )
}

/* ------------------------------------------------------------ test catalogue */
function TestCatalogue() {
  const toast = useToast()
  const { user } = useAuth()
  const [tests, setTests] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'Haematology',
    specimen_type: 'Blood',
    unit: '',
    result_type: 'numeric',
    ref_low: '',
    ref_high: '',
    ref_text: '',
    turnaround_hours: 24,
    notes: '',
  })

  const canCreate = ['super_admin', 'clinic_admin', 'lab_scientist'].includes(user?.role)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/laboratory/tests/', {
        params: { search: search || undefined, include_inactive: 1 },
      })
      setTests(data.tests || [])
      setCategories(data.categories || [])
    } catch (err) {
      toast.error(err.friendlyMessage || 'The test catalogue could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  useEffect(() => {
    load()
  }, [load])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = { ...form }
      if (!payload.ref_low) delete payload.ref_low
      if (!payload.ref_high) delete payload.ref_high
      await api.post('/laboratory/tests/', payload)
      toast.success(`Test ${form.code.toUpperCase()} added to the catalogue.`)
      setCreateOpen(false)
      load()
    } catch (err) {
      setMessage(err.friendlyMessage || 'The test could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search tests" className="flex-1" />
        {canCreate && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New test
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-500">
        Reference intervals are configured per test and drive the low/high flags on results. Categories in use:{' '}
        {categories.join(', ') || 'none'}.
      </p>
      <DataTable
        caption="Laboratory test catalogue"
        loading={loading}
        columns={[
          {
            key: 'name',
            header: 'Test',
            render: (row) => (
              <div>
                <p className="text-sm font-medium text-ink-800">{row.name}</p>
                <p className="font-mono text-[11px] text-ink-500">{row.code}</p>
              </div>
            ),
          },
          { key: 'category', header: 'Category', render: (row) => <span className="text-xs">{row.category}</span> },
          { key: 'specimen_type', header: 'Specimen', render: (row) => <span className="text-xs">{row.specimen_type}</span> },
          {
            key: 'reference_interval',
            header: 'Reference',
            render: (row) => <span className="text-xs">{row.reference_interval || '—'}</span>,
          },
          { key: 'unit', header: 'Unit', render: (row) => <span className="text-xs">{row.unit || '—'}</span> },
          { key: 'result_type', header: 'Type', render: (row) => <span className="text-xs">{humanise(row.result_type)}</span> },
          { key: 'turnaround_hours', header: 'TAT', render: (row) => <span className="text-xs">{row.turnaround_hours} h</span> },
          {
            key: 'is_active',
            header: 'Status',
            render: (row) => <StatusPill value={row.is_active ? 'active' : 'inactive'} />,
          },
        ]}
        rows={tests}
        empty={<EmptyState icon={FlaskConical} title="No tests configured" description="Add a test to begin ordering laboratory investigations." />}
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="md"
        title="Add a laboratory test"
        description="Configuration only — reference ranges must come from your laboratory's validated documentation."
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="test-form" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Create test'}
            </button>
          </>
        }
      >
        <form id="test-form" className="space-y-3" onSubmit={submit}>
          {message && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {message}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" htmlFor="test-code" required hint="Short unique code, e.g. FBC">
              <Input id="test-code" value={form.code} onChange={(event) => setForm((c) => ({ ...c, code: event.target.value.toUpperCase() }))} required />
            </Field>
            <Field label="Name" htmlFor="test-name" required>
              <Input id="test-name" value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} required />
            </Field>
            <Field label="Category" htmlFor="test-category">
              <Input id="test-category" value={form.category} onChange={(event) => setForm((c) => ({ ...c, category: event.target.value }))} />
            </Field>
            <Field label="Specimen type" htmlFor="test-specimen">
              <Input id="test-specimen" value={form.specimen_type} onChange={(event) => setForm((c) => ({ ...c, specimen_type: event.target.value }))} />
            </Field>
            <Field label="Result type" htmlFor="test-result-type">
              <Select id="test-result-type" value={form.result_type} onChange={(event) => setForm((c) => ({ ...c, result_type: event.target.value }))}>
                <option value="numeric">Numeric</option>
                <option value="qualitative">Qualitative</option>
                <option value="text">Free text</option>
              </Select>
            </Field>
            <Field label="Unit" htmlFor="test-unit">
              <Input id="test-unit" value={form.unit} onChange={(event) => setForm((c) => ({ ...c, unit: event.target.value }))} />
            </Field>
            <Field label="Reference low" htmlFor="test-low">
              <Input id="test-low" type="number" step="0.01" value={form.ref_low} onChange={(event) => setForm((c) => ({ ...c, ref_low: event.target.value }))} />
            </Field>
            <Field label="Reference high" htmlFor="test-high">
              <Input id="test-high" type="number" step="0.01" value={form.ref_high} onChange={(event) => setForm((c) => ({ ...c, ref_high: event.target.value }))} />
            </Field>
            <Field label="Reference text" htmlFor="test-ref-text" className="sm:col-span-2" hint="Used for qualitative tests, e.g. “Negative”.">
              <Input id="test-ref-text" value={form.ref_text} onChange={(event) => setForm((c) => ({ ...c, ref_text: event.target.value }))} />
            </Field>
            <Field label="Turnaround (hours)" htmlFor="test-tat">
              <Input id="test-tat" type="number" min={1} max={720} value={form.turnaround_hours} onChange={(event) => setForm((c) => ({ ...c, turnaround_hours: Number(event.target.value) }))} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="test-notes">
            <Textarea id="test-notes" rows={2} value={form.notes} onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))} />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

/* -------------------------------------------------------------------- page */
export default function Laboratory() {
  const toast = useToast()
  const { user } = useAuth()
  const [tab, setTab] = useState('worklist')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [detailRef, setDetailRef] = useState(null)
  const [reports, setReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [workload, setWorkload] = useState(null)
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const debouncedSearch = useDebounced(search)

  const isOrderRole = ORDER_ROLES.includes(user?.role)

  const loadRequests = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/laboratory/requests/', {
        params: {
          status: statusFilter || undefined,
          search: debouncedSearch || undefined,
          page,
          page_size: 15,
        },
      })
      setRows(data.results || [])
      setPagination(data.pagination)
    } catch (err) {
      setError(err.friendlyMessage || 'Laboratory requests could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, debouncedSearch, page])

  const loadWorkload = useCallback(async () => {
    try {
      const { data } = await api.get('/laboratory/workload/')
      setWorkload(data)
    } catch {
      setWorkload(null)
    }
  }, [])

  const loadReports = useCallback(async () => {
    setReportsLoading(true)
    try {
      const { data } = await api.get('/laboratory/reports/', { params: { page_size: 50 } })
      setReports(data.reports || data.results || [])
    } catch (err) {
      toast.error(err.friendlyMessage || 'Reports could not be loaded.')
    } finally {
      setReportsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadRequests()
    loadWorkload()
  }, [loadRequests, loadWorkload])

  useEffect(() => {
    if (tab === 'reports') loadReports()
  }, [tab, loadReports])

  const counts = workload?.counts || {}
  const activeStatuses = useMemo(
    () => STATUS_ORDER.filter((status) => !['released', 'cancelled'].includes(status)),
    [],
  )

  return (
    <>
      <PageHeader
        title="Laboratory"
        description="Requests move through specimen collection, processing, result entry, independent verification and release. Released reports are versioned and never overwritten."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Laboratory' }]}
        actions={
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                loadRequests()
                loadWorkload()
                if (tab === 'reports') loadReports()
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </button>
            {isOrderRole && (
              <a href="/patients" className="btn-primary">
                <ClipboardList className="h-4 w-4" aria-hidden="true" /> Order from a patient record
              </a>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label="Awaiting sample" value={counts.requested ?? 0} icon={TestTube} tone="medical" hint="Not yet collected" />
        <StatCard label="In progress" value={(counts.processing ?? 0) + (counts.sample_collected ?? 0)} icon={Beaker} tone="amber" hint="Collected / processing" />
        <StatCard
          label="Awaiting verification"
          value={(counts.awaiting_verification ?? 0) + (counts.results_entered ?? 0)}
          icon={ShieldCheck}
          tone="violet"
          hint="Held until verified"
        />
        <StatCard label="Verified" value={counts.verified ?? 0} icon={CheckCircle2} tone="teal" hint="Ready to release" />
        <StatCard label="Released" value={counts.released ?? 0} icon={FileText} tone="slate" hint="Reports available" />
      </div>

      <Card className="mt-5">
        <div className="px-5 pt-3">
          <Tabs
            tabs={[
              { id: 'worklist', label: 'Worklist' },
              { id: 'reports', label: 'Released reports', count: reports.length || undefined },
              { id: 'catalogue', label: 'Test catalogue' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'worklist' && (
          <>
            <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-3 lg:flex-row lg:items-end">
              <SearchBar
                value={search}
                onChange={(value) => {
                  setSearch(value)
                  setPage(1)
                }}
                placeholder="Search request number, patient name or number"
                className="flex-1"
              />
              <Field label="Status" htmlFor="lab-status">
                <Select
                  id="lab-status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">All statuses</option>
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {humanise(status)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-1.5 px-5 pt-3">
              <button
                type="button"
                onClick={() => setStatusFilter('')}
                className={`pill ${statusFilter === '' ? 'bg-medical-600 text-white' : 'bg-ink-100 text-ink-700'}`}
              >
                All
              </button>
              {activeStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`pill ${statusFilter === status ? 'bg-medical-600 text-white' : 'bg-ink-100 text-ink-700'}`}
                >
                  {humanise(status)} ({counts[status] ?? 0})
                </button>
              ))}
            </div>

            {error ? (
              <ErrorState message={error} onRetry={loadRequests} />
            ) : (
              <>
                <DataTable
                  caption="Laboratory worklist"
                  loading={loading}
                  onRowClick={(row) => setDetailRef(row.request_number)}
                  columns={[
                    {
                      key: 'request_number',
                      header: 'Request',
                      render: (row) => (
                        <div>
                          <p className="font-mono text-xs font-semibold text-ink-800">{row.request_number}</p>
                          <p className="text-[11px] text-ink-500">{formatDateTime(row.requested_at)}</p>
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
                      key: 'tests',
                      header: 'Tests',
                      render: (row) => <span className="text-xs text-ink-600">{row.tests?.join(', ')}</span>,
                    },
                    { key: 'priority', header: 'Priority', render: (row) => <StatusPill value={row.priority} /> },
                    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                    {
                      key: 'result_count',
                      header: 'Results',
                      render: (row) => (
                        <span className="text-xs">
                          {row.verified_count}/{row.result_count} verified
                        </span>
                      ),
                    },
                    {
                      key: 'ordering_clinician',
                      header: 'Requested by',
                      render: (row) => <span className="text-xs text-ink-600">{row.ordering_clinician}</span>,
                    },
                  ]}
                  rows={rows}
                  empty={
                    <EmptyState
                      icon={FlaskConical}
                      title="No laboratory requests"
                      description="Requests are created from a patient record by a clinician or nurse."
                    />
                  }
                />
                <Pagination pagination={pagination} onChange={setPage} />
              </>
            )}
          </>
        )}

        {tab === 'reports' && (
          <div className="p-5">
            <DataTable
              caption="Released laboratory reports"
              loading={reportsLoading}
              columns={[
                {
                  key: 'report_number',
                  header: 'Report',
                  render: (row) => (
                    <div>
                      <p className="font-mono text-xs font-semibold text-ink-800">{row.report_number}</p>
                      <p className="text-[11px] text-ink-500">version {row.version}</p>
                    </div>
                  ),
                },
                { key: 'request_number', header: 'Request', render: (row) => <span className="font-mono text-xs">{row.request_number}</span> },
                { key: 'patient_number', header: 'Patient', render: (row) => <span className="font-mono text-xs">{row.patient_number}</span> },
                {
                  key: 'results',
                  header: 'Results',
                  render: (row) => <span className="text-xs">{row.results?.length || 0} analytes</span>,
                },
                { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
                {
                  key: 'generated_at',
                  header: 'Released',
                  render: (row) => (
                    <span className="text-xs">
                      {formatDate(row.generated_at)}
                      <span className="block text-[11px] text-ink-500">{row.released_by_name || row.generated_by_name}</span>
                    </span>
                  ),
                },
                {
                  key: 'download',
                  header: 'PDF',
                  render: (row) => (
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        downloadFile(`/laboratory/reports/${row.id}/pdf/`, `${row.report_number}.pdf`).catch((err) =>
                          toast.error(err.friendlyMessage || 'Download failed.'),
                        )
                      }}
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Download
                    </button>
                  ),
                },
              ]}
              rows={reports}
              empty={<EmptyState icon={FileText} title="No reports released yet" description="Release a request once every result is verified." />}
            />
          </div>
        )}

        {tab === 'catalogue' && <TestCatalogue />}
      </Card>

      <RequestDetail
        requestRef={detailRef}
        onClose={() => setDetailRef(null)}
        onChanged={() => {
          loadRequests()
          loadWorkload()
        }}
      />
    </>
  )
}
