import Modal from '../../../shared/ui/Modal.jsx'
import { useMemo, useState } from 'react'
import FilterOptionsTable from './FilterOptionsTable.jsx'
import { sortTagOptions } from '../lib/filter-option-utils.js'
import { useFilterSort } from '../hooks/useFilterSort.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function QuickFilterOverlay({
  quickFilterKey,
  closeQuickFilter,
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
  const [tagSearch, setTagSearch] = useState({
    collection: '',
    model: '',
    background: '',
    symbol: '',
  })
  const sort = useFilterSort()
  const { sortConfig } = sort

  const visibleOptions = useMemo(
    () =>
      sortTagOptions(
        optionsByGroup[quickFilterKey] || [],
        tagSearch[quickFilterKey],
        sortConfig
      ),
    [optionsByGroup, quickFilterKey, tagSearch, sortConfig]
  )

  if (!quickFilterKey || (quickFilterKey === 'model' && selected.collection.length === 0)) return null

  return (
    <Modal className="quick-overlay" onClose={closeQuickFilter}>
      <section className="quick-panel" onClick={(event) => event.stopPropagation()}>
        <div className="quick-head">
          <h3>{filterGroups.find((group) => group.key === quickFilterKey)?.label}</h3>
          <button type="button" className="advanced-close" onClick={closeQuickFilter} aria-label={t('common.close')}>
            {'\u2715'}
          </button>
        </div>

        <label className="tag-search">
          <span>{'\u2315'}</span>
          <input
            type="text"
            placeholder={t('filters.search')}
            value={tagSearch[quickFilterKey]}
            onChange={(event) =>
              setTagSearch((prev) => ({ ...prev, [quickFilterKey]: event.target.value }))
            }
          />
        </label>

        <FilterOptionsTable groupKey={quickFilterKey} options={visibleOptions}
          selected={selected[quickFilterKey]} allSelected={isAllSelected(quickFilterKey)}
          onSelectAll={() => toggleSelectAll(quickFilterKey)}
          onToggle={value => toggleFilterValue(quickFilterKey, value)}
          sort={sort} showQuantity={showQuantity} quantityLabel={quantityLabel} quick />
      </section>
    </Modal>
  )
}

export default QuickFilterOverlay
