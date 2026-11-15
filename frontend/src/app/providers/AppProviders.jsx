import LanguageProvider from '../../shared/i18n/LanguageProvider.jsx'

function AppProviders({ children }) {
  return (
    <LanguageProvider>
      {children}
    </LanguageProvider>
  )
}

export default AppProviders
