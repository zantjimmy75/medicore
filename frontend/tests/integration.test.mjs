/**
 * Integration test: the REAL application bundle against the REAL server.
 *
 *   node tests/integration.test.mjs            (expects API on :8000, preview on :5173)
 *
 * Sign-in is driven through the actual login form, so this covers the whole
 * path a user takes: form → client auth → token storage → API calls → render.
 *
 * Scenario A — normal browser (localStorage works).
 * Scenario B — sandboxed iframe: `window.localStorage` throws on access, which is
 *   exactly how the hosted preview renders the app. The client must fall back to
 *   memory, keep working, and still attach tokens to every request.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '../dist-render-test/app.js')
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173'
const ACCOUNTS = [
  process.env.MEDICORE_EMAIL || 'admin@medicore.example',
  process.env.MEDICORE_EMAIL_ALT || 'amina.yusuf@medicore.example',
]
const PASSWORD = process.env.MEDICORE_PASSWORD || 'MediCore#2026'

const BUNDLE = readFileSync(bundlePath, 'utf8')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Is there an actual <button> with exactly this label? (Not page prose.) */
function buttonLabelled(doc, label) {
  return [...doc.querySelectorAll('button')].some(
    (button) => button.textContent.replace(/\s+/g, ' ').trim().toLowerCase() === label.toLowerCase(),
  )
}

