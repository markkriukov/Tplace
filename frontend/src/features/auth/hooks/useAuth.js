import { useEffect, useMemo, useState } from 'react'
import { loginDevelopment, loginTelegram } from '../api/auth.api.js'
import { authEvents } from '../../../shared/api/auth-events.js'

export function useAuth({ telegramSession, t }) {
  const [authToken, setAuthToken] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [authSource, setAuthSource] = useState('')
  const [authError, setAuthError] = useState('')
  const [isCurrentUserAdmin, setIsCurrentUserAdmin] = useState(false)

  useEffect(() => {
    const expire = event => {
      if (!authToken || event.detail !== authToken) return
      setAuthToken('')
      setIsCurrentUserAdmin(false)
      setAuthError('Authentication expired')
    }
    authEvents.addEventListener('expired', expire)
    return () => authEvents.removeEventListener('expired', expire)
  }, [authToken])

  const telegramDisplayUser =
    telegramSession.user ?? (!telegramSession.isTelegramWebApp ? telegramSession.devUser : null)

  const telegramDisplayName = useMemo(() => {
    const firstName = String(telegramDisplayUser?.first_name ?? '').trim()
    const username = String(telegramDisplayUser?.username ?? '').trim()
    if (username) return `@${username}`
    if (firstName) return firstName
    return t('nav.profile')
  }, [telegramDisplayUser, t])

  const telegramAvatarUrl =
    typeof telegramDisplayUser?.photo_url === 'string' ? telegramDisplayUser.photo_url : ''

  const telegramInitial = useMemo(() => {
    const raw = String(
      telegramDisplayUser?.first_name ?? telegramDisplayUser?.username ?? telegramDisplayUser?.id ?? '?'
    ).trim()
    return (raw[0] || '?').toUpperCase()
  }, [telegramDisplayUser])

  const { id: devUserId, username: devUsername, first_name: devFirstName } = telegramSession.devUser

  useEffect(() => {
    const controller = new AbortController()

    const bootstrapAuth = async () => {
      setAuthToken('')
      setIsCurrentUserAdmin(false)
      const hasTelegramInitData = telegramSession.isTelegramWebApp && Boolean(telegramSession.initData)
      const useDevAuth = import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEV_AUTH === 'true' && !telegramSession.isTelegramWebApp

      if (!hasTelegramInitData && !useDevAuth) {
        setAuthSource('telegram-missing-init-data')
        setAuthError('Telegram Web App opened without initData, backend auth is not possible.')
        return
      }

      setAuthSource(hasTelegramInitData ? 'telegram' : 'dev')
      setAuthError('')

      try {
        const options = { signal: controller.signal }
        const response = hasTelegramInitData
          ? await loginTelegram(telegramSession.initData, options)
          : await loginDevelopment({ id: devUserId, username: devUsername, first_name: devFirstName }, options)
        if (controller.signal.aborted) return
        const payload = response.data
        if (!response.ok) {
          setAuthError(payload?.error || `Auth failed with HTTP ${response.status}`)
          return
        }
        if (payload?.ok !== true || typeof payload.token !== 'string' || !payload.token.trim()) {
          throw new Error('Invalid authentication response')
        }
        setAuthToken(payload.token)
        setIsCurrentUserAdmin(payload.user?.is_admin === true)
        setAuthSource(payload.auth_source || (hasTelegramInitData ? 'telegram' : 'dev'))
      } catch (error) {
        if (controller.signal.aborted) return
        setAuthError(error.message)
      }
    }

    bootstrapAuth()
    return () => controller.abort()
  }, [
    retryCount,
    devFirstName,
    devUserId,
    devUsername,
    telegramSession.initData,
    telegramSession.isTelegramWebApp,
  ])

  return {
    authToken,
    authSource,
    authError,
    retryAuth: () => setRetryCount(count => count + 1),
    isCurrentUserAdmin,
    telegramDisplayName,
    telegramAvatarUrl,
    telegramInitial,
  }
}
