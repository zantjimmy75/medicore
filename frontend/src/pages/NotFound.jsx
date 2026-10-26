import { Link } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="card max-w-lg p-8 text-center">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-medical-50 text-medical-600">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold text-ink-900">Page not found</h1>
        <p className="mt-2 text-sm text-ink-600">
          That address does not match any screen in MediCore. Check the URL, or head back to the dashboard.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/dashboard" className="btn-primary">
            <Home className="h-4 w-4" aria-hidden="true" /> Dashboard
          </Link>
          <Link to="/patients" className="btn-outline">
            Patients
          </Link>
          <Link to="/staff" className="btn-outline">
            Staff
          </Link>
        </div>
      </div>
    </div>
  )
}
