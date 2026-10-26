import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { onSessionEnded, refreshAccessToken, tokenStore } from '../services/api'
import { useToast } from './ToastContext'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const toast = useToast()
  const [user, setUser] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [staffProfile, setStaffProfile] = useState(null)
  const [clinic, setClinic] = useState(null)
  // Only "loading" when there is something to restore *and* a way to restore it.
  const [loading, setLoading] = useState(Boolean(tokenStore.access || tokenStore.refresh))

  const clearIdentity = useCallback(() => {
    setUser(null)
    setPermissions({})
    setStaffProfile(null)
  }, [])

  const loadSession = useCallback(async () => {
    let access = tokenStore.access
    // A reload can land here with the refresh token but no access token (for
    // example after the access token was dropped by the browser's storage).
    if (!access && tokenStore.refresh) access = await refreshAccessToken()

    if (!access) {
      clearIdentity()
      setLoading(false)
      return null
    }

    try {
      const { data } = await api.get('/auth/me/')
      setUser(data.user)
      setPermissions(data.permissions || {})
      setStaffProfile(data.staff || null)
      return data.user
    } catch (err) {
      const status = err?.response?.status
      const definitive =
        status === 401 || status === 403 || err?.errorCode === 'authentication_failed'
      if (definitive && !tokenStore.hasSession) {
        // Nothing left to recover with.
        clearIdentity()
      } else if (definitive && tokenStore.hasSession) {
        // The request layer already retried with a fresh token; treat as ended.
        tokenStore.clear()
        clearIdentity()
      }
      // Transient failures (network/5xx) keep the session so a retry can work.
      return null
    } finally {
      setLoading(false)
    }
  }, [clearIdentity])

  useEffect(() => {
    loadSession()
    // Never call a protected endpoint while signed out: it produces a pointless
    // 401 in the network log that looks like a broken login to anyone watching.
    if (!tokenStore.hasSession) return
    api
      .get('/settings/clinic/')
      .then(({ data }) => setClinic(data.clinic))
      .catch(() => {})
  }, [loadSession])

  useEffect(() => {
    return onSessionEnded(({ reason }) => {
      clearIdentity()
      setClinic(null)
      if (reason === 'refresh_rejected' || reason === 'refresh_without_token') {
        toast.info('Your session ended. Please sign in again.')
      } else if (reason === 'unauthorized') {
        toast.info('Please sign in to continue.')
      }
    })
  }, [clearIdentity, toast])

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login/', { email, password }, { skipAuth: true })
    tokenStore.set(data.access_token, data.refresh_token)
    setUser(data.user)
    // Permissions are needed by the route guards, but a failure here must not
    // undo a successful login.
    try {
      const me = await api.get('/auth/me/')
      setPermissions(me.data.permissions || {})
      setStaffProfile(me.data.staff || null)
    } catch {
      setPermissions(data.user?.permissions || {})
    }
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout/')
    } catch {
      /* the local session is cleared regardless */
    }
    tokenStore.clear()
    clearIdentity()
    setClinic(null)
  }, [clearIdentity])

  const value = useMemo(
    () => ({
      user: user ? { ...user, permissions } : null,
      permissions,
      staffProfile,
      clinic,
      loading,
      login,
      logout,
      refresh: loadSession,
      setClinic,
    }),
    [user, permissions, staffProfile, clinic, loading, login, logout, loadSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
