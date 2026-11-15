import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { createOffer } from '../api/offers.api.js'
import { useRequestSignal } from '../../../shared/hooks/useRequestSignal.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import ResultDialog from '../../../shared/ui/ResultDialog.jsx'
import GiftPriceForm from '../../gifts/components/GiftPriceForm.jsx'

// These codes all mean the gift cannot take offers right now.
const UNAVAILABLE_GIFT_CODES = new Set(['NOT_FOUND', 'GIFT_OWNER_NOT_FOUND', 'GIFT_UNAVAILABLE', 'GIFT_BLOCKED', 'WITHDRAWAL_IN_PROGRESS'])

const OfferCreateFlow = forwardRef(function OfferCreateFlow({ authToken, pricing, onWalletUpdated }, ref) {
  const { t } = useTranslation()
  const [gift, setGift] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)
  const inFlight = useRef(false)
  const getRequestSignal = useRequestSignal()

  useImperativeHandle(ref, () => ({
    open(nextGift) {
      if (!nextGift || inFlight.current) return
      setError('')
      setGift(nextGift)
    },
  }), [])

  // Server messages are English only, so failures are shown by their code.
  const failureText = (code) => {
    const key = `offer.error.${UNAVAILABLE_GIFT_CODES.has(code) ? 'GIFT_UNAVAILABLE' : code}`
    const translated = t(key)
    return translated === key ? t('offer.sendFailed') : translated
  }

  const close = () => {
    if (inFlight.current) return
    setGift(null)
    setError('')
  }

  const submit = async (amount) => {
    if (!gift?.id || inFlight.current) return
    if (!authToken) {
      setError(t('common.authMissing'))
      return
    }

    inFlight.current = true
    const signal = getRequestSignal()
    setIsSubmitting(true)
    setError('')
    try {
      const response = await createOffer(gift.id, amount, { token: authToken, signal })
      if (signal.aborted) return
      const payload = response.data
      if (!response.ok || !payload?.ok) {
        setError(failureText(payload?.code))
        return
      }
      if (payload.wallet) onWalletUpdated?.(payload.wallet)
      setGift(null)
      setSent({ gift, amount })
    } catch {
      if (signal.aborted) return
      setError(t('offer.sendFailed'))
    } finally {
      inFlight.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {gift && (
        <GiftPriceForm
          key={gift.id}
          gift={gift}
          initialAmount={String(gift.price ?? '')}
          amountLabel={t('offer.amount')}
          notes={[t('offer.ownerReceivesNote'), t('offer.fundsHeldNote')]}
          showCurrencyInInput
          submitContent={isSubmitting ? <LoadingSkeleton variant="inline" label={t('offer.sending')} /> : t('offer.send')}
          pricing={pricing}
          error={error}
          isSubmitting={isSubmitting}
          onSubmit={submit}
          onClose={close}
        />
      )}
      {sent && (
        <ResultDialog
          variant="price-result"
          isSuccess
          title={t('offer.sent')}
          text={`${sent.gift.title} ${sent.gift.numberLabel}: ${sent.amount} ${APP_CURRENCY}`}
          onClose={() => setSent(null)}
        />
      )}
    </>
  )
})

export default OfferCreateFlow
