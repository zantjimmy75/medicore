/**
 * Patient deregistration panel.
 *
 * Separation of duties, mirroring the server rules:
 *   - a receptionist raises a request, and the reason is mandatory;
 *   - a clinic administrator approves or rejects it, or deregisters directly.
 *
 * Nothing is deleted. Deregistering sets the record to inactive/deceased/
 * transferred and revokes any live patient card; the reason is kept for audit.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ClipboardList, ShieldX, X } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Card, CardHeader, EmptyState, Field, Select, Textarea } from '../../components/ui'
import { formatDateTime } from '../../utils/format'

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-ink-100 text-ink-700',
}

const STATUS_LABELS = {
  inactive: 'Inactive (left the register)',
  deceased: 'Deceased',
  transferred: 'Transferred to another clinic',
}

export default function DeregistrationPanel({ patientRef, patientStatus, onChanged }) {
  const { user } = useAuth()
  const toast = useToast()

  const canRequest = Boolean(user?.permissions?.can_request_patient_deregistration)
  const canDecide = Boolean(user?.permissions?.can_decide_patient_deregistration)
  const isActive = patientStatus === 'active'

  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState('')
  const [requestedStatus, setRequestedStatus] = useState('inactive')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState({})
  const [directReason, setDirectReason] = useState('')
  const [directOpen, setDirectOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/patients/${patientRef}/deregistration-requests/`)
      setRequests(data.requests || [])
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [patientRef])

  useEffect(() => {
    if (canRequest || canDecide) load()
    else setLoading(false)
  }, [load, canRequest, canDecide])

  if (!canRequest && !canDecide) return null

  const pending = requests.find((row) => row.status === 'pending')

  const submitRequest = async (event) => {
    event.preventDefault()
    setBusy('request')
    try {
      await api.post(`/patients/${patientRef}/deregistration-requests/`, {
        reason: reason.trim(),
        requested_status: requestedStatus,
      })
      setReason('')
      toast.success('Request sent to the clinic administrator for a decision.')
      await load()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The request could not be submitted.')
    } finally {
      setBusy('')
    }
  }

  const decide = async (requestId, decision) => {
    setBusy(`${decision}-${requestId}`)
    try {
      await api.post(
        `/patients/${patientRef}/deregistration-requests/${requestId}/decision/`,
        { decision, note: (note[requestId] || '').trim() },
      )
      toast.success(
        decision === 'approve'
          ? 'Patient deregistered. The record is kept for audit.'
          : 'Request rejected — the patient stays on the active register.',
      )
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The decision could not be recorded.')
    } finally {
      setBusy('')
    }
  }

  const deregisterDirectly = async (event) => {
    event.preventDefault()
    setBusy('direct')
    try {
      await api.post(`/patients/${patientRef}/deregister/`, {
        reason: directReason.trim(),
        status: requestedStatus,
      })
      setDirectReason('')
      setDirectOpen(false)
      toast.success('Patient deregistered. The record is kept for audit.')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The patient could not be deregistered.')
    } finally {
      setBusy('')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Deregistration"
        description={
          canDecide
            ? 'Only a clinic administrator can deregister a patient. Receptionists raise the request with a reason.'
            : 'Ask a clinic administrator to remove this patient from the active register. A reason is required.'
        }
        actions={
          canDecide &&
          isActive && (
            <button
              type="button"
              className="btn-outline btn-sm text-red-700"
              onClick={() => setDirectOpen((v) => !v)}
            >
              <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />
              Deregister directly
            </button>
          )
        }
      />

      <div className="space-y-4 p-5">
        {!isActive && (
          <p className="flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            This patient is currently <strong className="mx-1">{patientStatus}</strong> — no further
            deregistration action is possible on this record.
          </p>
        )}

        {/* receptionist: raise a request */}
        {canRequest && isActive && !pending && (
          <form onSubmit={submitRequest} className="space-y-3">
            <Field
              label="Reason for deregistration"
              htmlFor="dereg-reason"
              required
              hint="At least 10 characters. Stored verbatim in the audit trail."
            >
              <Textarea
                id="dereg-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Patient relocated and asked for the record to be closed."
                required
                minLength={10}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="New status" htmlFor="dereg-status" className="w-full sm:w-64">
                <Select
                  id="dereg-status"
                  value={requestedStatus}
                  onChange={(e) => setRequestedStatus(e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy === 'request' || reason.trim().length < 10}
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                {busy === 'request' ? 'Sending…' : 'Request deregistration'}
              </button>
            </div>
          </form>
        )}

        {canRequest && pending && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Your request is awaiting the clinic administrator&apos;s decision.
          </p>
        )}

        {/* clinic administrator: direct deregistration */}
        {canDecide && directOpen && isActive && (
          <form
            onSubmit={deregisterDirectly}
            className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4"
          >
            <Field label="Reason" htmlFor="dereg-direct" required hint="At least 10 characters.">
              <Textarea
                id="dereg-direct"
                rows={2}
                value={directReason}
                onChange={(e) => setDirectReason(e.target.value)}
                required
                minLength={10}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="New status" htmlFor="dereg-direct-status" className="w-full sm:w-64">
                <Select
                  id="dereg-direct-status"
                  value={requestedStatus}
                  onChange={(e) => setRequestedStatus(e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <button
                type="submit"
                className="btn-primary bg-red-700 hover:bg-red-800"
                disabled={busy === 'direct' || directReason.trim().length < 10}
              >
                {busy === 'direct' ? 'Deregistering…' : 'Deregister patient'}
              </button>
            </div>
          </form>
        )}

        {/* history */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Request history
          </h3>
          {loading ? (
            <p className="text-xs text-ink-500">Loading…</p>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No deregistration requests"
              description={
                canRequest
                  ? 'Raise a request above if this patient should leave the active register.'
                  : 'Requests raised by reception appear here for a decision.'
              }
            />
          ) : (
            <ul className="space-y-3">
              {requests.map((row) => (
                <li key={row.id} className="rounded-xl border border-ink-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        STATUS_STYLES[row.status] || STATUS_STYLES.cancelled
                      }`}
                    >
                      {row.status}
                    </span>
                    <span className="text-[11px] text-ink-500">
                      {formatDateTime(row.requested_at)} · {row.requested_by_name || 'Receptionist'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-ink-800">{row.reason}</p>
                  <p className="mt-1 text-[11px] text-ink-500">
                    Requested status: {STATUS_LABELS[row.requested_status] || row.requested_status}
                  </p>
                  {row.decided_at && (
                    <p className="mt-1 text-[11px] text-ink-500">
                      {row.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
                      {row.decided_by_name || 'clinic administrator'} on{' '}
                      {formatDateTime(row.decided_at)}
                      {row.decision_note ? ` — “${row.decision_note}”` : ''}
                    </p>
                  )}

                  {canDecide && row.status === 'pending' && isActive && (
                    <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
                      <Textarea
                        rows={2}
                        value={note[row.id] || ''}
                        onChange={(e) =>
                          setNote((current) => ({ ...current, [row.id]: e.target.value }))
                        }
                        placeholder="Decision note (required when rejecting)"
                        aria-label="Decision note"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary btn-sm bg-emerald-700 hover:bg-emerald-800"
                          onClick={() => decide(row.id, 'approve')}
                          disabled={Boolean(busy)}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Approve
                        </button>
                        <button
                          type="button"
                          className="btn-outline btn-sm text-red-700"
                          onClick={() => decide(row.id, 'reject')}
                          disabled={Boolean(busy) || !(note[row.id] || '').trim()}
                          title="A reason is required to reject"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
