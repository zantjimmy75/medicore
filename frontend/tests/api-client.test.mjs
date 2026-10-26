/**
 * Behavioural tests for the API client's token handling.
 *
 * Runs the real `src/services/api.js` in Node behind a mock axios adapter, so
 * the refresh queue, header attachment and session-ending rules are verified
 * without a browser.
 *
 *   node tests/api-client.test.mjs
 *
 * Covers the regression that caused "your session has ended" seconds after a
 * successful sign-in:
 *   - a request that 401s must be retried WITH a usable Authorization header
 *   - N concurrent 401s must trigger exactly ONE refresh call
 *   - a successful refresh must not destroy the session
 *   - only a definitively rejected refresh (400/401/403) may end the session
 *   - a network failure during refresh must NOT sign the user out
 *   - no protected request may leave without a token when one is obtainable
 */
const store = new Map()

globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  dispatchEvent: () => true,
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.CustomEvent = class {
  constructor(type) {
    this.type = type
  }
}
globalThis.console.warn = () => {}

const failures = []
let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`)
    console.log(`FAIL  ${name}${detail ? `  -> ${detail}` : ''}`)
  }
}

const { default: api, tokenStore, refreshAccessToken, onSessionEnded, getTransportDiagnosis } =
  await import('../src/services/api.js')

/* ------------------------------------------------------------------ harness */

const calls = []
let refreshHandler = () => ({ status: 200, data: { access_token: 'ACCESS-2' } })
let protectedHandler = () => ({ status: 200, data: { ok: true } })
// What the transport probe reports back. Tests that exercise the credential-less
// path set this to simulate a proxy stripping headers.
let probeVerdict = {
  received: { authorization: true, x_auth_token: true, client_build: 'test', origin: '' },
}

// Mock axios adapter: simulates the network without HTTP.
api.defaults.adapter = async (config) => {
  if (String(config.url).includes('/diagnostics/transport/')) {
    return { data: probeVerdict, status: 200, headers: {}, config }
  }
  calls.push({ url: config.url, auth: config.headers?.Authorization })
  const result = await protectedHandler(config)
  if (result.status >= 400) {
    const error = new Error(`HTTP ${result.status}`)
    error.config = config
    error.response = { status: result.status, data: result.data ?? {} }
    throw error
  }
  return { data: result.data, status: result.status, headers: {}, config }
}

// The client refreshes through the top-level axios export, so patch that too.
const axiosModule = await import('axios')
const realPost = axiosModule.default.post
axiosModule.default.post = async (url) => {
  calls.push({ url, auth: null, refresh: true })
  const result = await refreshHandler()
  if (result.status >= 400) {
    const error = new Error(`HTTP ${result.status}`)
    error.response = { status: result.status, data: result.data ?? {} }
    throw error
  }
  return { data: result.data, status: result.status }
}

function reset() {
  calls.length = 0
  tokenStore.clear()
  store.clear()
}

/* -------------------------------------------------------------------- tests */

// 1. Token is attached on the happy path.
reset()
tokenStore.set('ACCESS-1', 'REFRESH-1')
await api.get('/dashboard/summary/')
check('attaches the bearer token', calls[0]?.auth === 'Bearer ACCESS-1', calls[0]?.auth)

// 2. A 401 is retried with the refreshed token, and the session survives.
reset()
tokenStore.set('EXPIRED', 'REFRESH-1')
let served = 0
protectedHandler = () => {
  served += 1
  return served === 1 ? { status: 401 } : { status: 200, data: { ok: true } }
}
const response = await api.get('/dashboard/summary/')
check('retries after refresh and succeeds', response.status === 200)
const retried = calls.filter((c) => !c.refresh).at(-1)
check('retry carries the NEW token', retried?.auth === 'Bearer ACCESS-2', retried?.auth)
check('session still present after refresh', tokenStore.hasSession === true)

// 3. Concurrent 401s share a single refresh (no token ping-pong).
reset()
tokenStore.set('EXPIRED-2', 'REFRESH-1')
refreshHandler = () => ({ status: 200, data: { access_token: 'ACCESS-3' } })
let slow = 0
protectedHandler = async () => {
  slow += 1
  await new Promise((resolve) => setTimeout(resolve, 15))
  return calls.filter((c) => !c.refresh).length <= 3 ? { status: 401 } : { status: 200 }
}
await Promise.all([
  api.get('/dashboard/summary/'),
  api.get('/dashboard/me/'),
  api.get('/settings/clinic/'),
]).catch(() => {})
const refreshes = calls.filter((c) => c.refresh).length
check('exactly one refresh for concurrent 401s', refreshes === 1, `refresh calls: ${refreshes}`)

// 4. A rejected refresh ends the session exactly once.
reset()
tokenStore.set('EXPIRED-3', 'REFRESH-STALE')
let ended = 0
const off = onSessionEnded(() => {
  ended += 1
})
refreshHandler = () => ({ status: 401, data: { error: { code: 'authentication_failed' } } })
protectedHandler = () => ({ status: 401 })
await api.get('/dashboard/summary/').catch(() => {})
check('definitive refresh rejection ends the session', ended === 1 && !tokenStore.hasSession)
off()

// 5. A network failure during refresh must keep the session.
reset()
tokenStore.set('EXPIRED-4', 'REFRESH-1')
let endedNetwork = 0
const off2 = onSessionEnded(() => {
  endedNetwork += 1
})
refreshHandler = () => {
  const error = new Error('Network Error')
  error.response = undefined
  throw error
}
protectedHandler = () => ({ status: 401 })
const networkError = await api.get('/dashboard/summary/').catch((err) => err)
check('network failure keeps the session', tokenStore.hasSession === true && endedNetwork === 0)
check(
  'network failure is reported as retryable',
  /connection|try again/i.test(networkError?.friendlyMessage || ''),
  networkError?.friendlyMessage,
)
off2()

// 6. With a refresh token but no access token, the request refreshes up front
//    instead of firing a header-less request that would 401.
reset()
tokenStore.set('', 'REFRESH-ONLY')
refreshHandler = () => ({ status: 200, data: { access_token: 'ACCESS-5' } })
protectedHandler = () => ({ status: 200, data: { ok: true } })
await api.get('/patients/')
check(
  'pre-emptive refresh when only the refresh token exists',
  calls.filter((c) => c.refresh).length === 1 && calls.at(-1)?.auth === 'Bearer ACCESS-5',
  JSON.stringify(calls),
)

// 7. Storing `undefined` must never produce a literal "Bearer undefined".
reset()
tokenStore.set(undefined, undefined)
check('ignores non-string tokens', tokenStore.access === null, String(tokenStore.access))

// 8. A definitive 401 with nothing to recover with ends the session once.
reset()
// A 401 for a request that never presented a token cannot mean "your session
// expired" — there was no session to expire. Reporting that would misdiagnose a
// stale client as an authentication failure (the reported bug), so the client
// must not fire the signed-out event; it asks the user to reload and retry.
let endedBare = 0
const off3 = onSessionEnded(() => {
  endedBare += 1
})
tokenStore.clear()
probeVerdict = {
  received: { authorization: false, x_auth_token: false, client_build: 'test', origin: 'null' },
}
protectedHandler = () => ({ status: 401 })
let bareError = null
await api.get('/dashboard/summary/').catch((err) => {
  bareError = err
})
check('header-less 401 does not claim the session expired', endedBare === 0 && tokenStore.hasSession === false)
check('header-less 401 is reported as a client-side token problem', bareError?.errorCode === 'no_token_attached')
check(
  'header-less 401 names the real cause (credentials not reaching the server)',
  /proxy|removing them|credentials/i.test(bareError?.friendlyMessage || ''),
  bareError?.friendlyMessage,
)
check('diagnosis is exposed for the UI to display', getTransportDiagnosis()?.cause === 'headers_stripped', getTransportDiagnosis()?.cause)

// A client that is running stale code is named as such, not as an expired session.
reset()
tokenStore.clear()
probeVerdict = { received: { authorization: false, x_auth_token: false, client_build: '', origin: '' } }
protectedHandler = () => ({ status: 401 })
let staleError = null
await api.get('/dashboard/summary/').catch((err) => {
  staleError = err
})
check(
  'a stale client is told to reload rather than that the session expired',
  /older copy of the app/i.test(staleError?.friendlyMessage || ''),
  staleError?.friendlyMessage,
)
off3()

axiosModule.default.post = realPost

/* ------------------------------------------------------------------- report */

console.log('\n' + '='.repeat(60))
console.log(`${checks - failures.length}/${checks} checks passed`)
if (failures.length) {
  console.log('FAILURES:')
  failures.forEach((f) => console.log(`  - ${f}`))
}
console.log('='.repeat(60))
process.exit(failures.length ? 1 : 0)
