import ResultDialog from '../../../shared/ui/ResultDialog.jsx'
import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function GiftBuyResultOverlay({ result, gift, onClose, message }) {
  const { t } = useTranslation()
  if (!result || !gift) return null
  const isSuccess = result === 'success'
  return (
    <ResultDialog
      variant="buy-result"
      isSuccess={isSuccess}
      title={isSuccess ? t('buy.success') : t('buy.failed')}
      text={isSuccess
        ? t('buy.successText', { name: gift.title, number: gift.numberLabel, price: gift.price, currency: APP_CURRENCY })
        : message || t('buy.failedText', { name: gift.title, number: gift.numberLabel })}
      onClose={onClose}
    />
  )
}

export default GiftBuyResultOverlay
