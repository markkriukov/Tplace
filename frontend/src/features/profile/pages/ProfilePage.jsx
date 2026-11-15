import { useEffect, useMemo, useRef, useState } from 'react'
import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import ActionIcon from '../../../shared/ui/ActionIcon.jsx'
import InfiniteScrollSentinel from '../../../shared/ui/InfiniteScrollSentinel.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { startVisiblePolling } from '../../../shared/lib/visible-polling.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import WalletStatus from '../../wallet/components/WalletStatus.jsx'
import { resolveOffer } from '../../offers/api/offers.api.js'
import { useOffers } from '../../offers/hooks/useOffers.js'
import { formatOfferTimeLeft, formatProfileOfferItems } from '../../offers/lib/offer-formatters.js'
import ProfileSettingsPage from './ProfileSettingsPage.jsx'

const profileStatFields = [
  { key: 'gifts', label: 'profile.gifts' },
  { key: 'sales', label: 'profile.sales' },
  { key: 'buys', label: 'profile.buys' },
]

const TAB_HISTORY = 'history'
const TAB_OFFERS = 'offers'

const isOfferExpired = (offer, now) => offer.status === 'pending' &&
  Number.isFinite(offer.expiresAtMs) && offer.expiresAtMs > 0 && offer.expiresAtMs <= now

