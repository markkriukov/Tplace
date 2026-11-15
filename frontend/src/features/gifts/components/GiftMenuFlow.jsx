import { forwardRef, useImperativeHandle, useState } from 'react'
import GiftMenuOverlay from './GiftMenuOverlay.jsx'

/** The gift description menu. A chosen action closes it before it runs;
 * actions a page does not offer may be omitted. */
const GiftMenuFlow = forwardRef(function GiftMenuFlow({
  source,
  inventorySection,
  addToCart,
  openBuyConfirm,
  openPriceMenu,
  openOfferCreate,
  openWithdrawConfirm,
  onCancelSale,
  onOpenCatalogFilter,
}, ref) {
  const [gift, setGift] = useState(null)

  useImperativeHandle(ref, () => ({
    open: (nextGift) => setGift(nextGift),
    close: () => setGift(null),
  }), [])

  const closing = (action) => action && ((menuGift, ...args) => {
    setGift(null)
    action(menuGift, ...args)
  })

  return (
    <GiftMenuOverlay
      gift={gift}
      onClose={() => setGift(null)}
      source={source}
      inventorySection={inventorySection}
      addToCart={addToCart}
      openBuyConfirm={closing(openBuyConfirm)}
      openPriceMenu={closing(openPriceMenu)}
      openOfferCreate={closing(openOfferCreate)}
      openWithdrawConfirm={closing(openWithdrawConfirm)}
      onCancelSale={closing(onCancelSale)}
      onOpenCatalogFilter={closing(onOpenCatalogFilter)}
    />
  )
})

export default GiftMenuFlow
