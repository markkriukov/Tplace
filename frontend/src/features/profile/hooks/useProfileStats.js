import { useEffect, useState } from 'react'
import { getProfile } from '../api/profile.api.js'

// Mounted in App so the last successful snapshot survives tab navigation.
export function useProfileStats({ authToken, isProfileView }) {
  const [snapshot, setSnapshot] = useState(null)
  const [failure, setFailure] = useState(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!authToken || !isProfileView) return
    const controller = new AbortController()
    async function refresh() {
      try {
        const response = await getProfile({ token: authToken, signal: controller.signal })
        const stats = response.data?.profile?.stats
        if (!response.ok || !response.data?.ok || !stats ||
          !['gifts', 'sales', 'buys'].every(key => Number.isSafeInteger(stats[key]) && stats[key] >= 0)) {
          throw new Error('Profile statistics unavailable')
        }
        if (controller.signal.aborted) return
        setSnapshot({ token: authToken, stats })
        setFailure(null)
      } catch {
        if (!controller.signal.aborted) setFailure({ token: authToken })
      }
    }
    void refresh()
    return () => controller.abort()
  }, [authToken, isProfileView, retryCount])

  return {
    stats: snapshot?.token === authToken ? snapshot.stats : null,
    error: failure?.token === authToken,
    retry: () => { setFailure(null); setRetryCount(count => count + 1) },
  }
}
