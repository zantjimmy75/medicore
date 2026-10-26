import { useEffect, useState } from 'react'
import { Camera, KeyRound, X } from 'lucide-react'
import Modal from '../../components/Modal'
import { Field, Input, Select, Textarea } from '../../components/ui'
import api from '../../services/api'
import { ROLE_LABELS } from '../../utils/permissions'
import { useAuth } from '../../context/AuthContext'

const EMPTY = {
  full_name: '',
  email: '',
  phone: '',
  gender: '',
  date_of_birth: '',
  address: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  emergency_contact_relationship: '',
  department_id: '',
  job_title: '',
  professional_reg_number: '',
  employment_date: '',
  employment_status: 'active',
  shift_id: '',
  role: 'nurse',
  attendance_pin: '',
  create_account: false,
  password: '',
  requires_approval: true,
}

const GENDERS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['other', 'Other'],
  ['undisclosed', 'Prefer not to say'],
]

const EMPLOYMENT = [
  ['active', 'Active'],
  ['on_leave', 'On leave'],
  ['suspended', 'Suspended'],
  ['resigned', 'Resigned'],
  ['terminated', 'Terminated'],
  ['retired', 'Retired'],
]

/**
 * Staff registration. Supports an optional photograph (multipart) and an
 * optional login account. Nothing is created locally — the record only exists
 * once the API returns 201.
 */
