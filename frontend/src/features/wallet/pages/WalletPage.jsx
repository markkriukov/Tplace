import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import WalletStatus from '../components/WalletStatus.jsx'
import ActionIcon from '../../../shared/ui/ActionIcon.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import WalletTransferPage from './WalletTransferPage.jsx'
import { shortenTonAddress } from '../lib/wallet-transfer.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function WalletPage({
  screen,
  deposit,
  withdrawal,
  balanceLabel,
  lockedBalanceLabel = null,
  recentActions = [],
  isHistoryLoading = false,
  isHistoryReady = false,
  walletError, hasMoreTransactions, loadMoreTransactions, retryWallet,
  currency = APP_CURRENCY,
}) {
  const { t } = useTranslation()
  const {
    activeWalletView, setActiveWalletView, connectionError,
    wallet, walletAddress, isConnectionRestored,
    openWalletModal, disconnectWallet, openWalletAction,
  } = screen

  if (activeWalletView === 'deposit' || activeWalletView === 'withdraw') {
    return (
      <WalletTransferPage
        kind={activeWalletView}
        transfer={activeWalletView === 'deposit' ? deposit : withdrawal}
        currency={currency}
        connectionError={connectionError}
        onBack={() => setActiveWalletView('overview')}
      />
    )
  }

  return (
    <main className="wallet-page" aria-label={t('nav.wallet')}>
      <section className="wallet-card">
        <div className="wallet-card-top">
          <p className="wallet-card-id">
            {!isConnectionRestored && <LoadingSkeleton variant="inline" label={t('wallet.restoring')} />}
            {isConnectionRestored && !wallet && t('wallet.notConnected')}
            {isConnectionRestored &&
              wallet &&
              walletAddress &&
              t('wallet.yourWallet', { address: shortenTonAddress(walletAddress) })}
          </p>
          {wallet ? (
            <button
              type="button"
              className="wallet-detach-btn"
              onClick={disconnectWallet}
              aria-label={t('wallet.disconnect')}
            >
              {t('wallet.disconnect')}
            </button>
          ) : (
            <button
              type="button"
              className="wallet-connect-btn"
              onClick={openWalletModal}
              disabled={!isConnectionRestored}
            >
              {t('wallet.connect')}
            </button>
          )}
        </div>
        <p className="wallet-card-label">{t('wallet.marketplaceBalance')}</p>
        <p className="wallet-card-balance">{balanceLabel}</p>
        {lockedBalanceLabel && (
          <p className="wallet-card-locked" title={t('wallet.lockedBalanceHint')}>
            {t('wallet.lockedBalance')}: <span className="wallet-card-locked-amount">{lockedBalanceLabel}</span>
          </p>
        )}
        <div className="wallet-card-actions">
          <button
            type="button"
            className="wallet-action-btn wallet-action-deposit"
            onClick={() => openWalletAction('deposit')}
            disabled={!isConnectionRestored}
          >
            <ActionIcon name="deposit" size={20} /> {t('wallet.deposit')}
          </button>
          <button
            type="button"
            className="wallet-action-btn wallet-action-withdraw"
            onClick={() => openWalletAction('withdraw')}
            disabled={!isConnectionRestored}
          >
            <ActionIcon name="withdraw" size={20} /> {t('wallet.withdraw')}
          </button>
        </div>
        {connectionError && <p className="wallet-connection-error">{t(connectionError)}</p>}
      </section>

      <section className="wallet-history" aria-label={t('wallet.recentActions')}>
        <h2>{t('wallet.recentActions')}</h2>
        <div className="wallet-history-list">
          {isHistoryLoading && recentActions.length === 0 && <LoadingSkeleton variant="wallet" />}
          {isHistoryReady && !isHistoryLoading && !hasMoreTransactions && recentActions.length === 0 && (
            <p className="wallet-history-empty">{t('wallet.noActions')}</p>
          )}
          {recentActions.map((item) => (
              <article className="wallet-history-item" key={item.id}>
                <p className="wallet-history-date">{item.date}</p>
                <div className="wallet-history-row">
                  <span className="wallet-history-icon" aria-hidden>
                    <ActionIcon name={item.icon} />
                  </span>
                  <div className="wallet-history-main">
                    <p className="wallet-history-type">{item.type}</p>
                    <p className="wallet-history-time">{item.time}</p>
                  </div>
                  <p className={`wallet-history-amount wallet-history-amount-${item.tone}`}>
                    {item.amount}
                  </p>
                </div>
              </article>
            ))}
          <WalletStatus variant="wallet" showLoading={recentActions.length > 0} error={walletError} hasMore={hasMoreTransactions} loading={isHistoryLoading} onMore={loadMoreTransactions} onRetry={retryWallet} />
        </div>
      </section>

    </main>
  )
}

export default WalletPage
