import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../services/api'

/**
 * Small data-fetching hook.
 *
 *   const { data, loading, error, refresh } = useFetch('/patients/', { page })
 *
 * `params` are sent as query parameters; changing them refetches.
 */
export function useFetch(url, params = {}, options = {}) {
  const { enabled = true, initial = null, transform } = options
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState('')
  const paramsKey = JSON.stringify(params)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const fetchData = useCallback(async () => {
    if (!enabled || !url) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.get(url, { params })
      if (!mounted.current) return
      setData(transform ? transform(response.data) : response.data)
    } catch (err) {
      if (!mounted.current) return
      setError(err.friendlyMessage || 'Unable to load this data.')
    } finally {
      if (mounted.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paramsKey, enabled])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refresh: fetchData, setData }
}

/** Debounced value, used by search inputs. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Wraps an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async (fn) => {
    setBusy(true)
    setError('')
    try {
      return await fn()
    } catch (err) {
      setError(err.friendlyMessage || 'The action could not be completed.')
      throw err
    } finally {
      setBusy(false)
    }
  }, [])

  return useMemo(() => ({ run, busy, error, setError }), [run, busy, error])
}
