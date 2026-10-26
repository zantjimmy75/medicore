import { Component } from 'react'

/**
 * Catches render-time exceptions (including a failed lazy-chunk import) so a
 * runtime error can never present as a blank white page.
 *
 * A stale chunk is the classic cause: after the dev server restarts or a new
 * build is deployed, an open tab may request a hashed module that no longer
 * exists. Reloading fixes it, so the fallback asks for exactly that.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Never log PHI: only the message and component stack.
    console.error('[medicore] interface error:', error?.message, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isChunkError = /dynamically imported module|Importing a module script failed|loading chunk/i.test(
      error?.message || '',
    )

    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-2xl">
            !
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            {isChunkError ? 'A newer version of the app is available' : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {isChunkError
              ? 'The page tried to load part of the application that has since been updated. Reloading will fetch the current version.'
              : 'The interface hit an unexpected error. Reloading usually fixes it; if it keeps happening, share the message below with your administrator.'}
          </p>
          <p className="mt-3 break-words rounded-lg bg-slate-50 p-3 text-left font-mono text-[11px] text-slate-500">
            {error?.message || 'Unknown error'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Reload the page
            </button>
            <a
              href="/login"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Go to sign in
            </a>
          </div>
        </div>
      </div>
    )
  }
}
