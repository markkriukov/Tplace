import { useEffect, useEffectEvent, useState } from 'react'

export function useInfiniteScroll({ enabled, pagination, loadPage }) {
  // A callback ref also reconnects when a lazy page mounts after its data loads.
  const [target, setTarget] = useState(null)
  const onVisible = useEffectEvent(() => {
    loadPage({ cursor: pagination.nextCursor, append: true })
  })

  useEffect(() => {
    if (!enabled || !pagination.hasMore || !target) return
    let triggered = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!triggered && entries.some((entry) => entry.isIntersecting)) {
          triggered = true
          observer.disconnect()
          onVisible()
        }
      },
      { root: null, rootMargin: '220px 0px', threshold: 0.01 }
    )
    observer.observe(target)
    return () => {
      triggered = true
      observer.disconnect()
    }
  }, [enabled, pagination.hasMore, pagination.nextCursor, target])
  return setTarget
}
