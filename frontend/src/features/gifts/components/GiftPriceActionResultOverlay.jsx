import ResultDialog from '../../../shared/ui/ResultDialog.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

const failureTitles = { cancel: 'price.cancelFailed', edit: 'price.updateFailed', list: 'price.listFailed' }

function GiftPriceActionResultOverlay({ result, onClose }) {
  const { t } = useTranslation()
  if (!result) return null
  const { status, gift, mode, price } = result
  const isSuccess = status === 'success'
  return (
    <ResultDialog
      variant="price-result"
      isSuccess={isSuccess}
      title={t(isSuccess ? (mode === 'edit' ? 'price.updated' : 'price.listed') : failureTitles[mode])}
      text={isSuccess
        ? `${gift.title} ${gift.numberLabel}: ${price} ${APP_CURRENCY}`
        : t('price.retry', { name: gift.title, number: gift.numberLabel })}
      onClose={onClose}
    />
  )
}

export default GiftPriceActionResultOverlay
