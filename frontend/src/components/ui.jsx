/**
 * Small, dependency-free UI primitives used by every page.
 * Kept in one module so visual language stays consistent.
 */
import { AlertCircle, Inbox, Loader2, SearchX } from 'lucide-react'
import clsx from 'clsx'
import { humanise } from '../utils/format'

/* ------------------------------------------------------------------ status */
const STATUS_STYLES = {
  // generic
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-ink-200 text-ink-700',
  approved: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-orange-100 text-orange-800',
  resigned: 'bg-ink-200 text-ink-700',
  terminated: 'bg-red-100 text-red-700',
  retired: 'bg-ink-200 text-ink-700',
  on_leave: 'bg-sky-100 text-sky-800',
  deceased: 'bg-ink-300 text-ink-800',
  transferred: 'bg-violet-100 text-violet-800',
  // attendance / duty
  present: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-medical-100 text-medical-800',
  late: 'bg-amber-100 text-amber-900',
  absent: 'bg-red-100 text-red-700',
  incomplete: 'bg-orange-100 text-orange-800',
  on_duty: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-medical-100 text-medical-800',
  not_scheduled: 'bg-ink-200 text-ink-600',
  not_available: 'bg-ink-200 text-ink-600',
  left_early: 'bg-amber-100 text-amber-900',
  // appointments
  confirmed: 'bg-teal-100 text-teal-800',
  cancelled: 'bg-red-100 text-red-700',
  missed: 'bg-orange-100 text-orange-800',
  no_show: 'bg-orange-100 text-orange-800',
  // laboratory
  requested: 'bg-ink-200 text-ink-700',
  sample_collected: 'bg-sky-100 text-sky-800',
  processing: 'bg-amber-100 text-amber-900',
  results_entered: 'bg-violet-100 text-violet-800',
  awaiting_verification: 'bg-amber-100 text-amber-900',
  verified: 'bg-teal-100 text-teal-800',
  released: 'bg-emerald-100 text-emerald-800',
  entered: 'bg-violet-100 text-violet-800',
  preliminary: 'bg-amber-100 text-amber-900',
  draft: 'bg-ink-200 text-ink-700',
  finalized: 'bg-emerald-100 text-emerald-800',
  amended: 'bg-violet-100 text-violet-800',
  // results flags
  normal: 'bg-emerald-100 text-emerald-800',
  high: 'bg-red-100 text-red-700',
  low: 'bg-red-100 text-red-700',
  abnormal: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-600 text-white',
  // cards
  replaced: 'bg-ink-200 text-ink-700',
  revoked: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-800',
  success: 'bg-emerald-100 text-emerald-800',
  failure: 'bg-red-100 text-red-700',
}

export function StatusPill({ value, label, className }) {
  if (!value && !label) return <span className="text-ink-400">—</span>
  const key = String(value || '').toLowerCase()
  const style = STATUS_STYLES[key] || 'bg-ink-100 text-ink-700'
  return (
    <span className={clsx('pill', style, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label || humanise(value)}
    </span>
  )
}

/* ------------------------------------------------------------------ layout */
export function PageHeader({ title, description, actions, breadcrumbs, meta }) {
  return (
    <header className="mb-6">
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-500">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 && <span aria-hidden="true">/</span>}
                {crumb.to ? (
                  <a href={crumb.to} className="hover:text-medical-700 hover:underline">
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-ink-700">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-ink-600">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function Card({ children, className, as: Tag = 'section' }) {
  return <Tag className={clsx('card', className)}>{children}</Tag>
}

export function CardHeader({ title, description, actions, icon: Icon }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 rounded-lg bg-medical-50 p-2 text-medical-600">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <div>
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  )
}

/* -------------------------------------------------------------------- form */
export function Field({ label, htmlFor, error, hint, required, children, className }) {
  return (
    <div className={clsx('min-w-0', error && 'field-error', className)}>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className="error-text" role="alert">
          {Array.isArray(error) ? error.join(' ') : error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  )
}

export function Input({ id, error, className, ...props }) {
  return (
    <input
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
      className={clsx('input', className)}
      {...props}
    />
  )
}

export function Textarea({ id, error, className, rows = 3, ...props }) {
  return (
    <textarea
      id={id}
      rows={rows}
      aria-invalid={Boolean(error)}
      className={clsx('input', className)}
      {...props}
    />
  )
}

export function Select({ id, error, className, children, ...props }) {
  return (
    <select id={id} aria-invalid={Boolean(error)} className={clsx('input', className)} {...props}>
      {children}
    </select>
  )
}

/* --------------------------------------------------------------- feedback */
export function Spinner({ className, label = 'Loading' }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-500">
      <Loader2 className={clsx('h-4 w-4 animate-spin', className)} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

export function LoadingBlock({ label = 'Loading data…', rows = 3 }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-10 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="rounded-full bg-ink-100 p-3 text-ink-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-800">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="alert">
      <span className="rounded-full bg-red-50 p-3 text-red-500">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="max-w-md text-sm font-medium text-ink-800">{message}</p>
      {onRetry && (
        <button type="button" className="btn-outline btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function NoResults({ query, onClear }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No matching records"
      description={query ? `Nothing matched “${query}”. Adjust the filters or search again.` : 'Try adjusting your filters.'}
      action={
        onClear && (
          <button type="button" className="btn-outline btn-sm" onClick={onClear}>
            Clear filters
          </button>
        )
      }
    />
  )
}

/* ----------------------------------------------------------------- table */
export function DataTable({ columns, rows, rowKey = 'id', onRowClick, empty, loading, caption }) {
  if (loading) return <LoadingBlock rows={4} />
  if (!rows?.length) return empty || <EmptyState title="No records yet" />
  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row[rowKey] ?? rowIndex}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render ? column.render(row) : row[column.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ pagination, onChange }) {
  if (!pagination) return null
  const { page, pages, total, page_size: pageSize, has_next: hasNext, has_previous: hasPrev } = pagination
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-ink-100 px-5 py-3 sm:flex-row">
      <p className="text-xs text-ink-500">
        Showing{' '}
        <span className="font-semibold text-ink-700">
          {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
        </span>{' '}
        of <span className="font-semibold text-ink-700">{total}</span> records
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-outline btn-sm"
          onClick={() => onChange(page - 1)}
          disabled={!hasPrev}
        >
          Previous
        </button>
        <span className="text-xs font-medium text-ink-600">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="btn-outline btn-sm"
          onClick={() => onChange(page + 1)}
          disabled={!hasNext}
        >
          Next
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ misc */
export function Avatar({ name, src, size = 'md' }) {
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-lg', xl: 'h-24 w-24 text-2xl' }
  const letters = (name || '?')
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
  if (src) {
    return (
      <img
        src={src}
        alt={name ? `${name} profile photograph` : 'Profile photograph'}
        className={clsx('rounded-full object-cover ring-2 ring-white', sizes[size])}
        loading="lazy"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-medical-100 font-semibold text-medical-700 ring-2 ring-white',
        sizes[size],
      )}
    >
      {letters}
    </span>
  )
}

export function DefinitionList({ items, columns = 2 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-4', columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{item.label}</dt>
          <dd className={clsx('mt-0.5 text-sm text-ink-800', item.mono && 'font-mono text-[13px]')}>
            {item.value ?? <span className="text-ink-400">Not recorded</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" aria-label="Section tabs" className="flex flex-wrap gap-1 border-b border-ink-200">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            '-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
            active === tab.id
              ? 'border-medical-600 text-medical-700'
              : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-700',
          )}
        >
          {tab.label}
          {tab.count != null && (
            <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
