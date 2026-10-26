/**
 * API client.
 *
 * Token handling is deliberately defensive because it caused a real bug: a
 * request could leave the browser *without* an `Authorization` header (silent
 * difference between in-memory state and storage), the retry after a perfectly
 * good refresh went out header-less too, and the client then threw the session
 * away. Rules enforced here:
 *
 * 1. The in-memory token mirror is the source of truth for the tab; storage is
 *    best-effort persistence (it can be blocked entirely — sandboxed iframes,
 *    private modes, partitioned storage — and must never break the session).
 * 2. A protected request never leaves without a token if a refresh token can
 *    still mint one: it refreshes *first* instead of firing a doomed request.
 * 3. A refresh is single-flight: concurrent 401s share one refresh promise, so
 *    rotating tokens cannot invalidate each other (the server also keeps the
 *    previous access token valid for a short grace window).
 * 4. The session is only discarded when the refresh endpoint *definitively*
 *    rejects (400/401/403). Network errors and 5xx keep the session.
 * 5. Blob responses (PDF/CSV) pass through untouched; no PHI is logged.
 */
import axios from 'axios'
import storage from '../utils/storage.js'

const ACCESS_KEY = 'medicore.access'
const REFRESH_KEY = 'medicore.refresh'

/* ------------------------------------------------------------------ storage */

// localStorage throws outright inside a sandboxed iframe (opaque origin), which
// is how the hosted preview renders the app. `storage` falls back to memory and
// never throws; see src/utils/storage.js.
const memory = { access: null, refresh: null, hydrated: false }

function hydrate() {
  if (memory.hydrated) return
  memory.hydrated = true
  memory.access = storage.get(ACCESS_KEY) || null
  memory.refresh = storage.get(REFRESH_KEY) || null
}

function persist() {
  if (memory.access) storage.set(ACCESS_KEY, memory.access)
  else storage.remove(ACCESS_KEY)
  if (memory.refresh) storage.set(REFRESH_KEY, memory.refresh)
  else storage.remove(REFRESH_KEY)
}

/** Diagnostics snapshot — never includes the tokens themselves. */
export function getClientSnapshot() {
  hydrate()
  return {
    build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
    storageMode: storage.mode,
    hasAccessToken: Boolean(memory.access),
    hasRefreshToken: Boolean(memory.refresh),
    shortAccessToken: memory.access ? `${memory.access.slice(0, 6)}…${memory.access.slice(-4)}` : null,
    origin: typeof window !== 'undefined' ? window.location.origin : 'n/a',
  }
}

export const tokenStore = {
  get access() {
    hydrate()
    return memory.access
  },
  get refresh() {
    hydrate()
    return memory.refresh
  },
  get hasSession() {
    hydrate()
    return Boolean(memory.access || memory.refresh)
  },
  set(access, refresh) {
    hydrate()
    // Never store `undefined`/`null` as a string — that produced a literal
    // "Bearer undefined" header in an earlier iteration.
    memory.access = typeof access === 'string' && access ? access : memory.access
    if (typeof refresh === 'string' && refresh) memory.refresh = refresh
    if (memory.access || memory.refresh) sessionEndNotified = false
    persist()
  },
  clear() {
    hydrate()
    memory.access = null
    memory.refresh = null
    persist()
  },
}

/* -------------------------------------------------------------------- client */

export const api = axios.create({
  baseURL: '/api',
  timeout: 45000,
  headers: { 'Content-Type': 'application/json' },
})

const AUTH_FREE = ['/auth/login/', '/auth/refresh/', '/auth/password-reset/']

function isAuthEndpoint(url = '') {
  return AUTH_FREE.some((path) => url.includes(path))
}

/* ------------------------------------------------------------------ refresh */

let refreshPromise = null
const listeners = new Set()

