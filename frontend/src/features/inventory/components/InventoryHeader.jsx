import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import FilterSearchHeader from '../../filters/components/FilterSearchHeader.jsx'

const sections = [
  { id: 'onSale', label: 'inventory.onSale' },
  { id: 'notOnSale', label: 'inventory.notOnSale' },
]

function InventoryHeader({ inventorySection, setInventorySection, inventorySummary, ...searchProps }) {
  const { t } = useTranslation()
  return (
    <>
      <FilterSearchHeader {...searchProps} filterContext="inventory" />
      <section className="inventory-modes" aria-label={t('inventory.modes')}>
        {sections.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`inventory-mode-btn ${inventorySection === id ? 'inventory-mode-btn-active' : ''}`}
            aria-pressed={inventorySection === id}
            onClick={() => setInventorySection(id)}
          >
            {t(label)}
            <span className="inventory-mode-count">{inventorySummary?.[id].total ?? '—'}</span>
          </button>
        ))}
      </section>
    </>
  )
}

export default InventoryHeader
