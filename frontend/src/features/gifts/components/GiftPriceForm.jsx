import { useState } from 'react'
import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import Modal from '../../../shared/ui/Modal.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { normalizePriceInput, getPriceDetails } from '../lib/gift-price-utils.js'
import GiftPriceRulesStatus from './GiftPriceRulesStatus.jsx'

/** A GRAM amount for a gift, checked against the market price rules: a listing price or an offer.
 * summaryLabel heads the seller's fee breakdown; offers omit it, as the buyer pays the amount entered,
 * and explain the offer's terms in notes instead. */
function GiftPriceForm({
  gift,
  initialAmount,
  amountLabel,
  summaryLabel,
  notes = [],
  showCurrencyInInput = false,
  submitContent,
  pricing = null,
  error = '',
  isSubmitting = false,
  onSubmit,
  onClose,
}) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState(initialAmount)
  const {
    minPrice, maxPrice, hasPricingRules, isBelowMin, isAboveMax,
    isInvalid, formattedAmount, feeAmountLabel, sellerReceiveLabel, feePercentLabel,
  } = getPriceDetails(amount, pricing)
  const cannotSubmit = isInvalid || isSubmitting
  const warning = isBelowMin ? t('price.minimum', { value: minPrice }) : isAboveMax ? t('price.maximum', { value: maxPrice }) : ''

  return (
    <Modal className="price-menu-overlay" onClose={isSubmitting ? undefined : onClose}>
      <aside className="price-menu-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="price-menu-close" onClick={onClose} aria-label={t('common.close')} disabled={isSubmitting}>
          {'\u2715'}
        </button>

        <FallbackImage src={gift.image} alt={gift.title} className="price-menu-image" />
        <p className="price-menu-title">{gift.title}</p>
        <p className="price-menu-token">{gift.numberLabel}</p>

        <div className="price-menu-input-wrap">
          {showCurrencyInInput && <span>{APP_CURRENCY}</span>}
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            disabled={isSubmitting}
            onChange={(event) => setAmount(normalizePriceInput(event.target.value))}
            aria-label={amountLabel}
          />
        </div>

        {summaryLabel && (
          <>
            <p className="price-menu-summary">{summaryLabel} {formattedAmount} {APP_CURRENCY}</p>
            <p className="price-menu-commission">
              {t('price.commission', { percent: feePercentLabel })} {feeAmountLabel} {APP_CURRENCY}
            </p>
            <p className="price-menu-commission">{t('price.receive')} {sellerReceiveLabel} {APP_CURRENCY}</p>
          </>
        )}
        {notes.length > 0 && (
          <div className="price-menu-notes">
            {notes.map((note) => <p key={note} className="price-menu-commission">{note}</p>)}
          </div>
        )}
        <GiftPriceRulesStatus pricing={pricing} hasPricingRules={hasPricingRules} />
        {warning && <p className="price-menu-commission">{warning}</p>}
        {error && <p className="price-menu-commission">{error}</p>}

        <button
          type="button"
          className={`price-menu-submit ${cannotSubmit ? 'price-menu-submit-disabled' : ''}`}
          disabled={cannotSubmit}
          onClick={() => onSubmit(formattedAmount)}
        >
          {submitContent}
        </button>
      </aside>
    </Modal>
  )
}

export default GiftPriceForm
