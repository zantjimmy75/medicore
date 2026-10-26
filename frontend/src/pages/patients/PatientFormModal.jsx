import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Camera, SearchCheck, ShieldAlert, X } from 'lucide-react'
import Modal from '../../components/Modal'
import { Field, Input, Select, Textarea } from '../../components/ui'
import api from '../../services/api'
import { formatDate } from '../../utils/format'

const EMPTY = {
  full_name: '',
  date_of_birth: '',
  estimated_age: '',
  sex: '',
  phone: '',
  email: '',
  address: '',
  national_id: '',
  blood_group: '',
  known_allergies: '',
  existing_conditions: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  next_of_kin_name: '',
  next_of_kin_relationship: '',
  next_of_kin_phone: '',
  insurance_provider: '',
  insurance_number: '',
  status: 'active',
}

const SEXES = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['other', 'Other'],
  ['undisclosed', 'Prefer not to say'],
]

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']

/**
 * Patient registration with live duplicate detection.
 *
 * The API returns 409 `possible_duplicate` for strong matches; the registrar
 * must explicitly review the candidates before overriding.
 */
export default function PatientFormModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY)
  const [duplicates, setDuplicates] = useState([])
  const [checking, setChecking] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [useEstimatedAge, setUseEstimatedAge] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY)
    setDuplicates([])
    setBlocked(false)
    setErrors({})
    setMessage('')
    setPhoto(null)
    setPhotoPreview('')
    setUseEstimatedAge(false)
  }, [open])

  const set = (field) => (event) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [field]: value }))
    if (blocked) setBlocked(false)
  }

  // Debounced, non-blocking duplicate check while typing.
  useEffect(() => {
    if (!open) return undefined
    const name = form.full_name.trim()
    if (name.length < 3) {
      setDuplicates([])
      return undefined
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setChecking(true)
      try {
        const { data } = await api.get('/patients/duplicate-check/', {
          params: {
            full_name: name,
            phone: form.phone || undefined,
            date_of_birth: form.date_of_birth || undefined,
            email: form.email || undefined,
          },
        })
        setDuplicates(data.duplicates || [])
      } catch {
        setDuplicates([])
      } finally {
        setChecking(false)
      }
    }, 550)
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.full_name, form.phone, form.date_of_birth, form.email])

  const strongMatches = duplicates.filter((row) => row.score >= 60)

  const submit = async (event, override = false) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage('')
    try {
      const payload = { ...form, confirm_not_duplicate: override }
      Object.keys(payload).forEach((key) => {
        if (payload[key] === '') delete payload[key]
      })
      if (payload.estimated_age) payload.estimated_age = Number(payload.estimated_age)

      let body = payload
      let config
      if (photo) {
        body = new FormData()
        Object.entries(payload).forEach(([key, value]) => body.append(key, String(value)))
        body.append('photo', photo)
        config = { headers: { 'Content-Type': 'multipart/form-data' } }
      }
      const { data } = await api.post('/patients/', body, config)
      onCreated?.(data.patient)
    } catch (err) {
      if (err?.response?.status === 409 && err.errorCode === 'possible_duplicate') {
        setDuplicates(err.errorDetails?.duplicates || [])
        setBlocked(true)
        setMessage('A strong match already exists. Review the records below and confirm only if this is a different person.')
      } else {
        setErrors(err.fieldErrors || {})
        setMessage(err.friendlyMessage || 'Could not register this patient.')
      }
    } finally {
      setBusy(false)
    }
  }

  const pickPhoto = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Register a patient"
      description="Duplicate checking runs while you type. Only synthetic or real patient data entered by authorised staff is stored — no demo records are created here."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="patient-form"
            className={blocked ? 'btn-danger' : 'btn-primary'}
            disabled={busy}
            onClick={(event) => {
              if (blocked) {
                event.preventDefault()
                submit(event, true)
              }
            }}
          >
            {busy ? 'Saving…' : blocked ? 'Register anyway (confirmed different person)' : 'Register patient'}
          </button>
        </>
      }
    >
      <form id="patient-form" className="space-y-5" onSubmit={submit} noValidate>
        {message && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {message}
          </p>
        )}

        {duplicates.length > 0 && (
          <div className={`rounded-xl border p-3 ${strongMatches.length ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-800">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {strongMatches.length ? 'Possible duplicate records' : 'Similar records found'}
              {checking && <span className="ml-1 font-normal normal-case text-ink-500">checking…</span>}
            </p>
            <ul className="mt-2 space-y-2">
              {duplicates.map((row) => (
                <li key={row.id} className="rounded-lg bg-white/80 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      to={`/patients/${row.patient_number}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-medical-800 hover:underline"
                    >
                      {row.full_name} · {row.patient_number}
                    </Link>
                    <span className={`pill ${row.score >= 60 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                      {row.score}% match
                    </span>
                  </div>
                  <p className="mt-1 text-ink-600">
                    {row.sex || 'Sex not recorded'}
                    {row.date_of_birth ? ` · DOB ${formatDate(row.date_of_birth)}` : ''}
                    {row.phone ? ` · ${row.phone}` : ''} · registered {formatDate(row.registration_date)}
                  </p>
                  {row.reasons?.length > 0 && (
                    <p className="mt-1 text-[11px] text-ink-500">Matched on: {row.reasons.join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-ink-200 bg-ink-100">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-6 w-6 text-ink-400" aria-hidden="true" />
            )}
          </div>
          <div>
            <label className="btn-outline btn-sm cursor-pointer">
              <Camera className="h-4 w-4" aria-hidden="true" /> {photoPreview ? 'Change photo' : 'Add photograph'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickPhoto} />
            </label>
            <p className="mt-1 text-[11px] text-ink-500">Printed on the patient card. Optional but recommended.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="pat-name" required error={errors.full_name?.[0]} className="sm:col-span-2">
            <Input id="pat-name" value={form.full_name} onChange={set('full_name')} required autoComplete="off" />
          </Field>

          <Field label="Date of birth" htmlFor="pat-dob" error={errors.date_of_birth?.[0]} hint="Leave blank and use estimated age if the patient does not know it.">
            <Input
              id="pat-dob"
              type="date"
              value={form.date_of_birth}
              onChange={set('date_of_birth')}
              max={new Date().toISOString().slice(0, 10)}
              disabled={useEstimatedAge}
            />
          </Field>
          <Field label="Estimated age (years)" htmlFor="pat-age" error={errors.estimated_age?.[0]}>
            <Input
              id="pat-age"
              type="number"
              min={0}
              max={130}
              value={form.estimated_age}
              onChange={(event) => {
                setUseEstimatedAge(Boolean(event.target.value))
                set('estimated_age')(event)
              }}
            />
          </Field>

          <Field label="Sex" htmlFor="pat-sex" required error={errors.sex?.[0]}>
            <Select id="pat-sex" value={form.sex} onChange={set('sex')} required>
              <option value="">Select</option>
              {SEXES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="pat-phone" error={errors.phone?.[0]}>
            <Input id="pat-phone" value={form.phone} onChange={set('phone')} placeholder="0803 000 0000" />
          </Field>
          <Field label="Email" htmlFor="pat-email" error={errors.email?.[0]}>
            <Input id="pat-email" type="email" value={form.email} onChange={set('email')} autoComplete="off" />
          </Field>
          <Field label="National ID / NIN" htmlFor="pat-nin" error={errors.national_id?.[0]}>
            <Input id="pat-nin" value={form.national_id} onChange={set('national_id')} />
          </Field>
          <Field label="Address" htmlFor="pat-address" error={errors.address?.[0]} className="sm:col-span-2">
            <Textarea id="pat-address" rows={2} value={form.address} onChange={set('address')} />
          </Field>
        </div>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Clinical baseline</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Blood group" htmlFor="pat-blood">
              <Select id="pat-blood" value={form.blood_group} onChange={set('blood_group')}>
                {BLOOD_GROUPS.map((value) => (
                  <option key={value || 'unknown'} value={value}>
                    {value || 'Not known'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Known allergies" htmlFor="pat-allergies" className="sm:col-span-2">
              <Input id="pat-allergies" value={form.known_allergies} onChange={set('known_allergies')} placeholder="Record only what the patient reports" />
            </Field>
            <Field label="Existing conditions" htmlFor="pat-conditions" className="sm:col-span-3">
              <Textarea id="pat-conditions" rows={2} value={form.existing_conditions} onChange={set('existing_conditions')} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Next of kin / emergency contact</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="pat-kin-name">
              <Input id="pat-kin-name" value={form.next_of_kin_name} onChange={set('next_of_kin_name')} />
            </Field>
            <Field label="Relationship" htmlFor="pat-kin-rel">
              <Input id="pat-kin-rel" value={form.next_of_kin_relationship} onChange={set('next_of_kin_relationship')} />
            </Field>
            <Field label="Phone" htmlFor="pat-kin-phone">
              <Input id="pat-kin-phone" value={form.next_of_kin_phone} onChange={set('next_of_kin_phone')} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Insurance</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider" htmlFor="pat-ins-provider">
              <Input id="pat-ins-provider" value={form.insurance_provider} onChange={set('insurance_provider')} />
            </Field>
            <Field label="Member number" htmlFor="pat-ins-number">
              <Input id="pat-ins-number" value={form.insurance_number} onChange={set('insurance_number')} />
            </Field>
          </div>
        </fieldset>

        <p className="flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-600">
          <SearchCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
          Duplicate detection compares name, phone, date of birth and email. A match of 60% or more blocks
          saving until you confirm this is a different person — that override is recorded in the audit log.
        </p>
      </form>
    </Modal>
  )
}
