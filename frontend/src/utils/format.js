/** Presentation helpers shared across pages. */

const DATE_OPTS = { day: '2-digit', month: 'short', year: 'numeric' }
const DATETIME_OPTS = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}

export function formatDate(value) {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', DATE_OPTS).format(date)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', DATETIME_OPTS).format(date)
}

export function formatTime(value) {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function relativeTime(value) {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  const diff = (Date.now() - date.getTime()) / 1000
  if (Number.isNaN(diff)) return '—'
  const units = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [86400 * 30, 'day'],
    [86400 * 365, 'month'],
    [Infinity, 'year'],
  ]
  if (Math.abs(diff) < 45) return 'just now'
  for (const [limit, unit] of units) {
    if (Math.abs(diff) < limit) {
      const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600
        : unit === 'day' ? 86400 : unit === 'month' ? 86400 * 30 : 86400 * 365
      const value = Math.round(diff / divisor)
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-value, unit)
    }
  }
  return formatDate(date)
}

export function todayISO() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export function isoDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export function initials(name = '') {
  return name
    .replace(/(Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)/gi, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function humanise(value) {
  if (!value) return '—'
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function ageFrom(dob) {
  if (!dob) return null
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1
  return age
}

export function truncate(value, length = 90) {
  if (!value) return '—'
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value
}

export function downloadBlobText(text, filename) {
  const url = window.URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.URL.revokeObjectURL(url)
}

export function formatCurrency(value, currency = 'NGN') {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  if (Number.isNaN(amount)) return '—'
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}
