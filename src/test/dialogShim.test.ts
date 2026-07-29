import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

// The shim is installed globally by setup.ts. These cases pin the exact subset
// of the HTMLDialogElement contract the app's DialogShell depends on, so a
// jsdom upgrade that ships a native implementation can be adopted by deleting
// the shim rather than by discovering behavioural drift in modal tests.

function mountDialog(inner = '<button type="button">action</button>'): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  dialog.innerHTML = inner
  document.body.appendChild(dialog)
  return dialog
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('dialog shim', () => {
  it('exposes showModal, show and close on HTMLDialogElement', () => {
    expect(typeof HTMLDialogElement.prototype.showModal).toBe('function')
    expect(typeof HTMLDialogElement.prototype.show).toBe('function')
    expect(typeof HTMLDialogElement.prototype.close).toBe('function')
  })

  it('showModal reflects the open attribute and makes the dialog visible', () => {
    const dialog = mountDialog()
    expect(dialog.open).toBe(false)
    expect(getComputedStyle(dialog).display).toBe('none')

    dialog.showModal()

    expect(dialog.open).toBe(true)
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(getComputedStyle(dialog).display).not.toBe('none')
  })

  it('throws InvalidStateError when showModal is called on a non-modally open dialog', () => {
    const dialog = mountDialog()
    dialog.show()

    expect(() => dialog.showModal()).toThrow(/already open/i)
    expect(dialog.open).toBe(true)
  })

  it('treats a repeated showModal on an already-modal dialog as a no-op', () => {
    const dialog = mountDialog()
    dialog.showModal()

    expect(() => dialog.showModal()).not.toThrow()
    expect(dialog.open).toBe(true)

    // The dialog must not have been pushed onto the modal stack twice, or one
    // Escape would leave a phantom entry behind.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog.open).toBe(false)
  })

  it('close clears open, records returnValue and fires a non-bubbling close event', () => {
    const dialog = mountDialog()
    const onClose = vi.fn()
    dialog.addEventListener('close', onClose)
    const bubbled = vi.fn()
    document.addEventListener('close', bubbled)

    dialog.showModal()
    dialog.close('accepted')

    expect(dialog.open).toBe(false)
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(dialog.returnValue).toBe('accepted')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(bubbled).not.toHaveBeenCalled()
    document.removeEventListener('close', bubbled)
  })

  it('close on an already-closed dialog is a no-op', () => {
    const dialog = mountDialog()
    const onClose = vi.fn()
    dialog.addEventListener('close', onClose)

    dialog.close()

    expect(onClose).not.toHaveBeenCalled()
    expect(dialog.open).toBe(false)
  })

  it('moves focus into the modal dialog and restores it on close', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const dialog = mountDialog()
    dialog.showModal()
    expect(dialog.contains(document.activeElement)).toBe(true)

    dialog.close()
    expect(document.activeElement).toBe(outside)
  })

  it('Escape dispatches a cancelable cancel event that closes the dialog by default', () => {
    const dialog = mountDialog()
    const onCancel = vi.fn()
    const onClose = vi.fn()
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('close', onClose)
    dialog.showModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel.mock.calls[0][0].cancelable).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(false)
  })

  it('Escape leaves the dialog open when cancel is prevented', () => {
    const dialog = mountDialog()
    dialog.addEventListener('cancel', event => event.preventDefault())
    dialog.showModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(dialog.open).toBe(true)
  })

  it('Escape only reaches the topmost open modal dialog', () => {
    const lower = mountDialog()
    const upper = mountDialog()
    const lowerCancel = vi.fn()
    const upperCancel = vi.fn()
    lower.addEventListener('cancel', lowerCancel)
    upper.addEventListener('cancel', upperCancel)

    lower.showModal()
    upper.showModal()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(upperCancel).toHaveBeenCalledTimes(1)
    expect(lowerCancel).not.toHaveBeenCalled()
    expect(upper.open).toBe(false)
    expect(lower.open).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(lowerCancel).toHaveBeenCalledTimes(1)
    expect(lower.open).toBe(false)
  })

  it('ignores Escape for non-modal dialogs opened with show()', () => {
    const dialog = mountDialog()
    const onCancel = vi.fn()
    dialog.addEventListener('cancel', onCancel)

    dialog.show()
    expect(dialog.open).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog.open).toBe(true)
  })

  it('drops dialogs removed from the document from the modal stack', () => {
    const dialog = mountDialog()
    dialog.showModal()
    dialog.remove()

    const survivor = mountDialog()
    const onCancel = vi.fn()
    survivor.addEventListener('cancel', onCancel)
    survivor.showModal()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
