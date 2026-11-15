import { useInfiniteScroll } from '../hooks/useInfiniteScroll.js'
import LoadingSkeleton from './LoadingSkeleton.jsx'

function InfiniteScrollSentinel({ hasMore, loading, error, onMore, showLoading = true, variant = 'history' }) {
  const targetRef = useInfiniteScroll({
    enabled: !loading && !error,
    pagination: { hasMore },
    loadPage: () => onMore?.(),
  })
  return <div ref={targetRef} style={{ minHeight: 1 }}>
    {loading && showLoading && <LoadingSkeleton variant={variant} count={1} />}
  </div>
}

export default InfiniteScrollSentinel
