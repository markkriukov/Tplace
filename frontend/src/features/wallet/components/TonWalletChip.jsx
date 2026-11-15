import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import {
  useIsConnectionRestored,
  useTonAddress,
  useTonConnectUI,
  useTonWallet,
} from '@tonconnect/ui-react'

import { shortenTonAddress } from '../lib/wallet-transfer.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function TonWalletChip({ className = 'tx-wallet-chip', onError }) {
  const { t } = useTranslation()
  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()
  const address = useTonAddress()
  const isConnectionRestored = useIsConnectionRestored()

  const openWalletModal = async () => {
    if (wallet || !isConnectionRestored) return
    try {
      await tonConnectUI.openModal()
    } catch {
      onError?.()
    }
  }

  const label = !isConnectionRestored
    ? t('wallet.restoring')
    : wallet && address
      ? `◉ ${shortenTonAddress(address)}`
      : t('wallet.connectTon')

  return (
    <button
      type="button"
      className={className}
      onClick={openWalletModal}
      disabled={!isConnectionRestored}
      aria-label={wallet && address ? t('wallet.connected', { address }) : t('wallet.connectTon')}
    >
      {!isConnectionRestored ? <LoadingSkeleton variant="inline" label={t('wallet.restoring')} /> : label}
    </button>
  )
}

export default TonWalletChip
