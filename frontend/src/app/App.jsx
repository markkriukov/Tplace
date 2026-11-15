import { lazy, Suspense, useMemo, useState } from 'react'
import LoadingSkeleton from '../shared/ui/LoadingSkeleton.jsx'
import AppShell from './components/AppShell.jsx'
import { useMarketplace } from './hooks/useMarketplace.js'
import { useAuthTelegramSession } from '../features/auth/hooks/useAuthTelegramSession.js'
import AuthTelegramEntryPage from '../features/auth/pages/AuthTelegramEntryPage.jsx'
import { useTranslation } from '../shared/i18n/useTranslation.js'
import { useAuth } from '../features/auth/hooks/useAuth.js'
import { useWallet } from '../features/wallet/hooks/useWallet.js'
import { useProfileStats } from '../features/profile/hooks/useProfileStats.js'
import { useNews } from '../features/news/hooks/useNews.js'
import { useNewsEditor } from '../features/news/hooks/useNewsEditor.js'
import '../styles/variables.css'
import '../styles/index.css'

const CatalogPage = lazy(() => import('../features/catalog/pages/CatalogPage.jsx'))
const InventoryPage = lazy(() => import('../features/inventory/pages/InventoryPage.jsx'))
const NewsPage = lazy(() => import('../features/news/pages/NewsPage.jsx'))
const ProfilePage = lazy(() => import('../features/profile/pages/ProfilePage.jsx'))
const WalletScreen = lazy(() => import('../features/wallet/pages/WalletScreen.jsx'))

const NAV_IDS = ['catalog', 'news', 'inventory', 'profile']
const skeletonVariants = { catalog: 'grid', inventory: 'grid', wallet: 'wallet', news: 'news' }

function App() {
  const telegramSession = useAuthTelegramSession()
  const allowLocalDevAuth = import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEV_AUTH === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

  if (!telegramSession.isTelegramWebApp && !allowLocalDevAuth) {
    return <AuthTelegramEntryPage />
  }

  return <MarketplaceApp telegramSession={telegramSession} />
}

function MarketplaceApp({ telegramSession }) {
  const { language, t } = useTranslation()
  const navItems = useMemo(() => NAV_IDS.map((id) => ({ id, label: t(`nav.${id}`) })), [t])

  const [activeNav, setActiveNavState] = useState('catalog')
  // Only the TonConnect provider needs to survive navigation after its first use.
  const [hasOpenedWallet, setHasOpenedWallet] = useState(false)
  const setActiveNav = (nav) => {
    if (nav === 'wallet') setHasOpenedWallet(true)
    setActiveNavState(nav)
  }

  const isCatalogView = activeNav === 'catalog'
  const isInventoryView = activeNav === 'inventory'
  const isNewsView = activeNav === 'news'
  const isProfileView = activeNav === 'profile'
  const isWalletView = activeNav === 'wallet'

  const {
    authToken,
    authSource,
    authError,
    retryAuth,
    isCurrentUserAdmin,
    telegramDisplayName,
    telegramAvatarUrl,
    telegramInitial,
  } = useAuth({ telegramSession, t })

  const {
    walletError, hasMoreTransactions, loadMoreTransactions, retryWallet,
    walletCurrency,
    isWalletTransactionsLoading,
    isWalletHistoryReady,
    applyWalletPayload,
    beginWalletRead,
    walletAvailableNano,
    walletBalance,
    walletLockedBalance,
    recentWalletActions,
    profileHistoryItems,
    loadWalletTransactions,
  } = useWallet({ t, language, authToken, isWalletView, isProfileView })
  const balanceLabel = `${walletBalance} ${walletCurrency}`
  const lockedBalanceLabel = walletLockedBalance == null ? null : `${walletLockedBalance} ${walletCurrency}`

  const market = useMarketplace({ isCatalogView, isInventoryView, authToken, t })
  const profileStats = useProfileStats({ authToken, isProfileView })
  const news = useNews({ authToken, language, isNewsView })
  const newsEditor = useNewsEditor(news)
  const openCatalogForGiftAttribute = (gift, key) => {
    if (market.filterCatalogByGiftAttribute(gift, key)) setActiveNav('catalog')
  }

  return (
    <AppShell
      telegramSession={telegramSession}
      authSource={authSource}
      authError={authError}
      retryAuth={retryAuth}
      telegramDisplayName={telegramDisplayName}
      telegramAvatarUrl={telegramAvatarUrl}
      telegramInitial={telegramInitial}
      isWalletView={isWalletView}
      setActiveNav={setActiveNav}
      t={t}
      balanceLabel={balanceLabel}
      navItems={navItems}
      activeNav={activeNav}
    >
      <Suspense fallback={<LoadingSkeleton variant={skeletonVariants[activeNav] ?? 'history'} />}>
      {isCatalogView && (
        <CatalogPage
          authToken={authToken}
          pricing={market.pricing}
          filters={market.filters}
          catalog={market.catalog}
          cart={market.cart}
          actions={market.actions}
          onWalletUpdated={applyWalletPayload}
          onOpenCatalogFilter={openCatalogForGiftAttribute}
        />
      )}
      {isInventoryView && (
        <InventoryPage
          authToken={authToken}
          pricing={market.pricing}
          filters={market.filters}
          inventory={market.inventory}
          cart={market.cart}
          actions={market.actions}
          onWalletUpdated={applyWalletPayload}
          onOpenCatalogFilter={openCatalogForGiftAttribute}
        />
      )}
      {isNewsView && (
        <NewsPage news={news} editor={newsEditor} isAdmin={isCurrentUserAdmin} />
      )}
      {isProfileView && (
        <ProfilePage
          onGiftsImported={() => { market.inventory.refreshInventory(); market.inventory.setInventorySection('notOnSale') }}
          profileStats={profileStats}
          telegramDisplayName={telegramDisplayName}
          telegramAvatarUrl={telegramAvatarUrl}
          telegramInitial={telegramInitial}
          balanceLabel={balanceLabel}
          onOpenWallet={() => setActiveNav('wallet')}
          authToken={authToken}
          isAdmin={isCurrentUserAdmin}
          debugEnabled={telegramSession.debugEnabled}
          onDebugEnabledChange={telegramSession.setDebugEnabled}
          historyItems={profileHistoryItems}
          walletError={walletError}
          hasMoreTransactions={hasMoreTransactions}
          loadMoreTransactions={loadMoreTransactions}
          retryWallet={retryWallet}
          isHistoryLoading={isWalletTransactionsLoading}
          isHistoryReady={isWalletHistoryReady}
          onWalletUpdated={applyWalletPayload}
          onWalletTransactionsRefresh={loadWalletTransactions}
        />
      )}
      {(isWalletView || hasOpenedWallet) && (
        <WalletScreen
          isActive={isWalletView}
          authToken={authToken}
          balanceLabel={balanceLabel}
          lockedBalanceLabel={lockedBalanceLabel}
          recentActions={recentWalletActions}
          walletError={walletError}
          hasMoreTransactions={hasMoreTransactions}
          loadMoreTransactions={loadMoreTransactions}
          retryWallet={retryWallet}
          isHistoryLoading={isWalletTransactionsLoading}
          isHistoryReady={isWalletHistoryReady}
          onWalletUpdated={applyWalletPayload}
          beginWalletRead={beginWalletRead}
          onWalletTransactionsRefresh={loadWalletTransactions}
          availableNano={walletAvailableNano}
          currency={walletCurrency}
        />
      )}
      </Suspense>
    </AppShell>
  )
}

export default App
