import Modal from './Modal.jsx'
import { useTranslation } from '../i18n/useTranslation.js'

/** Outcome of a finished action. `variant` prefixes the class names, e.g. "buy-result". */
function ResultDialog({ variant, isSuccess, title, text, onClose }) {
  const { t } = useTranslation()
  return (
    <Modal className={`${variant}-overlay`} onClose={onClose}>
      <aside className={`${variant}-panel`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={`${variant}-close`} onClick={onClose} aria-label={t('common.close')}>
          {'\u2715'}
        </button>
        <div className={`${variant}-icon ${variant}-icon-${isSuccess ? 'success' : 'error'}`} aria-hidden>
          {isSuccess ? '✓' : '!'}
        </div>
        <p className={`${variant}-title`}>{title}</p>
        <p className={`${variant}-text`}>{text}</p>
        <button type="button" className={`${variant}-btn`} onClick={onClose}>
          {t('common.ok')}
        </button>
      </aside>
    </Modal>
  )
}

export default ResultDialog