/** Notified with { reason } when the session is definitively over. */
export function onSessionEnded(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

// Concurrent failures must not each fire "your session ended": notify once per
// session, and re-arm as soon as a new session is established.
let sessionEndNotified = false

function endSession(reason) {
  tokenStore.clear()
  if (sessionEndNotified) return
  sessionEndNotified = true
  listeners.forEach((listener) => {
    try {
      listener({ reason })
    } catch {
      /* a listener must never break the client */
    }
  })
}

export function resetSessionEndedFlag() {
  sessionEndNotified = false
}

/**
 * Exchange the refresh token for a fresh access token.
 * Returns the new access token, or null when it is definitively over.
 */
export function refreshAccessToken() {
  const refresh = tokenStore.refresh
  if (!refresh) return Promise.resolve(null)
  if (refreshPromise) return refreshPromise

  refreshPromise = axios
    .post('/api/auth/refresh/', { refresh_token: refresh })
    .then(({ data }) => {
      const access = data?.access_token
      if (!access) {
        endSession('refresh_without_token')
        return null
      }
      tokenStore.set(access, data.refresh_token || refresh)
      return access
    })
    .catch((error) => {
      const status = error?.response?.status
      // Definitive rejection → the session is genuinely over.
      if (status === 400 || status === 401 || status === 403) {
        endSession('refresh_rejected')
        return null
      }
      // Network blip or server error: keep the session, let the caller retry.
      return null
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

/* --------------------------------------------------------------- interceptors */

/** Attach credentials on every channel the server accepts.
 *
 * `Authorization` is the standard channel. `X-Auth-Token` mirrors the same
 * opaque token because some sandboxed-iframe proxies strip `Authorization` in
 * transit, which would otherwise surface as a bogus "session expired". The
 * build id lets the server tell a stale tab from a stripped header.
 */
function applyAuthHeaders(config, token) {
  config.headers = config.headers || {}
  const set = (name, value) => {
    if (typeof config.headers.set === 'function') config.headers.set(name, value)
    else config.headers[name] = value
  }
  set('X-Client-Build', typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev')
  if (token) {
    set('Authorization', `Bearer ${token}`)
    set('X-Auth-Token', token)
  }
  return config
}

api.interceptors.request.use(async (config) => {
  if (config.skipAuth) return config

  let token = tokenStore.access
  if (!token && tokenStore.refresh) {
    // Better to refresh up front than to send a request we know will 401.
    token = await refreshAccessToken()
  }
  config.__sentWithToken = Boolean(token)
  return applyAuthHeaders(config, token)
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error
    if (!config) return Promise.reject(error)

    if (!response) {
      error.friendlyMessage =
        'Cannot reach the server. Check that the API is running and try again.'
      return Promise.reject(error)
    }

    const url = config.url || ''
    const attempts = config.__authRetries || 0

    // A 401 for a request that never carried a token cannot mean "your session
    // expired" — no session was presented. Try once to obtain a token, then
    // report a connection problem instead of signing the user out.
    if (response.status === 401 && !isAuthEndpoint(url) && config.__sentWithToken === false) {
      const token = await refreshAccessToken()
      if (token) {
        config.__sentWithToken = true
        config.__authRetries = (config.__authRetries || 0) + 1
        return api(applyAuthHeaders(config, token))
      }
      const diagnosis = await diagnoseTransport()
      error.errorCode = 'no_token_attached'
      error.friendlyMessage = transportMessage(diagnosis)
      return Promise.reject(error)
    }

    // Retry once (twice at most) after a silent refresh. `/auth/*` endpoints are
    // never retried: their 401s are answers, not expired sessions.
    if (response.status === 401 && !isAuthEndpoint(url) && attempts < 2) {
      const token = await refreshAccessToken()
      if (token) {
        config.__authRetries = attempts + 1
        return api(applyAuthHeaders(config, token))
      }
      if (!tokenStore.hasSession) {
        // Nothing left to recover with: the session is over (notified once).
        endSession(tokenStore.refresh ? 'refresh_rejected' : 'unauthorized')
        error.friendlyMessage = 'Your session has ended. Please sign in again.'
        return Promise.reject(error)
      }
      // Transient failure: report it as retryable rather than signing the user out.
      error.friendlyMessage =
        'We could not verify your session just now. Check your connection and try again.'
      return Promise.reject(error)
    }

    const payload = response.data?.error
    const authCodes = new Set([
      'not_authenticated',
      'authentication_failed',
      'invalid_token',
      'token_expired',
      'session_expired',
    ])

    if (response.status === 401 || authCodes.has(payload?.code)) {
      if (isAuthEndpoint(url) && payload?.message) {
        // Sign-in / reset failures must show the server's own explanation
        // ("Invalid email or password.") instead of a session message.
        error.friendlyMessage = payload.message
      } else {
        error.friendlyMessage = tokenStore.hasSession
          ? 'Your session is no longer valid. Please sign in again.'
          : 'Please sign in to continue.'
      }
      if (!tokenStore.hasSession && !isAuthEndpoint(url)) {
        endSession('unauthorized')
      }
    } else {
      error.friendlyMessage =
        payload?.message ||
        (response.status === 403
          ? 'You do not have permission to perform this action.'
          : `Request failed (${response.status}).`)
    }

    error.fieldErrors = payload?.fields || null
    error.errorCode = payload?.code || null
    error.errorDetails = payload?.details || null
    return Promise.reject(error)
  },
)

/* -------------------------------------------------------------- diagnosis */

let lastTransportDiagnosis = null

export function getTransportDiagnosis() {
  return lastTransportDiagnosis
}

/**
 * Ask the server what it actually received. Called only when a 401 arrives on a
 * request the client believes it authenticated: that combination means the
 * credentials were lost in transit (a proxy stripping headers) or the running
 * bundle is older than the server. Both are named instead of being reported as
 * an expired session.
 */
async function diagnoseTransport() {
  try {
    const { data } = await api.get('/diagnostics/transport/', { skipAuth: true })
    const received = data?.received || {}
    const sentBuild = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
    let cause = 'unknown'
    if (!received.client_build) {
      cause = 'stale_client'
    } else if (!received.authorization && !received.x_auth_token) {
      cause = 'headers_stripped'
    } else if (!received.authorization && received.x_auth_token) {
      cause = 'authorization_header_stripped'
    } else {
      cause = 'rejected'
    }
    lastTransportDiagnosis = {
      cause,
      sentBuild,
      serverSawBuild: received.client_build || null,
      authorizationReceived: Boolean(received.authorization),
      fallbackHeaderReceived: Boolean(received.x_auth_token),
      origin: received.origin || null,
      at: new Date().toISOString(),
    }
  } catch {
    lastTransportDiagnosis = { cause: 'probe_unreachable', at: new Date().toISOString() }
  }
  return lastTransportDiagnosis
}

function transportMessage(diagnosis) {
  switch (diagnosis?.cause) {
    case 'headers_stripped':
      return 'Your browser reached the clinic server without any credentials — a proxy in front of the app is removing them. Reload the page; if it persists, open the app outside the preview frame.'
    case 'authorization_header_stripped':
      return 'The proxy in front of the app is dropping the Authorization header. The app has switched to its fallback channel — reload to apply it.'
    case 'stale_client':
      return 'This tab is running an older copy of the app than the server. Reload the page (Ctrl/Cmd+Shift+R) to pick up the current version.'
    case 'probe_unreachable':
      return 'We could not reach the clinic server to check your session. Check your connection and try again.'
    default:
      return 'The clinic server rejected the sign-in token this browser sent. Reload the page and sign in again.'
  }
}

/* ------------------------------------------------------------------- helpers */

/** Trigger a browser download for a binary API response. */
export async function downloadFile(url, filename) {
  const response = await api.get(url, { responseType: 'blob' })
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(blobUrl)
}

export function openPdfPreview(url) {
  // Opens the authenticated PDF in a new tab via a blob URL.
  return api.get(url, { responseType: 'blob' }).then((response) => {
    const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
    window.open(blobUrl, '_blank', 'noopener,noreferrer')
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000)
  })
}

export default api