function ProfileContent({
  profileStats,
  telegramDisplayName,
  telegramAvatarUrl,
  telegramInitial,
  balanceLabel,
  onOpenWallet,
  authToken,
  isAdmin = false,
  debugEnabled = false,
  onDebugEnabledChange = null,
  historyItems = [],
  isHistoryLoading = false,
  isHistoryReady = false,
  walletError, hasMoreTransactions, loadMoreTransactions, retryWallet,
  onWalletUpdated = null,
  onWalletTransactionsRefresh = null,
  onGiftsImported,
}) {
  const { language, t } = useTranslation()
  const [activeProfileView, setActiveProfileView] = useState('profile')
  const [profileTab, setProfileTab] = useState(TAB_HISTORY)
  const isHistoryTab = profileTab === TAB_HISTORY
  const offersEnabled = !isHistoryTab && activeProfileView === 'profile'
  const offers = useOffers({ authToken, enabled: offersEnabled })
  const { offers: profileOffers, loaded: hasLoadedOffers, loading: isProfileOffersLoading } = offers
  const actionRequest = useRef(null)
  useEffect(() => () => actionRequest.current?.abort(), [])
  const [profileOffersError, setProfileOffersError] = useState('')
  const [offerActionTargetId, setOfferActionTargetId] = useState('')
  const [nowTs, setNowTs] = useState(() => Date.now())

  const offerItems = useMemo(
    () => formatProfileOfferItems(profileOffers, t, language),
    [profileOffers, t, language]
  )
  const currentOfferItems = offerItems.map(offer => isOfferExpired(offer, nowTs)
    ? { ...offer, status: 'expired', statusText: t('offer.status.expired') } : offer)
  const expiredIncomingCount = offerItems.filter(offer => offer.direction === 'incoming' && isOfferExpired(offer, nowTs)).length
  const offersPendingCount = Math.max(0, (offers.pendingCount ?? 0) - expiredIncomingCount)
  const hasPendingOffers = currentOfferItems.some(offer => offer.status === 'pending' && offer.expiresAtMs > nowTs)
  useEffect(() => {
    if (!offersEnabled || !hasPendingOffers) return
    return startVisiblePolling(() => { setNowTs(Date.now()) }, { intervalMs: 1000 })
  }, [offersEnabled, hasPendingOffers])

  /** action: 'accept' | 'reject' | 'cancel' */
  const runOfferAction = async (offerId, action) => {
    if (!authToken || !offerId || actionRequest.current) return
    const offer = offerItems.find(item => item.id === offerId)
    // eslint-disable-next-line react-hooks/purity -- Read the deadline only in the async click handler, between countdown ticks.
    if (!offer || offer.status !== 'pending' || isOfferExpired(offer, Date.now())) return

    const controller = new AbortController()
    actionRequest.current = controller
    setOfferActionTargetId(`${action}:${offerId}`)
    setProfileOffersError('')
    try {
      const response = await resolveOffer(offerId, action, { token: authToken, signal: controller.signal })
      if (controller.signal.aborted) return
      const payload = response.data
      if (!response.ok || !payload?.ok) {
        setProfileOffersError(typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error.trim() : t('profile.offerActionFailed'))
        return
      }
      if (payload.wallet) onWalletUpdated?.(payload.wallet)
      if (action === 'accept') profileStats?.retry?.()
      await Promise.all([offers.refresh(), onWalletTransactionsRefresh?.()])
    } catch {
      if (!controller.signal.aborted) setProfileOffersError(t('profile.offerActionFailed'))
    } finally {
      actionRequest.current = null
      if (!controller.signal.aborted) setOfferActionTargetId('')
    }
  }

  const isOfferActionLoading = (offerId, action) => offerActionTargetId === `${action}:${offerId}`
  const offerActionButton = (offer, action, className, label) => (
    <button
      type="button"
      className={className}
      disabled={Boolean(offerActionTargetId)}
      onClick={() => runOfferAction(offer.id, action)}
    >
      {isOfferActionLoading(offer.id, action) ? <LoadingSkeleton variant="inline" /> : label}
    </button>
  )

  if (activeProfileView === 'settings') {
    return (
      <ProfileSettingsPage
        authToken={authToken}
        onGiftsImported={() => { profileStats?.retry?.(); onGiftsImported?.() }}
        onBack={() => setActiveProfileView('profile')}
        isAdmin={isAdmin}
        debugEnabled={debugEnabled}
        onDebugEnabledChange={onDebugEnabledChange}
      />
    )
  }

  const avatarFallback = <span className="profile-hero-avatar profile-avatar-fallback">{telegramInitial}</span>
  const offersVisible = !isProfileOffersLoading || hasLoadedOffers

  return (
    <main className="profile-page" aria-label={t('profile.title')}>
      <section className="profile-hero" aria-label={t('profile.info')}>
        <div className="profile-hero-main">
          {telegramAvatarUrl ? (
            <FallbackImage src={telegramAvatarUrl} fallbackSrc={null} fallback={avatarFallback} alt={telegramDisplayName} className="profile-hero-avatar" />
          ) : avatarFallback}
          <div className="profile-hero-copy">
            <p className="profile-hero-title">{telegramDisplayName}</p>
          </div>
          <div className="profile-hero-actions">
            <button type="button" className="wallet-balance-btn" onClick={onOpenWallet}>
              {balanceLabel} &rsaquo;
            </button>
            <button
              type="button"
              className="profile-settings-btn"
              aria-label={t('profile.settings')}
              onClick={() => setActiveProfileView('settings')}
            >
              <ActionIcon name="settings" />
            </button>
          </div>
        </div>
        <div className="profile-hero-stats">
          {profileStatFields.map((item) => (
            <div className="profile-stat" key={item.key}>
              <span className="profile-stat-value">
                {profileStats.stats ? String(profileStats.stats[item.key]) : profileStats.error ? '—' : (
                  <span className="profile-stat-skeleton" role="status" aria-label={t('common.loading')} />
                )}
              </span>
              <span className="profile-stat-label">{t(item.label)}</span>
            </div>
          ))}
        </div>
        {profileStats.error && (
          <p className="profile-stats-error" role="alert">
            {t('profile.statsLoadFailed')}{' '}
            <button type="button" onClick={profileStats.retry}>{t('common.retry')}</button>
          </p>
        )}
      </section>

      <section className="profile-tabs" aria-label={t('profile.sections')}>
        <button
          type="button"
          className={`profile-tab-btn ${isHistoryTab ? 'profile-tab-btn-active' : ''}`}
          onClick={() => setProfileTab(TAB_HISTORY)}
        >
          {t('profile.history')}
        </button>
        <button
          type="button"
          className={`profile-tab-btn ${!isHistoryTab ? 'profile-tab-btn-active' : ''}`}
          onClick={() => setProfileTab(TAB_OFFERS)}
        >
          {t('profile.offers')}{' '}
          {offersPendingCount > 0 && <span className="profile-tab-badge">{offersPendingCount}</span>}
        </button>
      </section>

      {isHistoryTab ? (
        <section className="profile-history-list" aria-label={t('profile.operationsHistory')}>
          {isHistoryLoading && historyItems.length === 0 && (
            <LoadingSkeleton label={t('profile.loadingHistory')} />
          )}
          {isHistoryReady && !isHistoryLoading && historyItems.length === 0 && (
            <p className="profile-history-empty">{t('profile.noOperations')}</p>
          )}
          {historyItems.map((item) => (
            <article className="profile-history-item" key={item.id}>
              {item.icon ? (
                <span className="profile-history-image profile-history-action-icon"><ActionIcon name={item.icon} /></span>
              ) : <FallbackImage src={item.image} alt={item.title} className="profile-history-image" />}
              <div className="profile-history-main">
                <p className="profile-history-name">
                  {item.title} {item.numberLabel && <span>{item.numberLabel}</span>}
                </p>
                <p className="profile-history-time">{item.time}</p>
              </div>
              <div className="profile-history-side">
                <p className={`profile-history-type profile-history-type-${item.typeTone}`}>{item.type}</p>
                <p className="profile-history-price">{item.price} {APP_CURRENCY}</p>
              </div>
            </article>
          ))}
          <WalletStatus showLoading={historyItems.length > 0} error={walletError} hasMore={hasMoreTransactions} loading={isHistoryLoading} onMore={loadMoreTransactions} onRetry={retryWallet} />
        </section>
      ) : (
        <section className="profile-offer-wrap" aria-label={t('profile.offers')}>
          {isProfileOffersLoading && !hasLoadedOffers && (
            <LoadingSkeleton variant="offers" label={t('profile.loadingOffers')} />
          )}
          {offers.error && <p className="profile-offers-error" role="alert">
            {t('profile.offersLoadFailed')} <button type="button" onClick={offers.retry}>{t('common.retry')}</button>
          </p>}
          {offersVisible && profileOffersError && (
            <p className="profile-offers-error">{profileOffersError}</p>
          )}
          {offersVisible && !offers.error && !profileOffersError && currentOfferItems.length === 0 && (
            <p className="profile-history-empty">{t('profile.noOffers')}</p>
          )}
          {offersVisible && currentOfferItems.map((offer) => (
            <article className="profile-offer-card" key={offer.id}>
              <div className="profile-offer-row">
                <div className="profile-offer-gift">
                  <FallbackImage src={offer.image} alt={offer.title} className="profile-offer-image" loading="lazy" decoding="async" />
                  <div className="profile-offer-main">
                    <p className="profile-offer-name">
                      {offer.title} <span>{offer.numberLabel}</span>
                    </p>
                    <p className="profile-offer-price-time">
                      {offer.price} {APP_CURRENCY} <span>{offer.createdAtLabel}</span>
                    </p>
                  </div>
                </div>
                <div className="profile-offer-side">
                  <p className={`profile-offer-direction profile-offer-direction-${offer.direction}`}>
                    {offer.directionLabel}
                  </p>
                  <p className="profile-offer-left">
                    {offer.status === 'pending' ? '◔ ' : ''}
                    {formatOfferTimeLeft(offer, nowTs, t)}
                  </p>
                </div>
              </div>

              <div className="profile-offer-actions">
                {offer.direction === 'incoming' && offer.status === 'pending' && (
                  <>
                    {offerActionButton(offer, 'accept', 'profile-offer-accept', t('profile.accept'))}
                    {offerActionButton(offer, 'reject', 'profile-offer-decline', t('profile.reject'))}
                  </>
                )}
                {offer.direction === 'outgoing' && offer.status === 'pending' &&
                  offerActionButton(offer, 'cancel', 'profile-offer-decline profile-offer-decline-wide', t('common.cancel'))}
              </div>
            </article>
          ))}
          <InfiniteScrollSentinel hasMore={Boolean(offers.nextCursor)} loading={isProfileOffersLoading}
            error={offers.error} onMore={offers.loadMore} showLoading={hasLoadedOffers} variant="offers" />
        </section>
      )}
    </main>
  )
}

function ProfilePage({ authToken, ...props }) {
  return <ProfileContent key={authToken || 'anonymous'} authToken={authToken} {...props} />
}

export default ProfilePage
