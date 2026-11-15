import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import { useState } from 'react'
import GiftLottieOverlay from './GiftLottieOverlay.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'

function GiftCard({ gift, index, onOpen, meta, children }) {
  const { t } = useTranslation()
  const [isAnimated, setIsAnimated] = useState(false)
  return (
    <article
      className="gift-card"
      onMouseLeave={() => setIsAnimated(false)}
    >
      <button
        className="gift-image-btn"
        type="button"
        onClick={() => onOpen(gift)}
        onMouseEnter={() => setIsAnimated(true)}
        onFocus={() => setIsAnimated(true)}
        onBlur={() => setIsAnimated(false)}
        aria-label={t('gift.openMenu', { name: gift.title })}
      >
        <div className="gift-image-wrap">
          <FallbackImage src={gift.image} alt={gift.title} className="gift-image"
            loading={index < 6 ? 'eager' : 'lazy'} decoding="async" />
          <GiftLottieOverlay src={gift.lottieUrl} isActive={isAnimated} />
        </div>
      </button>
      <div className="gift-content">
        <div className="gift-head">
          <div className="gift-title">
            <h2>{gift.title}</h2>
            {meta}
          </div>
        </div>
        <div className="gift-foot">{children}</div>
      </div>
    </article>
  )
}

export default GiftCard
