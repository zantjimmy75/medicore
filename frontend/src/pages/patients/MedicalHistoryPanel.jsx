import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileSignature, History, PenLine, Save, ShieldCheck } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  StatusPill,
  Textarea,
} from '../../components/ui'
import { formatDateTime, humanise } from '../../utils/format'

const SECTIONS = [
  {
    title: 'Presentation',
    fields: [
      ['presenting_complaint', 'Presenting complaint', 3],
      ['history_of_present_illness', 'History of present illness', 4],
    ],
  },
  {
    title: 'Past history',
    fields: [
      ['past_medical_conditions', 'Past medical conditions', 3],
      ['past_surgeries', 'Past surgeries', 2],
      ['previous_diagnoses', 'Previous diagnoses', 3],
    ],
  },
  {
    title: 'Allergies & medication',
    fields: [
      ['allergies', 'Allergies', 2],
      ['allergy_reactions', 'Allergy reactions', 2],
      ['current_medications', 'Current medications', 3],
      ['past_medications', 'Past medications', 3],
    ],
  },
  {
    title: 'Background',
    fields: [
      ['family_history', 'Family history', 3],
      ['social_history', 'Social history', 3],
      ['immunizations', 'Immunisations', 2],
      ['risk_factors', 'Risk factors', 2],
      ['clinical_notes', 'Clinical notes', 3],
      ['treatment_followup_plan', 'Treatment / follow-up plan', 3],
    ],
  },
]

const ALL_FIELDS = SECTIONS.flatMap((section) => section.fields.map(([name, label]) => [name, label]))

/**
 * Longitudinal medical history. Finalised histories are never overwritten:
 * edits require a reason and append an amendment entry with the previous values.
 */
