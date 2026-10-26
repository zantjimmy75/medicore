import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

const TONES = {
  medical: 'bg-medical-50 text-medical-700',
  teal: 'bg-teal-50 text-teal-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-700',
  slate: 'bg-ink-100 text-ink-600',
}

export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'medical',
  trend,
  trendLabel,
  onClick,
  loading = false,
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'card card-pad flex w-full items-start gap-4 text-left transition-shadow',
        onClick && 'hover:shadow-lift focus-visible:ring-2 focus-visible:ring-medical-400',
      )}
    >
      {Icon && (
        <span className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', TONES[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        {loading ? (
          <div className="skeleton mt-2 h-7 w-16" />
        ) : (
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{value ?? '—'}</p>
        )}
        {(hint || trend != null) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
            {trend != null && (
              <span
                className={clsx(
                  'inline-flex items-center gap-0.5 font-semibold',
                  trend >= 0 ? 'text-emerald-600' : 'text-red-600',
                )}
              >
                {trend >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {Math.abs(trend)}%
              </span>
            )}
            {trendLabel || hint}
          </p>
        )}
      </div>
    </Tag>
  )
}
