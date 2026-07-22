import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/local-only';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900, contrastMax: 0 },
  { name: 'tablet', width: 768, height: 1024, contrastMax: 0 },
  { name: 'mobile', width: 390, height: 844, contrastMax: 0 },
  { name: 'narrow', width: 320, height: 568, contrastMax: 0 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`mock wallet reaches the exact payment review without sending (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: {
          isMetaMask: true,
          request: async (request: unknown) => {
            calls.push(request);
            return null;
          },
          on: () => undefined,
          removeListener: () => undefined,
        },
      });
      (window as unknown as { __walletCalls: unknown[] }).__walletCalls = calls;
    });
    await page.goto('/');

    await page.evaluate(() => {
      const review = {
        txId: 'browser-review',
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
        metadata: '0x1234',
        callData: '0xabcd',
        approval: {
          token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          spender: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
          amount: '12500000',
          callData: '0x5678',
        },
        nfts: [{ tierId: 3, name: 'Backstage Pass', quantity: 2 }],
      };
      (window as unknown as { __reviewResult?: boolean }).__reviewResult = undefined;
      window.dispatchEvent(
        new CustomEvent('juice:payment-review-request', {
          detail: {
            review,
            respond: (approved: boolean) => {
              (window as unknown as { __reviewResult?: boolean }).__reviewResult = approved;
            },
          },
        }),
      );
    });

    const dialog = page.getByRole('dialog', { name: 'Review payment' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('12.5 USDC')).toBeVisible();
    await expect(dialog.getByText('direct terminal payment')).toBeVisible();
    await expect(dialog.getByText('Backstage Pass')).toBeVisible();
    await expect(dialog.getByText('×2')).toBeVisible();
    await expect(dialog.getByText(/approve\(0x130f5d/)).toBeVisible();

    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockingA11y = axe.violations.filter(
      ({ id, impact }) =>
        id !== 'color-contrast' && (impact === 'critical' || impact === 'serious'),
    );
    const contrastViolation = axe.violations.find(({ id }) => id === 'color-contrast');
    const contrastNodes = contrastViolation?.nodes.length ?? 0;
    const contrastDetails = contrastViolation?.nodes
      .map(node => `${node.target.join(' ')}: ${node.failureSummary ?? node.html}`)
      .join('\n') ?? '';
    expect(
      contrastNodes,
      `payment review has color-contrast violations${contrastDetails ? `:\n${contrastDetails}` : ''}`,
    ).toBeLessThanOrEqual(
      viewport.contrastMax,
    );
    expect(
      blockingA11y,
      blockingA11y.map(violation => `${violation.id}: ${violation.help}`).join('\n'),
    ).toEqual([]);

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => (window as unknown as { __reviewResult?: boolean }).__reviewResult)
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        (window as unknown as { __walletCalls: unknown[] }).__walletCalls.length
      ),
    ).toBe(0);
  });
}
