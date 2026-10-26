import { useEffect, useState } from 'react'
import { Activity, Save } from 'lucide-react'
import Modal from '../../components/Modal'
import { Field, Input, Textarea } from '../../components/ui'
import api from '../../services/api'

const EMPTY = {
  systolic: '',
  diastolic: '',
  pulse: '',
  temperature_c: '',
  respiratory_rate: '',
  oxygen_saturation: '',
  weight_kg: '',
  height_cm: '',
  pain_score: '',
  notes: '',
}

const NUMERIC_FIELDS = [
  ['systolic', 'Systolic BP', 'mmHg', { min: 40, max: 300 }],
  ['diastolic', 'Diastolic BP', 'mmHg', { min: 20, max: 200 }],
  ['pulse', 'Pulse', 'bpm', { min: 20, max: 250 }],
  ['temperature_c', 'Temperature', '°C', { min: 25, max: 45, step: '0.1' }],
  ['respiratory_rate', 'Respiratory rate', 'breaths/min', { min: 4, max: 80 }],
  ['oxygen_saturation', 'Oxygen saturation', '%', { min: 40, max: 100 }],
  ['weight_kg', 'Weight', 'kg', { min: 0.3, max: 400, step: '0.1' }],
  ['height_cm', 'Height', 'cm', { min: 20, max: 250, step: '0.1' }],
  ['pain_score', 'Pain score', '0–10', { min: 0, max: 10 }],
]

export default function VitalsModal({ open, onClose, patientRef, consultationId, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY)
    setMessage('')
  }, [open])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = { consultation_doc_id: consultationId || undefined }
      Object.entries(form).forEach(([key, value]) => {
        if (value === '') return
        payload[key] = key === 'notes' ? value : Number(value)
      })
      const { data } = await api.post(`/patients/${patientRef}/vital-signs/`, payload)
      onSaved?.(data.vital_signs)
    } catch (err) {
      setMessage(err.friendlyMessage || 'Vital signs could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const bmi = (() => {
    const weight = Number(form.weight_kg)
    const height = Number(form.height_cm)
    if (!weight || !height) return null
    return (weight / (height / 100) ** 2).toFixed(1)
  })()

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Record vital signs"
      description="Each entry is timestamped and attributed to you. Values outside the usual range are not interpreted automatically."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="vitals-form" className="btn-primary" disabled={busy}>
            <Save className="h-4 w-4" aria-hidden="true" /> {busy ? 'Saving…' : 'Save vitals'}
          </button>
        </>
      }
    >
      <form id="vitals-form" className="space-y-4" onSubmit={submit}>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          {NUMERIC_FIELDS.map(([field, label, unit, constraints]) => (
            <Field key={field} label={`${label}${unit ? ` (${unit})` : ''}`} htmlFor={`vit-${field}`}>
              <Input
                id={`vit-${field}`}
                type="number"
                inputMode="decimal"
                step={constraints.step || '1'}
                min={constraints.min}
                max={constraints.max}
                value={form[field]}
                onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
              />
            </Field>
          ))}
        </div>
        {bmi && (
          <p className="flex items-center gap-1.5 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Calculated BMI: <strong>{bmi}</strong>
          </p>
        )}
        <Field label="Notes" htmlFor="vit-notes">
          <Textarea id="vit-notes" rows={2} value={form.notes} onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  )
}
