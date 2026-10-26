import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Check, Search, TriangleAlert } from 'lucide-react'
import Modal from '../../components/Modal'
import { Field, Input, Select, Spinner, Textarea } from '../../components/ui'
import api from '../../services/api'
import { formatTime, todayISO } from '../../utils/format'

/** Slots arrive as ISO timestamps that start on the half hour in clinic time. */
function slotTime(slot) {
  const date = new Date(slot.start)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Booking form. Slot availability is read from the API so the receptionist can
 * see real gaps in the clinician's day; conflicts are still rejected server-side.
 */
export default function AppointmentFormModal({ open, onClose, patient, onBooked }) {
  const [clinicians, setClinicians] = useState([])
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState([])
  const [chosenPatient, setChosenPatient] = useState(patient || null)
  const [form, setForm] = useState({
    clinician_user_id: '',
    date: todayISO(),
    time: '09:00',
    duration_minutes: 30,
    reason: '',
    notes: '',
    allow_double_booking: false,
  })
  const [slots, setSlots] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [conflicts, setConflicts] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) return
    setChosenPatient(patient || null)
    setPatientQuery('')
    setPatientResults([])
    setMessage('')
    setConflicts([])
    setForm((current) => ({ ...current, clinician_user_id: '', reason: '', notes: '', allow_double_booking: false }))
    api
      .get('/appointments/clinicians/')
      .then(({ data }) => setClinicians(data.clinicians || []))
      .catch(() => setClinicians([]))
  }, [open, patient])

  useEffect(() => {
    if (!open || !form.clinician_user_id || !form.date) {
      setSlots([])
      return
    }
    api
      .get('/appointments/availability/', {
        params: { clinician_user_id: form.clinician_user_id, date: form.date },
      })
      .then(({ data }) => {
        const list = data.slots || []
        setSlots(list)
        const firstFree = list.find((slot) => slot.available)
        if (firstFree && !list.some((slot) => slotTime(slot) === form.time && slot.available)) {
          setForm((current) => ({ ...current, time: slotTime(firstFree) }))
        }
      })
      .catch(() => setSlots([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.clinician_user_id, form.date])

  useEffect(() => {
    if (!open || patient) return undefined
    const term = patientQuery.trim()
    if (term.length < 2) {
      setPatientResults([])
      return undefined
    }
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const { data } = await api.get('/patients/', { params: { search: term, page_size: 6 } })
        setPatientResults(data.results || [])
      } catch {
        setPatientResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [open, patient, patientQuery])

  const selectedSlot = useMemo(
    () => slots.find((slot) => slotTime(slot) === form.time),
    [slots, form.time],
  )

  const submit = async (event) => {
    event.preventDefault()
    if (!chosenPatient) {
      setMessage('Select the patient first.')
      return
    }
    setBusy(true)
    setMessage('')
    setConflicts([])
    try {
      const scheduledAt = `${form.date}T${form.time}:00`
      const { data } = await api.post('/appointments/', {
        patient_doc_id: chosenPatient.id,
        clinician_user_id: form.clinician_user_id,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_minutes: Number(form.duration_minutes),
        reason: form.reason,
        notes: form.notes,
        allow_double_booking: form.allow_double_booking,
      })
      onBooked?.(data.appointment)
    } catch (err) {
      if (err.errorCode === 'appointment_conflict') {
        setConflicts(err.errorDetails?.conflicts || [])
        setMessage('That clinician already has an appointment overlapping this time.')
      } else {
        setMessage(err.friendlyMessage || 'The appointment could not be booked.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Book an appointment"
      description="Availability is calculated from existing appointments; the server re-checks for conflicts on save."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="appointment-form" className="btn-primary" disabled={busy}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" /> {busy ? 'Booking…' : 'Book appointment'}
          </button>
        </>
      }
    >
      <form id="appointment-form" className="space-y-4" onSubmit={submit}>
        {message && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="flex items-start gap-1.5 font-medium">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {message}
            </p>
            {conflicts.length > 0 && (
              <ul className="mt-1.5 list-disc pl-6 text-xs">
                {conflicts.map((row) => (
                  <li key={row.appointment_number}>
                    {row.appointment_number} · {row.patient_name} · {formatTime(row.scheduled_at)}–
                    {formatTime(row.ends_at)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!patient && (
          <div className="rounded-xl border border-ink-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Patient</p>
            {chosenPatient ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink-800">{chosenPatient.full_name}</p>
                  <p className="font-mono text-[11px] text-ink-500">{chosenPatient.patient_number}</p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setChosenPatient(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                  <input
                    type="search"
                    className="input pl-9"
                    placeholder="Search patient by name or number"
                    value={patientQuery}
                    onChange={(event) => setPatientQuery(event.target.value)}
                    aria-label="Search patient"
                  />
                </div>
                {searching && <Spinner className="mt-2" label="Searching" />}
                {patientResults.length > 0 && (
                  <ul className="mt-2 divide-y divide-ink-100 rounded-lg border border-ink-200">
                    {patientResults.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-ink-50"
                          onClick={() => {
                            setChosenPatient(row)
                            setPatientResults([])
                            setPatientQuery('')
                          }}
                        >
                          <span>
                            <span className="block text-sm text-ink-800">{row.full_name}</span>
                            <span className="font-mono text-[11px] text-ink-500">{row.patient_number}</span>
                          </span>
                          <Check className="h-4 w-4 text-teal-600" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clinician" htmlFor="appt-clinician" required>
            <Select
              id="appt-clinician"
              value={form.clinician_user_id}
              onChange={(event) => setForm((c) => ({ ...c, clinician_user_id: event.target.value }))}
              required
            >
              <option value="">Select a clinician</option>
              {clinicians.map((row) => (
                <option key={row.user_id} value={row.user_id}>
                  {row.full_name} · {row.department_name || row.job_title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="appt-date" required>
            <Input
              id="appt-date"
              type="date"
              min={todayISO()}
              value={form.date}
              onChange={(event) => setForm((c) => ({ ...c, date: event.target.value }))}
              required
            />
          </Field>
        </div>

        <div>
          <p className="label">Available slots</p>
          {!form.clinician_user_id ? (
            <p className="text-xs text-ink-500">Choose a clinician to see their open slots.</p>
          ) : slots.length === 0 ? (
            <p className="text-xs text-ink-500">No slots returned for this day.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((slot) => (
                <button
                  key={slot.start}
                  type="button"
                  disabled={!slot.available}
                  onClick={() => setForm((c) => ({ ...c, time: slotTime(slot) }))}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    form.time === slotTime(slot)
                      ? 'border-medical-600 bg-medical-600 text-white'
                      : slot.available
                        ? 'border-ink-200 bg-white text-ink-700 hover:border-medical-400'
                        : 'cursor-not-allowed border-ink-100 bg-ink-50 text-ink-300 line-through'
                  }`}
                  title={slot.available ? 'Available' : 'Already booked'}
                >
                  {slotTime(slot)}
                </button>
              ))}
            </div>
          )}
          {selectedSlot && !selectedSlot.available && (
            <p className="mt-2 text-xs text-amber-700">
              This slot is already booked. Pick another time or explicitly allow a double booking.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start time" htmlFor="appt-time" required>
            <Input
              id="appt-time"
              type="time"
              value={form.time}
              onChange={(event) => setForm((c) => ({ ...c, time: event.target.value }))}
              required
            />
          </Field>
          <Field label="Duration (minutes)" htmlFor="appt-duration">
            <Select
              id="appt-duration"
              value={form.duration_minutes}
              onChange={(event) => setForm((c) => ({ ...c, duration_minutes: event.target.value }))}
            >
              {[10, 15, 20, 30, 45, 60, 90, 120].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Reason for visit" htmlFor="appt-reason">
          <Textarea
            id="appt-reason"
            rows={2}
            value={form.reason}
            onChange={(event) => setForm((c) => ({ ...c, reason: event.target.value }))}
            maxLength={500}
          />
        </Field>
        <Field label="Internal notes" htmlFor="appt-notes">
          <Textarea
            id="appt-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
          />
        </Field>

        <label className="flex items-start gap-2 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.allow_double_booking}
            onChange={(event) => setForm((c) => ({ ...c, allow_double_booking: event.target.checked }))}
          />
          <span>
            Allow double booking
            <span className="block text-[11px] text-ink-500">
              Only use when two clinicians will cover the same slot. The override is audit-logged.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  )
}
