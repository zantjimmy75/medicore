import { Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui'

/**
 * Route guard. This is UX only — every API call is independently authorised
 * server-side, so a user editing the URL still cannot read data they must not.
 */
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <Spinner label="Checking your session…" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="card max-w-md p-8 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold text-ink-900">Access restricted</h1>
          <p className="mt-2 text-sm text-ink-600">
            Your role does not have permission to open this section. If you believe this is an error,
            contact your clinic administrator.
          </p>
        </div>
      </div>
    )
  }

  return children
}
