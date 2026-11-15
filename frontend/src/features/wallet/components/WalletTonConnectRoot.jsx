import { THEME, TonConnectUIProvider } from '@tonconnect/ui-react'

function WalletTonConnectRoot({ children, manifestUrl, twaReturnUrl = '' }) {
  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      restoreConnection
      walletsRequiredFeatures={{ sendTransaction: { minMessages: 1 } }}
      language="en"
      uiPreferences={{
        theme: THEME.DARK,
        borderRadius: 'm',
        colorsSet: {
          [THEME.DARK]: {
            accent: 'var(--color-accent)',
            connectButton: { background: 'var(--color-accent)', foreground: 'var(--color-on-accent)' },
            background: {
              primary: 'var(--color-surface)', secondary: 'var(--color-surface-raised)',
              segment: 'var(--color-surface-inset)', tint: 'var(--color-accent-soft)',
            },
            text: { primary: 'var(--color-text)', secondary: 'var(--color-text-secondary)' },
            icon: {
              primary: 'var(--color-accent)', secondary: 'var(--color-text-secondary)',
              tertiary: 'var(--color-text-muted)', success: 'var(--color-success)', error: 'var(--color-danger)',
            },
          },
        },
      }}
      actionsConfiguration={twaReturnUrl ? { twaReturnUrl } : undefined}
    >
      {children}
    </TonConnectUIProvider>
  )
}

export default WalletTonConnectRoot
