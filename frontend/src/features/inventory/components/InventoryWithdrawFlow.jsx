import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { getGiftWithdrawal, withdrawGift } from '../../gifts/api/gifts.api.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import InventoryWithdrawConfirmOverlay from './InventoryWithdrawConfirmOverlay.jsx'
import { startVisiblePolling } from '../../../shared/lib/visible-polling.js'
import { useRequestSignal } from '../../../shared/hooks/useRequestSignal.js'

/** Withdrawals the worker has not finished. */
const ACTIVE_STATUSES = ['queued', 'sending', 'review']

/** feeNano is the market's gift withdrawal fee; a real withdrawal waits until it is known. */
const InventoryWithdrawFlow = forwardRef(function InventoryWithdrawFlow({ authToken, feeNano = null, onWithdrawn, onQueued, onWalletUpdated }, ref) {
  const { t, language } = useTranslation()
  const [gift, setGift] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const inFlight = useRef(false)
  const keys = useRef(new Map())
  const session = useRef(authToken)
  const generation = useRef(0)
  const getRequestSignal = useRequestSignal()
  const onWithdrawnRef = useRef(onWithdrawn)
  onWithdrawnRef.current = onWithdrawn
  const onWalletUpdatedRef = useRef(onWalletUpdated)
  onWalletUpdatedRef.current = onWalletUpdated
  // An old account's response must never change the next account's inventory.
  if (session.current !== authToken) {
    session.current = authToken
    generation.current += 1
    keys.current.clear()
    setGift(null)
    setJob(null)
    setError(null)
    setSubmitting(false)
    inFlight.current = false
  }
  useImperativeHandle(ref, () => ({ open: value => {
    if (inFlight.current) return
    generation.current += 1
    setError(null)
    setJob(null)
    setGift(value)
  } }), [])
  const failureText = useCallback(data => {
    if ((data?.error_code || data?.code) === 'TRANSFER_LOCKED' && data.available_at) {
      return t('withdrawGift.lockedUntil', { date: new Date(data.available_at).toLocaleString(language, { hourCycle: 'h23' }) })
    }
    const key = `withdrawGift.error.${data?.error_code || data?.code}`
    const translated = t(key)
    return translated === key ? (data?.error || t('withdrawGift.failed')) : translated
  }, [t, language])
  const finish = completedGift => {
    keys.current.delete(completedGift.id)
    setGift(null)
    setJob(null)
    onWithdrawnRef.current?.(completedGift)
  }
  const confirm = async () => {
    if (inFlight.current || !gift || !authToken || ACTIVE_STATUSES.includes(job?.status)) return
    if (!gift.is_test_import && !feeNano) return
    const activeGeneration = generation.current
    const target = gift
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    const signal = getRequestSignal()
    try {
      let withdrawal = { id: target.id }
      if (!target.is_test_import) {
        if (!keys.current.has(target.id)) keys.current.set(target.id, crypto.randomUUID())
        withdrawal = { ...withdrawal, request_key: keys.current.get(target.id), expected_fee_nano: feeNano }
      }
      const response = await withdrawGift(withdrawal, { token: authToken, signal })
      if (signal.aborted || generation.current !== activeGeneration) return
      if (!response.ok) {
        setError(failureText(response.data))
        return
      }
      if (response.data?.wallet) onWalletUpdatedRef.current?.(response.data.wallet)
      if (target.is_test_import || response.data?.job?.status === 'completed') {
        finish(target)
      } else if (response.data?.job) {
        setJob(response.data.job)
        if (response.data.job.status === 'failed') {
          keys.current.delete(target.id)
          setError(failureText(response.data.job))
        }
        onQueued?.(target)
      } else {
        setError(t('withdrawGift.failed'))
      }
    } catch {
      if (!signal.aborted && generation.current === activeGeneration) setError(t('withdrawGift.retryRequest'))
    } finally {
      if (generation.current === activeGeneration) {
        inFlight.current = false
        setSubmitting(false)
      }
    }
  }
  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    if (!gift || !jobId || !ACTIVE_STATUSES.includes(jobStatus) || !authToken) return
    return startVisiblePolling(async signal => {
      const response = await getGiftWithdrawal(jobId, { token: authToken, signal })
      if (signal.aborted) return
      if (!response.ok || !response.data?.job) throw new Error('Status unavailable')
      if (response.data.wallet) onWalletUpdatedRef.current?.(response.data.wallet)
      const latest = response.data.job
      setError(null)
      setJob(latest)
      if (latest.status === 'completed') {
        keys.current.delete(gift.id)
        setGift(null)
        onWithdrawnRef.current?.(gift)
        return false
      }
      if (latest.status === 'failed') {
        keys.current.delete(gift.id)
        setError(failureText(latest))
        return false
      }
    }, { intervalMs: 2000, initialDelayMs: 1000, onError: () => setError(t('withdrawGift.statusRetry')) })
  }, [authToken, gift, jobId, jobStatus, t, failureText])
  const pending = submitting || ['queued', 'sending'].includes(job?.status)
  const shownFee = job && job.status !== 'failed' ? job.fee_nano ?? feeNano : feeNano
  return <InventoryWithdrawConfirmOverlay gift={gift} pending={pending} status={job?.status} error={error}
    feeNano={shownFee}
    disabled={!authToken || pending || job?.status === 'review' || (!gift?.is_test_import && !feeNano)} onConfirm={confirm}
    onClose={() => { if (!inFlight.current) { generation.current += 1; setGift(null); setJob(null) } }} />
})

export default InventoryWithdrawFlow