export default function StaffFormModal({ open, onClose, departments = [], onCreated }) {
  const { user } = useAuth()
  // The server decides which roles this account may hand out: a clinic
  // administrator can register staff but not another administrator.
  const assignable = user?.permissions?.assignable_staff_roles
  const roleOptions = Object.entries(ROLE_LABELS).filter(
    ([value]) => !assignable || assignable.includes(value),
  )
  const [form, setForm] = useState(EMPTY)
  const [shifts, setShifts] = useState([])
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY)
    setPhoto(null)
    setPhotoPreview('')
    setErrors({})
    setMessage('')
    api
      .get('/staff/shifts/')
      .then(({ data }) => setShifts(data.results || []))
      .catch(() => setShifts([]))
  }, [open])

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const pickPhoto = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage('')
    try {
      let payload
      let config
      const base = { ...form }
      Object.keys(base).forEach((key) => {
        if (base[key] === '' || base[key] === null) delete base[key]
      })
      if (photo) {
        payload = new FormData()
        Object.entries(base).forEach(([key, value]) => payload.append(key, String(value)))
        payload.append('photo', photo)
        config = { headers: { 'Content-Type': 'multipart/form-data' } }
      } else {
        payload = base
      }
      const { data } = await api.post('/staff/', payload, config)
      onCreated?.(data.staff)
    } catch (err) {
      setErrors(err.fieldErrors || {})
      setMessage(err.friendlyMessage || 'Could not register this staff member.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Register a staff member"
      description="A staff ID is allocated automatically. Attendance and ID-card features require approval by an administrator."
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="staff-form" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save staff record'}
          </button>
        </>
      }
    >
      <form id="staff-form" className="space-y-5" onSubmit={submit} noValidate>
        {message && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        )}

        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-ink-200 bg-ink-100">
              {photoPreview ? (
                <img src={photoPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-6 w-6 text-ink-400" aria-hidden="true" />
              )}
            </div>
            {photoPreview && (
              <button
                type="button"
                onClick={() => {
                  setPhoto(null)
                  setPhotoPreview('')
                }}
                className="absolute -right-1 -top-1 rounded-full bg-white p-1 text-ink-500 shadow ring-1 ring-ink-200"
                aria-label="Remove photo"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div>
            <label className="btn-outline btn-sm cursor-pointer">
              <Camera className="h-4 w-4" aria-hidden="true" /> Upload photograph
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickPhoto} />
            </label>
            <p className="mt-1 text-[11px] text-ink-500">JPEG, PNG or WebP up to 5 MB. Used on the ID card.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="stf-name" required error={errors.full_name?.[0]}>
            <Input id="stf-name" value={form.full_name} onChange={set('full_name')} required autoComplete="off" />
          </Field>
          <Field label="Work email" htmlFor="stf-email" required error={errors.email?.[0]} hint="Used to sign in if a login account is created.">
            <Input id="stf-email" type="email" value={form.email} onChange={set('email')} required autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="stf-phone" error={errors.phone?.[0]}>
            <Input id="stf-phone" value={form.phone} onChange={set('phone')} placeholder="0803 000 0000" />
          </Field>
          <Field label="Gender" htmlFor="stf-gender">
            <Select id="stf-gender" value={form.gender} onChange={set('gender')}>
              <option value="">Not recorded</option>
              {GENDERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of birth" htmlFor="stf-dob" error={errors.date_of_birth?.[0]}>
            <Input id="stf-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Employment date" htmlFor="stf-empdate" error={errors.employment_date?.[0]}>
            <Input id="stf-empdate" type="date" value={form.employment_date} onChange={set('employment_date')} />
          </Field>
        </div>

        <Field label="Home address" htmlFor="stf-address" error={errors.address?.[0]}>
          <Textarea id="stf-address" rows={2} value={form.address} onChange={set('address')} />
        </Field>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Employment</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="stf-department" required error={errors.department_id?.[0]}>
              <Select id="stf-department" value={form.department_id} onChange={set('department_id')} required>
                <option value="">Select a department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Job title" htmlFor="stf-title" required error={errors.job_title?.[0]}>
              <Input id="stf-title" value={form.job_title} onChange={set('job_title')} placeholder="e.g. Senior Staff Nurse" required />
            </Field>
            <Field label="System role" htmlFor="stf-role" required error={errors.role?.[0]} hint="Controls API permissions — enforced server-side.">
              <Select id="stf-role" value={form.role} onChange={set('role')} required>
                {roleOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Employment status" htmlFor="stf-status">
              <Select id="stf-status" value={form.employment_status} onChange={set('employment_status')}>
                {EMPLOYMENT.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default shift" htmlFor="stf-shift" hint="Optional. Roster entries can be assigned per day.">
              <Select id="stf-shift" value={form.shift_id} onChange={set('shift_id')}>
                <option value="">No default shift</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name} ({shift.start_time}–{shift.end_time})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Professional registration no." htmlFor="stf-reg" error={errors.professional_reg_number?.[0]}>
              <Input id="stf-reg" value={form.professional_reg_number} onChange={set('professional_reg_number')} placeholder="e.g. MDCN/R/12345" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Emergency contact</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="stf-ec-name">
              <Input id="stf-ec-name" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} />
            </Field>
            <Field label="Phone" htmlFor="stf-ec-phone">
              <Input id="stf-ec-phone" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
            </Field>
            <Field label="Relationship" htmlFor="stf-ec-rel">
              <Input id="stf-ec-rel" value={form.emergency_contact_relationship} onChange={set('emergency_contact_relationship')} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Access & attendance</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Attendance PIN"
              htmlFor="stf-pin"
              error={errors.attendance_pin?.[0]}
              hint="4–8 digits. Required to clock in by scanning the ID card."
            >
              <Input id="stf-pin" inputMode="numeric" maxLength={8} value={form.attendance_pin} onChange={set('attendance_pin')} placeholder="e.g. 4821" />
            </Field>
            <div className="space-y-2 pt-6">
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input type="checkbox" className="mt-0.5" checked={form.create_account} onChange={set('create_account')} />
                <span>
                  Create a login account
                  <span className="block text-[11px] text-ink-500">The staff member must change the password on first sign-in.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input type="checkbox" className="mt-0.5" checked={form.requires_approval} onChange={set('requires_approval')} />
                <span>
                  Require administrator approval
                  <span className="block text-[11px] text-ink-500">An ID card cannot be issued until the record is approved.</span>
                </span>
              </label>
            </div>
            {form.create_account && (
              <Field
                label="Temporary password"
                htmlFor="stf-password"
                required
                error={errors.password?.[0]}
                hint="At least 10 characters with upper and lower case letters, a digit and a symbol."
                className="sm:col-span-2"
              >
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                  <Input id="stf-password" type="password" className="pl-9" value={form.password} onChange={set('password')} autoComplete="new-password" />
                </div>
              </Field>
            )}
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
