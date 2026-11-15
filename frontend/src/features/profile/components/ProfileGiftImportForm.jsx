import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { createGiftImport, getGiftImport } from '../api/profile.api.js'
import { startVisiblePolling } from '../../../shared/lib/visible-polling.js'

const active = job => job && ['queued', 'running'].includes(job.status)

function ProfileGiftImportForm({ authToken, onCompleted }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [maximum, setMaximum] = useState('20')
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [revision, setRevision] = useState(0)
  const attempt = useRef(null)
  const submission = useRef(null)
  const notified = useRef(null)
  const completed = useRef(onCompleted)
  useEffect(() => { completed.current = onCompleted }, [onCompleted])
  useEffect(() => () => submission.current?.abort(), [])

  useEffect(() => {
    if (!authToken) return
    return startVisiblePolling(async signal => {
      try {
        const response = await getGiftImport({ token: authToken, signal })
        if (!response.ok || response.data?.ok !== true) throw new Error('Import status unavailable')
        if (signal.aborted) return
        const next = response.data.job
        setJob(next)
        setError(false)
        if (next?.status === 'completed' && notified.current !== next.id) {
          notified.current = next.id
          completed.current?.()
        }
        return Boolean(active(next))
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }, { intervalMs: 2000, onError: () => { setError(true); setLoading(false) } })
  }, [authToken, revision])

  const submit = async event => {
    event.preventDefault()
    if (submission.current || active(job) || loading) return
    const input = { username: username.trim().replace(/^@/, '').toLowerCase(), max_count: Number(maximum) }
    if (!/^[a-z][a-z0-9_]{3,31}$/.test(input.username) || !Number.isInteger(input.max_count) || input.max_count < 1 || input.max_count > 1000) return
    const fingerprint = JSON.stringify(input)
    if (attempt.current?.fingerprint !== fingerprint || ['completed', 'failed'].includes(job?.status)) {
      attempt.current = { fingerprint, key: crypto.randomUUID() }
    }
    const controller = new AbortController()
    submission.current = controller
    setSending(true)
    setError(false)
    setSubmitError(false)
    setJob(null)
    try {
      const response = await createGiftImport({ ...input, request_key: attempt.current.key }, { token: authToken,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
      if (controller.signal.aborted) return
      if (!response.ok || !response.data?.job) throw new Error('Import not queued')
      setJob(response.data.job)
    } catch {
      if (!controller.signal.aborted) setSubmitError(true)
    } finally {
      submission.current = null
      if (!controller.signal.aborted) {
        setSending(false)
        setRevision(value => value + 1)
      }
    }
  }

  const disabled = !authToken || loading || sending || Boolean(active(job))
  return <form className="gift-import-form" onSubmit={submit} aria-label={t('settings.importGifts')}>
    <h3>{t('settings.importGifts')}</h3>
    <p>{t('settings.importDescription')}</p>
    <label>{t('settings.importUsername')}
      <input value={username} onChange={event => setUsername(event.target.value)} placeholder="@username"
        required pattern="@?[A-Za-z][A-Za-z0-9_]{3,31}" maxLength={33} autoComplete="off" disabled={disabled} />
    </label>
    <label>{t('settings.importMaximum')}
      <input type="number" min="1" max="1000" step="1" required value={maximum}
        onChange={event => setMaximum(event.target.value)} disabled={disabled} />
    </label>
    <button type="submit" className="settings-debug-toggle" disabled={disabled}>{t('settings.importGifts')}</button>
    {error && <p role="alert">{t('settings.importConnectionError')}</p>}
    {submitError && <p role="alert">{t('settings.importSubmitError')}</p>}
    {job && <div role="status" aria-live="polite">
      <p>@{job.username}: {t(`settings.importStatus.${job.status}`)}</p>
      {job.status === 'completed' && <p>{t('settings.importResult', job.result)}</p>}
      {job.status === 'failed' && <p>{t(`settings.importError.${job.error_code || 'IMPORT_FAILED'}`)}</p>}
    </div>}
  </form>
}

export default ProfileGiftImportForm
