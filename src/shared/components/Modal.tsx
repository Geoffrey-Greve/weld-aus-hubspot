/**
 * Modal - accessible dialog overlay using React portals.
 *
 * - Portals into `document.body` to avoid z-index stacking context issues.
 * - Closes on backdrop click and ESC key.
 * - Traps focus within the dialog (Tab / Shift+Tab cycle inside).
 * - Restores focus to the previously-focused element on close.
 * - Uses role="dialog", aria-modal, and aria-labelledby for screen readers.
 */

import React, { useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const TITLE_ID = 'wa-modal-title'

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md'
}: ModalProps): React.ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  // Remember what was focused before the modal opened so we can restore it
  const returnFocusRef = useRef<Element | null>(null)

  // Capture trigger element and focus dialog on open
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement
      // Defer so the portal has painted before we focus
      const raf = requestAnimationFrame(() => {
        if (dialogRef.current) {
          const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTORS)
          if (first) {
            first.focus()
          } else {
            dialogRef.current.focus()
          }
        }
      })
      return () => cancelAnimationFrame(raf)
    } else {
      // Restore focus when closing
      const el = returnFocusRef.current
      if (el && el instanceof HTMLElement) {
        el.focus()
      }
      returnFocusRef.current = null
    }
  }, [open])

  // Focus trap: keep Tab / Shift+Tab within the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      ).filter((el) => !el.closest('[hidden]'))

      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onClose]
  )

  if (!open) return null

  const modal = (
    <div
      className="wa-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`wa-modal wa-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? TITLE_ID : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <div className="wa-modal__header">
            <h2 id={TITLE_ID}>{title}</h2>
            <button
              type="button"
              className="wa-modal__close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              &times;
            </button>
          </div>
        )}
        <div className="wa-modal__body">{children}</div>
      </div>
    </div>
  )

  return ReactDOM.createPortal(modal, document.body)
}

export default Modal
