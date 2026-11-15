import Modal from '../../../shared/ui/Modal.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function CartCheckoutResultOverlay({ result, onClose }) {
  const { t } = useTranslation()
  if (!result) return null

  const purchased = Array.isArray(result.purchased) ? result.purchased : []
  const failed = Array.isArray(result.failed) ? result.failed : []

  return (
    <Modal className="cart-checkout-result-overlay" onClose={onClose}>
      <aside className="cart-checkout-result-panel" onClick={(event) => event.stopPropagation()}>
        <div className="cart-checkout-result-header">
          <h3 className="cart-checkout-result-title">{t('cart.summary')}</h3>
          <button
            type="button"
            className="cart-checkout-result-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            {'\u2715'}
          </button>
        </div>

        <div className="cart-checkout-result-group">
          <p className="cart-checkout-result-group-title">
            {t('cart.purchased', { count: purchased.length })}
          </p>
          {purchased.length === 0 && (
            <p className="cart-checkout-result-empty">{t('common.none')}</p>
          )}
          {purchased.map((gift) => (
            <p
              className="cart-checkout-result-line cart-checkout-result-line-success"
              key={`ok-${gift.id}`}
            >
              {'\u2713'} {gift.title} {gift.numberLabel}
            </p>
          ))}
        </div>

        <div className="cart-checkout-result-group">
          <p className="cart-checkout-result-group-title">
            {t('cart.failed', { count: failed.length })}
          </p>
          {failed.length === 0 && <p className="cart-checkout-result-empty">{t('common.none')}</p>}
          {failed.map((item) => (
            <p
              className="cart-checkout-result-line cart-checkout-result-line-error"
              key={`fail-${item.gift?.id ?? item.error}`}
            >
              ! {item.gift?.title} {item.gift?.numberLabel}: {item.error}
            </p>
          ))}
        </div>

        <button type="button" className="cart-checkout-result-btn" onClick={onClose}>
          {t('common.ok')}
        </button>
      </aside>
    </Modal>
  )
}

export default CartCheckoutResultOverlay
