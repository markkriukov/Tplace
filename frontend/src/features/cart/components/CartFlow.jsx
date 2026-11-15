import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import { buyGift, getGiftQuote } from '../../gifts/api/gifts.api.js'
import { purchasePayload } from '../../gifts/lib/gift-purchase-payload.js'
import { useRequestSignal } from '../../../shared/hooks/useRequestSignal.js'

import { useEffect, useMemo, useRef, useState } from 'react'
import CartCheckoutResultOverlay from './CartCheckoutResultOverlay.jsx'
import CartOverlay from './CartOverlay.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function CartFlow({
  isOpen,
  onClose,
  authToken,
  cartGifts: selectedEntries,
  cartIds,
  onCartIdsChange,
  onWalletUpdated,
  onGiftsPurchased,
}) {
  const { t } = useTranslation()
  const [refreshedQuotes, setRefreshedQuotes] = useState({})
  const cartGifts = useMemo(() => selectedEntries.map(gift => ({ ...gift, ...refreshedQuotes[gift.id] })), [selectedEntries, refreshedQuotes])
  const [deselectedCartIds, setDeselectedCartIds] = useState([])
  const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false)
  const [checkoutStatusMessage, setCheckoutStatusMessage] = useState('')
  const [checkoutResult, setCheckoutResult] = useState(null)
  const checkoutInFlight = useRef(false)
  const getRequestSignal = useRequestSignal()

  useEffect(() => {
    const currentIds = new Set(cartIds)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Discard quote and selection caches for gifts removed by any cart control.
    setRefreshedQuotes(previous => {
      const entries = Object.entries(previous)
      const retained = entries.filter(([id]) => currentIds.has(String(id)))
      return retained.length === entries.length ? previous : Object.fromEntries(retained)
    })
    setDeselectedCartIds(previous => {
      const retained = previous.filter(id => currentIds.has(id))
      return retained.length === previous.length ? previous : retained
    })
  }, [cartIds])

  const visibleCartIds = useMemo(() => cartGifts.map((gift) => gift.id), [cartGifts])
  const deselectedCartIdSet = useMemo(() => new Set(deselectedCartIds), [deselectedCartIds])
  const selectedCartIds = useMemo(
    () => cartIds.filter((id) => !deselectedCartIdSet.has(id)),
    [cartIds, deselectedCartIdSet]
  )
  const selectedCartIdSet = useMemo(() => new Set(selectedCartIds), [selectedCartIds])
  const visibleSelectedCartIds = useMemo(
    () => visibleCartIds.filter((id) => !deselectedCartIdSet.has(id)),
    [visibleCartIds, deselectedCartIdSet]
  )
  const allCartSelected =
    visibleCartIds.length > 0 && visibleSelectedCartIds.length === visibleCartIds.length
  const selectedCartTotal = useMemo(() => {
    let total = 0n
    for (const gift of cartGifts) {
      if (selectedCartIdSet.has(gift.id)) total += BigInt(gift.price_nano ?? 0)
    }
    return formatGramAmount(total)
  }, [cartGifts, selectedCartIdSet])
  const canCheckoutSelected = visibleSelectedCartIds.length > 0 && !isCheckoutProcessing

  const removeCartIds = (idsToRemove) => {
    const removeSet = new Set(idsToRemove)
    onCartIdsChange((prev) => prev.filter((id) => !removeSet.has(id)))
    setCheckoutStatusMessage('')
  }

  const removeCartGift = (giftId) => { if (!checkoutInFlight.current) removeCartIds([giftId]) }
  const clearCart = () => {
    if (checkoutInFlight.current) return
    onCartIdsChange([])
    setCheckoutStatusMessage('')
  }
  const removeSelectedFromCart = () => {
    if (checkoutInFlight.current || selectedCartIds.length === 0) return
    removeCartIds(selectedCartIds)
  }
  const toggleCartGift = (giftId) => {
    if (checkoutInFlight.current) return
    setDeselectedCartIds((prev) =>
      selectedCartIdSet.has(giftId)
        ? [...new Set([...prev, giftId])]
        : prev.filter((id) => id !== giftId)
    )
  }
  const toggleSelectAllCart = () => {
    if (checkoutInFlight.current) return
    setDeselectedCartIds((prev) => {
      if (visibleCartIds.length === 0) return []
      const currentDeselectedSet = new Set(prev)
      const visibleCartIdSet = new Set(visibleCartIds)
      const isAllVisibleSelected = visibleCartIds.every((id) => !currentDeselectedSet.has(id))
      return isAllVisibleSelected
        ? [...new Set([...prev, ...visibleCartIds])]
        : prev.filter((id) => !visibleCartIdSet.has(id))
    })
  }

  const checkoutSelectedCart = async () => {
    if (checkoutInFlight.current) return
    if (selectedCartIds.length === 0) return

    if (!authToken) {
      setCheckoutStatusMessage(t('common.authMissing'))
      return
    }

    const giftsToBuy = []
    const failedEntries = []
    for (const gift of cartGifts) {
      if (!selectedCartIdSet.has(gift.id)) continue
      if (gift.isOwnedByCurrentUser === true) {
        failedEntries.push({ gift, error: t('cart.cannotBuyOwn') })
      } else {
        giftsToBuy.push(gift)
      }
    }

    checkoutInFlight.current = true
    setIsCheckoutProcessing(true)
    setCheckoutStatusMessage('')
    setCheckoutResult(null)
    const signal = getRequestSignal()

    // Refresh before any purchase. A changed quote must be displayed and
    // explicitly confirmed by a second click; never silently charge a new price.
    try {
      const quotes = {}
      let changed = false
      for (const gift of giftsToBuy) {
        signal.throwIfAborted()
        const response = await getGiftQuote(gift.id, { signal })
        if (signal.aborted) return
        // Recover our own completed purchase even if its listing has disappeared.
        if (response.status === 404 || response.status === 409) continue
        if (!response.ok || !response.data?.quote?.listing_id || !response.data.quote.price_nano) throw new Error(t('buy.listingChanged'))
        quotes[gift.id] = { ...response.data.quote, price: formatGramAmount(response.data.quote.price_nano) }
        if (String(gift.listing_id) !== String(response.data.quote.listing_id) || String(gift.price_nano) !== response.data.quote.price_nano) changed = true
      }
      if (changed) {
        setRefreshedQuotes(previous => ({ ...previous, ...quotes }))
        setCheckoutStatusMessage(t('buy.listingChanged'))
        setIsCheckoutProcessing(false)
        checkoutInFlight.current = false
        return
      }
    } catch (error) {
      if (signal.aborted) return
      setCheckoutStatusMessage(error.message)
      setIsCheckoutProcessing(false)
      checkoutInFlight.current = false
      return
    }
    const purchasedIds = []
    const purchasedGifts = []
    let lastWalletPayload = null

    for (const gift of giftsToBuy) {
      if (signal.aborted) return
      try {
        const response = await buyGift(purchasePayload(gift), { token: authToken, signal })
        if (signal.aborted) return
        const payload = response.data
        if (!response.ok || !payload?.ok) {
          const message =
            payload?.code === 'LISTING_CHANGED' ? t('buy.listingChanged') :
            typeof payload?.error === 'string' && payload.error.trim()
              ? payload.error.trim()
              : t('cart.buyGiftFailed', { id: gift.id })
          failedEntries.push({ gift, error: message })
          continue
        }

        purchasedIds.push(gift.id)
        purchasedGifts.push(gift)
        if (payload?.wallet) {
          lastWalletPayload = payload.wallet
        }
      } catch (error) {
        if (signal.aborted) return
        failedEntries.push({ gift, error: error.code === 'LISTING_CHANGED' ? t('buy.listingChanged') : t('cart.requestFailed', { id: gift.id }) })
      }
    }

    if (lastWalletPayload) {
      onWalletUpdated?.(lastWalletPayload)
    }

    // Gifts that could not be bought leave the cart too; the result lists them with the reason.
    const processedIds = [...purchasedIds, ...failedEntries.map(entry => entry.gift.id)]
    if (processedIds.length > 0) removeCartIds(processedIds)
    if (purchasedIds.length > 0) onGiftsPurchased?.(purchasedIds)

    const hasSummary = purchasedGifts.length > 0 || failedEntries.length > 0
    if (hasSummary) {
      setCheckoutResult({
        purchased: purchasedGifts,
        failed: failedEntries,
      })
      setCheckoutStatusMessage('')
    }

    setIsCheckoutProcessing(false)
    checkoutInFlight.current = false
  }

  const closeCheckoutResult = () => {
    setCheckoutResult(null)
    onClose()
  }

  return (
    <>
      <CartOverlay
        isOpen={isOpen}
        onClose={() => { if (!checkoutInFlight.current) onClose() }}
        allCartSelected={allCartSelected}
        toggleSelectAllCart={toggleSelectAllCart}
        clearCart={clearCart}
        removeSelectedFromCart={removeSelectedFromCart}
        cartGifts={cartGifts}
        selectedCartIds={selectedCartIds}
        toggleCartGift={toggleCartGift}
        removeCartGift={removeCartGift}
        selectedCartTotal={selectedCartTotal}
        onCheckoutSelected={checkoutSelectedCart}
        canCheckoutSelected={canCheckoutSelected}
        isCheckoutProcessing={isCheckoutProcessing}
        checkoutStatusMessage={checkoutStatusMessage}
      />
      <CartCheckoutResultOverlay result={checkoutResult} onClose={closeCheckoutResult} />
    </>
  )
}

export default CartFlow
