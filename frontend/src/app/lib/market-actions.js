export function createMarketActions({
  setCatalogGifts,
  setInventoryGifts,
  setCartIds,
  refreshInventory,
  refreshCatalog,
}) {
  return {
    saleCanceled(giftId) {
      setCatalogGifts((previous) => previous.filter((item) => item.id !== giftId))
      setInventoryGifts((previous) => previous.filter((item) => item.id !== giftId))
      refreshInventory()
    },
    giftListed({ gift, mode, price, listing }, source) {
      const quote = listing ? { listing_id: listing.id, price_nano: String(listing.price_nano) } : {}
      setInventoryGifts((previous) =>
        mode === 'list'
          ? previous.filter((item) => item.id !== gift.id)
          : previous.map((item) => (item.id === gift.id ? { ...item, price, ...quote } : item))
      )
      setCatalogGifts((previous) => {
        const listed = { ...gift, price, ...quote, isOwnedByCurrentUser: true }
        if (
          source === 'inventory' &&
          mode === 'list' &&
          !previous.some((item) => item.id === gift.id)
        ) {
          return [...previous, listed]
        }
        return previous.map((item) => (item.id === gift.id ? { ...item, ...listed } : item))
      })
      refreshInventory()
      refreshCatalog()
    },
    giftPurchased(giftId) {
      setCatalogGifts((previous) => previous.filter((item) => item.id !== giftId))
      setCartIds((previous) => previous.filter((id) => id !== giftId))
      refreshInventory()
    },
    cartPurchased(giftIds) {
      const purchased = new Set(giftIds)
      setCatalogGifts((previous) => previous.filter((item) => !purchased.has(item.id)))
      refreshInventory()
    },
  }
}
