/**
 * Pending patient-deregistration requests, shown to clinic administrators on the
 * Patients page so requests raised by reception are not missed.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ClipboardList, X } from 'lucide-react'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { Card, CardHeader, EmptyState, Textarea } from '../../components/ui'
import { formatDateTime } from '../../utils/format'

export default function DeregistrationQueue({ refreshKey = 0 }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/patients/deregistration-requests/', {
        params: { status: 'pending' },
      })
      setRows(data.requests || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const decide = async (row, decision) => {
    setBusy(row.id)
    try {
      await api.post(
        `/patients/${row.patient_number}/deregistration-requests/${row.id}/decision/`,
        { decision, note: (notes[row.id] || '').trim() },
      )
      toast.success(
        decision === 'approve'
          ? `${row.patient_number} deregistered.`
          : 'Request rejected — the patient stays active.',
      )
      await load()
    } catch (err) {
      toast.error(err.friendlyMessage || 'The decision could not be recorded.')
    } finally {
      setBusy('')
    }
  }

  if (loading || rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Deregistration requests awaiting you"
        description="Raised by reception. Approving removes the patient from the active register and revokes their card."
      />
      <ul className="divide-y divide-ink-100">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link
                  to={`/patients/${row.patient_number}`}
                  className="text-sm font-semibold text-medical-700 hover:underline"
                >
                  {row.patient_name} · {row.patient_number}
                </Link>
                <p className="text-[11px] text-ink-500">
                  Raised {formatDateTime(row.requested_at)} by{' '}
                  {row.requested_by_name || 'reception'}
                </p>
              </div>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                pending
              </span>
            </div>
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-800">{row.reason}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[240px] flex-1">
                <Textarea
                  rows={1}
                  value={notes[row.id] || ''}
                  onChange={(e) => setNotes((c) => ({ ...c, [row.id]: e.target.value }))}
                  placeholder="Decision note (required to reject)"
                  aria-label={`Decision note for ${row.patient_number}`}
                />
              </div>
              <button
                type="button"
                className="btn-primary btn-sm bg-emerald-700 hover:bg-emerald-800"
                onClick={() => decide(row, 'approve')}
                disabled={Boolean(busy)}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Approve
              </button>
              <button
                type="button"
                className="btn-outline btn-sm text-red-700"
                onClick={() => decide(row, 'reject')}
                disabled={Boolean(busy) || !(notes[row.id] || '').trim()}
                title="A reason is required to reject"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500">
        <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
        {rows.length} pending {rows.length === 1 ? 'request' : 'requests'}
      </p>
    </Card>
  )
}
