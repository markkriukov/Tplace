import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { getWalletTransactions, getWalletBalance } from '../api/wallet.api.js'
import { formatWalletActions, formatProfileHistoryItems } from '../lib/wallet-formatters.js'
import { isWalletPayload } from '../lib/wallet-payload.js'

export function useWallet({ t, language, authToken, isWalletView, isProfileView }) {
  const [state, setState] = useState({})
  const requests = useRef({ balance: null, history: null })
  const session = useMemo(() => ({ token: authToken }), [authToken])
  const balanceRevision = useRef(0)
  const reads = useRef({ started: 0, applied: 0 })
  const currentSession = useRef(session)
  useEffect(() => { currentSession.current = session }, [session])
  const data = state.token === authToken ? state : {}
  const update = useCallback(patch => setState(previous => ({ ...(previous.token === authToken ? previous : {}), token: authToken, ...patch })), [authToken])
  const applyWalletPayload = useCallback(wallet => {
    if (currentSession.current !== session) return
    if (!isWalletPayload(wallet)) { update({ balanceError: true }); return }
    // A mutation response is newer than an already running balance read.
    requests.current.balance?.abort()
    requests.current.balance = null
    balanceRevision.current += 1
    update({ wallet, balanceError: false })
  }, [session, update])
  const beginWalletRead = useCallback(() => {
    const revision = balanceRevision.current
    const readId = ++reads.current.started
    return wallet => {
      if (currentSession.current !== session || balanceRevision.current !== revision ||
        readId <= reads.current.applied || !isWalletPayload(wallet)) return false
      reads.current.applied = readId
      update({ wallet, balanceError: false })
      return true
    }
  }, [session, update])
  const loadBalance = useCallback(async () => {
    if (!authToken) return
    // Do not cancel a slow request every time the refresh timer fires.
    if (requests.current.balance && !requests.current.balance.signal.aborted) return
    const controller = new AbortController()
    requests.current.balance = controller
    const applyRead = beginWalletRead()
    const revision = balanceRevision.current
    const readId = reads.current.started
    try {
      const result = await getWalletBalance({ token: authToken,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      if (!result.ok || !isWalletPayload(result.data?.wallet)) throw new Error('Wallet unavailable')
      if (!controller.signal.aborted) applyRead(result.data.wallet)
    } catch {
      if (!controller.signal.aborted && currentSession.current === session &&
        balanceRevision.current === revision && readId >= reads.current.applied) update({ balanceError: true })
    } finally {
      if (requests.current.balance === controller) requests.current.balance = null
    }
  }, [authToken, beginWalletRead, session, update])
  const loadWalletTransactions = useCallback(async (cursor = null) => {
    if (!authToken) return
    requests.current.history?.abort()
    const controller = new AbortController()
    requests.current.history = controller
    update({ loading: true })
    try {
      const result = await getWalletTransactions({ token: authToken, signal: controller.signal, cursor })
      if (!result.ok || !Array.isArray(result.data?.transactions)) throw new Error('History unavailable')
      if (controller.signal.aborted) return
      setState(previous => {
        const current = previous.token === authToken ? previous : {}
        const rows = cursor ? [...(current.transactions || []), ...result.data.transactions] : result.data.transactions
        return { ...current, token: authToken, transactions: [...new Map(rows.map(row => [row.id, row])).values()], nextCursor: result.data.pagination?.next_cursor ?? null, failedHistoryCursor: null, historyError: false, loading: false }
      })
    } catch {
      if (!controller.signal.aborted) update({ historyError: true, failedHistoryCursor: cursor, loading: false })
    }
  }, [authToken, update])
  useEffect(() => {
    const active = isWalletView || isProfileView
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      void loadBalance()
      if (active) void loadWalletTransactions()
    }
    refresh()
    // Refresh balance while visible; keep paginated history stable until explicit refresh.
    const timer = active ? setInterval(() => { if (document.visibilityState !== 'hidden') void loadBalance() }, 10000) : null
    const controllers = requests.current
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      controllers.balance?.abort()
      controllers.history?.abort()
    }
  }, [isWalletView, isProfileView, loadBalance, loadWalletTransactions])
  const walletCurrency = data.wallet?.currency_code || APP_CURRENCY
  const walletAvailableNano = data.wallet?.available_nano
  const walletBalance = data.wallet ? formatGramAmount(data.wallet.available_nano) : '\u2014'
  const walletLockedBalance = data.wallet?.locked_nano != null ? formatGramAmount(data.wallet.locked_nano) : null
  const recentWalletActions = useMemo(() => formatWalletActions(data.transactions || [], walletCurrency, t, language), [data.transactions, walletCurrency, t, language])
  const profileHistoryItems = useMemo(() => formatProfileHistoryItems(data.transactions || [], t, language), [data.transactions, t, language])
  return {
    walletCurrency, walletAvailableNano, walletBalance, walletLockedBalance, recentWalletActions, profileHistoryItems,
    applyWalletPayload, beginWalletRead, loadWalletTransactions: () => loadWalletTransactions(),
    isWalletTransactionsLoading: Boolean(data.loading), walletError: Boolean(data.balanceError || data.historyError),
    isWalletHistoryReady: Array.isArray(data.transactions) && !data.historyError,
    hasMoreTransactions: Boolean(data.nextCursor),
    loadMoreTransactions: () => {
      if (!data.nextCursor || data.loading || data.historyError) return
      return loadWalletTransactions(data.nextCursor)
    },
    retryWallet: () => {
      if (data.balanceError) void loadBalance()
      if (data.historyError) void loadWalletTransactions(data.failedHistoryCursor)
    },
  }
}
