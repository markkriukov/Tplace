/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Modal from '../../../src/shared/ui/Modal.jsx'
import { useCart } from '../../../src/features/cart/hooks/useCart.js'
import { useWallet } from '../../../src/features/wallet/hooks/useWallet.js'
import LanguageProvider from '../../../src/shared/i18n/LanguageProvider.jsx'
import { useTranslation } from '../../../src/shared/i18n/useTranslation.js'
import WalletStatus from '../../../src/features/wallet/components/WalletStatus.jsx'
import InventoryWithdrawFlow from '../../../src/features/inventory/components/InventoryWithdrawFlow.jsx'
import GiftMenuFlow from '../../../src/features/gifts/components/GiftMenuFlow.jsx'
import { useRef } from 'react'
import { useMarketplace } from '../../../src/app/hooks/useMarketplace.js'
import InventoryPage from '../../../src/features/inventory/pages/InventoryPage.jsx'
import CatalogPage from '../../../src/features/catalog/pages/CatalogPage.jsx'
import ProfilePage from '../../../src/features/profile/pages/ProfilePage.jsx'
import { useProfileStats } from '../../../src/features/profile/hooks/useProfileStats.js'
import { useInventory } from '../../../src/features/inventory/hooks/useInventory.js'
import GiftBuyFlow from '../../../src/features/gifts/components/GiftBuyFlow.jsx'
import CartFlow from '../../../src/features/cart/components/CartFlow.jsx'
import ProfileSettingsPage from '../../../src/features/profile/pages/ProfileSettingsPage.jsx'
import NewsPage from '../../../src/features/news/pages/NewsPage.jsx'
import { useNews } from '../../../src/features/news/hooks/useNews.js'
import { useNewsEditor } from '../../../src/features/news/hooks/useNewsEditor.js'
import { useAuth } from '../../../src/features/auth/hooks/useAuth.js'
import WalletTransferPage from '../../../src/features/wallet/pages/WalletTransferPage.jsx'
import { useWalletTransfer } from '../../../src/features/wallet/hooks/useWalletTransfer.js'
import WalletTonConnectRoot from '../../../src/features/wallet/components/WalletTonConnectRoot.jsx'
import '../../../src/styles/index.css'

