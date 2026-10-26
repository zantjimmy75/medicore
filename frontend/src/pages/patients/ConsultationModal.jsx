import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'
import { Field, Input, Select, Textarea } from '../../components/ui'
import api from '../../services/api'

const TYPES = [
  ['outpatient', 'Outpatient'],
  ['follow_up', 'Follow-up'],
  ['emergency', 'Emergency'],
  ['teleconsult', 'Teleconsultation'],
]

const CERTAINTY = [
  ['provisional', 'Provisional'],
  ['confirmed', 'Confirmed'],
  ['differential', 'Differential'],
]

const EMPTY = {
  consultation_type: 'outpatient',
  chief_complaint: '',
  history_of_present_illness: '',
  examination_findings: '',
  assessment: '',
  treatment_plan: '',
  investigations_requested: '',
  follow_up_instructions: '',
  follow_up_date: '',
  notes: '',
  finalize: false,
}

/**
 * Consultation composer. Everything typed here is entered by the clinician —
 * the system never generates diagnoses or treatment text.
 */
export default function ConsultationModal({ open, onClose, patientRef, appointment, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [diagnoses, setDiagnoses] = useState([{ text: '', certainty: 'provisional' }])
  const [prescriptions, setPrescriptions] = useState([])
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({
      ...EMPTY,
      chief_complaint: '',
      appointment_doc_id: appointment?.id || '',
    })
    setDiagnoses([{ text: '', certainty: 'provisional' }])
    setPrescriptions([])
    setErrors({})
    setMessage('')
  }, [open, appointment])

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage('')
    try {
      const payload = {
        ...form,
        appointment_doc_id: appointment?.id || undefined,
        diagnosis: diagnoses.filter((d) => d.text.trim()),
        prescriptions: prescriptions.filter((p) => p.drug.trim()),
      }
      Object.keys(payload).forEach((key) => {
        if (payload[key] === '' || payload[key] === null) delete payload[key]
      })
      const { data } = await api.post(`/patients/${patientRef}/consultations/`, payload)
      onSaved?.(data.consultation)
    } catch (err) {
      setErrors(err.fieldErrors || {})
      setMessage(err.friendlyMessage || 'The consultation could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Record a consultation"
      description={
        appointment
          ? `Linked to appointment ${appointment.appointment_number} — completing this marks the appointment as attended.`
          : 'Clinical notes are entered by you. Save as a draft to revisit, or finalise to lock the record.'
      }
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="consultation-form" className="btn-primary" disabled={busy}>
            <Save className="h-4 w-4" aria-hidden="true" /> {busy ? 'Saving…' : form.finalize ? 'Save & finalise' : 'Save draft'}
          </button>
        </>
      }
    >
      <form id="consultation-form" className="space-y-5" onSubmit={submit} noValidate>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Consultation type" htmlFor="cons-type">
            <Select id="cons-type" value={form.consultation_type} onChange={set('consultation_type')}>
              {TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Follow-up date" htmlFor="cons-followup">
            <Input id="cons-followup" type="date" value={form.follow_up_date} onChange={set('follow_up_date')} />
          </Field>
        </div>

        <Field label="Presenting complaint" htmlFor="cons-complaint" error={errors.chief_complaint?.[0]} required>
          <Textarea id="cons-complaint" rows={2} value={form.chief_complaint} onChange={set('chief_complaint')} />
        </Field>
        <Field label="History of present illness" htmlFor="cons-hpi">
          <Textarea id="cons-hpi" rows={3} value={form.history_of_present_illness} onChange={set('history_of_present_illness')} />
        </Field>
        <Field label="Examination findings" htmlFor="cons-exam">
          <Textarea id="cons-exam" rows={3} value={form.examination_findings} onChange={set('examination_findings')} />
        </Field>
        <Field label="Assessment" htmlFor="cons-assessment">
          <Textarea id="cons-assessment" rows={2} value={form.assessment} onChange={set('assessment')} />
        </Field>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Diagnosis (your clinical judgement)
          </legend>
          <div className="space-y-2">
            {diagnoses.map((entry, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={`Diagnosis ${index + 1}`}
                  value={entry.text}
                  placeholder="Diagnosis as documented by the clinician"
                  onChange={(event) =>
                    setDiagnoses((current) =>
                      current.map((row, i) => (i === index ? { ...row, text: event.target.value } : row)),
                    )
                  }
                />
                <Select
                  aria-label={`Certainty ${index + 1}`}
                  value={entry.certainty}
                  onChange={(event) =>
                    setDiagnoses((current) =>
                      current.map((row, i) => (i === index ? { ...row, certainty: event.target.value } : row)),
                    )
                  }
                  className="sm:w-44"
                >
                  {CERTAINTY.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-red-700"
                  onClick={() => setDiagnoses((current) => current.filter((_, i) => i !== index))}
                  aria-label="Remove diagnosis"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() => setDiagnoses((current) => [...current, { text: '', certainty: 'provisional' }])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add diagnosis
            </button>
          </div>
        </fieldset>

        <Field label="Treatment plan" htmlFor="cons-plan">
          <Textarea id="cons-plan" rows={3} value={form.treatment_plan} onChange={set('treatment_plan')} />
        </Field>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Prescriptions</legend>
          {prescriptions.length === 0 ? (
            <p className="text-xs text-ink-500">No prescriptions added.</p>
          ) : (
            <div className="space-y-3">
              {prescriptions.map((entry, index) => (
                <div key={index} className="grid gap-2 rounded-lg border border-ink-200 p-3 sm:grid-cols-6">
                  {[
                    ['drug', 'Drug', 'sm:col-span-2'],
                    ['dose', 'Dose', ''],
                    ['route', 'Route', ''],
                    ['frequency', 'Frequency', ''],
                    ['duration', 'Duration', ''],
                  ].map(([field, label, span]) => (
                    <Input
                      key={field}
                      aria-label={`${label} ${index + 1}`}
                      placeholder={label}
                      className={span}
                      value={entry[field] || ''}
                      onChange={(event) =>
                        setPrescriptions((current) =>
                          current.map((row, i) => (i === index ? { ...row, [field]: event.target.value } : row)),
                        )
                      }
                    />
                  ))}
                  <div className="sm:col-span-6">
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-red-700"
                      onClick={() => setPrescriptions((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove prescription
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn-outline btn-sm mt-3"
            onClick={() =>
              setPrescriptions((current) => [
                ...current,
                { drug: '', dose: '', route: '', frequency: '', duration: '', notes: '' },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add prescription
          </button>
        </fieldset>

        <Field label="Investigations requested" htmlFor="cons-investigations">
          <Textarea
            id="cons-investigations"
            rows={2}
            value={form.investigations_requested}
            onChange={set('investigations_requested')}
            placeholder="Order laboratory tests from the Laboratory tab so they are tracked through the workflow"
          />
        </Field>
        <Field label="Follow-up instructions" htmlFor="cons-followup-notes">
          <Textarea id="cons-followup-notes" rows={2} value={form.follow_up_instructions} onChange={set('follow_up_instructions')} />
        </Field>
        <Field label="Internal notes" htmlFor="cons-notes">
          <Textarea id="cons-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>

        <label className="flex items-start gap-2 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
          <input type="checkbox" className="mt-0.5" checked={form.finalize} onChange={set('finalize')} />
          <span>
            Finalise this consultation now
            <span className="block text-[11px] text-ink-500">
              Finalised notes become read-only. Later corrections are recorded as amendments with a reason and
              the original values are kept.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  )
}
