import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const STYLES = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-800', iconColor: 'text-emerald-600' },
  error: { icon: AlertTriangle, ring: 'border-red-200', bg: 'bg-red-50', text: 'text-red-800', iconColor: 'text-red-600' },
  info: { icon: Info, ring: 'border-medical-200', bg: 'bg-medical-50', text: 'text-medical-900', iconColor: 'text-medical-600' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const remove = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (message, variant = 'info', ttl = 5000) => {
      if (!message) return
      counter.current += 1
      const id = counter.current
      setToasts((current) => [...current.slice(-3), { id, message, variant }])
      if (ttl) window.setTimeout(() => remove(id), ttl)
    },
    [remove],
  )

  const value = useMemo(
    () => ({
      toast: push,
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error', 7000),
      info: (message) => push(message, 'info'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
      >
        {toasts.map((toast) => {
          const style = STYLES[toast.variant] || STYLES.info
          const Icon = style.icon
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border ${style.ring} ${style.bg} p-3.5 shadow-lift animate-fade-in`}
            >
              <Icon className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${style.iconColor}`} aria-hidden="true" />
              <p className={`flex-1 text-sm font-medium ${style.text}`}>{toast.message}</p>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="rounded p-0.5 text-ink-500 hover:bg-white/60 hover:text-ink-700"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
