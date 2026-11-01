import { expect, type Page } from '@playwright/test';

export const NICHES = [
  { id: 'general', label: 'General', nav: 'Resources' },
  { id: 'restaurant', label: 'Restaurant', nav: 'Menu' },
  { id: 'legal', label: 'Legal', nav: 'Cases' },
  { id: 'civic', label: 'Civic office', nav: 'Proposals' },
  { id: 'wellness', label: 'Wellness', nav: 'Programs' },
] as const;

export const PASSWORD = 'browser-test-passphrase-1';

/** Creates a workspace through the real UI (not the API), so the sign-up flow itself is under test. */
export async function signUp(page: Page, niche: (typeof NICHES)[number]): Promise<string> {
  const email = `e2e-${niche.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace', pressed: false }).click();
  await page.getByRole('button', { name: new RegExp(`^${niche.label}`) }).click();
  await page.getByLabel('Your name').fill('Ana Souza');
  await page.getByLabel('Workspace name').fill(`${niche.label} Studio`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading', { name: /Good to see you, Ana/ })).toBeVisible();
  return email;
}

/** Horizontal overflow in CSS pixels; anything above 0 means the page scrolls sideways. */
export const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
