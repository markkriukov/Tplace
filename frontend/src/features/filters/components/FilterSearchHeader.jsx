import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import ActionIcon from '../../../shared/ui/ActionIcon.jsx'

/** Search box and quick filter pills shared by the catalog, inventory and sales history. */
function FilterSearchHeader({
  filters,
  filterContext,
  openQuickFilter,
  openFilters,
  openCart,
  cartCount = 0,
  variant = '',
  children,
}) {
  const { t } = useTranslation()
  const { selected, filterGroups, getFilterSummary, clearFilter, handleHorizontalWheel, giftNumberQuery, setGiftNumberQuery } = filters
  const modelDisabled = selected.collection.length === 0
  return (
    <>
      <section className={`search-row ${variant ? `${variant}-search-row` : ''}`.trim()} aria-label={t('search.label')}>
        <label className="search-input-wrap">
          <span className="search-icon">{'⌕'}</span>
          <input
            type="text"
            className="search-input"
            placeholder={t('search.placeholder')}
            value={giftNumberQuery}
            onChange={(event) => setGiftNumberQuery(event.target.value)}
          />
          {giftNumberQuery.trim().length > 0 && (
            <button type="button" className="search-clear" aria-label={t('search.clear')} onClick={() => setGiftNumberQuery('')}>
              {'\u00D7'}
            </button>
          )}
        </label>
        {openCart && (
          <button type="button" className="search-cart" aria-label={t('search.cart')} onClick={openCart}>
            <span className="search-cart-icon" aria-hidden>
              <ActionIcon name="cart" size={20} />
            </span>
            {cartCount > 0 && <span className="search-cart-count-badge">{cartCount}</span>}
          </button>
        )}
        {children}
      </section>

      <section className={`filters ${variant ? `${variant}-filter-bar` : ''}`.trim()} aria-label={t('filters.quick')}>
        <button type="button" className="filter-toggle" aria-label={t('filters.title')} onClick={openFilters}>
          {'≡'}
        </button>

        <div className="filters-scroll" onWheel={handleHorizontalWheel}>
          <div className="filters-inline" role="group" aria-label={t(`filters.${filterContext}`)}>
            {filterGroups.map((group) => {
              const hasSelection = selected[group.key].length > 0
              const disabled = group.key === 'model' && modelDisabled
              return (
                <div key={group.key} className="filter-pill-wrap">
                  <button
                    type="button"
                    className={`filter-pill ${hasSelection ? 'filter-pill-active' : ''}`}
                    disabled={disabled}
                    title={disabled ? t('filters.selectCollectionFirst') : undefined}
                    onClick={() => openQuickFilter(group.key)}
                  >
                    <span className="filter-pill-label">{group.label}</span>
                    <span className="filter-pill-value">{getFilterSummary(group.key)}</span>
                  </button>
                  {hasSelection && (
                    <button
                      type="button"
                      className="filter-pill-clear"
                      aria-label={t('filters.clearNamed', { name: group.label })}
                      onClick={(event) => {
                        event.stopPropagation()
                        clearFilter(group.key)
                      }}
                    >
                      {'\u00D7'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </>
  )
}

export default FilterSearchHeader
