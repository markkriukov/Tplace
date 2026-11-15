import { APP_CURRENCY } from '../../../shared/config/currency.js'
import GiftCard from '../../gifts/components/GiftCard.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { GiftSkeletonCards } from '../../../shared/ui/LoadingSkeleton.jsx'

function InventoryGrid({
  gifts,
  isLoadingMore = false,
  openGiftMenu,
  inventorySection,
  openPriceMenu,
  openWithdrawConfirm,
  onCancelSale,
}) {
  const { t } = useTranslation()
  const isOnSale = inventorySection === 'onSale'

  return (
    <main className="catalog" aria-label={t('nav.inventory')} aria-busy={isLoadingMore || undefined}>
      {gifts.map((gift, index) => {
        return (
          <GiftCard
            key={gift.id}
            gift={gift}
            index={index}
            onOpen={openGiftMenu}
            meta={
              <div className="inventory-meta-row">
                <p className="gift-id">{gift.numberLabel}</p>
                {isOnSale && (
                  <p className="inventory-listed-price">
                    {gift.price} {APP_CURRENCY}
                  </p>
                )}
              </div>
            }
          >
            <div className="action-row">
              <button
                type="button"
                className={`buy-btn inventory-main-btn ${isOnSale ? 'inventory-cancel-btn' : 'inventory-list-btn'}`}
                onClick={!isOnSale ? () => openPriceMenu(gift, 'list') : () => onCancelSale(gift)}
              >
                {isOnSale ? t('inventory.cancelListing') : t('inventory.list')}
              </button>
              <button
                type="button"
                className="cart-btn inventory-icon-btn"
                aria-label={isOnSale ? t('inventory.editPrice') : t('inventory.withdrawGift')}
                onClick={
                  isOnSale ? () => openPriceMenu(gift, 'edit') : () => openWithdrawConfirm(gift)
                }
              >
                {isOnSale ? '\u270e' : '\u21ea'}
              </button>
            </div>
          </GiftCard>
        )
      })}
      {isLoadingMore && <GiftSkeletonCards count={2} />}
    </main>
  )
}

export default InventoryGrid
