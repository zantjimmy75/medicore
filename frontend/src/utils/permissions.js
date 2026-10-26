/**
 * Frontend role helpers. These only shape the UI — the API enforces the same
 * rules server-side, so hiding a button is never the security boundary.
 */

export const ROLE_LABELS = {
  super_admin: 'Super Administrator',
  clinic_admin: 'Clinic Administrator',
  doctor: 'Doctor',
  nurse: 'Nurse',
  lab_scientist: 'Laboratory Scientist',
  receptionist: 'Receptionist',
  hr_officer: 'HR / Attendance Officer',
}

export const ROLE_COLORS = {
  super_admin: 'bg-medical-100 text-medical-800',
  clinic_admin: 'bg-medical-100 text-medical-800',
  doctor: 'bg-teal-100 text-teal-800',
  nurse: 'bg-emerald-100 text-emerald-800',
  lab_scientist: 'bg-violet-100 text-violet-800',
  receptionist: 'bg-amber-100 text-amber-800',
  hr_officer: 'bg-sky-100 text-sky-800',
}

export function hasRole(user, ...roles) {
  return Boolean(user) && roles.includes(user.role)
}

export function can(user, permission) {
  return Boolean(user?.permissions?.[permission])
}

/** Navigation definition, filtered by role. */
export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', roles: null },
  { to: '/staff', label: 'Staff', icon: 'Users', roles: ['super_admin', 'clinic_admin', 'hr_officer', 'doctor', 'nurse', 'receptionist', 'lab_scientist'] },
  { to: '/patients', label: 'Patients', icon: 'UserRound', roles: ['super_admin', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'lab_scientist', 'hr_officer'] },
  { to: '/appointments', label: 'Appointments', icon: 'CalendarClock', roles: ['super_admin', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'hr_officer'] },
  { to: '/attendance', label: 'Attendance', icon: 'Fingerprint', roles: ['super_admin', 'clinic_admin', 'hr_officer', 'doctor', 'nurse', 'lab_scientist', 'receptionist'] },
  { to: '/duty-roster', label: 'Duty Roster', icon: 'CalendarDays', roles: ['super_admin', 'clinic_admin', 'hr_officer', 'doctor', 'nurse', 'lab_scientist', 'receptionist'] },
  { to: '/laboratory', label: 'Laboratory', icon: 'FlaskConical', roles: ['super_admin', 'clinic_admin', 'lab_scientist', 'doctor', 'nurse'] },
  { to: '/reports', label: 'Reports', icon: 'FileBarChart', roles: ['super_admin', 'clinic_admin', 'hr_officer', 'doctor', 'receptionist', 'lab_scientist'] },
  { to: '/settings', label: 'Settings', icon: 'Settings', roles: ['super_admin', 'clinic_admin'] },
]

export function visibleNav(user) {
  if (!user) return []
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user.role))
}
