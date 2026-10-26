import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import QRScanner from '../components/QRScanner'
import { Avatar, Card, Field, Input, Spinner, StatusPill } from '../components/ui'
import { formatDateTime, humanise } from '../utils/format'
import api from '../services/api'

/**
 * PUBLIC card verification page (no sign-in required).
 *
 * Shows only what is needed to confirm identity: name, photograph, identifier,
 * department and employment/card status. It never exposes contact details,
 * clinical information or records.
 */
export default function VerifyCard() {
  const { kind, token } = useParams()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const [manualKind, setManualKind] = useState('staff')

  const verify = useCallback(async (cardToken, cardKind) => {
    if (!cardToken) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const { data } = await api.get(`/${cardKind === 'patient' ? 'patients' : 'staff'}/verify-card/${encodeURIComponent(cardToken)}/`)
      setResult({ ...data, kind: data.kind || cardKind })
    } catch (err) {
      if (err?.response?.status === 410) {
        setResult({ valid: false, ...(err.response.data || {}), kind: cardKind })
      } else if (err?.response?.status === 404) {
        setError('This card reference is not recognised. It may belong to another clinic.')
      } else {
        setError(err.friendlyMessage || 'We could not verify this card right now. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      verify(token, kind === 'patient' ? 'patient' : 'staff')
    }
  }, [token, kind, verify])

  const isPatient = result?.kind === 'patient'

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-medical-600 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">MediCore Card Verification</p>
              <p className="text-[11px] text-ink-500">Secure identity check</p>
            </div>
          </div>
          <Link to="/login" className="text-xs font-medium text-medical-700 hover:underline">
            Staff sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8">
        <p className="mb-6 rounded-xl border border-medical-200 bg-medical-50 px-4 py-3 text-xs leading-relaxed text-medical-900">
          This page confirms whether a clinic card is genuine and currently valid. It deliberately
          shows <strong>only</strong> identity information — no medical records, contact details or
          personal identifiers are available here.
        </p>

        {loading && (
          <Card className="card-pad flex items-center justify-center py-16">
            <Spinner label="Verifying card…" />
          </Card>
        )}

        {error && (
          <Card className="card-pad">
            <div className="flex items-start gap-3">
              <span className="rounded-full bg-red-50 p-2.5 text-red-600">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-ink-900">Verification failed</h2>
                <p className="mt-1 text-sm text-ink-600">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {result && (
          <Card className={`overflow-hidden ${result.valid ? '' : 'border-red-200'}`}>
            <div className={`px-5 py-4 ${result.valid ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-full ${result.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {result.valid ? <BadgeCheck className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </span>
                <div>
                  <h1 className="text-lg font-semibold text-ink-900">
                    {result.valid ? 'Card is valid' : 'Card is not valid'}
                  </h1>
                  <p className="text-xs text-ink-600">
                    {result.clinic_name || 'Clinic'} · checked {formatDateTime(result.verified_at || new Date())}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-5 sm:grid-cols-[auto,1fr]">
              <div className="flex flex-col items-center gap-2">
                <Avatar name={result.full_name} src={result.photo_url} size="xl" />
                <StatusPill value={result.card_status || (result.valid ? 'active' : 'revoked')} />
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">{isPatient ? 'Patient name' : 'Staff name'}</dt>
                  <dd className="text-base font-semibold text-ink-900">{result.full_name}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">{isPatient ? 'Patient number' : 'Staff ID'}</dt>
                  <dd className="font-mono text-sm font-semibold text-ink-900">
                    {result.staff_id || result.patient_number}
                  </dd>
                </div>
                {!isPatient && (
                  <>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-500">Department</dt>
                      <dd className="text-sm text-ink-800">{result.department || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-500">Job title</dt>
                      <dd className="text-sm text-ink-800">{result.job_title || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-500">Employment status</dt>
                      <dd className="mt-0.5">
                        <StatusPill value={result.employment_status} />
                      </dd>
                    </div>
                  </>
                )}
                {isPatient && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-500">Sex</dt>
                    <dd className="text-sm text-ink-800">{humanise(result.sex)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">Card issued</dt>
                  <dd className="text-sm text-ink-800">{formatDateTime(result.issued_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">Card expires</dt>
                  <dd className="text-sm text-ink-800">{formatDateTime(result.expires_at)}</dd>
                </div>
              </dl>
            </div>

            {!result.valid && result.reasons?.length > 0 && (
              <div className="border-t border-red-100 bg-red-50/60 px-5 py-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-800">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Why this card is not valid
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-800">
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.notice && (
              <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">{result.notice}</p>
            )}

            <p className="border-t border-ink-100 bg-ink-50 px-5 py-3 text-[11px] text-ink-500">
              Every verification is written to the clinic audit log. If a card is presented by someone
              you do not recognise, contact the clinic directly using a published number.
            </p>
          </Card>
        )}

        {!token && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card className="card-pad">
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink-900">
                <KeyRound className="h-4 w-4 text-medical-600" aria-hidden="true" /> Enter a card reference
              </h2>
              <p className="mb-4 text-xs text-ink-500">
                Type the reference printed under the QR code, or paste the full link.
              </p>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  verify(manual.trim(), manualKind)
                }}
              >
                <Field label="Card type" htmlFor="verify-kind">
                  <select
                    id="verify-kind"
                    className="input"
                    value={manualKind}
                    onChange={(event) => setManualKind(event.target.value)}
                  >
                    <option value="staff">Staff ID card</option>
                    <option value="patient">Patient card</option>
                  </select>
                </Field>
                <Field label="Card reference" htmlFor="verify-token">
                  <Input
                    id="verify-token"
                    value={manual}
                    onChange={(event) => setManual(event.target.value)}
                    placeholder="e.g. L9FTTKUlMF2vpiewsMWB5C7pYt-LR_T_ss…"
                    autoComplete="off"
                  />
                </Field>
                <button type="submit" className="btn-primary w-full" disabled={!manual.trim() || loading}>
                  Verify card
                </button>
              </form>
            </Card>

            <Card className="card-pad">
              <h2 className="mb-1 text-base font-semibold text-ink-900">Scan with a camera</h2>
              <p className="mb-4 text-xs text-ink-500">
                Camera access is only requested when you start scanning.
              </p>
              <QRScanner onDetected={(value) => verify(value, manualKind)} busy={loading} />
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
