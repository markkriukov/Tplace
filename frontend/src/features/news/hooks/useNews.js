import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getNews, createNews, updateNews, deleteNews } from '../api/news.api.js'
import { mapNewsItemFromApi } from '../lib/news-utils.js'

const newsRequestError = (payload, fallback) =>
  typeof payload?.error === 'string' && payload.error.trim() ? payload.error.trim() : fallback

export function useNews({ authToken, language, isNewsView }) {
  const [newsData, setNewsData] = useState([])
  const [hasLoadedNews, setHasLoadedNews] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isCreatingNews, setIsCreatingNews] = useState(false)
  const [updatingNewsId, setUpdatingNewsId] = useState(null)
  const [deletingNewsId, setDeletingNewsId] = useState(null)
  const loadController = useRef(null)
  const mutationInFlight = useRef(false)
  const newsItems = useMemo(() => newsData
    .filter((item) => Boolean(item?.id))
    .map((item) => mapNewsItemFromApi(item, language)), [newsData, language])

  const loadNews = useCallback(async () => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    const { signal } = controller
    setIsLoading(true)
    setLoadError(false)
    try {
      const response = await getNews({ signal })
      if (signal.aborted) return
      const payload = response.data
      if (!response.ok || !payload?.ok || !Array.isArray(payload.news)) throw new Error('NEWS_LOAD_FAILED')
      setNewsData(payload.news)
      setHasLoadedNews(true)
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return
      setLoadError(true)
    } finally {
      if (!signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isNewsView) return
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && !mutationInFlight.current) void loadNews()
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      loadController.current?.abort()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadNews, isNewsView])

  const beginMutation = () => {
    if (mutationInFlight.current) return false
    if (!authToken) throw new Error('common.authMissing')
    mutationInFlight.current = true
    loadController.current?.abort()
    setIsLoading(false)
    setLoadError(false)
    return true
  }

  const createNewsItem = async (news) => {
    if (!beginMutation()) return false
    setIsCreatingNews(true)
    try {
      const response = await createNews(news, { token: authToken }).catch(() => { throw new Error('news.createFailed') })
      const payload = response.data
      if (!response.ok || !payload?.ok) throw new Error(newsRequestError(payload, 'news.createFailed'))
      const created = payload.news
      const createdId = String(created?.id ?? '')
      if (createdId) {
        setNewsData((prev) => [created, ...prev.filter((item) => String(item?.id) !== createdId)])
        setHasLoadedNews(true)
      } else {
        await loadNews()
      }
      return true
    } finally {
      mutationInFlight.current = false
      setIsCreatingNews(false)
    }
  }

  const updateNewsItem = async (newsId, changes) => {
    if (!newsId) throw new Error('news.invalidId')
    if (!beginMutation()) return false
    setUpdatingNewsId(newsId)
    try {
      const response = await updateNews(newsId, changes, { token: authToken }).catch(() => { throw new Error('news.updateFailed') })
      const payload = response.data
      if (!response.ok || !payload?.ok) throw new Error(newsRequestError(payload, 'news.updateFailed'))
      const updated = payload.news
      const updatedId = String(updated?.id ?? '')
      if (updatedId) {
        setNewsData((prev) => prev.map((item) => (String(item?.id) === updatedId ? updated : item)))
      } else {
        await loadNews()
      }
      return true
    } finally {
      mutationInFlight.current = false
      setUpdatingNewsId(null)
    }
  }

  const removeNewsItem = async (newsId) => {
    if (!newsId) throw new Error('news.invalidId')
    if (!beginMutation()) return false
    setDeletingNewsId(newsId)
    try {
      const response = await deleteNews(newsId, { token: authToken }).catch(() => { throw new Error('news.deleteFailed') })
      const payload = response.data
      if (!response.ok || !payload?.ok) throw new Error(newsRequestError(payload, 'news.deleteFailed'))
      setNewsData((prev) => prev.filter((item) => String(item?.id) !== newsId))
      return true
    } finally {
      mutationInFlight.current = false
      setDeletingNewsId(null)
    }
  }

  return {
    newsItems, hasLoadedNews, isLoading, loadError, loadNews,
    isCreatingNews, updatingNewsId, deletingNewsId,
    isMutating: isCreatingNews || updatingNewsId !== null || deletingNewsId !== null,
    createNewsItem, updateNewsItem, removeNewsItem,
  }
}
