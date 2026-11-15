import FilterOptionIcon from './FilterOptionIcon.jsx'
import { useMemo } from 'react'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function FilterOptionsTable({ groupKey, options, selected, allSelected, onSelectAll,
  onToggle, sort, showQuantity, quantityLabel, quick = false }) {
  const { t } = useTranslation()
  const selectedValues = useMemo(() => new Set(selected), [selected])
  const showRarity = groupKey !== 'collection'
  const columns = [{ key: 'value', label: t('filters.name') },
    ...(showRarity ? [{ key: 'rarity', label: t('common.rarity') }] : []),
    ...(showQuantity ? [{ key: 'quantity', label: quantityLabel ?? t('filters.onSale') }] : [])]
  return <>
    <div className={`tag-columns ${showRarity ? '' : 'tag-columns-no-rarity'} ${showQuantity ? '' : 'tag-columns-no-quantity'}`.trim()}>
      <button type="button" className={`choose-all ${allSelected ? 'choose-all-active' : ''}`} onClick={onSelectAll}>
        {t('filters.selectAll')}
      </button>
      {columns.map(column => <button key={column.key} type="button" className="column-sort-btn"
        onClick={() => sort.toggleSortColumn(column.key)}>
        <span>{column.label}</span>
        <span className={`sort-indicator ${sort.isSortColumnActive(column.key) ? 'sort-indicator-active' : ''}`}>
          {sort.getSortIndicator(column.key)}
        </span>
      </button>)}
      <span />
    </div>
    <div className={`tag-list${quick ? ' quick-list' : ''}`}>
      {options.map(option => <button type="button" key={`${groupKey}-${option.value}`}
        className={`filter-item ${showRarity ? '' : 'filter-item-no-rarity'} ${showQuantity ? '' : 'filter-item-no-quantity'}`.trim()}
        onClick={() => onToggle(option.value)}>
        <FilterOptionIcon option={option} />
        <span className="item-name">{option.value}</span>
        {showRarity && <span className="item-rarity">{option.rarity ? `✨ ${option.rarity}` : ''}</span>}
        {showQuantity && <span className="item-quantity">{option.quantity}</span>}
        <span className={`item-check ${selectedValues.has(option.value) ? 'item-check-active' : ''}`} />
      </button>)}
    </div>
  </>
}

export default FilterOptionsTable
