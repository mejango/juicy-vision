import { expect, test } from '../fixtures/local-only'

/**
 * Every modal in this app is a native <dialog> opened with showModal(), which
 * promotes it to the browser's top layer and makes the rest of the document
 * inert. That is a browser guarantee, not app code, so it can only be proven
 * here: jsdom implements neither the top layer nor inertness.
 *
 * What these cases lock down:
 *  - background content is neither focusable nor clickable while a modal is open
 *  - a second modal opened over the first is the one that receives interaction
 *  - closing restores the background exactly as it was, including the
 *    reference-counted body scroll lock
 */

const CHAT_INPUT = "What's your juicy vision?"

/** Opens the standalone create-project wizard, a real DialogShell modal. */
async function openCreateFlow(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'create form' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a project' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Raises the exact-payment review modal, which stacks over whatever is open. */
async function openPaymentReview(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __reviewResult?: boolean }).__reviewResult = undefined
    window.dispatchEvent(
      new CustomEvent('juice:payment-review-request', {
        detail: {
          review: {
            txId: 'stacked-review',
            account: '0x1234567890123456789012345678901234567890',
            chainId: 1,
            chainName: 'Ethereum',
            projectId: '7',
            terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
            route: 'direct terminal payment',
            tokenSymbol: 'USDC',
            tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            amount: '12.5',
            amountRaw: '12500000',
            valueRaw: '0',
            beneficiary: '0x1234567890123456789012345678901234567890',
            memo: 'membership',
            rulesetId: '9',
            expectedProjectTokens: '0',
            minimumProjectTokens: '0',
            metadata: '0x',
            callData: '0xabcd',
            approval: null,
            nfts: [],
          },
          respond: (approved: boolean) => {
            ;(window as unknown as { __reviewResult?: boolean }).__reviewResult = approved
          },
        },
      }),
    )
  })
  const dialog = page.getByRole('dialog', { name: 'Review payment' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** True when the element still accepts programmatic focus (i.e. is not inert). */
function isFocusable(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate(target => {
    const element = document.querySelector<HTMLElement>(target)
    if (!element) throw new Error(`missing element: ${target}`)
    element.focus()
    return document.activeElement === element
  }, selector)
}

type Box = { x: number; y: number; width: number; height: number }

/**
 * Describes what a real click at the centre of `box` would actually land on:
 * the tag name, and the accessible name of the dialog owning it (null when the
 * hit is page background). This is the honest "is it clickable" question — a
 * covered element still reports itself visible and enabled.
 */
function hitTest(page: import('@playwright/test').Page, box: Box) {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y)
    const dialog = hit?.closest('dialog')
    return {
      tag: hit?.tagName.toLowerCase() ?? null,
      dialog: dialog ? dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby') : null,
    }
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
}

/** Focusability of the first button inside the dialog with the given label. */
function firstButtonFocusable(page: import('@playwright/test').Page, label: string) {
  return page.evaluate(target => {
    const dialog = document.querySelector<HTMLDialogElement>(`dialog[open][aria-label="${target}"]`)
    if (!dialog) throw new Error(`no open dialog labelled ${target}`)
    const button = dialog.querySelector<HTMLElement>('button')
    if (!button) throw new Error(`dialog ${target} has no button`)
    button.focus()
    return document.activeElement === button
  }, label)
}

test('an open modal makes the page behind it inert and restores it on close', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  const chatInput = page.getByRole('textbox', { name: CHAT_INPUT })
  await expect(chatInput).toBeVisible()
  const inputBox = await chatInput.boundingBox()
  expect(inputBox).not.toBeNull()

  // Baseline: the background is interactive and nothing holds the scroll lock.
  await chatInput.focus()
  expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe('textarea')
  const overflowBefore = await page.evaluate(() => document.body.style.overflow)
  expect(await hitTest(page, inputBox!)).toMatchObject({ tag: 'textarea', dialog: null })

  const createFlow = await openCreateFlow(page)

  // 1. The background cannot take focus: showModal() made it inert.
  expect(await isFocusable(page, 'textarea')).toBe(false)

  // 2. The background cannot be clicked: the dialog and its ::backdrop occupy
  //    the top layer above it, so the hit test never reaches the input.
  await expect.poll(() => hitTest(page, inputBox!)).toMatchObject({ dialog: 'Create a project' })

  // 3. Tabbing stays inside the dialog. The wizard inside it is lazy-loaded, so
  //    wait for its content to land before probing tab order — a Suspense swap
  //    unmounts the focused node and momentarily resets focus to <body>.
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('dialog[open] button, dialog[open] input').length))
    .toBeGreaterThan(1)
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('dialog[open] button')?.focus()
  })
  await page.keyboard.press('Tab')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]')
        return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement))
      }),
    )
    .toBe(true)

  // 3b. Controls *inside* the dialog stay fully interactive. This is the other
  //     half of inertness and the reason in-modal pickers must live in the
  //     dialog's own subtree rather than portal to document.body.
  const wizardInput = createFlow.getByRole('textbox').first()
  await wizardInput.fill('top layer check')
  await expect(wizardInput).toHaveValue('top layer check')

  // 3c. A body-level portal is dead under an open modal — even one that opts
  //     into the top layer via the popover API, and even at the maximum
  //     z-index. This is executable documentation for the invariant enforced by
  //     scripts/check-source-invariants.mjs: a dropdown or tooltip portaled to
  //     document.body from inside a modal would silently never appear.
  const portalProbe = await page.evaluate(() => {
    const overlay = document.createElement('div')
    overlay.id = 'body-portal-probe'
    overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:red')
    document.body.appendChild(overlay)
    try {
      overlay.setAttribute('popover', 'manual')
      ;(overlay as unknown as { showPopover: () => void }).showPopover()
    } catch {
      // Popover unsupported here; the plain fixed overlay still proves the point.
    }
    const hit = document.elementFromPoint(window.innerWidth / 2, 4)
    const result = {
      hitId: hit?.id ?? '',
      hitIsDialog: hit?.tagName.toLowerCase() === 'dialog',
    }
    overlay.remove()
    return result
  })
  expect(portalProbe.hitId).not.toBe('body-portal-probe')
  expect(portalProbe.hitIsDialog).toBe(true)

  // 4. The dialog is a real modal in the top layer, not a z-index stack.
  expect(
    await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]') as HTMLDialogElement | null
      return {
        open: dialog?.open ?? false,
        modal: dialog?.matches(':modal') ?? false,
        zIndex: dialog ? getComputedStyle(dialog).zIndex : 'missing',
      }
    }),
  ).toEqual({ open: true, modal: true, zIndex: 'auto' })

  // 5. The scroll lock is applied while a modal is open.
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  // Escape reaches the dialog's native cancel event and closes it.
  await page.keyboard.press('Escape')
  await expect(createFlow).toBeHidden()

  // Everything is restored: focus, hit testing and the scroll lock.
  expect(await isFocusable(page, 'textarea')).toBe(true)
  await expect.poll(() => hitTest(page, inputBox!)).toMatchObject({ tag: 'textarea', dialog: null })
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(overflowBefore)
  expect(await page.evaluate(() => document.querySelectorAll('dialog[open]').length)).toBe(0)

  expect(pageErrors).toEqual([])
})

