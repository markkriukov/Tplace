import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import Modal from '../../../shared/ui/Modal.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { formatGramAmount } from '../../../shared/lib/gram-amount.js'

function InventoryWithdrawConfirmOverlay({ gift, onClose, onConfirm, pending, status, disabled, error, feeNano }) {
  const { t } = useTranslation()
  if (!gift) return null

  return (
    <Modal className="withdraw-confirm-overlay" onClose={onClose}>
      <aside className="withdraw-confirm-panel" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="withdraw-confirm-close"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          {'\u2715'}
        </button>

        <FallbackImage src={gift.image} alt={gift.title} className="withdraw-confirm-image" />
        <p className="withdraw-confirm-title">{gift.title}</p>
        <p className="withdraw-confirm-token">{gift.numberLabel}</p>

        {gift.is_test_import && <p className="withdraw-confirm-text">{t('withdrawGift.testNotice')}</p>}
        {['queued', 'sending', 'review'].includes(status) && <p role="status">{t(`withdrawGift.${status}`)}</p>}

        {error && <p role="alert">{error}</p>}
        <button type="button" className="withdraw-confirm-btn" disabled={disabled} onClick={onConfirm}>
          {pending ? t('withdrawGift.processing') : gift.is_test_import || !feeNano
            ? t('withdrawGift.withdraw')
            : t('withdrawGift.withdrawWithFee', { amount: formatGramAmount(feeNano) })}
        </button>
      </aside>
    </Modal>
  )
}

export default InventoryWithdrawConfirmOverlay
