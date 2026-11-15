import { buyGift } from '../api/gifts.api.js'
import { purchasePayload } from '../lib/gift-purchase-payload.js'
import { useRequestSignal } from '../../../shared/hooks/useRequestSignal.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import GiftBuyConfirmOverlay from './GiftBuyConfirmOverlay.jsx'
import GiftBuyResultOverlay from './GiftBuyResultOverlay.jsx'

const GiftBuyFlow = forwardRef(function GiftBuyFlow({ authToken, onWalletUpdated, onGiftBought }, ref) {
  const { t } = useTranslation()
  const [errorMessage, setErrorMessage] = useState('')
  const [confirmGift, setConfirmGift] = useState(null)
  const [result, setResult] = useState(null)
  const [resultGift, setResultGift] = useState(null)
  const inFlight = useRef(false)
  const getRequestSignal = useRequestSignal()

  useImperativeHandle(
    ref,
    () => ({
      open(gift) {
        if (!gift || inFlight.current) return
        setConfirmGift(gift)
      },
    }),
    []
  )

  const closeConfirm = () => setConfirmGift(null)
  const closeResult = () => {
    setResult(null)
    setResultGift(null)
  }

  const confirmBuy = async () => {
    if (!confirmGift || inFlight.current) return

    const giftToBuy = confirmGift
    setConfirmGift(null)
    setResultGift(giftToBuy)
    setErrorMessage('')

    if (!authToken) {
      setResult('error')
      return
    }

    inFlight.current = true
    const signal = getRequestSignal()
    try {
      const response = await buyGift(purchasePayload(giftToBuy), { token: authToken, signal })
      if (signal.aborted) return
      const payload = response.data

      if (!response.ok || !payload?.ok) {
        setErrorMessage(payload?.code === 'LISTING_CHANGED' ? t('buy.listingChanged') : payload?.error ?? '')
        setResult('error')
        return
      }

      if (payload.wallet) onWalletUpdated?.(payload.wallet)
      onGiftBought?.(String(giftToBuy.id))
      setResult('success')
    } catch (error) {
      if (signal.aborted) return
      if (error.code === 'LISTING_CHANGED') setErrorMessage(t('buy.listingChanged'))
      setResult('error')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <>
      <GiftBuyConfirmOverlay gift={confirmGift} onClose={closeConfirm} onConfirm={confirmBuy} />
      <GiftBuyResultOverlay result={result} gift={resultGift} message={errorMessage} onClose={closeResult} />
    </>
  )
})

export default GiftBuyFlow
