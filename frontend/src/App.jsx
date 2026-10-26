import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { LoadingBlock } from './components/ui'

// Every page is code-split; the login screen and the public verification page
// stay in the main bundle because they must load for unauthenticated visitors.
import Login from './pages/Login'
import VerifyCard from './pages/VerifyCard'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Staff = lazy(() => import('./pages/Staff'))
const StaffDetail = lazy(() => import('./pages/staff/StaffDetail'))
const Patients = lazy(() => import('./pages/Patients'))
const PatientDetail = lazy(() => import('./pages/patients/PatientDetail'))
const Appointments = lazy(() => import('./pages/Appointments'))
const Attendance = lazy(() => import('./pages/Attendance'))
const DutyRoster = lazy(() => import('./pages/DutyRoster'))
const Laboratory = lazy(() => import('./pages/Laboratory'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const NotFound = lazy(() => import('./pages/NotFound'))

function PageFallback() {
  return (
    <div className="card">
      <LoadingBlock label="Loading page…" rows={5} />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* public */}
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<VerifyCard />} />
        <Route path="/verify/:kind/:token" element={<VerifyCard />} />

        {/* authenticated shell */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/staff/:staffId" element={<StaffDetail />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/patients/:patientRef" element={<PatientDetail />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/duty-roster" element={<DutyRoster />} />
          <Route path="/laboratory" element={<Laboratory />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
