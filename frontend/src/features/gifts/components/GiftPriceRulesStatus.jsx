import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function GiftPriceRulesStatus({ pricing, hasPricingRules }) {
  const { t } = useTranslation()
  if (hasPricingRules) return null
  return <div role={pricing?.isLoading ? 'status' : 'alert'}>
    <p className="price-menu-commission">{t(pricing?.isLoading ? 'common.loading' : 'price.rulesFailed')}</p>
    {pricing?.retry && <button type="button" className="price-rules-retry"
      disabled={pricing.isLoading} onClick={pricing.retry}>{t('common.retry')}</button>}
  </div>
}

export default GiftPriceRulesStatus
