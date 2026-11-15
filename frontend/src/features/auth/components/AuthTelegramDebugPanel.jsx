const buildInitDataKeys = (initData) => {
  if (!initData) return []
  return [...new URLSearchParams(initData).keys()]
}

const maskHash = (value) => {
  if (!value) return ''
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-6)}`
}

function AuthTelegramDebugPanel({ session, authSource, authError }) {
  if (!session?.debugEnabled) return null

  const initDataKeys = buildInitDataKeys(session.initData)
  const initDataParams = new URLSearchParams(session.initData)
  const hash = initDataParams.get('hash') ?? ''

  return (
    <section className="telegram-debug-panel" aria-label="Telegram Web App debug">
      <div className="telegram-debug-row">
        <span>environment</span>
        <strong>{session.isTelegramWebApp ? 'Telegram Web App' : 'browser'}</strong>
      </div>
      <div className="telegram-debug-row">
        <span>auth</span>
        <strong>{authSource || 'pending'}</strong>
      </div>
      {authError && <div className="telegram-debug-error">{authError}</div>}
      <pre>
        {JSON.stringify(
          {
            platform: session.platform || null,
            version: session.version || null,
            isExpanded: session.isExpanded,
            viewportHeight: session.viewportHeight,
            viewportStableHeight: session.viewportStableHeight,
            startParam: session.startParam || null,
            initData: session.initData
              ? {
                  length: session.initData.length,
                  keys: initDataKeys,
                  hash: maskHash(hash),
                }
              : null,
            initDataUnsafe: session.initDataUnsafe,
          },
          null,
          2
        )}
      </pre>
    </section>
  )
}

export default AuthTelegramDebugPanel