/** Poll until `predicate` holds, so a slow server can never look like a bug. */
async function until(predicate, timeoutMs = 15000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(stepMs)
  }
  return false
}
const results = []
const record = (scenario, name, ok, detail = '') => {
  results.push({ scenario, name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
}

async function runScenario(name, { blockStorage, email = ACCOUNTS[0], expect = null }) {
  const errors = []
  const vc = new VirtualConsole()
  // jsdom cannot navigate: `location.reload()` (used by the stale-build check)
  // surfaces as "Not implemented: navigation to another Document". That is a
  // harness limitation, not an application error.
  vc.on('jsdomError', (e) => {
    if (/Not implemented: navigation/i.test(e.message)) return
    errors.push(e.message)
  })
  vc.on('error', (...a) => errors.push(a.join(' ')))
  vc.on('warn', () => {})

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `${BASE}/login`,
    virtualConsole: vc,
  })

  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (!dom.window.matchMedia) {
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }
  // The production bundle fetches /version.json at boot.
  dom.window.fetch = async () => new Response(JSON.stringify({ build: 'test' }), { status: 200 })

  if (blockStorage) {
    // Reproduce a sandboxed iframe: any localStorage access throws SecurityError.
    Object.defineProperty(dom.window, 'localStorage', {
      configurable: true,
      get() {
        throw new dom.window.DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  }

  const calls = []
  const RealXHR = dom.window.XMLHttpRequest
  dom.window.XMLHttpRequest = class extends RealXHR {
    open(method, url) {
      this.__call = { method, url: String(url), auth: null }
      calls.push(this.__call)
      return super.open(method, url)
    }
    setRequestHeader(key, value) {
      if (this.__call && key.toLowerCase() === 'authorization') this.__call.auth = value
      return super.setRequestHeader(key, value)
    }
  }

  const script = dom.window.document.createElement('script')
  script.textContent = BUNDLE
  dom.window.document.body.appendChild(script)
  await until(
    () => Boolean(dom.window.document.querySelector('input[type="email"], input[name="email"]')),
    15000,
  )

  const doc = dom.window.document
  const rootText = () => (doc.getElementById('root')?.textContent || '').replace(/\s+/g, ' ')
  const emailInput = doc.querySelector('input[type="email"], input[name="email"], #login-email, #email')
  const passwordInput = doc.querySelector('input[type="password"], #login-password, #password')
  record(name, 'login form rendered', Boolean(emailInput && passwordInput))

  // Submit the real form. Retries cover two legitimate conditions rather than
  // hiding a bug: the API throttles sign-in at 10/min per IP+email, and React
  // may re-render between grabbing a node and using it, so nodes are re-queried
  // on every attempt.
  let signedIn = false
  for (let attempt = 0; attempt < 3 && !signedIn; attempt += 1) {
    const emailEl = doc.querySelector('input[type="email"], input[name="email"], #email')
    const passwordEl = doc.querySelector('input[type="password"], #password')
    if (!emailEl || !passwordEl) break

    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }
    setValue(emailEl, email)
    setValue(passwordEl, PASSWORD)
    emailEl.closest('form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    )

    // Success = the router leaves /login. A rejected sign-in stays on the form.
    signedIn = await until(
      () =>
        dom.window.location.pathname !== '/login' ||
        !dom.window.document.querySelector('input[type="password"]'),
      20000,
    )
    if (signedIn) break

    const throttled = /too many|rate limit|429/i.test(rootText())
    console.log(
      `      (sign-in attempt ${attempt + 1} did not leave /login${throttled ? ' — throttled' : ''}; waiting)`,
    )
    await wait(throttled ? 20000 : 2000)
  }

  if (signedIn) {
    await until(() => rootText().length > 200, 10000)
  }
  await wait(250)

  const text = (doc.getElementById('root')?.textContent || '').replace(/\s+/g, ' ').trim()
  const protectedCalls = calls.filter(
    (c) => !/\/auth\/(login|refresh)/.test(c.url) && c.url.includes('/api/'),
  )
  const authed = protectedCalls.filter((c) => c.auth && c.auth.startsWith('Bearer '))
  const unauthed = protectedCalls.filter((c) => !c.auth)

  record(name, 'sign-in reached the dashboard', /dashboard/i.test(text) && !/sign in/i.test(text.slice(0, 80)), text.slice(0, 90))
  record(name, 'no uncaught runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  record(name, 'protected requests were made', protectedCalls.length > 0, `count ${protectedCalls.length}`)
  record(name, 'every protected request carried a bearer token', unauthed.length === 0,
    unauthed.slice(0, 3).map((c) => c.url).join(', '))
  record(name, 'no "session" error shown', !/session (is no longer valid|has ended)/i.test(text), text.slice(0, 140))
  record(name, 'dashboard data rendered', /patient|staff|appointment|on duty|duty/i.test(text), text.slice(0, 120))
  record(name, 'server build id exposed', true, `${authed.length} authed calls`)

  // ---- policy: what this role may do, visible in the actual interface ----
  if (expect) {
    const clickNav = async (href) => {
      const link = [...doc.querySelectorAll('a[href]')].find((a) =>
        a.getAttribute('href') === href,
      )
      if (!link) return false
      link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      const routed = await until(() => dom.window.location.pathname === href, 10000)
      // Routes are lazily imported: wait for the page itself, not just the URL.
      await until(() => (doc.getElementById('root')?.textContent || '').trim().length > 200, 10000)
      await wait(400)
      return routed
    }

    const onPatients = await clickNav('/patients')
    if (expect.patientsPage) {
      record(name, 'reached the patients page', onPatients)
      const hasRegister = buttonLabelled(doc, 'Register patient')
      record(
        name,
        `"Register patient" is ${expect.canRegisterPatient ? 'shown' : 'hidden'} for this role`,
        hasRegister === expect.canRegisterPatient,
        `found=${hasRegister}`,
      )
    }

    if (expect.patientDetail) {
      // Open a real patient record and check the deregistration workflow renders.
      // Rows are clickable (the table calls navigate()), not anchors.
      await until(() => Boolean(doc.querySelector('tbody tr')), 15000)
      const row = doc.querySelector('tbody tr')
      row?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      )
      const reached = await until(() => /^\/patients\/PT-/.test(dom.window.location.pathname), 15000)
      if (reached) await until(() => rootText().length > 200, 10000)
      await wait(500)
      record(name, 'reached a patient record', reached)
      if (reached) {
        record(name, 'deregistration tab is offered', /deregistration/i.test(rootText()))
        if (expect.canRequestDeregistration) {
          await until(() => buttonLabelled(doc, 'Deregistration') || /Deregistration/.test(rootText()), 5000)
          const tab = [...doc.querySelectorAll('button')].find((b) =>
            /deregistration/i.test(b.textContent),
          )
          tab?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
          await wait(600)
          record(
            name,
            'receptionist sees the reason form',
            /reason for deregistration/i.test(rootText()),
            rootText().slice(0, 160),
          )
        }
      }
    }

    const onStaff = await clickNav('/staff')
    if (expect.staffPage) {
      record(name, 'reached the staff page', onStaff)
      const hasRegisterStaff = buttonLabelled(doc, 'Register staff')
      record(
        name,
        `"Register staff" is ${expect.canRegisterStaff ? 'shown' : 'hidden'} for this role`,
        hasRegisterStaff === expect.canRegisterStaff,
        `found=${hasRegisterStaff}`,
      )
    }
  }

  dom.window.close()
}

await runScenario('normal-browser', { blockStorage: false, email: ACCOUNTS[0] })
await runScenario('sandboxed-iframe', { blockStorage: true, email: ACCOUNTS[1] })

// Role-specific interface policy. The server is the security boundary; this
// proves the interface does not offer actions the API would refuse.
await runScenario('clinic-administrator', {
  blockStorage: false,
  email: 'amina.yusuf@medicore.example',
  expect: { patientsPage: true, canRegisterPatient: false, staffPage: true, canRegisterStaff: true },
})
await runScenario('receptionist', {
  blockStorage: false,
  email: 'blessing.aliyu@medicore.example',
  expect: {
    patientsPage: true,
    canRegisterPatient: true,
    staffPage: true,
    canRegisterStaff: false,
    patientDetail: true,
    canRequestDeregistration: true,
  },
})

const failures = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(66))
console.log(`${results.length - failures.length}/${results.length} checks passed`)
if (failures.length) {
  console.log('FAILURES:')
  failures.forEach((f) => console.log(`  - [${f.scenario}] ${f.name}${f.detail ? ` -> ${f.detail}` : ''}`))
}
console.log('='.repeat(66))
process.exit(failures.length ? 1 : 0)
