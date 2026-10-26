/**
 * Boot smoke tests for the SPA, executed in jsdom against the real bundle
 * (built as an IIFE because jsdom cannot run <script type="module">).
 *
 *   npx vite build --config vite.render-test.config.js
 *   node tests/render-smoke.test.mjs
 *
 * Scenario 1 — signed out: the login screen must render (a blank #root is a
 * runtime failure that `vite build` and the API smoke test cannot detect).
 *
 * Scenario 2 — signed in: the dashboard must render and must NOT be torn down by
 * a stray 401. This is a headless regression test for the "your session has
 * ended seconds after signing in" bug: the API answers the dashboard calls with
 * a 401 once, the client refreshes, the retry succeeds, and the shell must stay.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '../dist-render-test/app.js')
const cssPath = resolve(here, '../dist-render-test/medicore-clinic-management-frontend.css')

if (!existsSync(bundlePath)) {
  console.error('Missing dist-render-test/app.js — run: npx vite build --config vite.render-test.config.js')
  process.exit(2)
}

const CSS = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
const BUNDLE = readFileSync(bundlePath, 'utf8')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(scenario, name, ok, detail = '') {
  results.push({ scenario, name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
}

/**
 * Boot the app in a fresh jsdom.
 * `respond(url, method)` returns { status, body } for any API call.
 */
async function boot({ path = '/login', seedTokens = null, respond }) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (err) => errors.push(String(err.message)))
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')))

  const dom = new JSDOM(
    `<!doctype html><html><head><style>${CSS}</style></head><body><div id="root"></div></body></html>`,
    {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: `http://localhost:5173${path}`,
      virtualConsole,
    },
  )

  // jsdom has no layout engine: give Recharts (and anything measuring) the two
  // observers browsers provide natively.
  dom.window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  dom.window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!dom.window.matchMedia) {
    dom.window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })
  }

  if (seedTokens) {
    dom.window.localStorage.setItem('medicore.access', seedTokens.access)
    dom.window.localStorage.setItem('medicore.refresh', seedTokens.refresh)
  }

  const seen = []
  dom.window.XMLHttpRequest = class {
    constructor() {
      this.readyState = 0
      this.status = 0
      this.responseText = ''
      this.listeners = {}
    }
    open(method, url) {
      this.method = method
      this.url = url
    }
    setRequestHeader() {}
    getAllResponseHeaders() {
      return 'content-type: application/json'
    }
    addEventListener(event, handler) {
      this.listeners[event] = handler
    }
    removeEventListener() {}
    abort() {}
    send() {
      const { status, body } = respond(this.url, this.method)
      seen.push({ url: this.url, status })
      setTimeout(() => {
        this.readyState = 4
        this.status = status
        this.responseText = JSON.stringify(body ?? {})
        this.response = this.responseText
        if (this.onreadystatechange) this.onreadystatechange()
        if (this.onload) this.onload()
      }, 5)
    }
  }
  dom.window.fetch = async (url) => {
    const { status, body } = respond(String(url), 'GET')
    return new Response(JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const script = dom.window.document.createElement('script')
  script.textContent = BUNDLE
  try {
    dom.window.document.body.appendChild(script)
  } catch (err) {
    errors.push(`bundle threw: ${err.message}`)
  }

  let text = ''
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(150)
    text = (dom.window.document.getElementById('root')?.textContent || '').trim()
    if (text.length > 0) break
  }
  return { dom, text, errors, seen }
}

/* ------------------------------------------------------- scenario 1: signed out */

{
  const { dom, text, errors } = await boot({
    path: '/login',
    respond: () => ({
      status: 401,
      body: { error: { code: 'not_authenticated', message: 'stub: not signed in' } },
    }),
  })
  record('signed-out', 'no uncaught runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  record('signed-out', '#root is not empty', text.length > 0, `length ${text.length}`)
  record('signed-out', 'login screen rendered', /sign in|email|password/i.test(text), text.slice(0, 100))
  record('signed-out', 'brand visible', /medicore/i.test(text))
  record(
    'signed-out',
    'form controls exist',
    dom.window.document.querySelectorAll('input').length >= 2,
  )
  dom.window.close()
}

/* --------------------------------------------------- scenario 2: signed in */

{
  const USER = {
    id: '6ad8aab18b65a91a3feeed00',
    email: 'admin@medicore.example',
    full_name: 'System Administrator',
    role: 'super_admin',
    is_active: true,
    must_change_password: false,
  }
  let dashboardAuthFailures = 1 // the first dashboard call 401s once

  const respond = (url = '') => {
    if (url.includes('/auth/refresh/')) {
      return { status: 200, body: { access_token: 'ACCESS-ROTATED', expires_in: 3600 } }
    }
    if (url.includes('/auth/me/')) {
      return {
        status: 200,
        body: {
          user: USER,
          permissions: {
            can_manage_staff: true,
            can_register_staff: true,
            can_register_clinic_admin: true,
            assignable_staff_roles: ['super_admin', 'clinic_admin', 'doctor'],
            can_view_any_staff_card: true,
          },
          staff: null,
        },
      }
    }
    if (url.includes('/settings/clinic/')) {
      return { status: 200, body: { clinic: { clinic_name: 'MediCore General Hospital' } } }
    }
    if (url.includes('/dashboard/')) {
      if (dashboardAuthFailures > 0) {
        dashboardAuthFailures -= 1
        return { status: 401, body: { error: { code: 'not_authenticated', message: 'expired' } } }
      }
      return {
        status: 200,
        body: {
          cards: {
            total_patients: 12,
            active_staff: 10,
            staff_on_duty: 10,
            appointments_today: 3,
            lab_pending: 0,
            lab_released_7d: 2,
          },
          trends: { patients: [], attendance: [], laboratory: [] },
          role: 'super_admin',
        },
      }
    }
    return { status: 200, body: {} }
  }

  const { dom, text, errors, seen } = await boot({
    path: '/dashboard',
    seedTokens: { access: 'ACCESS-STALE', refresh: 'REFRESH-OK' },
    respond,
  })

  // Give the client time to refresh and retry (this is where the old build died).
  await wait(1500)
  const finalText = (dom.window.document.getElementById('root')?.textContent || '').trim()
  const refreshCalls = seen.filter((call) => call.url.includes('/auth/refresh/')).length
  const dashboardRetries = seen.filter((call) => call.url.includes('/dashboard/')).length

  record('signed-in', 'no uncaught runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  record('signed-in', 'dashboard shell rendered', /dashboard|patients|staff/i.test(finalText), finalText.slice(0, 120))
  record('signed-in', 'session was NOT torn down', !/session (has )?ended|sign in again/i.test(finalText), finalText.slice(0, 160))
  record('signed-in', 'refreshed exactly once after the 401', refreshCalls === 1, `refresh calls: ${refreshCalls}`)
  record('signed-in', 'retried the failed dashboard request', dashboardRetries >= 2, `dashboard calls: ${dashboardRetries}`)
  record('signed-in', 'still shows a signed-in user', /administrator|admin/i.test(finalText), finalText.slice(0, 120))
  record('signed-in', 'no blank screen', finalText.length > 100, `length ${finalText.length}`)
  dom.window.close()
}

/* ------------------------------------------------------------------- report */

const failures = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(64))
console.log(`${results.length - failures.length}/${results.length} checks passed`)
if (failures.length) {
  console.log('FAILURES:')
  failures.forEach((f) => console.log(`  - [${f.scenario}] ${f.name}${f.detail ? ` -> ${f.detail}` : ''}`))
}
console.log('='.repeat(64))
process.exit(failures.length ? 1 : 0)
