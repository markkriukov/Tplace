import { useTranslation } from '../i18n/useTranslation.js'

function LoadError({ onRetry }) {
  const { t } = useTranslation()
  return (
    <div className="catalog-loading" role="alert">
      <p>{t('common.loadFailed')}</p>
      <button type="button" className="buy-result-btn" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  )
}

export default LoadError
