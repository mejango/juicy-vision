import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DialogShell from './DialogShell'

function getDialog(): HTMLDialogElement {
  const dialog = document.querySelector('dialog')
  if (!dialog) throw new Error('no dialog rendered')
  return dialog as HTMLDialogElement
}

describe('DialogShell', () => {
  it('renders nothing while closed', () => {
    render(
      <DialogShell isOpen={false} onClose={vi.fn()}>
        <p>body</p>
      </DialogShell>,
    )
    expect(document.querySelector('dialog')).toBeNull()
    expect(screen.queryByText('body')).not.toBeInTheDocument()
  })

  it('opens a native dialog in the top layer via showModal', () => {
    render(
      <DialogShell isOpen onClose={vi.fn()}>
        <p>body</p>
      </DialogShell>,
    )
    const dialog = getDialog()
    expect(dialog.open).toBe(true)
    expect(screen.getByText('body')).toBeVisible()
    // showModal() gives role=dialog + modal semantics implicitly.
    expect(screen.getByRole('dialog')).toBe(dialog)
  })

  it('does not carry the manual modal attributes that showModal supersedes', () => {
    render(
      <DialogShell isOpen onClose={vi.fn()} labelledBy="t" describedBy="d">
        <h2 id="t">Title</h2>
        <p id="d">Description</p>
      </DialogShell>,
    )
    const dialog = getDialog()
    expect(dialog.hasAttribute('role')).toBe(false)
    expect(dialog.hasAttribute('aria-modal')).toBe(false)
    expect(dialog.getAttribute('aria-labelledby')).toBe('t')
    expect(dialog.getAttribute('aria-describedby')).toBe('d')
  })

  it('guards against calling showModal on an already-open dialog', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const { rerender } = render(
      <DialogShell isOpen onClose={vi.fn()}>
        <p>body</p>
      </DialogShell>,
    )
    rerender(
      <DialogShell isOpen onClose={vi.fn()}>
        <p>body again</p>
      </DialogShell>,
    )
    expect(showModal).toHaveBeenCalledTimes(1)
    showModal.mockRestore()
  })

  it('closes the dialog when it unmounts', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const { rerender } = render(
      <DialogShell isOpen onClose={vi.fn()}>
        <p>body</p>
      </DialogShell>,
    )
    rerender(
      <DialogShell isOpen={false} onClose={vi.fn()}>
        <p>body</p>
      </DialogShell>,
    )
    expect(close).toHaveBeenCalled()
    expect(document.querySelector('dialog')).toBeNull()
    close.mockRestore()
  })

  describe('escape', () => {
    it('routes the native cancel event to onClose', () => {
      const onClose = vi.fn()
      render(
        <DialogShell isOpen onClose={onClose}>
          <p>body</p>
        </DialogShell>,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('keeps React as the source of truth by preventing the default close', () => {
      // The parent owns `isOpen`; letting the UA close the dialog behind React's
      // back would leave a mounted-but-invisible modal if the parent declines.
      render(
        <DialogShell isOpen onClose={vi.fn()}>
          <p>body</p>
        </DialogShell>,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(getDialog().open).toBe(true)
    })

    it('blocks escape entirely when the dialog is not dismissible', () => {
      const onClose = vi.fn()
      render(
        <DialogShell isOpen dismissible={false} onClose={onClose}>
          <p>body</p>
        </DialogShell>,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
      expect(getDialog().open).toBe(true)
    })

    it('reads the latest dismissible value without remounting the dialog', () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <DialogShell isOpen dismissible={false} onClose={onClose}>
          <p>body</p>
        </DialogShell>,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()

      rerender(
        <DialogShell isOpen dismissible onClose={onClose}>
          <p>body</p>
        </DialogShell>,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('backdrop click', () => {
    it('closes when the press and the click both land on the dialog itself', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <DialogShell isOpen onClose={onClose}>
          <p>body</p>
        </DialogShell>,
      )
      await user.click(getDialog())
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ignores clicks inside the content wrapper', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <DialogShell isOpen onClose={onClose}>
          <button type="button">inside</button>
        </DialogShell>,
      )
      await user.click(screen.getByRole('button', { name: 'inside' }))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('ignores a drag that starts inside the content and ends on the backdrop', () => {
      const onClose = vi.fn()
      render(
        <DialogShell isOpen onClose={onClose}>
          <p>selectable calldata</p>
        </DialogShell>,
      )
      fireEvent.mouseDown(screen.getByText('selectable calldata'))
      fireEvent.click(getDialog())
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does not close on backdrop click when not dismissible', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <DialogShell isOpen dismissible={false} onClose={onClose}>
          <p>body</p>
        </DialogShell>,
      )
      await user.click(getDialog())
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('body scroll lock', () => {
    it('is reference counted across stacked dialogs', () => {
      document.body.style.overflow = 'scroll'

      const first = render(
        <DialogShell isOpen onClose={vi.fn()}>
          <p>first</p>
        </DialogShell>,
      )
      expect(document.body.style.overflow).toBe('hidden')

      const second = render(
        <DialogShell isOpen onClose={vi.fn()}>
          <p>second</p>
        </DialogShell>,
      )
      expect(document.body.style.overflow).toBe('hidden')

      second.unmount()
      // The outer dialog is still open, so the lock must survive.
      expect(document.body.style.overflow).toBe('hidden')

      first.unmount()
      expect(document.body.style.overflow).toBe('scroll')

      document.body.style.overflow = ''
    })

    it('does not lock while closed', () => {
      render(
        <DialogShell isOpen={false} onClose={vi.fn()}>
          <p>body</p>
        </DialogShell>,
      )
      expect(document.body.style.overflow).toBe('')
    })
  })

  // Body-level portals are inert under an open modal dialog, so in-modal
  // pickers must live in the dialog's own subtree. These pin that the ordinary
  // in-tree controls the app actually uses stay interactive inside a dialog.
  describe('in-dialog controls', () => {
    it('keeps a native select usable', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <DialogShell isOpen onClose={vi.fn()}>
          <label htmlFor="chain">Chain</label>
          <select id="chain" defaultValue="1" onChange={event => onChange(event.target.value)}>
            <option value="1">Ethereum</option>
            <option value="8453">Base</option>
          </select>
        </DialogShell>,
      )

      const select = screen.getByLabelText('Chain')
      await user.selectOptions(select, '8453')

      expect(onChange).toHaveBeenCalledWith('8453')
      expect((select as HTMLSelectElement).value).toBe('8453')
    })

    it('keeps typing and clicking inside the dialog working', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(
        <DialogShell isOpen onClose={vi.fn()}>
          <input aria-label="amount" />
          <button type="button" onClick={onClick}>
            Confirm
          </button>
        </DialogShell>,
      )

      await user.type(screen.getByLabelText('amount'), '12.5')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(screen.getByLabelText('amount')).toHaveValue('12.5')
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  it('defaults the content wrapper to display:contents so a caller panel stays the centred box', () => {
    render(
      <DialogShell isOpen onClose={vi.fn()}>
        <div data-testid="panel">body</div>
      </DialogShell>,
    )
    const wrapper = getDialog().firstElementChild as HTMLElement
    expect(wrapper.className).toBe('contents')
    expect(wrapper.firstElementChild).toBe(screen.getByTestId('panel'))
  })

  it('applies caller styling to the content wrapper and the dialog', () => {
    render(
      <DialogShell isOpen onClose={vi.fn()} className="items-end" contentClassName="max-w-md bg-white">
        <p>body</p>
      </DialogShell>,
    )
    const dialog = getDialog()
    expect(dialog.className).toContain('items-end')
    const content = dialog.firstElementChild as HTMLElement
    expect(content.className).toContain('max-w-md')
    expect(content.className).toContain('bg-white')
  })
})