const gift = { id: 1, title: 'Test gift', price_nano: '1000000001', listing_id: 2 }
function Fixture() {
  const { t, language } = useTranslation()
  const [open, setOpen] = useState(false)
  const [filtered, setFiltered] = useState(false)
  const cart = useCart({ gifts: filtered ? [] : [gift], catalogGifts: [], inventoryGifts: [] })
  const wallet = useWallet({ t, language, authToken: 'test-token', isWalletView: true, isProfileView: false })
  const withdraw = useRef(null)
  return <>
    <button onClick={() => setOpen(true)}>Open dialog</button>
    {open && <Modal onClose={() => setOpen(false)}><h2>Test dialog</h2><button>First</button><button onClick={() => setOpen(false)}>Last</button></Modal>}
    <button onClick={() => cart.setCartIds([1])}>Add gift</button>
    <button onClick={() => setFiltered(true)}>Filter gifts</button>
    <output aria-label="Cart count">{cart.cartGifts.length}</output>
    <output aria-label="Balance">{wallet.walletBalance}</output>
    <button onClick={() => wallet.applyWalletPayload({ available_nano: '500000001', currency_code: 'GRAM' })}>Apply purchase balance</button>
    <output aria-label="History count">{wallet.recentWalletActions.length}</output>
    <WalletStatus error={wallet.walletError} hasMore={wallet.hasMoreTransactions} loading={wallet.isWalletTransactionsLoading} onMore={wallet.loadMoreTransactions} onRetry={wallet.retryWallet} />
    <button onClick={() => withdraw.current.open(gift)}>Withdraw gift</button>
    <InventoryWithdrawFlow ref={withdraw} feeNano="250000000" />
  </>
}
function InventoryFixture() {
  const { t } = useTranslation()
  const [isInventoryView, setIsInventoryView] = useState(true)
  const market = useMarketplace({ isCatalogView: !isInventoryView, isInventoryView, authToken: 'test-token', t })
  const Page = isInventoryView ? InventoryPage : CatalogPage
  const openCatalogForGiftAttribute = (gift, key) => {
    if (market.filterCatalogByGiftAttribute(gift, key)) setIsInventoryView(false)
  }
  return <>
    <button onClick={() => setIsInventoryView(!isInventoryView)}>Switch page</button>
    <Page authToken="test-token" {...market} onOpenCatalogFilter={openCatalogForGiftAttribute} />
  </>
}
function ProfileFixture() {
  const [visible, setVisible] = useState(false)
  const [authToken, setAuthToken] = useState('profile-user-one')
  const profileStats = useProfileStats({ authToken, isProfileView: visible })
  return <>
    <button onClick={() => setVisible(value => !value)}>Switch profile</button>
    <button onClick={() => setAuthToken('profile-user-two')}>Switch account</button>
    {visible && <ProfilePage profileStats={profileStats} authToken={authToken} telegramDisplayName="@tester" telegramInitial="T" balanceLabel="1 GRAM" isHistoryReady />}
  </>
}
function InventorySessionFixture() {
  const [authToken, setAuthToken] = useState('user-a')
  const [query, setQuery] = useState('')
  const { setInventorySection, retryInventory, refreshInventory, inventoryGifts, inventorySummary, hasLoadedInventoryGifts, inventoryError, inventoryLoadTriggerRef } = useInventory({ authToken, searchCriteriaKey: JSON.stringify({ q: query }), isInventoryView: true })
  return <>
    <button onClick={() => setAuthToken('user-b')}>Switch account</button>
    <button onClick={() => setAuthToken('')}>Log out</button>
    <button onClick={() => setAuthToken('user-a')}>Return to A</button>
    <button onClick={() => setQuery('changed')}>Change filter</button>
    <button onClick={() => setInventorySection('notOnSale')}>Change section</button>
    <button onClick={retryInventory}>Retry inventory</button>
    <button onClick={refreshInventory}>Refresh inventory</button>
    <output aria-label="Gift ids">{inventoryGifts.map(gift => gift.id).join(',')}</output>
    <output aria-label="Inventory summary">{JSON.stringify(inventorySummary)}</output>
    <output aria-label="Loaded">{String(hasLoadedInventoryGifts)}</output>
    <output aria-label="Error">{inventoryError ?? ''}</output>
    <div ref={inventoryLoadTriggerRef} style={{ height: 1 }} />
  </>
}
function PurchaseFixture() {
  const buy = useRef(null)
  const [cartOpen, setCartOpen] = useState(false)
  const gifts = fixtureParams.has('mixed') ? [
    gift,
    { ...gift, id: 2, title: 'Own gift', price_nano: '2000000000', listing_id: 4, isOwnedByCurrentUser: true },
    { ...gift, id: 3, title: 'Deselected gift', price_nano: '3000000000', listing_id: 5 },
    { ...gift, id: 4, title: 'Unavailable gift', price_nano: '4000000000', listing_id: 6 },
  ] : [gift]
  const [ids, setIds] = useState(() => gifts.map(gift => gift.id))
  const [purchased, setPurchased] = useState([])
  return <>
    <button onClick={() => buy.current.open(gift)}>Buy fixture gift</button>
    <button onClick={() => buy.current.open({ ...gift, id: 2, title: 'Second gift' })}>Buy second gift</button>
    <button onClick={() => setCartOpen(true)}>Open fixture cart</button>
    <output aria-label="Purchased ids">{purchased.join(',')}</output>
    <GiftBuyFlow ref={buy} authToken="buyer" onGiftBought={id => setPurchased([id])} />
    <CartFlow isOpen={cartOpen} onClose={() => setCartOpen(false)} authToken="buyer"
      cartGifts={gifts.filter(gift => ids.includes(gift.id))} cartIds={ids} onCartIdsChange={setIds} onGiftsPurchased={setPurchased} />
  </>
}
const fixtureParams = new URLSearchParams(window.location.search)
function ImportFixture() {
  const [completed, setCompleted] = useState(0)
  const [token, setToken] = useState('admin-one')
  return <>
    <button onClick={() => setToken('admin-two')}>Switch import account</button>
    <ProfileSettingsPage authToken={token} isAdmin={!fixtureParams.has('ordinary')} onGiftsImported={() => setCompleted(value => value + 1)} />
    <output aria-label="Import refreshes">{completed}</output>
  </>
}
function WithdrawFixture() {
  const flow = useRef(null)
  const menu = useRef(null)
  const [withdrawn, setWithdrawn] = useState(false)
  const [withdrawalWallet, setWithdrawalWallet] = useState(null)
  const gift = { id: 123, title: 'Test gift', numberLabel: '#1', is_test_import: !fixtureParams.has('ordinary') }
  return <>
    <button onClick={() => flow.current.open(gift)}>Open withdrawal</button>
    <button onClick={() => menu.current.open(gift)}>Open gift description</button>
    <GiftMenuFlow ref={menu} source="inventory" inventorySection="unlisted" openWithdrawConfirm={value => flow.current.open(value)} />
    <output aria-label="Withdrawn">{String(withdrawn)}</output>
    <output aria-label="Withdrawal wallet">{JSON.stringify(withdrawalWallet)}</output>
    <InventoryWithdrawFlow ref={flow} authToken="test-owner" feeNano="250000000" onWithdrawn={() => setWithdrawn(true)} onWalletUpdated={setWithdrawalWallet} />
  </>
}
function NewsFixture() {
  const { setLanguage, language } = useTranslation()
  const [visible, setVisible] = useState(true)
  const news = useNews({ authToken: 'test-admin', language, isNewsView: visible })
  const editor = useNewsEditor(news)
  return <>
    <button onClick={() => setLanguage('uk')}>Ukrainian</button>
    <button onClick={() => setLanguage('en')}>English</button>
    <button onClick={() => setVisible(value => !value)}>Switch news</button>
    {visible && <NewsPage news={news} editor={editor} isAdmin />}
  </>
}
function AccountFixture() {
  const { t } = useTranslation()
  const [authToken, setAuthToken] = useState('account-a')
  const [updates, setUpdates] = useState([])
  const isInventoryView = fixtureParams.has('inventory')
  const market = useMarketplace({ isCatalogView: !isInventoryView, isInventoryView, authToken, t })
  const Page = isInventoryView ? InventoryPage : CatalogPage
  return <>
    <button onClick={() => setAuthToken('account-b')}>Switch marketplace account</button>
    <output aria-label="Account cart ids">{market.cart.cartIds.join(',')}</output>
    <output aria-label="Account wallet updates">{updates.join(',')}</output>
    <Page authToken={authToken} {...market} onWalletUpdated={() => setUpdates(previous => [...previous, authToken])} />
  </>
}
function AuthFixture() {
  const { t } = useTranslation()
  const [sessionId, setSessionId] = useState(1)
  const auth = useAuth({ t, telegramSession: {
    isTelegramWebApp: true, initData: `session-${sessionId}`, user: { id: sessionId }, devUser: {},
  } })
  return <>
    <button onClick={() => setSessionId(value => value + 1)}>Change auth session</button>
    <button onClick={auth.retryAuth}>Retry authentication</button>
    <output aria-label="Auth token">{auth.authToken}</output>
    <output aria-label="Auth admin">{String(auth.isCurrentUserAdmin)}</output>
    <output aria-label="Auth error">{auth.authError}</output>
  </>
}
function TransferFixture() {
  const { t, language } = useTranslation()
  const [authToken, setAuthToken] = useState('user-a')
  const wallet = useWallet({ t, language, authToken, isWalletView: true })
  return <WalletTonConnectRoot manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}>
    <button onClick={() => setAuthToken('user-b')}>Switch transfer account</button>
    <button onClick={() => wallet.applyWalletPayload({ available_nano: '2000000001' })}>Update available balance</button>
    <TransferContent key={authToken} authToken={authToken} wallet={wallet} />
  </WalletTonConnectRoot>
}
function TransferContent({ authToken, wallet }) {
  const transfer = useWalletTransfer({
    kind: 'withdraw', authToken, isActive: true, availableNano: wallet.walletAvailableNano,
    onWalletUpdated: wallet.applyWalletPayload, beginWalletRead: wallet.beginWalletRead,
  })
  return <WalletTransferPage kind="withdraw" transfer={transfer} />
}
const PageFixture = fixtureParams.has('account') ? AccountFixture : fixtureParams.has('transfer') ? TransferFixture : fixtureParams.has('auth') ? AuthFixture : fixtureParams.has('news') ? NewsFixture : fixtureParams.has('withdraw') ? WithdrawFixture : fixtureParams.has('import') ? ImportFixture : fixtureParams.has('purchase') ? PurchaseFixture : fixtureParams.has('inventory-session') ? InventorySessionFixture : fixtureParams.has('profile') ? ProfileFixture : fixtureParams.has('inventory') ? InventoryFixture : Fixture
createRoot(document.getElementById('root')).render(<LanguageProvider><PageFixture /></LanguageProvider>)
