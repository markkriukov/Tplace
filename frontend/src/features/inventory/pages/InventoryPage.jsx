import { useRef, useState } from 'react'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import LoadError from '../../../shared/ui/LoadError.jsx'
import ScrollToTop from '../../../shared/ui/ScrollToTop.jsx'
import CartFlow from '../../cart/components/CartFlow.jsx'
import FiltersFlow from '../../filters/components/FiltersFlow.jsx'
import GiftMenuFlow from '../../gifts/components/GiftMenuFlow.jsx'
import InventoryGrid from '../components/InventoryGrid.jsx'
import InventoryHeader from '../components/InventoryHeader.jsx'
import GiftPriceFlow from '../../gifts/components/GiftPriceFlow.jsx'
import InventoryWithdrawFlow from '../components/InventoryWithdrawFlow.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function InventoryPage(props) {
  return <InventoryContent key={props.authToken} {...props} />
}

function InventoryContent({ authToken, pricing, filters, inventory, cart, actions, onWalletUpdated, onOpenCatalogFilter }) {
  const {
    gifts, isLoading, isSearching, isLoadingMore, hasLoadedGifts, pagination, loadTriggerRef, error, retry,
    inventorySection, setInventorySection, inventorySummary, refreshInventory,
  } = inventory
  const { cartIds, setCartIds, cartGifts } = cart
  const { t } = useTranslation()
  const [isCartOpen, setIsCartOpen] = useState(false)
  const filtersFlowRef = useRef(null)
  const giftMenuFlowRef = useRef(null)
  const priceFlowRef = useRef(null)
  const withdrawFlowRef = useRef(null)

  const openGiftMenu = (gift) => giftMenuFlowRef.current?.open(gift)
  const openPriceMenu = (gift, mode) => priceFlowRef.current?.open(gift, mode)
  const openWithdrawConfirm = (gift) => withdrawFlowRef.current?.open(gift)
  const cancelSale = (gift) => priceFlowRef.current?.cancelSale(gift)

  return (
    <>
      <InventoryHeader
        filters={filters}
        openQuickFilter={(key) => filtersFlowRef.current?.openQuick(key)}
        openFilters={() => filtersFlowRef.current?.openAdvanced()}
        openCart={() => setIsCartOpen(true)}
        cartCount={cartGifts.length}
        inventorySection={inventorySection}
        setInventorySection={setInventorySection}
        inventorySummary={inventorySummary}
      />
      <FiltersFlow ref={filtersFlowRef} filters={filters} quantityLabel={t('filters.inStock')} />
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
      <GiftMenuFlow
        ref={giftMenuFlowRef}
        source="inventory"
        inventorySection={inventorySection}
        openPriceMenu={openPriceMenu}
        openWithdrawConfirm={openWithdrawConfirm}
        onCancelSale={cancelSale}
        onOpenCatalogFilter={onOpenCatalogFilter}
      />
      <GiftPriceFlow
        ref={priceFlowRef}
        authToken={authToken}
        pricing={pricing}
        onGiftListed={(result) => actions.giftListed(result, 'inventory')}
        onSaleCanceled={actions.saleCanceled}
      />
      <InventoryWithdrawFlow
        ref={withdrawFlowRef}
        authToken={authToken}
        feeNano={pricing.giftWithdrawalFeeNano}
        onWalletUpdated={onWalletUpdated}
        onQueued={refreshInventory}
        onWithdrawn={() => { giftMenuFlowRef.current?.close(); refreshInventory() }}
      />
      <ScrollToTop />
      {error && <LoadError onRetry={retry} />}
      {(isLoading && !hasLoadedGifts) || isSearching ? (
        <main aria-label={t('inventory.loadingLabel')}>
          <LoadingSkeleton variant="grid" count={6} />
        </main>
      ) : error && !hasLoadedGifts ? null : (
        <>
          <InventoryGrid
            gifts={gifts}
            isLoadingMore={isLoadingMore}
            openGiftMenu={openGiftMenu}
            inventorySection={inventorySection}
            openPriceMenu={openPriceMenu}
            openWithdrawConfirm={openWithdrawConfirm}
            onCancelSale={cancelSale}
          />
          {!error && pagination.hasMore && (
            <div ref={loadTriggerRef} className="catalog-scroll-sentinel" aria-hidden="true" />
          )}
        </>
      )}
      <div className="inventory-page-end" aria-hidden="true" />
    </>
  )
}

export default InventoryPage
