import { useCallback, useEffect, useRef, useState } from 'react'
import { getMarketConfig } from '../api/gifts.api.js'
import { isValidPricing } from '../lib/gift-price-utils.js'
import { formatGramAmount } from '../../../shared/lib/gram-amount.js'

export function useGiftMarketPricing() {
  const [marketPricing, setMarketPricing] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const activeRequest = useRef(null)
  const loadMarketPricing = useCallback(async () => {
    if (activeRequest.current && !activeRequest.current.signal.aborted) return
    const controller = new AbortController()
    activeRequest.current = controller
    setIsLoading(true)
    try {
      const response = await getMarketConfig({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      if (controller.signal.aborted) return
      const rawPricing = response.data?.pricing
      const pricing = {
        minPrice: Number(formatGramAmount(rawPricing?.min_price_nano)),
        maxPrice: Number(formatGramAmount(rawPricing?.max_price_nano)),
        marketplaceFeeBps: Number(rawPricing?.marketplace_fee_bps),
        giftWithdrawalFeeNano: /^\d+$/.test(String(rawPricing?.gift_withdrawal_fee_nano ?? ''))
          ? String(rawPricing.gift_withdrawal_fee_nano) : null,
      }
      if (!response.ok || rawPricing?.marketplace_fee_bps == null || !isValidPricing(pricing)) {
        throw new Error('Price limits unavailable')
      }
      setMarketPricing(pricing)
    } catch {
      // The price forms expose retry when no valid rules have been loaded.
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the initial request; forms expose the same callback for retry.
    void loadMarketPricing()
    return () => activeRequest.current?.abort()
  }, [loadMarketPricing])
  return { ...marketPricing, isLoading, retry: loadMarketPricing }
}
