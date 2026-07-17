import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  wide?: boolean
  children: ReactNode
}

/**
 * Envuelve <dialog> nativo: el navegador nos da atrapado del foco, capa
 * superior y backdrop gratis — nada de reimplementarlos a mano.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  wide = false,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  // `cancel` cubre el gesto de atrás de Android y la tecla Esc.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const handleCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }

    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onClose])

  return (
    <dialog ref={ref} className={cn(styles.dialog, wide && styles.wide)}>
      {open && (
        <>
          {title && (
            <header className={styles.header}>
              <div>
                <h2 className={styles.title}>{title}</h2>
                {description && <p className={styles.description}>{description}</p>}
              </div>
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </header>
          )}

          <div className={styles.body}>{children}</div>

          {footer && <footer className={styles.footer}>{footer}</footer>}
        </>
      )}
    </dialog>
  )
}
