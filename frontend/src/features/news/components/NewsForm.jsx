import { useTranslation } from '../../../shared/i18n/useTranslation.js'

/** Title, lead, text and image URL of a news item, for creating or editing it. */
function NewsForm({ className, form, onFieldChange, onSubmit, disabled, error, submitContent }) {
  const { t } = useTranslation()
  const field = (name) => ({
    value: form[name],
    disabled,
    onChange: (event) => onFieldChange(name, event.target.value),
  })
  return (
    <form className={className} onSubmit={onSubmit}>
      <input type="text" className="news-create-input" placeholder={t('news.title')} maxLength={200} required {...field('title')} />
      <input type="text" className="news-create-input" placeholder={t('news.lead')} maxLength={2000} {...field('lead')} />
      <textarea className="news-create-textarea" placeholder={t('news.content')} maxLength={50000} required {...field('content')} />
      <input
        type="text" inputMode="url" pattern="^(https?://|/|$).*" maxLength={2048}
        className="news-create-input" placeholder={t('news.imageUrl')} {...field('imageUrl')}
      />
      {error && <p className="news-create-error">{t(error)}</p>}
      <button type="submit" className="news-create-submit" disabled={disabled}>{submitContent}</button>
    </form>
  )
}

export default NewsForm
