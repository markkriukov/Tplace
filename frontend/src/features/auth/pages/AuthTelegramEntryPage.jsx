import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import '../styles/auth-telegram-entry.css'

function AuthTelegramEntryPage() {
  const { t } = useTranslation()

  return (
    <main className="telegram-entry">
      <section className="telegram-entry-card" aria-labelledby="telegram-entry-title">
        <img className="telegram-entry-brand" src="/tplace-logo.svg" alt="TPlace" width="1633" height="466" />
        <h1 id="telegram-entry-title">{t('telegramEntry.title')}</h1>
        <p className="telegram-entry-description">{t('telegramEntry.description')}</p>
        <a className="telegram-entry-button" href="https://t.me/t_place_bot">
          {t('telegramEntry.openBot')}
          <span aria-hidden="true">↗</span>
        </a>
        <p className="telegram-entry-handle">@t_place_bot</p>
      </section>
    </main>
  )
}

export default AuthTelegramEntryPage
