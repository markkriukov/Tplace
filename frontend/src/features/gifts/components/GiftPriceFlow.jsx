import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { cancelGiftListing, listGift } from '../api/gifts.api.js'
import { useRequestSignal } from '../../../shared/hooks/useRequestSignal.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import GiftPriceActionResultOverlay from './GiftPriceActionResultOverlay.jsx'
import GiftPriceForm from './GiftPriceForm.jsx'

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A listing the purchase flow can later confirm exactly: its public ID and nano price. */
const isListing = (listing) => UUIDV7.test(String(listing?.id ?? '')) &&
  /^[1-9]\d*$/.test(String(listing?.price_nano ?? '')) && BigInt(listing.price_nano) <= BigInt(Number.MAX_SAFE_INTEGER)

/** mode: 'list' a gift for sale or 'edit' its price; cancelSale withdraws a listing. */
const GiftPriceFlow = forwardRef(function GiftPriceFlow({ authToken, pricing, onGiftListed, onSaleCanceled }, ref) {
  const { t } = useTranslation()
  const [menuConfig, setMenuConfig] = useState(null)
  const [actionResult, setActionResult] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionInFlight = useRef(false)
  const getRequestSignal = useRequestSignal()

  useImperativeHandle(ref, () => ({
    open(gift, mode) {
      if (submissionInFlight.current) return
      setMenuConfig({ gift, mode })
    },
    async cancelSale(gift) {
      if (!gift?.id || submissionInFlight.current) return
      submissionInFlight.current = true
      setIsSubmitting(true)
      const signal = getRequestSignal()
      try {
        if (!authToken) throw new Error('Authentication required')
        const response = await cancelGiftListing(gift.id, { token: authToken, signal })
        if (signal.aborted) return
        if (!response.ok || response.data?.ok !== true) throw new Error('Sale cancellation failed')
        onSaleCanceled?.(gift.id)
      } catch {
        if (signal.aborted) return
        setActionResult({ status: 'error', gift, mode: 'cancel' })
      } finally {
        submissionInFlight.current = false
        setIsSubmitting(false)
      }
    },
  }), [authToken, onSaleCanceled, getRequestSignal])

  const closeMenu = () => {
    if (!submissionInFlight.current) setMenuConfig(null)
  }

  const submit = async (price) => {
    if (submissionInFlight.current || !menuConfig) return
    const { gift, mode } = menuConfig
    if (!authToken) {
      setMenuConfig(null)
      setActionResult({ status: 'error', gift, mode, price })
      return
    }

    submissionInFlight.current = true
    setIsSubmitting(true)
    let status = 'error'
    const signal = getRequestSignal()
    try {
      const response = await listGift(gift.id, price, { token: authToken, signal })
      if (signal.aborted) return
      const listing = response.data?.listing
      if (response.ok && response.data?.ok === true && isListing(listing)) {
        status = 'success'
        onGiftListed?.({ gift, mode, price, listing })
      }
    } catch {
      status = 'error'
    } finally {
      submissionInFlight.current = false
      setIsSubmitting(false)
    }

    if (signal.aborted) return
    setMenuConfig(null)
    setActionResult({ status, gift, mode, price })
  }

  return (
    <>
      {menuConfig?.gift && (
        <GiftPriceForm
          key={`${menuConfig.gift.id}-${menuConfig.mode}`}
          gift={menuConfig.gift}
          initialAmount={menuConfig.gift.price}
          amountLabel={t('common.price')}
          summaryLabel={t('price.total')}
          submitContent={isSubmitting ? t('common.saving') : t(menuConfig.mode === 'edit' ? 'price.save' : 'inventory.list')}
          pricing={pricing}
          isSubmitting={isSubmitting}
          onSubmit={submit}
          onClose={closeMenu}
        />
      )}
      <GiftPriceActionResultOverlay result={actionResult} onClose={() => setActionResult(null)} />
    </>
  )
})

export default GiftPriceFlow
