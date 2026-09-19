import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

/**
 * Modal accesible sin dependencias externas:
 * cierra con Escape, bloquea el scroll, devuelve el foco y atrapa el tabulador.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panelRef = useRef(null)
  const previouslyFocused = useRef(null)

  /**
   * onClose cambia de identidad en cada render del padre. Guardarlo en una
   * ref deja que el efecto dependa solo de `open`: si dependiera de onClose se
   * volvería a montar en cada tecla, devolviendo el foco al botón de cerrar y
   * haciendo imposible escribir en el formulario.
   */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined

    previouslyFocused.current = document.activeElement
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const focusable = () =>
      panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []

    // Al abrir, el foco va al primer control real; el botón de cerrar solo
    // recibe el foco si no hay nada más dentro del diálogo.
    const timer = window.setTimeout(() => {
      const items = [...focusable()]
      const target = items.find((item) => !item.hasAttribute('data-dialog-close')) ?? items[0]
      target?.focus()
    }, 30)

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return

      const items = [...focusable()]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-navy-900/50 backdrop-blur-[1px]"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl',
          'sm:rounded-2xl',
          sizes[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#edf1f5] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar ventana"
            data-dialog-close=""
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-[#e5eaf0] px-5 py-4 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirmar', loading }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">Esta acción queda registrada en la bitácora del centro.</p>
    </Dialog>
  )
}
