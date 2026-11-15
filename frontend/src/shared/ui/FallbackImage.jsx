import { useState } from 'react'
import { DEFAULT_PLACEHOLDER_IMAGE } from '../config/placeholder-images.js'

function ImageAttempt({ src, fallbackSrc, fallback, alt = '', ...props }) {
  const [stage, setStage] = useState(0)
  if (stage === 2 || (!src && !fallbackSrc)) {
    return fallback ?? <span className={props.className} role="img" aria-label={alt} />
  }
  return <img {...props} alt={alt} src={stage === 1 ? fallbackSrc : src || fallbackSrc}
    onError={() => setStage(stage === 0 && src && fallbackSrc && src !== fallbackSrc ? 1 : 2)} />
}

function FallbackImage({ fallbackSrc = DEFAULT_PLACEHOLDER_IMAGE, ...props }) {
  return <ImageAttempt key={props.src} {...props} fallbackSrc={fallbackSrc} />
}

export default FallbackImage
