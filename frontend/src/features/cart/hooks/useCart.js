import { useState, useMemo, useCallback } from 'react'
import { selectCartEntries } from '../lib/cart-state.js'
const EMPTY_CART = []
export function useCart({ authToken, gifts, catalogGifts, inventoryGifts }) {
  const [state, setState] = useState(() => ({ token: authToken, gifts: [] }))
  if (state.token !== authToken) setState({ token: authToken, gifts: [] })
  const cartGifts = state.token === authToken ? state.gifts : EMPTY_CART
  const pooled = useMemo(() => [...inventoryGifts, ...catalogGifts, ...gifts], [gifts, catalogGifts, inventoryGifts])
  const setCartIds = useCallback(update => setState(previous => previous.token === authToken
    ? { token: authToken, gifts: selectCartEntries(previous.gifts, update, pooled) }
    : previous), [authToken, pooled])
  const cartIds = useMemo(() => cartGifts.map(gift => gift.id), [cartGifts])
  return { cartIds, setCartIds, cartGifts }
}
