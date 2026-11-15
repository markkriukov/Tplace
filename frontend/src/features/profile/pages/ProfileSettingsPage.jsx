import { LANGUAGE_OPTIONS } from '../../../shared/i18n/translations.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import ProfileGiftImportForm from '../components/ProfileGiftImportForm.jsx'

function ProfileSettingsPage({
  onBack = null,
  isAdmin = false,
  debugEnabled = false,
  onDebugEnabledChange = null,
  authToken,
  onGiftsImported,
}) {
  const { language, setLanguage, t } = useTranslation()

  return (
    <main className="settings-page" aria-label={t('settings.page')}>
      {typeof onBack === 'function' && (
        <button type="button" className="tx-back-btn" onClick={onBack}>
          {t('nav.profile')}
        </button>
      )}
      <section className="settings-panel">
        <h2 className="settings-title">{t('settings.title')}</h2>
        <div
          className="settings-lang-list"
          role="radiogroup"
          aria-label={t('settings.chooseLanguage')}
        >
          {LANGUAGE_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={language === item.id}
              className={`settings-lang-btn ${language === item.id ? 'settings-lang-btn-active' : ''}`}
              onClick={() => setLanguage(item.id)}
            >
              <span className="settings-lang-main">
                <span className="settings-lang-flag" aria-hidden>
                  {item.flag}
                </span>
                <span>{item.label}</span>
              </span>
              <span className="settings-lang-check" aria-hidden>
                {language === item.id ? '\u2713' : ''}
              </span>
            </button>
          ))}
        </div>
        {isAdmin && (
          <section className="settings-admin-tools" aria-label={t('settings.adminTools')}>
            <h3 className="settings-admin-title">{t('settings.adminTools')}</h3>
            <ProfileGiftImportForm key={authToken} authToken={authToken} onCompleted={onGiftsImported} />
            <button
              type="button"
              role="switch"
              aria-checked={debugEnabled}
              className={`settings-debug-toggle ${debugEnabled ? 'settings-debug-toggle-active' : ''}`}
              onClick={() => onDebugEnabledChange?.(!debugEnabled)}
            >
              <span className="settings-debug-copy">
                <strong>{t('settings.telegramDebug')}</strong>
                <small>{t('settings.telegramDebugDescription')}</small>
              </span>
              <span className="settings-debug-state">
                {debugEnabled ? t('settings.enabled') : t('settings.disabled')}
              </span>
            </button>
          </section>
        )}
        <p className="settings-credits">
          {t('settings.giftDataCredit')}{' '}
          <a href="https://t.me/GiftChanges" target="_blank" rel="noopener noreferrer">
            @GiftChanges
          </a>
        </p>
      </section>
    </main>
  )
}

export default ProfileSettingsPage
