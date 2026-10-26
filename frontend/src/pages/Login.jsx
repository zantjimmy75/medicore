import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Activity, AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import StorageNotice from '../components/StorageNotice'
import api from '../services/api'

const DEMO_ACCOUNTS = [
  { role: 'Super Administrator', email: 'admin@medicore.example' },
  { role: 'Clinic Administrator', email: 'amina.yusuf@medicore.example' },
  { role: 'Doctor', email: 'dr.chinedu.okafor@medicore.example' },
  { role: 'Nurse', email: 'grace.adeyemi@medicore.example' },
  { role: 'Laboratory Scientist', email: 'ngozi.e.nwosu@medicore.example' },
  { role: 'Receptionist', email: 'blessing.aliyu@medicore.example' },
  { role: 'HR / Attendance', email: 'peter.danjuma@medicore.example' },
]
const DEMO_PASSWORD = 'MediCore#2026'

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('login') // login | reset
  const [resetSent, setResetSent] = useState(null)

  const from = location.state?.from || '/dashboard'

  useEffect(() => {
    if (user) navigate(from, { replace: true })
  }, [user, from, navigate])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'reset') {
        const { data } = await api.post('/auth/password-reset/', { email: form.email })
        setResetSent({ message: data.message, token: data.dev_reset_token })
      } else {
        await login(form.email.trim(), form.password)
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err.friendlyMessage || 'Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-medical-800 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #009688 0, transparent 45%), radial-gradient(circle at 80% 70%, #1E6BC0 0, transparent 50%)',
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15">
              <Activity className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-lg font-semibold tracking-tight">MediCore</p>
              <p className="text-xs text-medical-100/80">Clinic Management &amp; Patient Records</p>
            </div>
          </div>
          <h1 className="mt-14 max-w-md text-3xl font-semibold leading-tight">
            One secure workspace for patient records, staff attendance and laboratory reporting.
          </h1>
          <ul className="mt-8 space-y-3 text-sm text-medical-100/90">
            {[
              'Role-based access enforced on every API request',
              'QR-verified staff and patient identification cards',
              'Live duty roster, clock-in/clock-out and attendance reports',
              'Laboratory workflow with verification before release',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-medical-100/70">
          Confidential medical information. Access is logged and monitored. Handle data in line with
          the Nigeria Data Protection Act 2023 and clinic policy.
        </p>
      </div>

      {/* form panel */}
      <div className="flex items-center justify-center bg-white px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-medical-600 text-white">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-semibold text-ink-900">MediCore</p>
              <p className="text-[11px] text-ink-500">Clinic Management System</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-ink-900">
            {mode === 'login' ? 'Sign in to your workspace' : 'Reset your password'}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {mode === 'login'
              ? 'Use the credentials issued by your clinic administrator.'
              : 'Enter your work email and we will generate a reset link.'}
          </p>

          {error && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {resetSent && (
            <div role="status" className="mt-5 rounded-lg border border-medical-200 bg-medical-50 px-3.5 py-3 text-sm text-medical-900">
              <p>{resetSent.message}</p>
              {resetSent.token && (
                <p className="mt-2 break-all rounded bg-white px-2 py-1.5 font-mono text-[11px] text-ink-700">
                  Development reset token: {resetSent.token}
                </p>
              )}
            </div>
          )}

          <StorageNotice className="mb-4" />

          <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
            <div>
              <label htmlFor="email" className="label">
                Work email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="input pl-9"
                  placeholder="you@clinic.example"
                />
              </div>
            </div>

            {mode === 'login' && (
              <div>
                <label htmlFor="password" className="label">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className="input px-9"
                    placeholder="••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:bg-ink-100"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {mode === 'login' ? 'Sign in securely' : 'Send reset instructions'}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              className="font-medium text-medical-700 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'reset' : 'login')
                setError('')
                setResetSent(null)
              }}
            >
              {mode === 'login' ? 'Forgot password?' : 'Back to sign in'}
            </button>
            <Link to="/verify" className="text-ink-500 hover:text-medical-700 hover:underline">
              Verify a card
            </Link>
          </div>

          <div className="mt-8 rounded-xl border border-ink-200 bg-ink-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">
              Demo accounts (synthetic data)
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Password for every demo account: <span className="font-mono font-semibold text-ink-700">{DEMO_PASSWORD}</span>
            </p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => setForm({ email: account.email, password: DEMO_PASSWORD })}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-white"
                >
                  <span className="font-medium text-ink-700">{account.role}</span>
                  <span className="truncate font-mono text-ink-500">{account.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
