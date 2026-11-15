const locales = { uk: 'uk-UA', en: 'en-GB' }
const formattersByLocale = new Map()

export function getDateFormatters(language) {
  const locale = locales[language] || locales.en
  if (!formattersByLocale.has(locale)) {
    formattersByLocale.set(locale, {
      date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }),
      short: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      news: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
      sale: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    })
  }
  return formattersByLocale.get(locale)
}
