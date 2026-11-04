import { type Page, expect, test } from '@playwright/test';
import { active, labSignUp, leaveSplash, press, tab } from './helpers';

// Only with SHOTS=1 (`make screenshots`): these are the pictures in the README, taken from the real stack.
test.skip(process.env.SHOTS !== '1', 'screenshots are taken on request');
test.use({
  viewport: { width: 1360, height: 900 },
  colorScheme: 'light',
  contextOptions: { reducedMotion: 'reduce' },
});

const OUT = process.env.SHOTS_DIR ?? '../docs/img';
const settle = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 0)); // clicking scrolled the page; the picture starts at the top
  await page.waitForTimeout(5000); // let the confirmation toast leave
};

test('landing', async ({ page }) => {
  await page.goto('/');
  await leaveSplash(page);
  await page.screenshot({ path: `${OUT}/landing.png` });
});

test('lab: asking for someone else’s record', async ({ page }) => {
  await labSignUp(page);
  await press(page, 'Create a record in A');
  await press(page, 'Read it as B');
  await press(page, 'Swap the tenant in A’s token');
  await page.setViewportSize({ width: 1360, height: 1500 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/lab-isolation.png` });
});

test('lab: twenty payments for a hundred dollars', async ({ page }) => {
  await labSignUp(page);
  await tab(page, 'Money').click();
  await press(page, 'Create an invoice of 100.00');
  await press(page, 'Pay all at once');
  await expect(active(page).getByText('ends at 100.00 paid')).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 1500 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/lab-money.png` });
});