export default function MedicalHistoryPanel({ patientRef, canWrite }) {
  const toast = useToast()
  const { user } = useAuth()
  const [record, setRecord] = useState(null)
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalMessage, setModalMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/patients/${patientRef}/medical-history/`)
      setRecord(data.medical_history)
      setExists(data.exists)
    } catch (err) {
      setError(err.friendlyMessage || 'Medical history could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [patientRef])

  useEffect(() => {
    load()
  }, [load])

  const finalised = record?.status === 'finalized'

  const openEditor = () => {
    const draft = {}
    ALL_FIELDS.forEach(([field]) => {
      draft[field] = record?.[field] || ''
    })
    setForm(draft)
    setReason('')
    setModalMessage('')
    setEditing(true)
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setModalMessage('')
    try {
      const payload = { ...form }
      if (finalised) payload.amendment_reason = reason
      const { data } = await api.post(`/patients/${patientRef}/medical-history/`, payload)
      setRecord(data.medical_history)
      setExists(true)
      setEditing(false)
      toast.success(data.amended ? 'Amendment recorded with the previous values preserved.' : 'Medical history saved.')
    } catch (err) {
      setModalMessage(err.friendlyMessage || 'The medical history could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const finalise = async () => {
    setBusy(true)
    try {
      const payload = {}
      ALL_FIELDS.forEach(([field]) => {
        payload[field] = record?.[field] || ''
      })
      payload.finalize = true
      const { data } = await api.post(`/patients/${patientRef}/medical-history/`, payload)
      setRecord(data.medical_history)
      toast.success('Medical history finalised. Further edits will create auditable amendments.')
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not finalise the history.')
    } finally {
      setBusy(false)
    }
  }

  const completeness = useMemo(() => {
    if (!record) return 0
    const recorded = record.recorded_fields?.length || 0
    return Math.round((recorded / ALL_FIELDS.length) * 100)
  }, [record])

  if (loading) {
    return (
      <Card>
        <LoadingBlock rows={5} label="Loading medical history…" />
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <ErrorState message={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Medical history"
          description={
            exists
              ? `Version ${record?.version} · last updated ${formatDateTime(record?.updated_at)} by ${record?.updated_by_name || '—'}`
              : 'No longitudinal history recorded yet'
          }
          actions={
            canWrite && (
              <>
                {exists && !finalised && (
                  <button type="button" className="btn-outline btn-sm" onClick={finalise} disabled={busy}>
                    <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Finalise
                  </button>
                )}
                <button type="button" className="btn-primary btn-sm" onClick={openEditor}>
                  <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> {exists ? 'Amend' : 'Record history'}
                </button>
              </>
            )
          }
        />

        {!exists ? (
          <EmptyState
            icon={History}
            title="No medical history on file"
            description={
              canWrite
                ? 'Record the patient’s baseline history once; later changes are tracked as amendments.'
                : 'Only doctors, nurses and administrators can record clinical history.'
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3">
              <StatusPill value={record.status} />
              <span className="text-xs text-ink-500">{completeness}% of sections completed</span>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-teal-500" style={{ width: `${completeness}%` }} />
              </div>
              {finalised && (
                <span className="pill bg-emerald-100 text-emerald-800">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Signed {formatDateTime(record.finalized_at)}
                </span>
              )}
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-2">
              {SECTIONS.map((section) => (
                <section key={section.title}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{section.title}</h3>
                  <dl className="space-y-2">
                    {section.fields.map(([field, label]) => (
                      <div key={field}>
                        <dt className="text-[11px] font-medium text-ink-500">{label}</dt>
                        <dd className="whitespace-pre-wrap text-sm text-ink-800">
                          {record?.[field] ? record[field] : <span className="text-ink-300">Not recorded</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>

            {record.amendments?.length > 0 && (
              <div className="border-t border-ink-100 px-5 py-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <History className="h-3.5 w-3.5" aria-hidden="true" /> Amendment trail ({record.amendments.length})
                </h3>
                <ul className="space-y-3">
                  {[...record.amendments].reverse().map((entry, index) => (
                    <li key={index} className="rounded-lg border border-ink-200 bg-ink-50/60 p-3 text-xs">
                      <p className="font-medium text-ink-800">
                        {entry.amended_by_name} · {formatDateTime(entry.amended_at)} · version {entry.previous_version} → {entry.previous_version + 1}
                      </p>
                      <p className="mt-0.5 text-ink-600">Reason: {entry.reason}</p>
                      <ul className="mt-1.5 space-y-1">
                        {entry.changes?.map((change) => (
                          <li key={change.field} className="text-ink-600">
                            <span className="font-medium text-ink-700">{humanise(change.field)}</span>:{' '}
                            <span className="line-through decoration-red-400">{change.from || 'empty'}</span>{' '}
                            → <span className="text-emerald-700">{change.to || 'empty'}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {record.created_by_name && (
              <p className="border-t border-ink-100 px-5 py-3 text-[11px] text-ink-500">
                First recorded by {record.created_by_name} on {formatDateTime(record.created_at)}. Access to this
                panel is audit-logged for {user?.role === 'doctor' ? 'clinicians' : 'authorised staff'}.
              </p>
            )}
          </>
        )}
      </Card>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        size="xl"
        title={finalised ? 'Amend medical history' : exists ? 'Update medical history' : 'Record medical history'}
        description={
          finalised
            ? 'This history is finalised. Changes require a reason and the previous values are preserved in the amendment trail.'
            : 'Record only what the patient reports or what you have observed. Do not invent findings.'
        }
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="history-form" className="btn-primary" disabled={busy}>
              <Save className="h-4 w-4" aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="history-form" className="space-y-5" onSubmit={save}>
          {modalMessage && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {modalMessage}
            </p>
          )}
          {SECTIONS.map((section) => (
            <fieldset key={section.title} className="rounded-xl border border-ink-200 p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{section.title}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map(([field, label, rows]) => (
                  <Field
                    key={field}
                    label={label}
                    htmlFor={`hist-${field}`}
                    className={rows >= 3 ? 'sm:col-span-2' : undefined}
                  >
                    <Textarea
                      id={`hist-${field}`}
                      rows={rows}
                      value={form[field] || ''}
                      onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                    />
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
          {finalised && (
            <Field
              label="Amendment reason (required)"
              htmlFor="hist-reason"
              required
              hint="At least 5 characters. Recorded with your name, the timestamp and the previous values."
            >
              <Textarea
                id="hist-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
            </Field>
          )}
        </form>
      </Modal>
    </>
  )
}