test('a modal stacked over another modal owns the interaction', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  const createFlow = await openCreateFlow(page)
  const createFlowClose = createFlow.getByRole('button', { name: 'Close' })
  await expect(createFlowClose).toBeVisible()
  const closeBox = await createFlowClose.boundingBox()
  expect(closeBox).not.toBeNull()

  const review = await openPaymentReview(page)

  // Both dialogs are open; the top layer orders them by open() order, not by a
  // z-index race — the review modal carries no z-index of its own.
  expect(await page.evaluate(() => document.querySelectorAll('dialog[open]').length)).toBe(2)

  // The lower dialog is now inert: its close button cannot be focused, and a
  // click at its coordinates is absorbed by the review dialog above it.
  expect(await firstButtonFocusable(page, 'Create a project')).toBe(false)
  await expect.poll(() => hitTest(page, closeBox!)).toMatchObject({ dialog: 'payment-review-title' })

  // The upper dialog is fully interactive.
  const agreement = review.getByRole('checkbox')
  await agreement.check()
  await expect(agreement).toBeChecked()

  // Escape dismisses only the topmost dialog.
  await page.keyboard.press('Escape')
  await expect(review).toBeHidden()
  await expect(createFlow).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __reviewResult?: boolean }).__reviewResult))
    .toBe(false)

  // With one dialog still open the reference-counted scroll lock must hold.
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  // The lower dialog is interactive again.
  expect(await firstButtonFocusable(page, 'Create a project')).toBe(true)
  await expect.poll(() => hitTest(page, closeBox!)).toMatchObject({ dialog: 'Create a project' })
  await createFlowClose.click()
  await expect(createFlow).toBeHidden()

  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  expect(await page.evaluate(() => document.querySelectorAll('dialog[open]').length)).toBe(0)
  expect(pageErrors).toEqual([])
})
