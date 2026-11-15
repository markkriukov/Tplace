import { APP_CURRENCY } from '../../../shared/config/currency.js'
import Modal from '../../../shared/ui/Modal.jsx'
import { useMemo, useState } from 'react'
import FilterOptionsTable from './FilterOptionsTable.jsx'
import { sortTagOptions } from '../lib/filter-option-utils.js'
import { useFilterSort } from '../hooks/useFilterSort.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function AdvancedFiltersOverlay({
  isOpen,
  onClose,
  giftNumberQuery,
  setGiftNumberQuery,
  sortOptions,
  sortOption,
  setSortOption,
  priceMin,
  setPriceMin,
  priceMax,
  setPriceMax,
  filterGroups,
  optionsByGroup,
  isAllSelected,
  toggleSelectAll,
  toggleFilterValue,
  selected,
  quantityLabel,
  showQuantity = true,
}) {
  const { t } = useTranslation()
  const [isSortSectionOpen, setIsSortSectionOpen] = useState(true)
  const [isPriceSectionOpen, setIsPriceSectionOpen] = useState(true)
  const [tagSectionsOpen, setTagSectionsOpen] = useState({
    collection: true,
    model: false,
    background: false,
    symbol: false,
  })
  const [tagSearch, setTagSearch] = useState({
    collection: '',
    model: '',
    background: '',
    symbol: '',
  })
  const sort = useFilterSort()
  const { sortConfig } = sort

  const sortedOptionsByGroup = useMemo(
    () => {
      if (!isOpen) return {}
      return Object.fromEntries(
        filterGroups.filter(group => tagSectionsOpen[group.key] &&
          (group.key !== 'model' || selected.collection.length > 0)).map((group) => [
          group.key,
          sortTagOptions(
            optionsByGroup[group.key] || [],
            tagSearch[group.key],
            sortConfig
          ),
        ])
      )
    },
    [isOpen, filterGroups, optionsByGroup, tagSearch, sortConfig, tagSectionsOpen, selected.collection.length]
  )

  if (!isOpen) return null

  return (
    <Modal className="advanced-overlay" onClose={onClose}>
      <aside className="advanced-panel" onClick={(event) => event.stopPropagation()}>
        <div className="advanced-head">
          <h3>{t('filters.title')}</h3>
          <button type="button" className="advanced-close" onClick={onClose} aria-label={t('common.close')}>
            {'\u2715'}
          </button>
        </div>

        <section className="advanced-section gift-num-row">
          <p>{t('filters.giftNumber')}</p>
          <input
            type="text"
            placeholder="#"
            value={giftNumberQuery}
            onChange={(event) => setGiftNumberQuery(event.target.value)}
          />
        </section>

        <section className="advanced-section">
          <button
            type="button"
            className={`section-toggle ${isSortSectionOpen ? 'section-toggle-open' : ''}`}
            onClick={() => setIsSortSectionOpen((prev) => !prev)}
          >
            <span className="section-title">{t('filters.sort')}</span>
            <span className="chevron-icon" aria-hidden />
          </button>
          {isSortSectionOpen && (
            <div className="sort-list">
              {sortOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`sort-item ${sortOption === option.id ? 'sort-item-active' : ''}`}
                  onClick={() => setSortOption(option.id)}
                >
                  <span className="sort-radio" />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="advanced-section">
          <button
            type="button"
            className={`section-toggle ${isPriceSectionOpen ? 'section-toggle-open' : ''}`}
            onClick={() => setIsPriceSectionOpen((prev) => !prev)}
          >
            <span className="section-title">{t('filters.price')}</span>
            <span className="chevron-icon" aria-hidden />
          </button>
          {isPriceSectionOpen && (
            <div className="price-row">
              <div className="price-input-wrap">
                <span>{APP_CURRENCY}</span>
                <input
                  type="number"
                  placeholder={t('filters.from')}
                  value={priceMin}
                  onChange={(event) => setPriceMin(event.target.value)}
                />
              </div>
              <span className="price-dash">—</span>
              <div className="price-input-wrap">
                <input
                  type="number"
                  placeholder={t('filters.to')}
                  value={priceMax}
                  onChange={(event) => setPriceMax(event.target.value)}
                />
              </div>
            </div>
          )}
        </section>

        <section className="advanced-section tags-section">
          <div className="tags-groups">
            {filterGroups.map((group) => {
              const isDisabled = group.key === 'model' && selected.collection.length === 0
              const visibleOptions = sortedOptionsByGroup[group.key] || []
              return (
                <div className="tag-group" key={group.key}>
                  <button
                    type="button"
                    className={`section-toggle tag-group-head ${tagSectionsOpen[group.key] ? 'section-toggle-open' : ''}`}
                    disabled={isDisabled}
                    title={isDisabled ? t('filters.selectCollectionFirst') : undefined}
                    onClick={() =>
                      setTagSectionsOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                    }
                  >
                    <span className="section-title">{group.label}</span>
                    <span className="chevron-icon" aria-hidden />
                  </button>

                  {!isDisabled && tagSectionsOpen[group.key] && (
                    <div className="tag-group-body">
                      <label className="tag-search">
                        <span>{'\u2315'}</span>
                        <input
                          type="text"
                          placeholder={t('filters.search')}
                          value={tagSearch[group.key]}
                          onChange={(event) =>
                            setTagSearch((prev) => ({ ...prev, [group.key]: event.target.value }))
                          }
                        />
                      </label>

                      <FilterOptionsTable groupKey={group.key} options={visibleOptions}
                        selected={selected[group.key]} allSelected={isAllSelected(group.key)}
                        onSelectAll={() => toggleSelectAll(group.key)}
                        onToggle={value => toggleFilterValue(group.key, value)}
                        sort={sort} showQuantity={showQuantity} quantityLabel={quantityLabel} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </aside>
    </Modal>
  )
}

export default AdvancedFiltersOverlay
