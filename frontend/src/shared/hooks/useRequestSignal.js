import { useCallback, useEffect, useRef } from 'react'

// Requests and their callbacks belong to the mounted transaction dialog.
export function useRequestSignal() {
  const controller = useRef(null)
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    return () => current.abort()
  }, [])
  return useCallback(() => controller.current.signal, [])
}
