import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import Modal from '../../../shared/ui/Modal.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function GiftBuyConfirmOverlay({ gift, onClose, onConfirm }) {
  const { t } = useTranslation()
  if (!gift) return null

  return (
    <Modal className="buy-confirm-overlay" onClose={onClose}>
      <aside className="buy-confirm-panel" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="buy-confirm-close"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          {'\u2715'}
        </button>

        <FallbackImage src={gift.image} alt={gift.title} className="buy-confirm-image" />
        <p className="buy-confirm-title">{gift.title}</p>
        <p className="buy-confirm-token">{gift.numberLabel}</p>

        <p className="buy-confirm-text">{t('buy.confirm', { price: gift.price, currency: APP_CURRENCY })}</p>

        <button type="button" className="buy-confirm-btn" onClick={onConfirm}>
          {t('buy.buy')}
        </button>
      </aside>
    </Modal>
  )
}

export default GiftBuyConfirmOverlay
