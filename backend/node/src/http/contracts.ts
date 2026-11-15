export interface ApiFailure {
  ok: false
  error: string
  code: string
  request_id: string
  available_at?: string
}

export interface PurchaseRequest {
  id: string
  listing_id: string
  expected_price_nano: string | number
}

export interface GiftQuote {
  id: string
  listing_id: string | null
  price_nano: string | null
}

export interface WalletPayload {
  currency_code: string
  available_nano: string
  locked_nano: string
}

export interface TonPaymentPayload {
  id: string
  kind: 'deposit' | 'withdraw'
  status: 'pending' | 'queued' | 'broadcast' | 'completed' | 'review' | 'expired'
  amount_nano: string
  fee_nano: string
  total_nano: string
  wallet_address: string
  network: '-239' | '-3'
  tx_hash: string | null
}
