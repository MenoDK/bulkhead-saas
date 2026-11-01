import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { horizontalOverflow, NICHES, signUp } from './helpers';

const PAGES = ['/', '/resources', '/invoices', '/team', '/audit', '/webhooks'];

for (const niche of NICHES) {
  test(`${niche.id}: sign-up applies the niche theme and vocabulary`, async ({ page }) => {
    await signUp(page, niche);
    await expect(page.locator('html')).toHaveAttribute('data-niche', niche.id);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByText(niche.nav, { exact: true }),
    ).toBeVisible();
  });

  test(`${niche.id}: no horizontal scroll and no serious accessibility violations on any screen, light and dark`, async ({
    page,
  }) => {
    await signUp(page, niche);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.getByRole('button', { name: 'System' }).click(); // follow the OS preference we just emulated
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('main')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(
          await horizontalOverflow(page),
          `${niche.id} ${scheme} ${path} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(
          blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
          `${niche.id} ${scheme} ${path}`,
        ).toEqual([]);
      }
    }
  });
}

test('the sign-in page itself is accessible and does not scroll sideways', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id),
  ).toEqual([]);
});

test('keyboard only: the whole sign-in form can be completed without a mouse', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').focus();
  await page.keyboard.type('nobody@example.test');
  await page.keyboard.press('Tab');
  await page.keyboard.type('wrong-password-1');
  await page.keyboard.press('Enter');
  await expect(page.getByText('E-mail or password is incorrect.')).toBeVisible();
});
