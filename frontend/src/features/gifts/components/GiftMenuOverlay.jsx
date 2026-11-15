import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import Modal from '../../../shared/ui/Modal.jsx'
import ActionIcon from '../../../shared/ui/ActionIcon.jsx'
import GiftLottieOverlay from './GiftLottieOverlay.jsx'
import { buildTelegramNftUrl, getRarityLabel, trimText, normalizeFilterValue } from '../lib/gift-utils.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

const attributeRows = [
  { key: 'model', label: 'common.model' },
  { key: 'background', label: 'common.background' },
  { key: 'symbol', label: 'common.pattern' },
]

const openTelegramNftLink = (gift) => {
  const url = buildTelegramNftUrl(gift)
  if (!url) return
  const telegramWebApp = window.Telegram?.WebApp
  if (typeof telegramWebApp?.openTelegramLink === 'function') {
    telegramWebApp.openTelegramLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** source: 'catalog' | 'inventory'; inventorySection: 'onSale' | 'notOnSale'. */
function GiftMenuOverlay({
  gift,
  onClose,
  source,
  inventorySection,
  addToCart,
  openBuyConfirm,
  openPriceMenu,
  openOfferCreate,
  openWithdrawConfirm,
  onCancelSale,
  onOpenCatalogFilter,
}) {
  const { t } = useTranslation()
  if (!gift) return null

  const isInventoryView = source === 'inventory'
  const isOnSaleSection = inventorySection === 'onSale'
  const canManageListing = isInventoryView || gift.isOwnedByCurrentUser === true
  const collectionName = trimText(gift.collection_name)
  const isKnown = (value) => Boolean(value) && normalizeFilterValue(value) !== 'unknown'
  const canFilterBy = (key) => Boolean(onOpenCatalogFilter) && isKnown(collectionName) &&
    isKnown(key === 'collection' ? collectionName : trimText(gift[key]))

  return (
    <Modal className="gift-menu-overlay" onClose={onClose}>
      <aside className="gift-menu-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="gift-menu-close" onClick={onClose} aria-label={t('common.close')}>
          {'\u2715'}
        </button>

        <div className="gift-menu-main">
          <div className="gift-menu-image-wrap">
            <FallbackImage src={gift.image} alt={gift.title} className="gift-menu-image" />
            <GiftLottieOverlay src={gift.lottieUrl} isActive className="gift-menu-lottie-overlay" />
          </div>
          <button
            type="button"
            className="gift-menu-name gift-menu-name-link"
            disabled={!canFilterBy('collection')}
            aria-label={`${t('common.collection')}: ${collectionName}`}
            onClick={() => onOpenCatalogFilter(gift, 'collection')}
          >
            {gift.title}
          </button>
          <p className="gift-menu-token">{gift.numberLabel}</p>
        </div>

        {gift.is_test_import && <p className="gift-test-notice">{t('giftMenu.testNotice')}</p>}

        <div className="gift-menu-table" role="table" aria-label={t('giftMenu.parameters')}>
          {attributeRows.map(({ key, label }) => {
            const rarity = getRarityLabel(key, gift)
            return (
              <div className="gift-menu-row" role="row" key={key}>
                <span className="gift-menu-label" role="cell">{t(label)}</span>
                <span className="gift-menu-value" role="cell">
                  <button
                    type="button"
                    className="gift-menu-value-link"
                    disabled={!canFilterBy(key)}
                    aria-label={`${t(label)}: ${gift[key]}`}
                    onClick={() => onOpenCatalogFilter(gift, key)}
                  >
                    {gift[key]}
                  </button>
                </span>
                {rarity && <span className="gift-menu-pill" role="cell">{rarity}</span>}
              </div>
            )
          })}
        </div>

        <div className="gift-menu-actions">
          {canManageListing ? (
            <>
              <button
                type="button"
                className="gift-menu-offer-btn"
                onClick={() => openPriceMenu(gift, isInventoryView && !isOnSaleSection ? 'list' : 'edit')}
              >
                {!isInventoryView ? t('giftMenu.edit') : isOnSaleSection ? t('giftMenu.changePrice') : t('inventory.list')}
              </button>
              <button
                type="button"
                className="gift-menu-buy-btn"
                onClick={() => (isInventoryView && !isOnSaleSection ? openWithdrawConfirm(gift) : onCancelSale(gift))}
              >
                {isInventoryView && !isOnSaleSection ? t('withdrawGift.withdraw') : t('giftMenu.cancelSale')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="gift-menu-offer-btn" onClick={() => openOfferCreate(gift)}>
                {t('giftMenu.offer')}
              </button>
              <button type="button" className="gift-menu-buy-btn" onClick={() => openBuyConfirm(gift)}>
                {gift.price} {APP_CURRENCY}
              </button>
            </>
          )}
        </div>

        <div className={`gift-menu-share ${canManageListing ? 'gift-menu-share-single' : ''}`.trim()}>
          <button
            type="button"
            className={`gift-menu-icon-btn ${canManageListing ? 'gift-menu-icon-btn-center' : ''}`.trim()}
            aria-label={t('giftMenu.send')}
            onClick={() => openTelegramNftLink(gift)}
          >
            {'✈'}
          </button>
          {!canManageListing && (
            <button type="button" className="gift-menu-add-btn" onClick={() => addToCart(gift.id)}>
              {t('giftMenu.addToCart')} <ActionIcon name="cart" size={18} />
            </button>
          )}
        </div>
      </aside>
    </Modal>
  )
}

export default GiftMenuOverlay
