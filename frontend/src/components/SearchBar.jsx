import { Search, X } from 'lucide-react'
import clsx from 'clsx'

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  onSubmit,
  className,
  label = 'Search records',
  inputRef,
}) {
  return (
    <form
      role="search"
      className={clsx('relative', className)}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.(value)
      }}
    >
      <label className="sr-only" htmlFor="global-filter-search">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        aria-hidden="true"
      />
      <input
        id="global-filter-search"
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  )
}
