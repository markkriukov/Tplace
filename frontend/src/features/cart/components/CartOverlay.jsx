import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import Modal from '../../../shared/ui/Modal.jsx'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function CartOverlay({
  isOpen,
  onClose,
  allCartSelected,
  toggleSelectAllCart,
  clearCart,
  removeSelectedFromCart,
  cartGifts,
  selectedCartIds,
  toggleCartGift,
  removeCartGift,
  selectedCartTotal,
  onCheckoutSelected,
  canCheckoutSelected,
  isCheckoutProcessing,
  checkoutStatusMessage,
}) {
  const { t } = useTranslation()
  if (!isOpen) return null
  const isCartEmpty = cartGifts.length === 0
  const selectedCartIdSet = new Set(selectedCartIds)

  return (
    <Modal className="cart-overlay" onClose={onClose}>
      <aside className="cart-panel" onClick={(event) => event.stopPropagation()}>
        <div className="cart-head">
          <h3 className="cart-title">{t('cart.title')}</h3>
          <button
            type="button"
            className="cart-close-btn"
            disabled={isCheckoutProcessing}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            {'\u2715'}
          </button>
        </div>

        <div className="cart-actions">
          <button
            type="button"
            className={`cart-check ${allCartSelected ? 'cart-check-active' : ''}`}
            onClick={toggleSelectAllCart}
            disabled={isCartEmpty || isCheckoutProcessing}
            aria-label={t('cart.selectAll')}
          />
          <button
            type="button"
            className="cart-link"
            onClick={toggleSelectAllCart}
            disabled={isCartEmpty || isCheckoutProcessing}
          >
            {t('cart.selectAll')}
          </button>
          <button type="button" className="cart-clear" onClick={clearCart} disabled={isCheckoutProcessing}>
            {t('cart.clearAll')}
          </button>
          <button
            type="button"
            className="cart-trash"
            onClick={removeSelectedFromCart}
            disabled={isCheckoutProcessing}
            aria-label={t('cart.removeSelected')}
          >
            {'\u{1F5D1}'}
          </button>
        </div>

        <div className="cart-list">
          {cartGifts.map((gift) => (
            <article className="cart-item" key={`cart-${gift.id}`}>
              <button
                type="button"
                className={`cart-check ${selectedCartIdSet.has(gift.id) ? 'cart-check-active' : ''}`}
                onClick={() => toggleCartGift(gift.id)}
                disabled={isCheckoutProcessing}
                aria-label={t('cart.selectGift')}
              />

              <FallbackImage src={gift.image} alt={gift.title} className="cart-item-image" />

              <div className="cart-item-info">
                <p className="cart-item-name">{gift.title}</p>
                <p className="cart-item-id">{gift.numberLabel}</p>
                <p className="cart-item-price">
                  {gift.price} {APP_CURRENCY}
                </p>
              </div>

              <button
                type="button"
                className="cart-trash"
                onClick={() => removeCartGift(gift.id)}
                disabled={isCheckoutProcessing}
                aria-label={t('cart.remove', { name: gift.title })}
              >
                {'\u{1F5D1}'}
              </button>
            </article>
          ))}
        </div>

        <div className="cart-bottom">
          {checkoutStatusMessage && <p className="cart-status-message">{checkoutStatusMessage}</p>}
          <button
            type="button"
            className="cart-buy-btn"
            onClick={onCheckoutSelected}
            disabled={!canCheckoutSelected || isCheckoutProcessing}
          >
            {isCheckoutProcessing ? <LoadingSkeleton variant="inline" label={t('cart.checkingOut')} /> : `${selectedCartTotal} ${APP_CURRENCY}`}
          </button>
        </div>
      </aside>
    </Modal>
  )
}

export default CartOverlay
