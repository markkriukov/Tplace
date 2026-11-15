import { useTranslation } from '../i18n/useTranslation.js'

function Line({ width = '80%' }) {
  return <span className="loading-skeleton-line loading-skeleton-shape" style={{ width }} />
}

function GiftSkeleton() {
  return <article className="gift-card gift-card-skeleton" aria-hidden="true">
    <div className="gift-image loading-skeleton-shape" />
    <div className="gift-content">
      <div className="gift-title"><h2><Line /></h2><p className="gift-id"><Line width="35%" /></p></div>
      <div className="gift-foot"><div className="action-row">
        <span className="buy-btn loading-skeleton-shape" />
        <span className="cart-btn loading-skeleton-shape" />
      </div></div>
    </div>
  </article>
}

/** Placeholders for the next page, placed inside a gift grid so they continue its last row. */
export function GiftSkeletonCards({ count }) {
  return Array.from({ length: count }, (_, index) => <GiftSkeleton key={index} />)
}

function HistorySkeleton({ offers = false }) {
  const content = <>
    <span className="profile-history-image loading-skeleton-shape" />
    <div className="profile-history-main">
      <p className="profile-history-name"><Line width="85%" /></p>
      <p className="profile-history-time"><Line width="65%" /></p>
    </div>
    <div className="profile-history-side loading-skeleton-side">
      <p className="profile-history-type"><Line width="100%" /></p>
      <p className="profile-history-price"><Line width="70%" /></p>
    </div>
  </>
  if (!offers) return <article className="profile-history-item" aria-hidden="true">{content}</article>
  return <article className="profile-offer-card" aria-hidden="true">
    <div className="loading-skeleton-offer-row">{content}</div>
    <div className="profile-offer-actions">
      <span className="profile-offer-accept loading-skeleton-shape" />
      <span className="profile-offer-decline loading-skeleton-shape" />
    </div>
  </article>
}

function WalletSkeleton() {
  return <article className="wallet-history-item" aria-hidden="true">
    <p className="wallet-history-date"><Line width="140px" /></p>
    <div className="wallet-history-row">
      <span className="wallet-history-icon loading-skeleton-shape" />
      <div className="wallet-history-main">
        <p className="wallet-history-type"><Line /></p>
        <p className="wallet-history-time"><Line width="40%" /></p>
      </div>
      <p className="wallet-history-amount loading-skeleton-side"><Line width="100%" /></p>
    </div>
  </article>
}

function SaleSkeleton() {
  return <article className="sales-history-item" aria-hidden="true">
    <span className="sales-history-image loading-skeleton-shape" />
    <div className="sales-history-main">
      <p className="sales-history-name"><Line /></p>
      <p className="sales-history-meta"><Line width="65%" /></p>
    </div>
    <div className="sales-history-side loading-skeleton-side">
      <p className="sales-history-price"><Line width="100%" /></p>
      <p className="sales-history-time"><Line width="70%" /></p>
    </div>
  </article>
}

function NewsCardSkeleton() {
  return <article className="news-card news-skeleton-card" aria-hidden="true">
    <div className="news-card-grid">
      <div className="news-card-copy news-skeleton-copy">
        <div className="news-skeleton-line news-skeleton-title" />
        <div className="news-skeleton-line news-skeleton-lead" />
        <div className="news-skeleton-line" />
        <div className="news-skeleton-line news-skeleton-short" />
        <div className="news-skeleton-line news-skeleton-date" />
      </div>
      <div className="news-card-image news-skeleton-image" />
    </div>
  </article>
}

function LoadingSkeleton({ variant = 'history', count = 3, label, className = '' }) {
  const { t } = useTranslation()
  const accessibleLabel = label || t('common.loading')
  if (variant === 'inline') {
    return <span className={`loading-skeleton-inline ${className}`} role="status" aria-label={accessibleLabel}>
      <span className="loading-skeleton-shape" aria-hidden="true" />
    </span>
  }
  const Card = variant === 'grid' ? GiftSkeleton : variant === 'wallet' ? WalletSkeleton
    : variant === 'sales' ? SaleSkeleton
      : variant === 'news' ? NewsCardSkeleton : HistorySkeleton
  return <div className={`${variant === 'grid' ? 'catalog' : 'loading-skeleton'} loading-skeleton-${variant} ${className}`} role="status" aria-label={accessibleLabel}>
    {Array.from({ length: count }, (_, index) => <Card key={index} offers={variant === 'offers'} />)}
  </div>
}

export default LoadingSkeleton
