import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import FilterSearchHeader from '../../filters/components/FilterSearchHeader.jsx'

function CatalogHeader({ openSalesHistory, ...props }) {
  const { t } = useTranslation()
  return (
    <FilterSearchHeader {...props} filterContext="catalog">
      <button type="button" className="search-history" aria-label={t('sales.title')} onClick={openSalesHistory}>
        {t('search.salesHistory')}
      </button>
    </FilterSearchHeader>
  )
}

export default CatalogHeader
