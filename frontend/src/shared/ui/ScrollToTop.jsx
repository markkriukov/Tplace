import { useEffect, useState } from 'react'
import { useTranslation } from '../i18n/useTranslation.js'
import './scroll-to-top.css'

function ScrollToTop() {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(() => window.scrollY > 320)

  useEffect(() => {
    const onScroll = () => setIsVisible(window.scrollY > 320)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!isVisible) return null

  return (
    <button
      type="button"
      className="scroll-to-top"
      aria-label={t('common.scrollToTop')}
      title={t('common.scrollToTop')}
      onClick={() => window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      })}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 11 6-6 6 6M12 5v14" />
      </svg>
    </button>
  )
}

export default ScrollToTop
