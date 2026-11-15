import { useCallback, useEffect, useRef, useState } from 'react'
import { getOffers, refreshOffers } from '../api/offers.api.js'
import { startVisiblePolling } from '../../../shared/lib/visible-polling.js'

export function useOffers({ authToken, enabled }) {
  const [state, setState] = useState({})
  const active = useRef(null)
  const latest = useRef(state)
  useEffect(() => { latest.current = state }, [state])
  const data = state.token === authToken ? state : {}
  const load = useCallback(async (cursor = null, background = false, signal) => {
    if (!authToken) return
    if (background && active.current) return
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    const update = patch => setState(previous => ({
      ...(previous.token === authToken ? previous : {}), token: authToken, ...patch,
    }))
    if (!background) update({ loading: true, error: false })
    try {
      const options = { token: authToken,
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      }
      let snapshot
      if (background) {
        const previous = latest.current.token === authToken ? latest.current.offers : []
        snapshot = await refreshOffers({ ...options, oldestId: previous?.at(-1)?.id })
      } else {
        const response = await getOffers({ ...options, cursor })
        if (!response.ok || !Array.isArray(response.data?.offers)) throw new Error('Offers unavailable')
        snapshot = { offers: response.data.offers, pendingCount: response.data.pending_incoming_count,
          nextCursor: response.data.pagination?.next_cursor ?? null }
      }
      if (controller.signal.aborted) return
      signal?.throwIfAborted()
      setState(previous => {
        const current = previous.token === authToken ? previous : {}
        const rows = cursor ? [...(current.offers ?? []), ...snapshot.offers] : snapshot.offers
        const merged = [...new Map(rows.map(row => [row.id, row])).values()]
        return { ...current, token: authToken, offers: merged,
          pendingCount: snapshot.pendingCount ?? current.pendingCount ?? 0,
          nextCursor: snapshot.nextCursor,
          loaded: true, loading: false, error: false, failedCursor: null, refreshFailed: false,
        }
      })
    } catch (error) {
      if (!controller.signal.aborted && (!signal?.aborted || signal.reason?.name === 'TimeoutError')) {
        update({ loading: false, error: true, failedCursor: cursor, refreshFailed: background })
        if (background) throw error
      }
    } finally {
      if (active.current === controller) active.current = null
    }
  }, [authToken])
  useEffect(() => {
    if (enabled) void load()
    return () => active.current?.abort()
  }, [enabled, load])
  useEffect(() => {
    if (!enabled) return
    return startVisiblePolling(signal => load(null, true, signal), { intervalMs: 30_000, initialDelayMs: 30_000 })
  }, [enabled, load])
  return {
    ...data, offers: data.offers ?? [],
    refresh: () => load(), retry: () => load(data.failedCursor ?? null, Boolean(data.refreshFailed)).catch(() => {}),
    loadMore: () => { if (data.nextCursor && !data.loading && !data.error) void load(data.nextCursor) },
  }
}
