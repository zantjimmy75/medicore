import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, FlaskConical, Loader2, Search, UserRound, Users } from 'lucide-react'
import Modal from './Modal'
import api from '../services/api'
import { StatusPill } from './ui'

const GROUP_ICONS = {
  patient: UserRound,
  staff: Users,
  appointment: CalendarClock,
  laboratory: FlaskConical,
}

/** Server-backed global search with role-scoped results. */
export default function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) {
      setQuery('')
      setGroups([])
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    if (query.trim().length < 2) {
      setGroups([])
      return undefined
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      api
        .get('/search/', { params: { q: query.trim() } })
        .then(({ data }) => setGroups(data.groups || []))
        .catch(() => setGroups([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, open])

  const go = (href) => {
    onClose()
    navigate(href)
  }

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <Modal open={open} onClose={onClose} title="Global search" size="lg" labelledBy="global-search-title">
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Patient number, name, phone, staff ID, request number…"
            aria-label="Search the clinic"
            className="input pl-9"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-medical-500" aria-hidden="true" />
          )}
        </div>

        <p className="text-xs text-ink-500">
          Results are limited to what your role is permitted to see. Start typing to search —
          names, identifiers and phone numbers all work.
        </p>

        {query.trim().length >= 2 && !loading && total === 0 && (
          <p className="rounded-lg bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
            No records matched “{query.trim()}”.
          </p>
        )}

        <div className="space-y-5">
          {groups.map((group) => {
            const Icon = GROUP_ICONS[group.type] || Search
            return (
              <section key={group.type}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {group.label}
                </h3>
                <ul className="space-y-1.5">
                  {group.items.map((item) => (
                    <li key={`${group.type}-${item.id}`}>
                      <button
                        type="button"
                        onClick={() => go(item.href)}
                        className="flex w-full items-center gap-3 rounded-lg border border-ink-100 px-3 py-2 text-left transition-colors hover:border-medical-200 hover:bg-medical-50/60"
                      >
                        {item.photo_url ? (
                          <img src={item.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-medical-100 text-medical-700">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-800">{item.title}</span>
                          <span className="block truncate text-xs text-ink-500">{item.subtitle}</span>
                        </span>
                        {item.status && <StatusPill value={item.status} />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
