import { useRef, useState } from 'react'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import LoadError from '../../../shared/ui/LoadError.jsx'
import ScrollToTop from '../../../shared/ui/ScrollToTop.jsx'
import GiftBuyFlow from '../../gifts/components/GiftBuyFlow.jsx'
import CartFlow from '../../cart/components/CartFlow.jsx'
import CatalogGrid from '../components/CatalogGrid.jsx'
import CatalogHeader from '../components/CatalogHeader.jsx'
import FiltersFlow from '../../filters/components/FiltersFlow.jsx'
import GiftMenuFlow from '../../gifts/components/GiftMenuFlow.jsx'
import OfferCreateFlow from '../../offers/components/OfferCreateFlow.jsx'
import GiftPriceFlow from '../../gifts/components/GiftPriceFlow.jsx'
import SalesHistoryFlow from '../../sales-history/components/SalesHistoryFlow.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function CatalogPage(props) {
  return <CatalogContent key={props.authToken} {...props} />
}

function CatalogContent({ authToken, pricing, filters, catalog, cart, actions, onWalletUpdated, onOpenCatalogFilter }) {
  const { gifts, isLoading, isSearching, isLoadingMore, hasLoadedGifts, pagination, loadTriggerRef, error, retry } = catalog
  const { cartIds, setCartIds, cartGifts } = cart
  const { t } = useTranslation()
  const [isCartOpen, setIsCartOpen] = useState(false)
  const buyFlowRef = useRef(null)
  const filtersFlowRef = useRef(null)
  const giftMenuFlowRef = useRef(null)
  const offerCreateFlowRef = useRef(null)
  const priceFlowRef = useRef(null)
  const salesHistoryFlowRef = useRef(null)

  const addToCart = (giftId) => setCartIds((prev) => (prev.includes(giftId) ? prev : [...prev, giftId]))
  const removeCartGift = (giftId) => setCartIds((prev) => prev.filter((id) => id !== giftId))
  const openBuyConfirm = (gift) => buyFlowRef.current?.open(gift)
  const openOfferCreate = (gift) => offerCreateFlowRef.current?.open(gift)
  const openPriceMenu = (gift, mode) => priceFlowRef.current?.open(gift, mode)
  const cancelSale = (gift) => priceFlowRef.current?.cancelSale(gift)
  const openGiftMenu = (gift) => giftMenuFlowRef.current?.open(gift)

  return (
    <>
      <CatalogHeader
        filters={filters}
        openQuickFilter={(key) => filtersFlowRef.current?.openQuick(key)}
        openFilters={() => filtersFlowRef.current?.openAdvanced()}
        openCart={() => setIsCartOpen(true)}
        cartCount={cartGifts.length}
        openSalesHistory={() => salesHistoryFlowRef.current?.open()}
      />
      <FiltersFlow ref={filtersFlowRef} filters={filters} />
      <CartFlow
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        authToken={authToken}
        cartGifts={cartGifts}
        cartIds={cartIds}
        onCartIdsChange={setCartIds}
        onWalletUpdated={onWalletUpdated}
        onGiftsPurchased={actions.cartPurchased}
      />
      <SalesHistoryFlow ref={salesHistoryFlowRef} />
      <GiftMenuFlow
        ref={giftMenuFlowRef}
        source="catalog"
        addToCart={addToCart}
        openBuyConfirm={openBuyConfirm}
        openPriceMenu={openPriceMenu}
        openOfferCreate={openOfferCreate}
        onCancelSale={cancelSale}
        onOpenCatalogFilter={onOpenCatalogFilter}
      />
      <OfferCreateFlow ref={offerCreateFlowRef} authToken={authToken} pricing={pricing} onWalletUpdated={onWalletUpdated} />
      <GiftPriceFlow
        ref={priceFlowRef}
        authToken={authToken}
        pricing={pricing}
        onGiftListed={(result) => actions.giftListed(result, 'catalog')}
        onSaleCanceled={actions.saleCanceled}
      />
      <GiftBuyFlow ref={buyFlowRef} authToken={authToken} onWalletUpdated={onWalletUpdated} onGiftBought={actions.giftPurchased} />
      <ScrollToTop />
      {error && <LoadError onRetry={retry} />}
      {(isLoading && !hasLoadedGifts) || isSearching ? (
        <main aria-label={t('catalog.loadingLabel')}>
          <LoadingSkeleton variant="grid" count={6} />
        </main>
      ) : error && !hasLoadedGifts ? null : (
        <>
          <CatalogGrid
            gifts={gifts}
            isLoadingMore={isLoadingMore}
            openGiftMenu={openGiftMenu}
            addToCart={addToCart}
            removeCartGift={removeCartGift}
            cartIds={cartIds}
            openBuyConfirm={openBuyConfirm}
          />
          {!error && pagination.hasMore && (
            <div ref={loadTriggerRef} className="catalog-scroll-sentinel" aria-hidden="true" />
          )}
        </>
      )}
    </>
  )
}

export default CatalogPage
