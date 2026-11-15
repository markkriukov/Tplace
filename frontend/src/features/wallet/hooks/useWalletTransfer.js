import { useEffect, useRef, useState } from 'react'
import { useTonConnectUI, useTonWallet, UserRejectsError } from '@tonconnect/ui-react'
import { createPayment, getWallet, getPayment } from '../api/wallet.api.js'
import { formatGramAmount, parseGramAmount } from '../../../shared/lib/gram-amount.js'
import { getWithdrawalQuote } from '../lib/wallet-transfer.js'
import { startVisiblePolling } from '../../../shared/lib/visible-polling.js'
import { isWalletPayload } from '../lib/wallet-payload.js'

const inProgress = (payment) => payment && ['pending', 'queued', 'broadcast', 'review'].includes(payment.status)
const storageKey = (kind, account) => `tplace:ton:${account}:${kind}`
function paymentAccount(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.sub) return String(payload.sub)
  } catch { /* Non-JWT development tokens are scoped by their full identity. */ }
  return token
}
function readAttempt(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') }
  catch { return null }
}
function storeAttempt(key, attempt) {
  try {
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt))
    else sessionStorage.removeItem(key)
  } catch { /* The server retains the payment even when browser storage is unavailable. */ }
}

export function useWalletTransfer({ kind, authToken, onWalletUpdated, beginWalletRead, onPaymentCompleted, availableNano, isActive }) {
  const storageScope = storageKey(kind, paymentAccount(authToken))
  const wallet = useTonWallet()
  const [tonConnectUI] = useTonConnectUI()
  const [amount, setAmount] = useState('')
  const [configuration, setConfiguration] = useState(null)
  const [available, setAvailable] = useState(0n)
  const [payment, setPayment] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState(false)
  const attempt = useRef(null)
  const hasRestoredAttempt = useRef(false)
  const transferRevision = useRef(0)
  const submitting = useRef(false)
  const updated = useRef(onWalletUpdated)
  const reads = useRef(beginWalletRead)
  const completed = useRef(onPaymentCompleted)
  const lifetime = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])
  useEffect(() => { updated.current = onWalletUpdated }, [onWalletUpdated])
  useEffect(() => { reads.current = beginWalletRead; completed.current = onPaymentCompleted }, [beginWalletRead, onPaymentCompleted])

  useEffect(() => {
    if (!authToken || !isActive) return
    const controller = new AbortController()
    const revision = transferRevision.current
    const applyRead = reads.current?.()
    getWallet({ token: authToken, signal: controller.signal }).then((response) => {
      if (!response.ok || !response.data?.ok || !isWalletPayload(response.data.wallet)) throw new Error('Wallet unavailable')
      // Returning to a screen can overlap restoration with a save or a status poll.
      if (controller.signal.aborted || revision !== transferRevision.current || submitting.current) return
      setConfiguration(response.data.ton)
      setError(previous => previous === 'wallet.loadFailed' ? '' : previous)
      if (!applyRead || applyRead(response.data.wallet)) setAvailable(BigInt(response.data.wallet.available_nano))
      const saved = readAttempt(storageScope)
      if (saved?.key && saved?.fingerprint) attempt.current = saved
      const recent = response.data.payments?.find((item) => item.id === saved?.paymentId && item.kind === kind) ||
        response.data.payments?.find((item) => item.kind === kind && inProgress(item))
      if (recent) {
        setPayment(recent)
        setAmount(formatGramAmount(recent.total_nano ?? (BigInt(recent.amount_nano) + BigInt(recent.fee_nano))))
        // With no local record, assume the request may already have been signed.
        setSubmitted(saved?.paymentId === recent.id ? Boolean(saved.submitted) : true)
        if (saved?.paymentId === recent.id) attempt.current = saved
      } else if (!hasRestoredAttempt.current && saved?.amount) setAmount(saved.amount)
      hasRestoredAttempt.current = true
      setReady(true)
    }).catch(() => {
      if (!controller.signal.aborted && revision === transferRevision.current && !submitting.current) setError('wallet.loadFailed')
    })
    return () => controller.abort()
  }, [authToken, kind, storageScope, isActive])

  useEffect(() => {
    if (!authToken || !isActive || !inProgress(payment)) return
    return startVisiblePolling(async signal => {
      const applyRead = reads.current?.()
      const response = await getPayment(payment.id, { token: authToken, signal })
      signal.throwIfAborted()
      if (!response.ok || !response.data?.ok || !response.data.payment || !isWalletPayload(response.data.wallet)) throw new Error('Payment status unavailable')
      transferRevision.current += 1
      setStatusError(false)
      setNow(Date.now() / 1000)
      setPayment(response.data.payment)
      if (!applyRead || applyRead(response.data.wallet)) setAvailable(BigInt(response.data.wallet.available_nano))
      if (response.data.payment.status === 'completed' || response.data.payment.status === 'expired') {
        if (response.data.payment.status === 'completed') completed.current?.()
        storeAttempt(storageScope, null)
        return false
      }
    }, { intervalMs: 5000, initialDelayMs: 1500, onError: () => setStatusError(true) })
  }, [authToken, kind, payment?.id, payment?.status, isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDeposit = kind === 'deposit'
  const fee = BigInt(payment?.fee_nano ?? configuration?.withdraw_fee_nano ?? 0)
  const amountNano = parseGramAmount(amount)
  const currentAvailable = availableNano == null ? available : BigInt(availableNano)
  const quote = getWithdrawalQuote(amountNano, fee, currentAvailable)
  const enabled = isDeposit ? configuration?.deposits_enabled : configuration?.withdrawals_enabled
  const wrongNetwork = wallet && configuration && wallet.account.chain !== configuration.network
  const locked = busy || Boolean(payment?.status === 'completed' || (inProgress(payment) && (submitted || !isDeposit)))
  const canSubmit = isActive && ready && enabled && wallet && !wrongNetwork && amountNano && !locked &&
    (isDeposit || !quote.error)

  const submit = async () => {
    if (submitting.current || !canSubmit) return
    submitting.current = true
    transferRevision.current += 1
    setBusy(true)
    setError('')
    try {
      const fingerprint = `${wallet.account.address}:${wallet.account.chain}:${amountNano}`
      if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
        attempt.current = { fingerprint, amount: formatGramAmount(amountNano), key: crypto.randomUUID(), submitted: false }
      }
      storeAttempt(storageScope, attempt.current)
      const response = await createPayment(kind, {
        amount: formatGramAmount(amountNano), wallet_address: wallet.account.address,
        network: wallet.account.chain, idempotency_key: attempt.current.key,
      }, { token: authToken, signal: lifetime.current.signal })
      if (lifetime.current.signal.aborted) return
      if (!response.ok || !response.data?.payment || !isWalletPayload(response.data.wallet)) {
        setError(response.data?.code ? `wallet.error.${response.data.code}` : `wallet.${kind}RequestFailed`)
        return
      }
      const created = response.data.payment
      attempt.current.paymentId = created.id
      storeAttempt(storageScope, attempt.current)
      setPayment(created)
      if (!isDeposit) setAmount(formatGramAmount(created.total_nano ?? (BigInt(created.amount_nano) + BigInt(created.fee_nano))))
      setAvailable(BigInt(response.data.wallet.available_nano))
      updated.current?.(response.data.wallet)
      if (isDeposit && created.transaction) {
        if (created.transaction.validUntil <= Date.now() / 1000) {
          setError('wallet.invoiceExpired')
          return
        }
        // The wallet can change while the server prepares the invoice.
        if (tonConnectUI.account?.address !== wallet.account.address || tonConnectUI.account?.chain !== wallet.account.chain) {
          setError('wallet.walletChanged')
          return
        }
        attempt.current.submitted = true
        storeAttempt(storageScope, attempt.current)
        setSubmitted(true)
        try {
          await tonConnectUI.sendTransaction(created.transaction)
        } catch (failure) {
          if (failure instanceof UserRejectsError) {
            attempt.current.submitted = false
            storeAttempt(storageScope, attempt.current)
            setSubmitted(false)
            setError('wallet.rejected')
          } else {
            // A timeout can happen after broadcast. Keep polling, never re-send.
            setError('wallet.signatureUnknown')
          }
        }
      } else { setSubmitted(true) }
    } catch { if (!lifetime.current.signal.aborted) setError(`wallet.${kind}RequestFailed`) }
    finally { submitting.current = false; setBusy(false) }
  }

  const reset = () => {
    transferRevision.current += 1
    attempt.current = null
    storeAttempt(storageScope, null)
    setPayment(null)
    setSubmitted(false)
    setAmount('')
    setError('')
    setStatusError(false)
  }
  return {
    amount, setAmount, configuration, payment, busy, ready, now, error, setError, statusError,
    isDeposit, fee, currentAvailable, quote, enabled, wrongNetwork, locked, canSubmit, submit, reset,
    isPaymentInProgress: Boolean(inProgress(payment)),
  }
}
