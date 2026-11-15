import { APP_CURRENCY } from '../../../shared/config/currency.js'
import GiftCard from '../../gifts/components/GiftCard.jsx'
import ActionIcon from '../../../shared/ui/ActionIcon.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { GiftSkeletonCards } from '../../../shared/ui/LoadingSkeleton.jsx'
import { useMemo } from 'react'

function CatalogGrid({
  gifts,
  isLoadingMore = false,
  openGiftMenu,
  addToCart,
  removeCartGift,
  cartIds,
  openBuyConfirm,
}) {
  const { t } = useTranslation()
  const cartIdSet = useMemo(() => new Set(cartIds), [cartIds])

  return (
    <main className="catalog" aria-label={t('nav.catalog')} aria-busy={isLoadingMore || undefined}>
      {gifts.map((gift, index) => {
        const isInCart = cartIdSet.has(gift.id)

        return (
          <GiftCard
            key={gift.id}
            gift={gift}
            index={index}
            onOpen={openGiftMenu}
            meta={<p className="gift-id">{gift.numberLabel}</p>}
          >
            <div className="action-row">
              <button
                type="button"
                className="buy-btn"
                onClick={() =>
                  gift.isOwnedByCurrentUser ? openGiftMenu(gift) : openBuyConfirm(gift)
                }
              >
                {gift.price} {APP_CURRENCY}
              </button>
              {!gift.isOwnedByCurrentUser && (
                <button
                  type="button"
                  className="cart-btn"
                  aria-label={isInCart ? t('cart.remove', { name: gift.title }) : t('giftMenu.addToCart')}
                  onClick={() => (isInCart ? removeCartGift(gift.id) : addToCart(gift.id))}
                >
                  {isInCart ? '\u{1F5D1}' : <ActionIcon name="cart" size={18} />}
                </button>
              )}
            </div>
          </GiftCard>
        )
      })}
      {isLoadingMore && <GiftSkeletonCards count={2} />}
    </main>
  )
}

export default CatalogGrid
