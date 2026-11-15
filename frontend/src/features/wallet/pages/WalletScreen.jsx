import WalletTonConnectRoot from '../components/WalletTonConnectRoot.jsx'
import WalletPage from './WalletPage.jsx'
import { useWalletScreen } from '../hooks/useWalletScreen.js'
import { useWalletTransfer } from '../hooks/useWalletTransfer.js'

const manifestUrl = String(import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? '').trim() ||
  `${new URL('/tonconnect-manifest.json', String(import.meta.env.VITE_TONCONNECT_APP_URL ?? '').trim() || window.location.origin)}?v=2`
const twaReturnUrl = String(import.meta.env.VITE_TONCONNECT_TWA_RETURN_URL ?? '').trim()

// Loaded on the first wallet visit. Keep the provider mounted across navigation
// so connection restoration and wallet subscriptions only initialize once.
function WalletScreen({ isActive, ...props }) {
  return <WalletTonConnectRoot manifestUrl={manifestUrl} twaReturnUrl={twaReturnUrl}>
    <WalletScreenContent key={props.authToken || 'anonymous'} isActive={isActive} {...props} />
  </WalletTonConnectRoot>
}

function WalletScreenContent({ isActive, ...props }) {
  const screen = useWalletScreen(props)
  const transferOptions = {
    authToken: props.authToken,
    onWalletUpdated: screen.handleWalletUpdated,
    beginWalletRead: props.beginWalletRead,
    onPaymentCompleted: props.onWalletTransactionsRefresh,
    availableNano: props.availableNano,
  }
  const deposit = useWalletTransfer({
    ...transferOptions, kind: 'deposit', isActive: isActive && screen.activeWalletView === 'deposit',
  })
  const withdrawal = useWalletTransfer({
    ...transferOptions, kind: 'withdraw', isActive: isActive && screen.activeWalletView === 'withdraw',
  })

  return isActive ? <WalletPage {...props} screen={screen} deposit={deposit} withdrawal={withdrawal} /> : null
}

export default WalletScreen
