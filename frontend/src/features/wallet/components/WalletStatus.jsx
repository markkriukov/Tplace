import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import InfiniteScrollSentinel from '../../../shared/ui/InfiniteScrollSentinel.jsx'
function WalletStatus({ error, hasMore, loading, onMore, onRetry, showLoading = true, variant = 'history' }) {
  const { t } = useTranslation()
  return <section className="wallet-status" aria-live="polite">
    {error && <p role="alert">{t('wallet.loadError')} <button type="button" onClick={onRetry}>{t('common.retry')}</button></p>}
    <InfiniteScrollSentinel variant={variant} hasMore={hasMore} loading={loading} error={error} onMore={onMore} showLoading={showLoading} />
  </section>
}

export default WalletStatus
