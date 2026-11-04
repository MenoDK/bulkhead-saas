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
  await page.goto('/app/');
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

/* ------------------------------------------------------------------ landing page and lab */

const BASE = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:8080');

/** Collects what would make a reviewer frown: console errors, page errors (CSP violations land here) and third-party calls. */
export function watch(page: Page, { allowStatus = [] as number[] } = {}): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Chromium logs every non-2xx fetch as an error. The lab provokes some on purpose; allow only the listed ones.
    const status = /status of (\d{3})/.exec(m.text());
    if (status && allowStatus.includes(Number(status[1]))) return;
    problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.host !== BASE.host) {
      problems.push(`third-party request: ${r.url()}`);
    }
  });
  return problems;
}

export async function leaveSplash(page: Page): Promise<void> {
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 10_000 });
}

/** Every status the lab provokes on purpose. */
export const REFUSALS = [400, 401, 403, 404, 409, 422, 429];

/** A first visit to the lab: the form on screen creates a real workspace (the fields are pre-filled) and signs in. */
export async function labSignUp(page: Page): Promise<void> {
  await page.goto('/lab.html');
  await leaveSplash(page);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('tab', { name: 'Isolation' })).toBeVisible();
}

export const tab = (page: Page, name: string) => page.getByRole('tab', { name });

/** The tab panel that is open. Panels that were visited and left stay in the page, hidden, so every locator starts here. */
export const active = (page: Page) => page.locator('[role="tabpanel"]:not([hidden])');

/** The answer and result cards in the open tab, newest first. */
export const cards = (page: Page) => active(page).locator('.box.arrive');

/** The newest card in the open tab. */
export const latest = (page: Page) => cards(page).first();

export const press = (page: Page, name: string) =>
  active(page).getByRole('button', { name, exact: true }).click();
