/**
 * Stale-bundle detection.
 *
 * A tab that stays open across a deployment keeps running the JavaScript it
 * loaded, even though the server has moved on. That produced repeated support
 * reports ("blank page", "my session is no longer valid") where the running code
 * was simply out of date. This checks the server's build stamp and reloads once
 * when they differ.
 */
import storage from './storage.js'

const RELOAD_FLAG = 'medicore.reloadedForBuild'

export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

export async function checkForNewBuild({ reload = true } = {}) {
  try {
    const response = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return { updated: false, reason: 'no-version-file' }
    const { build } = await response.json()
    if (!build || build === BUILD_ID) {
      storage.remove(RELOAD_FLAG)
      return { updated: false, serverBuild: build, build: BUILD_ID }
    }
    if (reload && storage.get(RELOAD_FLAG) !== build) {
      // Guard the reload so a broken deploy cannot put a tab into a reload loop.
      storage.set(RELOAD_FLAG, build)
      window.location.reload()
    }
    return { updated: true, serverBuild: build, build: BUILD_ID }
  } catch {
    return { updated: false, reason: 'unreachable' }
  }
}
