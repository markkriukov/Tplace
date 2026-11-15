import { useRef } from 'react'
import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import Modal from '../../../shared/ui/Modal.jsx'
import InfiniteScrollSentinel from '../../../shared/ui/InfiniteScrollSentinel.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import FilterSearchHeader from '../../filters/components/FilterSearchHeader.jsx'
import FiltersFlow from '../../filters/components/FiltersFlow.jsx'

function SalesHistoryOverlay({
  isOpen,
  onClose,
  items = [],
  filters,
  onLoadMore,
  hasMore = false,
  hasLoadedHistory = false,
  isLoading = false,
  isLoadingMore = false,
  error = '',
  onRetry,
}) {
  const { t } = useTranslation()
  const filtersFlowRef = useRef(null)
  if (!isOpen) return null

  return (
    <Modal className="sales-history-overlay" onClose={onClose}>
      <aside className="sales-history-panel" onClick={(event) => event.stopPropagation()}>
        <div className="sales-history-head">
          <h3 className="sales-history-title">{t('sales.title')}</h3>
          <button type="button" className="sales-history-close-btn" onClick={onClose} aria-label={t('common.close')}>
            {'\u2715'}
          </button>
        </div>

        <FilterSearchHeader
          filters={filters}
          filterContext="sales"
          variant="sales-history"
          openQuickFilter={(key) => filtersFlowRef.current?.openQuick(key)}
          openFilters={() => filtersFlowRef.current?.openAdvanced()}
        />

        {error && <div role="alert"><p className="sales-history-error">{error}</p>
          <button type="button" onClick={onRetry} disabled={isLoading || isLoadingMore}>{t('common.retry')}</button>
        </div>}

        <div className="sales-history-list">
          {isLoading && !hasLoadedHistory && (
            <LoadingSkeleton variant="sales" label={t('sales.loading')} />
          )}
          {!isLoading && hasLoadedHistory && !error && items.length === 0 && (
            <p className="sales-history-empty">{t('sales.empty')}</p>
          )}
          {items.map((item) => (
            <article className="sales-history-item" key={`sale-history-${item.id}`}>
              <FallbackImage src={item.gift?.image} alt={item.gift?.title || t('common.gift')} className="sales-history-image" />
              <div className="sales-history-main">
                <p className="sales-history-name">
                  {item.gift?.title || t('common.gift')}{' '}
                  <span>#{item.gift?.number || item.gift_id}</span>
                </p>
                <p className="sales-history-meta">{item.collectionName} · {item.modelName}</p>
              </div>
              <div className="sales-history-side">
                <p className="sales-history-price">{item.priceLabel}</p>
                <p className="sales-history-time">{item.timeLabel}</p>
              </div>
            </article>
          ))}

          <InfiniteScrollSentinel variant="sales" showLoading={hasLoadedHistory} hasMore={hasMore} loading={isLoading || isLoadingMore} error={error} onMore={onLoadMore} />
        </div>
        <FiltersFlow ref={filtersFlowRef} filters={filters} showQuantity={false} />
      </aside>
    </Modal>
  )
}

export default SalesHistoryOverlay
