/**
 * Explains a real limitation of the environment, in plain language.
 *
 * When the app runs inside a sandboxed iframe the browser blocks
 * `localStorage`, so the session is held in memory only and any reload — a
 * manual reload, a stale-build auto-reload, or the preview frame restarting —
 * ends it. That is an environment property, not a bug in sign-in, and the user
 * deserves to be told before they blame their account.
 */
import storage from '../utils/storage'

export function isFramed() {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

export default function StorageNotice({ className = '' }) {
  if (storage.mode !== 'memory') return null

  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 ${className}`}
    >
      <p className="font-semibold">
        This browser context blocks storage, so your session is kept in memory only.
      </p>
      <p className="mt-0.5">
        Signing in works and stays valid while this page stays loaded, but a reload
        {isFramed() ? ' or a restart of this preview frame' : ''} ends the session and you will
        need to sign in again. Open the app in its own browser tab for a session that survives
        reloads.
      </p>
    </div>
  )
}
