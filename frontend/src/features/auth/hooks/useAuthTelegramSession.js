import { useCallback, useEffect, useState } from 'react'
import { readLocalStorage, writeLocalStorage } from '../../../shared/lib/storage.js'
import { updateTelegramAppearance } from '../lib/telegram-appearance.js'
import {
  useExpand,
  useInitData,
  useWebApp,
} from '@vkruglikov/react-telegram-web-app'

const getStartParamFromLocation = () => {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('tgWebAppStartParam') ?? ''
}

const getDevTelegramUser = () => ({
  id: import.meta.env.VITE_DEV_TELEGRAM_ID ?? '100001',
  username: import.meta.env.VITE_DEV_USERNAME ?? 'dev_user',
  first_name: import.meta.env.VITE_DEV_FIRST_NAME ?? 'Dev',
})
const devUser = getDevTelegramUser()

const getInitialDebugEnabled = () => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('tgDebug') === '1' || readLocalStorage('tgDebug') === '1'
}

const buildWebAppLogPayload = ({
  initData,
  initDataUnsafe,
  isTelegramWebApp,
  startParam,
  webApp,
}) => ({
  isTelegramWebApp,
  initData,
  initDataUnsafe,
  user: initDataUnsafe?.user ?? null,
  receiver: initDataUnsafe?.receiver ?? null,
  chat: initDataUnsafe?.chat ?? null,
  startParam,
  webApp: webApp
    ? {
        version: webApp.version,
        platform: webApp.platform,
        viewportHeight: webApp.viewportHeight,
        viewportStableHeight: webApp.viewportStableHeight,
        isExpanded: webApp.isExpanded,
        isClosingConfirmationEnabled: webApp.isClosingConfirmationEnabled,
      }
    : null,
})

export function useAuthTelegramSession() {
  const webApp = useWebApp()
  const [initDataUnsafe, initData] = useInitData()
  const [isExpanded, expand] = useExpand()

  const platform = typeof webApp?.platform === 'string' ? webApp.platform : ''
  const isTelegramWebApp = Boolean(webApp && (initData || (platform && platform !== 'unknown')))
  const user = initDataUnsafe?.user ?? null
  const startParam = initDataUnsafe?.start_param ?? getStartParamFromLocation()
  const [debugEnabled, setDebugEnabledState] = useState(getInitialDebugEnabled)
  const setDebugEnabled = useCallback((nextValue) => {
    const nextEnabled = Boolean(nextValue)
    setDebugEnabledState(nextEnabled)
    writeLocalStorage('tgDebug', nextEnabled ? '1' : null)
  }, [])

  useEffect(() => {
    if (!webApp || !isTelegramWebApp) return

    webApp.ready?.()
    if (!webApp.isExpanded) {
      expand?.()
    }
  }, [webApp, expand, isTelegramWebApp])

  useEffect(() => {
    if (!webApp || !isTelegramWebApp) return

    const palette = getComputedStyle(document.documentElement)
    const backgroundColor = palette.getPropertyValue('--color-bg').trim()
    const headerColor = palette.getPropertyValue('--color-surface').trim()

    updateTelegramAppearance(webApp, { headerColor, backgroundColor })
  }, [webApp, isTelegramWebApp])

  useEffect(() => {
    if (!debugEnabled) return

    console.info(
      '[Telegram WebApp debug]',
      buildWebAppLogPayload({
        initData,
        initDataUnsafe,
        isTelegramWebApp,
        startParam,
        webApp,
      })
    )
  }, [debugEnabled, initData, initDataUnsafe, isTelegramWebApp, startParam, webApp])

  return {
    webApp,
    initData: initData ?? '',
    initDataUnsafe: initDataUnsafe ?? null,
    user,
    devUser,
    startParam,
    isExpanded: Boolean(isExpanded ?? webApp?.isExpanded),
    isTelegramWebApp,
    debugEnabled,
    setDebugEnabled,
    platform,
    version: webApp?.version ?? '',
    viewportHeight: webApp?.viewportHeight ?? null,
    viewportStableHeight: webApp?.viewportStableHeight ?? null,
  }
}
