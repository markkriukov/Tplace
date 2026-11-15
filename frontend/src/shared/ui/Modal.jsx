import { useEffect, useRef, useId } from 'react'
import { lockBodyScroll } from '../lib/body-scroll-lock.js'

function Modal({ children, onClose, className, ...props }) {
  const ref = useRef(null)
  const close = useRef(onClose)
  const id = useId()
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => lockBodyScroll(), [])
  useEffect(() => {
    const element = ref.current
    const previous = document.activeElement
    const title = element.querySelector('h1,h2,h3,[class*="title"]')
    if (title && !element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) {
      title.id ||= `${id}-title`
      element.setAttribute('aria-labelledby', title.id)
    }
    const focusable = () => [...element.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length)
    ;(focusable()[0] ?? element).focus()
    const isTop = () => [...document.querySelectorAll('[data-modal-root]')].at(-1) === element
    const keydown = event => {
      if (!isTop()) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current?.() }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      const index = nodes.indexOf(document.activeElement)
      if (!nodes.length) { event.preventDefault(); element.focus(); return }
      if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1).focus() }
      else if (!event.shiftKey && (index === nodes.length - 1 || index === -1)) { event.preventDefault(); nodes[0].focus() }
    }
    const focusin = event => { if (isTop() && !element.contains(event.target)) (focusable()[0] ?? element).focus() }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('focusin', focusin)
      if (previous?.isConnected) previous.focus()
    }
  }, [id])
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} data-modal-root className={className} onClick={event => { if (event.target === event.currentTarget) onClose?.() }} {...props}>
      {children}
    </div>
  )
}

export default Modal
