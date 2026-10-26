/**
 * Storage that can never crash the app.
 *
 * The hosted preview renders the app inside a sandboxed iframe
 * (`sandbox="allow-scripts"`), where the document origin is opaque and
 * `window.localStorage` **throws** on access. Any unguarded call — even a
 * harmless `localStorage.getItem('sidebar')` — would then throw during render
 * and take the whole interface down.
 *
 * This wrapper probes once, falls back to an in-memory map, and reports which
 * mode is active so the UI can explain that the session will not survive a
 * reload in this context.
 */

let backend = null
let mode = 'unknown'

function probe() {
  if (backend !== null) return backend
  try {
    const store = window.localStorage
    const key = '__medicore_probe__'
    store.setItem(key, '1')
    store.removeItem(key)
    backend = store
    mode = 'persistent'
  } catch {
    backend = new Map()
    mode = 'memory'
  }
  return backend
}

export const storage = {
  /** 'persistent' (localStorage) or 'memory' (blocked / sandboxed). */
  get mode() {
    probe()
    return mode
  },
  get available() {
    return this.mode === 'persistent'
  },
  get(key, fallback = null) {
    const store = probe()
    try {
      if (store instanceof Map) return store.has(key) ? store.get(key) : fallback
      const value = store.getItem(key)
      return value === null || value === undefined ? fallback : value
    } catch {
      return fallback
    }
  },
  set(key, value) {
    const store = probe()
    try {
      if (store instanceof Map) store.set(key, String(value))
      else store.setItem(key, String(value))
      return true
    } catch {
      return false
    }
  },
  remove(key) {
    const store = probe()
    try {
      if (store instanceof Map) store.delete(key)
      else store.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

export default storage
