import { useCallback, useEffect, useMemo, useState } from 'react'

import { LanguageContext } from './context.js'
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, translations } from './translations.js'
import { readLocalStorage, writeLocalStorage } from '../lib/storage.js'

const normalizeLanguage = (value) => {
  const language = String(value ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0]
  return SUPPORTED_LANGUAGES.includes(language) ? language : ''
}

const detectInitialLanguage = () => {
  const storedLanguage = normalizeLanguage(readLocalStorage(LANGUAGE_STORAGE_KEY))
  if (storedLanguage) return storedLanguage

  const telegramLanguage = normalizeLanguage(
    window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code
  )
  if (telegramLanguage) return telegramLanguage

  return normalizeLanguage(window.navigator.language) || 'en'
}

const interpolate = (message, params) =>
  String(message).replace(/\{\{(\w+)\}\}/g, (_, name) => String(params?.[name] ?? ''))

function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(detectInitialLanguage)

  const setLanguage = useCallback((nextLanguage) => {
    const normalized = normalizeLanguage(nextLanguage)
    if (!normalized) return
    writeLocalStorage(LANGUAGE_STORAGE_KEY, normalized)
    setLanguageState(normalized)
  }, [])

  const t = useCallback(
    (key, params = undefined) => {
      const message = translations[language]?.[key] ?? translations.en[key] ?? key
      return interpolate(message, params)
    },
    [language]
  )

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export default LanguageProvider
