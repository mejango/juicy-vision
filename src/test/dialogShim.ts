// TEST-ONLY shim for the parts of HTMLDialogElement that jsdom 29 does not
// implement (`showModal`, `show`, `close`, `returnValue`, and the `cancel` /
// `close` events). Production code depends on native `<dialog>` semantics, so
// without this every component test that renders a modal would render a
// permanently-closed (`display: none`) dialog.
//
// jsdom already reflects the `open` content attribute onto the `open` IDL
// property and already applies the `dialog:not([open]) { display: none }` UA
// rule, so this shim only has to drive that attribute and dispatch the events.
//
// Behaviour follows the current HTML spec: `showModal()` on a dialog that is
// already modal is a no-op, while `showModal()` on a dialog opened non-modally
// with `show()` throws InvalidStateError.
//
// Delete this file when jsdom ships a native implementation.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface ModalEntry {
  dialog: HTMLDialogElement
  previouslyFocused: Element | null
}

const modalStack: ModalEntry[] = []
const nonModalOpen = new WeakSet<HTMLDialogElement>()

function pruneStack(): void {
  for (let index = modalStack.length - 1; index >= 0; index -= 1) {
    const { dialog } = modalStack[index]
    if (!dialog.isConnected || !dialog.hasAttribute('open')) modalStack.splice(index, 1)
  }
}

function removeFromStack(dialog: HTMLDialogElement): ModalEntry | undefined {
  const index = modalStack.findIndex(entry => entry.dialog === dialog)
  if (index === -1) return undefined
  return modalStack.splice(index, 1)[0]
}

function focusInto(dialog: HTMLDialogElement): void {
  const autofocus = dialog.querySelector<HTMLElement>('[autofocus]')
  const target = autofocus ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
  if (target) {
    target.focus()
    return
  }
  // A dialog with no focusable content takes focus itself, matching browsers.
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1')
  dialog.focus()
}

function invalidState(message: string): Error {
  // jsdom exposes DOMException globally; fall back to Error under any runtime
  // that does not.
  const DomException = globalThis.DOMException
  return DomException
    ? new DomException(message, 'InvalidStateError')
    : new Error(message)
}

function closeDialog(dialog: HTMLDialogElement, returnValue?: string): void {
  if (!dialog.hasAttribute('open')) return
  if (returnValue !== undefined) dialog.returnValue = returnValue
  dialog.removeAttribute('open')
  const entry = removeFromStack(dialog)
  nonModalOpen.delete(dialog)
  const previous = entry?.previouslyFocused
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
  dialog.dispatchEvent(new Event('close', { bubbles: false, cancelable: false }))
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  pruneStack()
  const top = modalStack[modalStack.length - 1]
  if (!top) return
  const cancel = new Event('cancel', { bubbles: false, cancelable: true })
  const notPrevented = top.dialog.dispatchEvent(cancel)
  if (notPrevented) closeDialog(top.dialog)
}

let installed = false

export function installDialogShim(): void {
  if (installed) return
  installed = true

  const prototype = HTMLDialogElement.prototype as HTMLDialogElement

  if (typeof prototype.showModal !== 'function') {
    prototype.showModal = function showModal(this: HTMLDialogElement): void {
      if (this.hasAttribute('open')) {
        if (nonModalOpen.has(this)) {
          throw invalidState(
            'The dialog is already open as a non-modal dialog, and therefore cannot be opened as a modal dialog.',
          )
        }
        return
      }
      const previouslyFocused = document.activeElement
      this.setAttribute('open', '')
      modalStack.push({ dialog: this, previouslyFocused })
      focusInto(this)
    }
  }

  if (typeof prototype.show !== 'function') {
    prototype.show = function show(this: HTMLDialogElement): void {
      if (this.hasAttribute('open')) return
      this.setAttribute('open', '')
      nonModalOpen.add(this)
    }
  }

  if (typeof prototype.close !== 'function') {
    prototype.close = function close(this: HTMLDialogElement, returnValue?: string): void {
      closeDialog(this, returnValue)
    }
  }

  if (!('returnValue' in prototype)) {
    const values = new WeakMap<HTMLDialogElement, string>()
    Object.defineProperty(prototype, 'returnValue', {
      configurable: true,
      get(this: HTMLDialogElement) {
        return values.get(this) ?? ''
      },
      set(this: HTMLDialogElement, value: string) {
        values.set(this, String(value))
      },
    })
  }

  document.addEventListener('keydown', handleEscape)
}

// Component tests unmount dialogs rather than closing them, so the stack has to
// be emptied between cases or a stale entry would swallow the next Escape.
export function resetDialogShim(): void {
  modalStack.length = 0
}
