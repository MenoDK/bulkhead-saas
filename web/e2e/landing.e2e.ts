import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { leaveSplash, watch } from './helpers';

test.describe('landing page', () => {
  test('shows the loading stage, then the page, without a single console problem or third-party request', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/');
    await expect(page.locator('#splash')).toBeVisible();
    await leaveSplash(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Many businesses, one database,');
    await expect(page.getByRole('link', { name: /Open the lab/ }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the tour tabs swap in recorded output that really came from the stack', async ({ page }) => {
    await page.goto('/');
    await leaveSplash(page);
    const tabs = page.getByRole('group', { name: 'Explore the product' });
    const output = page.getByRole('region', { name: 'Example output' });
    await tabs.getByRole('button', { name: /Isolation/ }).click();
    await expect(output).toContainText('NOT_FOUND');
    await expect(output).toContainText('INVALID_TOKEN');
    // placeholders are text, not tags: a transcript inserted as HTML must not swallow "<invoice>"
    await expect(output).toContainText('/api/invoices/<invoice>');
    await tabs.getByRole('button', { name: /Money/ }).click();
    await expect(output).toContainText('10 × 201');
    await expect(output).toContainText('INVOICE_NOT_OPEN');
    await expect(output).toContainText('Idempotent-Replayed: true');
    await expect(output).toContainText('IDEMPOTENCY_KEY_REUSED');
    await tabs.getByRole('button', { name: /Sessions/ }).click();
    await expect(output).toContainText('INVALID_REFRESH_TOKEN');
    await expect(output).toContainText('RATE_LIMITED');
    await tabs.getByRole('button', { name: /Webhooks/ }).click();
    await expect(output).toContainText('UNSAFE_TARGET');
    await expect(output).toContainText('UNRESOLVABLE_TARGET');
    await tabs.getByRole('button', { name: /Audit/ }).click();
    await expect(output).toContainText('audit_logs is append-only');
    await expect(output).toContainText('hash_mismatch');
    await expect(tabs.getByRole('button', { name: /Audit/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('every hard part offers a recipe and a link that opens the lab on that tab', async ({ page }) => {
    await page.goto('/#hard-parts');
    await leaveSplash(page);
    const list = page.getByRole('group', { name: 'Hard parts to try' });
    const names = [
      'Read their data',
      'Pay twice',
      'Overspend',
      'Refund too much',
      'Steal a session',
      'Aim a webhook inward',
      'Edit the history',
    ];
    for (const name of names) {
      await list.getByRole('button', { name }).click();
      await expect(page.getByText('You should see', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Try it in the lab' })).toHaveAttribute(
        'href',
        /lab\.html(#\w+)?$/,
      );
    }
  });

  test('the console moved under /app/ and the old root no longer serves it', async ({ page, request }) => {
    await page.goto('/app/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect((await request.get('/app', { maxRedirects: 0 })).status()).toBe(301);
    expect((await request.get('/no-such-page')).status()).toBe(404);
  });

  test('the theme switch is applied and remembered across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await leaveSplash(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Use the dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('works with reduced motion and still reveals every section', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await leaveSplash(page);
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: /Asked often/ })).toBeVisible();
    await context.close();
  });

  test('has no horizontal scroll on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto('/');
    await leaveSplash(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility: the landing page has no WCAG A/AA violations (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await leaveSplash(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
    await context.close();
  });
}
