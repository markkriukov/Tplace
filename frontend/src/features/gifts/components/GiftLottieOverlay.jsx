import { useEffect, useRef } from 'react'

const lottieJsonCache = new Map()
const lottieJsonRequestCache = new Map()

async function loadLottieJson(src) {
  if (lottieJsonCache.has(src)) {
    return lottieJsonCache.get(src)
  }
  if (lottieJsonRequestCache.has(src)) {
    return lottieJsonRequestCache.get(src)
  }

  const request = fetch(src)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load lottie: ${response.status}`)
      }
      return response.json()
    })
    .then((json) => {
      if (lottieJsonCache.size >= 50) lottieJsonCache.delete(lottieJsonCache.keys().next().value)
      lottieJsonCache.set(src, json)
      lottieJsonRequestCache.delete(src)
      return json
    })
    .catch((error) => {
      lottieJsonRequestCache.delete(src)
      throw error
    })

  lottieJsonRequestCache.set(src, request)
  return request
}

function GiftLottieOverlay({ src, isActive, className = '' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isActive || !src || !containerRef.current) return undefined

    let destroyed = false
    let animation = null

    const start = async () => {
      try {
        // Gift animations are TGS (no expressions), so the SVG-only light build
        // suffices: about half the size, and no eval() under a strict CSP.
        const [animationData, { default: lottie }] = await Promise.all([
          loadLottieJson(src),
          import('lottie-web/build/player/lottie_light'),
        ])
        if (destroyed || !containerRef.current) return

        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid meet',
          },
        })
      } catch {
        // ignore load errors: fallback static image remains visible
      }
    }

    start()

    return () => {
      destroyed = true
      if (animation) {
        animation.destroy()
      }
    }
  }, [src, isActive])

  if (!isActive || !src) return null

  return (
    <div className={`gift-lottie-overlay ${className}`.trim()} aria-hidden>
      <div ref={containerRef} className="gift-lottie-canvas" />
    </div>
  )
}

export default GiftLottieOverlay
