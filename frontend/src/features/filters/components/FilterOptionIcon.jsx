import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
function toHexColor(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const masked = Math.max(0, Math.floor(numeric)) & 0xffffff
  return `#${masked.toString(16).padStart(6, '0').toUpperCase()}`
}

function buildColorPreviewStyle(option) {
  const center = toHexColor(option?.colorCenter)
  const edge = toHexColor(option?.colorEdge)
  const pattern = toHexColor(option?.colorPattern)

  if (center && edge) {
    return { background: `radial-gradient(circle at 35% 30%, ${center}, ${edge})` }
  }
  if (center) return { background: center }
  if (edge) return { background: edge }
  if (pattern) return { background: pattern }
  return {}
}

function FilterOptionIcon({ option }) {
  const previewType = option?.previewType
  const previewUrl = typeof option?.previewUrl === 'string' ? option.previewUrl.trim() : ''
  const previewTitle = typeof option?.previewTitle === 'string' ? option.previewTitle : ''
  const previewVariant =
    typeof option?.previewVariant === 'string' ? option.previewVariant.trim() : ''
  const imageClassName = previewVariant
    ? `item-icon item-icon-image item-icon-image-${previewVariant}`
    : 'item-icon item-icon-image'

  if (previewType === 'image' && previewUrl) {
    return (
      <span className={imageClassName} title={previewTitle || option?.value}>
        <FallbackImage src={previewUrl} alt="" loading="lazy" />
      </span>
    )
  }

  if (previewType === 'color') {
    return (
      <span
        className="item-icon item-icon-color"
        style={buildColorPreviewStyle(option)}
        title={previewTitle || option?.value}
      />
    )
  }

  return <span className="item-icon">{option?.icon}</span>
}

export default FilterOptionIcon
