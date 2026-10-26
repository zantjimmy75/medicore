import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  Fingerprint,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { ROLE_COLORS, ROLE_LABELS, visibleNav } from '../utils/permissions'
import storage from '../utils/storage'
import StorageNotice from './StorageNotice'
import { Avatar } from './ui'
import GlobalSearch from './GlobalSearch'

const ICONS = {
  LayoutDashboard,
  Users,
  UserRound,
  CalendarClock,
  Fingerprint,
  CalendarDays,
  FlaskConical,
  FileBarChart,
  Settings,
}

export default function Layout() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => storage.get('medicore.sidebar') === 'collapsed',
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const menuRef = useRef(null)

  const items = visibleNav(user)

  useEffect(() => {
    storage.set('medicore.sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const handleLogout = async () => {
    await logout()
    toast.info('You have been signed out.')
    navigate('/login', { replace: true })
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-medical-800 text-white">
      <div className={clsx('flex items-center gap-2.5 px-4 py-5', collapsed && 'justify-center px-2')}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">MediCore</p>
            <p className="truncate text-[11px] text-medical-100/80">Clinic Management</p>
          </div>
        )}
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {items.map((item) => {
          const Icon = ICONS[item.icon] || LayoutDashboard
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => clsx('sidebar-link', isActive && 'sidebar-link-active', collapsed && 'justify-center px-2')}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className={clsx('border-t border-white/10 p-3', collapsed && 'px-2')}>
        {!collapsed && (
          <div className="mb-3 rounded-lg bg-white/10 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-medical-100">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Secure session
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-medical-100/80">
              All access is role-checked on the server and written to the audit log.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="sidebar-link w-full justify-center"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : (
            <>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-ink-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-medical-700 focus:shadow-lift"
      >
        Skip to main content
      </a>

      {/* mobile drawer */}
      <div className={clsx('fixed inset-0 z-50 lg:hidden', mobileOpen ? 'block' : 'hidden')}>
        <div className="absolute inset-0 bg-ink-900/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
        <div className="relative h-full w-64 shadow-lift">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute right-2 top-3 z-10 rounded-lg p-1.5 text-white/80 hover:bg-white/10"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
          {sidebar}
        </div>
      </div>

      {/* desktop sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        {sidebar}
      </aside>

      <div className={clsx('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="btn-ghost -ml-2 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="group flex flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-left text-sm text-ink-500 transition-colors hover:border-medical-300 hover:bg-white sm:max-w-md"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1 truncate">Search patients, staff, lab requests…</span>
              <kbd className="hidden rounded border border-ink-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink-500 sm:inline">
                Ctrl K
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" className="btn-ghost relative" aria-label="Notifications (0 unread)">
                <Bell className="h-5 w-5" />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              </button>

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-ink-100"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <Avatar name={user?.full_name} size="sm" />
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-[160px] truncate text-sm font-semibold text-ink-800">
                      {user?.full_name}
                    </span>
                    <span className="block text-[11px] text-ink-500">{ROLE_LABELS[user?.role] || user?.role}</span>
                  </span>
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 animate-fade-in overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lift"
                  >
                    <div className="border-b border-ink-100 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-ink-800">{user?.full_name}</p>
                      <p className="truncate text-xs text-ink-500">{user?.email}</p>
                      <span className={clsx('mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', ROLE_COLORS[user?.role])}>
                        {ROLE_LABELS[user?.role]}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          <StorageNotice className="mb-4" />
          <Outlet />
        </main>

        <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 pt-2 text-xs text-ink-500 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-1 border-t border-ink-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p>
              MediCore Clinic Management System · Records are confidential and access is audited.
            </p>
            <p>
              Signed in as <span className="font-medium text-ink-700">{ROLE_LABELS[user?.role]}</span>
            </p>
          </div>
        </footer>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
