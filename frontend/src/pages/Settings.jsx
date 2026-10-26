import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  Database,
  Image as ImageIcon,
  Info,
  LockKeyhole,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { getClientSnapshot } from '../services/api'
import { useToast } from '../context/ToastContext'
import { useFetch } from '../hooks/useApi'
import { Card, CardHeader, Field, Input, LoadingBlock, PageHeader, Select, Tabs, Textarea } from '../components/ui'
import { formatDateTime, humanise } from '../utils/format'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'UTC',
]

export default function Settings() {
  const toast = useToast()
  const { user, refresh } = useAuth()
  const [tab, setTab] = useState('clinic')
  const [form, setForm] = useState(null)
  const [initial, setInitial] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [health, setHealth] = useState(null)
  const [session, setSession] = useState(null)
  const [transport, setTransport] = useState(null)
  const { data: departments } = useFetch('/staff/departments/', { include_inactive: 1 })

  const isSuperAdmin = user?.role === 'super_admin'
  const readOnly = !isSuperAdmin

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/clinic/')
      setForm(data.clinic)
      setInitial(data.clinic)
    } catch (err) {
      setMessage(err.friendlyMessage || 'Clinic settings could not be loaded.')
    }
  }, [])

  const loadHealth = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/health/')
      setHealth(data)
    } catch {
      setHealth(null)
    }
  }, [])

  const loadSession = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/session/')
      setSession(data)
    } catch {
      setSession(null)
    }
  }, [])

  // Ask the server what it actually received from this browser: that is the
  // difference between "your session expired" and "something stripped the
  // credentials in transit".
  const loadTransport = useCallback(async () => {
    try {
      const { data } = await api.get('/diagnostics/transport/', { skipAuth: true })
      setTransport(data)
    } catch {
      setTransport(null)
    }
  }, [])

  useEffect(() => {
    load()
    loadHealth()
    loadSession()
    loadTransport()
  }, [load, loadHealth, loadSession, loadTransport])

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const dirty = Boolean(form && initial && JSON.stringify(form) !== JSON.stringify(initial))

  const save = async (event) => {
    event.preventDefault()
    setBusy('save')
    setMessage('')
    try {
      const payload = {
        clinic_name: form.clinic_name,
        clinic_code: form.clinic_code,
        address: form.address,
        phone: form.phone,
        email: form.email,
        website: form.website,
        timezone: form.timezone,
        late_grace_minutes: Number(form.late_grace_minutes),
        id_card_validity_months: Number(form.id_card_validity_months),
        working_days: form.working_days,
        lab_requires_verification: form.lab_requires_verification,
        lab_dual_control: form.lab_dual_control,
        patient_card_footer: form.patient_card_footer,
        retention_note: form.retention_note,
      }
      const { data } = await api.patch('/settings/clinic/', payload)
      setForm(data.clinic)
      setInitial(data.clinic)
      await refresh()
      toast.success('Clinic settings saved. They apply to cards, reports and attendance calculations immediately.')
    } catch (err) {
      setMessage(err.friendlyMessage || 'Settings could not be saved.')
    } finally {
      setBusy('')
    }
  }

  const uploadLogo = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy('logo')
    try {
      const body = new FormData()
      body.append('logo', file)
      const { data } = await api.post('/settings/clinic/logo/', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setForm(data.clinic)
      setInitial(data.clinic)
      toast.success('Logo updated.')
    } catch (err) {
      toast.error(err.friendlyMessage || 'Logo upload failed.')
    } finally {
      setBusy('')
    }
  }

  const toggleDay = (index) => {
    if (readOnly) return
    setForm((current) => {
      const days = new Set(current.working_days || [])
      if (days.has(index)) days.delete(index)
      else days.add(index)
      return { ...current, working_days: [...days].sort((a, b) => a - b) }
    })
  }

  if (!form) {
    return (
      <Card>
        <LoadingBlock rows={6} label="Loading clinic settings…" />
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="Clinic settings"
        description={
          readOnly
            ? 'Your role can view the clinic configuration. Only a Super Administrator can change it.'
            : 'Configuration here drives ID cards, report headers, attendance lateness and laboratory release rules.'
        }
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Settings' }]}
        meta={
          <>
            <span>Signed in as {user?.full_name}</span>
            <span className="text-ink-400">·</span>
            <span>{humanise(user?.role)}</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn-outline" onClick={() => { load(); loadHealth() }}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload
            </button>
            {!readOnly && (
              <button type="submit" form="settings-form" className="btn-primary" disabled={busy === 'save' || !dirty}>
                <Save className="h-4 w-4" aria-hidden="true" /> {busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            )}
          </>
        }
      />

      {message && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {message}
        </p>
      )}

      <Card>
        <div className="px-5 pt-3">
          <Tabs
            tabs={[
              { id: 'clinic', label: 'Clinic profile' },
              { id: 'policy', label: 'Attendance & laboratory policy' },
              { id: 'reference', label: 'Reference data' },
              { id: 'security', label: 'Security & compliance' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        <form id="settings-form" onSubmit={save} className="p-5">
          {tab === 'clinic' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
                  {form.logo_data_uri ? (
                    <img src={form.logo_data_uri} alt="Clinic logo" className="h-full w-full object-contain" />
                  ) : (
                    <Building2 className="h-7 w-7 text-ink-300" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <label className={`btn-outline btn-sm ${readOnly ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
                    <ImageIcon className="h-4 w-4" aria-hidden="true" /> {busy === 'logo' ? 'Uploading…' : 'Upload logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={uploadLogo} disabled={readOnly} />
                  </label>
                  <p className="mt-1 text-[11px] text-ink-500">
                    PNG, JPEG or WebP up to 512 KB. Stored as a data URI, embedded on printed cards and reports.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Clinic name" htmlFor="set-name" required>
                  <Input id="set-name" value={form.clinic_name} onChange={set('clinic_name')} disabled={readOnly} required />
                </Field>
                <Field label="Clinic code" htmlFor="set-code" hint="Short prefix used on printed cards.">
                  <Input id="set-code" value={form.clinic_code} onChange={set('clinic_code')} disabled={readOnly} maxLength={8} />
                </Field>
                <Field label="Address" htmlFor="set-address" className="sm:col-span-2">
                  <Textarea id="set-address" rows={2} value={form.address} onChange={set('address')} disabled={readOnly} />
                </Field>
                <Field label="Phone" htmlFor="set-phone">
                  <Input id="set-phone" value={form.phone} onChange={set('phone')} disabled={readOnly} />
                </Field>
                <Field label="Email" htmlFor="set-email">
                  <Input id="set-email" type="email" value={form.email} onChange={set('email')} disabled={readOnly} />
                </Field>
                <Field label="Website" htmlFor="set-website">
                  <Input id="set-website" value={form.website} onChange={set('website')} disabled={readOnly} />
                </Field>
                <Field label="Timezone" htmlFor="set-timezone" hint="Attendance work dates are calculated in this time zone.">
                  <Select id="set-timezone" value={form.timezone} onChange={set('timezone')} disabled={readOnly}>
                    {[...new Set([form.timezone, ...TIMEZONES])].map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Patient card footer" htmlFor="set-card-footer" className="sm:col-span-2">
                  <Input id="set-card-footer" value={form.patient_card_footer} onChange={set('patient_card_footer')} disabled={readOnly} />
                </Field>
              </div>

              <div>
                <p className="label">Working days</p>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((day, index) => {
                    const activeDay = (form.working_days || []).includes(index)
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(index)}
                        aria-pressed={activeDay}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                          activeDay
                            ? 'border-medical-600 bg-medical-600 text-white'
                            : 'border-ink-200 bg-white text-ink-600'
                        } ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'policy' && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Late grace period (minutes)"
                  htmlFor="set-grace"
                  hint="Clock-ins after shift start + grace are marked late."
                >
                  <Input
                    id="set-grace"
                    type="number"
                    min={0}
                    max={180}
                    value={form.late_grace_minutes}
                    onChange={set('late_grace_minutes')}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="ID card validity (months)" htmlFor="set-validity" hint="Cards expire after this period and must be reissued.">
                  <Input
                    id="set-validity"
                    type="number"
                    min={1}
                    max={120}
                    value={form.id_card_validity_months}
                    onChange={set('id_card_validity_months')}
                    disabled={readOnly}
                  />
                </Field>
              </div>

              <div className="space-y-3 rounded-xl border border-ink-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Laboratory release rules</p>
                <label className="flex items-start gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.lab_requires_verification}
                    onChange={set('lab_requires_verification')}
                    disabled={readOnly}
                  />
                  <span>
                    Require verification before release
                    <span className="block text-[11px] text-ink-500">
                      Results stay in “awaiting verification” until a scientist confirms them.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.lab_dual_control}
                    onChange={set('lab_dual_control')}
                    disabled={readOnly}
                  />
                  <span>
                    Dual control
                    <span className="block text-[11px] text-ink-500">
                      The person who enters a result cannot also verify it. Recommended for clinical safety.
                    </span>
                  </span>
                </label>
              </div>

              <Field label="Records retention note" htmlFor="set-retention" hint="Printed on reports and referenced in the privacy notice.">
                <Textarea
                  id="set-retention"
                  rows={3}
                  value={form.retention_note}
                  onChange={set('retention_note')}
                  disabled={readOnly}
                />
              </Field>
            </div>
          )}

          {tab === 'reference' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Departments</p>
                <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-200">
                  {(departments?.results || []).map((dept) => (
                    <li key={dept.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-ink-800">
                        {dept.name} <span className="font-mono text-[11px] text-ink-500">{dept.code}</span>
                      </span>
                      <span className="text-[11px] text-ink-500">
                        {dept.staff_count} staff · {dept.is_active ? 'active' : 'inactive'}
                      </span>
                    </li>
                  ))}
                  {!departments?.results?.length && <li className="px-3 py-3 text-sm text-ink-500">No departments yet.</li>}
                </ul>
                <p className="mt-2 text-[11px] text-ink-500">
                  Departments and shift templates are managed from the API (<code>/api/staff/departments/</code>,{' '}
                  <code>/api/staff/shifts/</code>). A dedicated editing screen is listed in the README as not implemented.
                </p>
              </div>
              <div className="rounded-xl border border-ink-200 p-4 text-xs leading-relaxed text-ink-600">
                <p className="mb-1 font-semibold text-ink-700">Laboratory test catalogue</p>
                <p>
                  Tests, reference intervals and turnaround times live under Laboratory → Test catalogue and can be
                  extended without a code deployment.
                </p>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-ink-200 p-4">
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-500">
                    <Database className="h-3.5 w-3.5" aria-hidden="true" /> Database
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink-900">
                    {health?.database || 'mongodb'}
                    {health?.connected ? ' · connected' : ' · unavailable'}
                  </p>
                  <p className="text-[11px] text-ink-500">Server {health?.server_version || '—'}</p>
                </div>
                <div className="rounded-xl border border-ink-200 p-4">
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-500">
                    <ServerCog className="h-3.5 w-3.5" aria-hidden="true" /> Transactions
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink-900">
                    {health?.transactions_supported ? 'Supported' : 'Not available'}
                  </p>
                  <p className="text-[11px] text-ink-500">Multi-document ops are guarded in application code.</p>
                </div>
                <div className="rounded-xl border border-ink-200 p-4">
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-500">
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Sessions
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink-900">Bearer tokens</p>
                  <p className="text-[11px] text-ink-500">Hashed at rest, revocable per user.</p>
                </div>
              </div>

              <div className="rounded-xl border border-ink-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-500">
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> This session
                  </p>
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    onClick={() => {
                      loadSession()
                      loadTransport()
                    }}
                  >
                    Refresh
                  </button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-ink-600 sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-400">Access token</dt>
                    <dd className="font-mono text-ink-800">
                      {session ? `${Math.max(0, Math.round(session.access_seconds_remaining / 60))} min left` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Refresh token</dt>
                    <dd className="font-mono text-ink-800">
                      {session ? `${Math.max(0, Math.round(session.refresh_seconds_remaining / 3600))} h left` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Rotation grace</dt>
                    <dd className="font-mono text-ink-800">{session ? `${session.grace_seconds}s` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Browser storage</dt>
                    <dd className="font-mono text-ink-800">{getClientSnapshot().storageMode}</dd>
                  </div>
                </dl>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-ink-200 pt-2 text-[11px] text-ink-600 sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-400">Authorization header</dt>
                    <dd className="font-mono text-ink-800">
                      {transport ? (transport.received.authorization ? 'received' : 'missing') : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Fallback header</dt>
                    <dd className="font-mono text-ink-800">
                      {transport ? (transport.received.x_auth_token ? 'received' : 'missing') : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Build seen by server</dt>
                    <dd className="font-mono text-ink-800">
                      {transport?.received.client_build || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Origin</dt>
                    <dd className="truncate font-mono text-ink-800" title={transport?.received.origin || ''}>
                      {transport?.received.origin || '—'}
                    </dd>
                  </div>
                </dl>
                {transport && !transport.received.authorization && !transport.received.x_auth_token ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800">
                    The server is not receiving this browser&apos;s credentials. If you can sign in
                    but every page then says your session has ended, a proxy in front of the app is
                    removing the auth headers — open the app in its own tab rather than inside a
                    preview frame.
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-ink-500">
                  Build <span className="font-mono">{getClientSnapshot().build}</span>
                  {getClientSnapshot().storageMode === 'memory' ? (
                    <> · storage is blocked in this context, so signing in again is required after a reload.</>
                  ) : (
                    <> · you stay signed in across reloads until the refresh token expires.</>
                  )}
                </p>
              </div>

              <div className="rounded-xl border border-medical-200 bg-medical-50 p-4 text-xs leading-relaxed text-medical-900">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Nigeria Data Protection Act 2023
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Access is role-based and enforced on the server for every endpoint, not just in this UI.</li>
                  <li>Clinical values are never written to application logs or to the audit trail.</li>
                  <li>Every record view, edit, export and card scan is attributed to an identified user.</li>
                  <li>Uploads are type-sniffed and served only through an authenticated endpoint.</li>
                  <li>
                    Records are retained according to the note in the policy tab; corrections preserve the previous
                    values rather than overwriting them.
                  </li>
                  <li>Only synthetic patient data should be used in demonstrations and training environments.</li>
                </ul>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <Info className="h-3.5 w-3.5" aria-hidden="true" /> Known limitations
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>This deployment is an application-level reference implementation; it has not been independently penetration tested.</li>
                  <li>Database-level encryption, backups and key management are deployment responsibilities.</li>
                  <li>Department and shift editing screens are API-only in this release.</li>
                  <li>No SMS/email delivery is configured — appointment reminders are stored, not sent.</li>
                </ul>
              </div>

              <p className="text-[11px] text-ink-500">
                Settings last changed {formatDateTime(form.updated_at || new Date())}.
              </p>
            </div>
          )}
        </form>
      </Card>
    </>
  )
}
