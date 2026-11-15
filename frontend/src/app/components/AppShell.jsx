import FallbackImage from '../../shared/ui/FallbackImage.jsx'
import BottomNav from './BottomNav.jsx'
import AuthTelegramDebugPanel from '../../features/auth/components/AuthTelegramDebugPanel.jsx'

function AppShell({
  children,
  telegramSession,
  authSource,
  authError,
  retryAuth,
  telegramDisplayName,
  telegramAvatarUrl,
  telegramInitial,
  isWalletView,
  setActiveNav,
  t,
  balanceLabel,
  navItems,
  activeNav,
}) {
  return (
    <div className="app-shell">
      <AuthTelegramDebugPanel session={telegramSession} authSource={authSource} authError={authError} />
      {authError && <div className="wallet-status-error" role="alert">
        <p>{t('auth.failed')}</p>
        <button type="button" onClick={retryAuth}>{t('common.retry')}</button>
      </div>}
      {activeNav !== 'profile' && <header className="top-block">
        <div className="brand-row">
          <button
            type="button"
            className="tg-account"
            aria-label={telegramDisplayName}
            onClick={() => setActiveNav('profile')}
          >
            <span className="tg-account-logo">{telegramAvatarUrl ? (
              <FallbackImage src={telegramAvatarUrl} alt="" fallbackSrc={null} fallback={<span>{telegramInitial}</span>} />
            ) : (
              <span>{telegramInitial}</span>
            )}</span>
            <span className="tg-account-name">{telegramDisplayName}</span>
          </button>
          {isWalletView ? (
            <button type="button" className="ghost" onClick={() => setActiveNav('catalog')}>
              {t('nav.backToCatalog')}
            </button>
          ) : (
            <button
              type="button"
              className="wallet-balance-btn"
              onClick={() => setActiveNav('wallet')}
            >
              {balanceLabel} ›
            </button>
          )}
        </div>
      </header>}
      {children}
      <BottomNav
        isVisible={!isWalletView}
        navItems={navItems}
        activeNav={activeNav}
        setActiveNav={setActiveNav}
      />
    </div>
  )
}

export default AppShell
