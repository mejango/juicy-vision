import { useEffect, useRef, type ReactNode } from 'react'
import { useBodyScrollLock } from './useBodyScrollLock'

export interface DialogShellProps {
  /** The parent owns visibility; the dialog element only exists while true. */
  isOpen: boolean
  /**
   * Called for every user-initiated dismissal (Escape, backdrop click). The
   * parent must flip `isOpen` — the shell never closes itself behind React.
   */
  onClose: () => void
  /**
   * False while a dismissal would be unsafe (a signature is pending, a
   * multi-chain send is in flight). Escape and backdrop clicks become no-ops.
   */
  dismissible?: boolean
  /** id of the heading that names the dialog. */
  labelledBy?: string
  /** id of the element that describes the dialog. */
  describedBy?: string
  /** Accessible name when there is no visible heading to point at. */
  label?: string
  /** Classes on the <dialog> itself — flex alignment and viewport padding. */
  className?: string
  /**
   * Classes on the content wrapper. Defaults to `contents`, which makes the
   * wrapper layout-transparent so a caller that already renders its own panel
   * element keeps that element as the centred box.
   */
  contentClassName?: string
  children: ReactNode
}

// The dialog fills the viewport so that clicks landing outside the content
// wrapper hit the <dialog> element itself, which is how backdrop dismissal is
// detected. `dialog-shell` (src/index.css) supplies the ::backdrop dimming and
// the [open] display toggle.
const DIALOG_BASE =
  'dialog-shell fixed inset-0 m-0 h-full max-h-full w-full max-w-full border-0 bg-transparent text-inherit'

export default function DialogShell({
  isOpen,
  onClose,
  dismissible = true,
  labelledBy,
  describedBy,
  label,
  className = 'items-center justify-center p-4',
  contentClassName = 'contents',
  children,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)

  // Escape arrives as a native `cancel` event on the dialog, which is dispatched
  // outside React's lifecycle. Reading the live props through refs lets the
  // listener stay attached for the dialog's whole lifetime.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return

    // showModal() throws InvalidStateError on an already-open dialog, and a
    // StrictMode double-invoked effect would otherwise hit exactly that.
    if (!dialog.open) dialog.showModal()

    const handleCancel = (event: Event) => {
      // Always suppress the UA's own close. `isOpen` is the single source of
      // truth; letting the browser close the element would leave a mounted but
      // invisible modal whenever the parent declines the request.
      event.preventDefault()
      if (dismissibleRef.current) onCloseRef.current()
    }
    dialog.addEventListener('cancel', handleCancel)

    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      if (dialog.open) dialog.close()
    }
    // Re-running on `isOpen` matters: a parent that toggles the same mounted
    // shell closed and open again gets a brand new <dialog> node that must be
    // shown again.
  }, [isOpen])

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={label}
      className={`${DIALOG_BASE} ${className}`}
      onMouseDown={event => {
        pressedBackdrop.current = event.target === dialogRef.current
      }}
      onClick={event => {
        // Require both the press and the release on the backdrop so that a text
        // selection dragged out of the content does not dismiss the dialog.
        const onBackdrop = pressedBackdrop.current && event.target === dialogRef.current
        pressedBackdrop.current = false
        if (onBackdrop && dismissible) onClose()
      }}
    >
      <div className={contentClassName}>{children}</div>
    </dialog>
  )
}
