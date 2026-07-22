import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '../fixtures/local-only'

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900, contrastMax: 0 },
  { name: 'tablet', width: 768, height: 1024, contrastMax: 0 },
  { name: 'mobile', width: 390, height: 844, contrastMax: 0 },
  { name: 'narrow', width: 320, height: 568, contrastMax: 0 },
] as const

for (const viewport of VIEWPORTS) {
  test(`production shell keeps its responsive shape and input invariant (${viewport.name})`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.setViewportSize(viewport)
    await page.goto('/')

    await expect(page.locator('.border-juice-orange').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Shuffle' })).toBeVisible()
    const chatInput = page.getByRole('textbox', { name: "What's your juicy vision?" })
    await expect(chatInput).toHaveCount(1)
    await expect(chatInput).toBeVisible()
    await chatInput.fill(`shape check ${viewport.name}`)
    await expect(chatInput).toHaveValue(`shape check ${viewport.name}`)

    await page.locator('body').click({ position: { x: 1, y: 1 } })
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toBeVisible()

    const inputBox = await chatInput.boundingBox()
    expect(inputBox).not.toBeNull()
    expect(inputBox!.x).toBeGreaterThanOrEqual(0)
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(viewport.width)
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )).toBe(true)

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const blockingA11y = axe.violations.filter(({ id, impact }) =>
      id !== 'color-contrast' && (impact === 'critical' || impact === 'serious')
    )
    const contrastViolation = axe.violations.find(({ id }) => id === 'color-contrast')
    const contrastNodes = contrastViolation?.nodes.length ?? 0
    const contrastDetails = contrastViolation?.nodes
      .map(node => `${node.target.join(' ')}: ${node.failureSummary ?? node.html}`)
      .join('\n') ?? ''
    expect(
      contrastNodes,
      `known color-contrast debt increased${contrastDetails ? `:\n${contrastDetails}` : ''}`,
    ).toBeLessThanOrEqual(
      viewport.contrastMax,
    )
    expect(
      blockingA11y,
      blockingA11y.map(violation => `${violation.id}: ${violation.help}`).join('\n'),
    ).toEqual([])
    expect(pageErrors).toEqual([])
  })
}
