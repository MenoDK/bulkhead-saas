import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { NICHES, PASSWORD, signUp } from './helpers';

/** Opt-in (SCREENSHOTS=1): regenerates the README gallery from the running stack. */
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to regenerate docs/screenshots');

interface Seed {
  resources: string[];
  invoices: { lines: { description: string; quantity: number; unitPrice: string }[]; paid: string | null }[];
  invoicesLabel: string;
}

/** Plausible, obviously fictional content per niche, so the gallery shows the product in use, not empty states. */
const SEEDS: Record<(typeof NICHES)[number]['id'], Seed> = {
  general: {
    resources: [
      'Onboarding checklist',
      'Quarterly report',
      'Vendor contract',
      'Brand guidelines',
      'Support playbook',
    ],
    invoices: [
      { lines: [{ description: 'Implementation', quantity: 12, unitPrice: '150.00' }], paid: '1800.00' },
      { lines: [{ description: 'Monthly retainer', quantity: 1, unitPrice: '2400.00' }], paid: '1000.00' },
      { lines: [{ description: 'Workshop', quantity: 1, unitPrice: '900.00' }], paid: null },
    ],
    invoicesLabel: 'Invoices',
  },
  restaurant: {
    resources: [
      'Margherita pizza',
      'Grilled sea bass',
      'Mushroom risotto',
      'Tiramisu',
      'House lemonade',
      'Caesar salad',
    ],
    invoices: [
      {
        lines: [
          { description: 'Margherita pizza', quantity: 2, unitPrice: '58.00' },
          { description: 'House lemonade', quantity: 3, unitPrice: '12.00' },
        ],
        paid: '152.00',
      },
      { lines: [{ description: 'Grilled sea bass', quantity: 1, unitPrice: '84.00' }], paid: '40.00' },
      { lines: [{ description: 'Tiramisu', quantity: 4, unitPrice: '26.00' }], paid: null },
    ],
    invoicesLabel: 'Tabs',
  },
  legal: {
    resources: [
      'Labour claim 0412',
      'Tenancy dispute',
      'Company formation',
      'Contract review',
      'Probate: estate Alves',
    ],
    invoices: [
      { lines: [{ description: 'Initial consultation', quantity: 2, unitPrice: '350.00' }], paid: '700.00' },
      { lines: [{ description: 'Contract drafting', quantity: 6, unitPrice: '420.00' }], paid: '1200.00' },
      { lines: [{ description: 'Court appearance', quantity: 1, unitPrice: '1800.00' }], paid: null },
    ],
    invoicesLabel: 'Fee notes',
  },
  civic: {
    resources: [
      'Bike lanes on Main Street',
      'Public library hours',
      'Park lighting upgrade',
      'Waste collection schedule',
    ],
    invoices: [
      {
        lines: [{ description: 'Community garden grant', quantity: 1, unitPrice: '5000.00' }],
        paid: '5000.00',
      },
      { lines: [{ description: 'Youth sports fund', quantity: 1, unitPrice: '12000.00' }], paid: '4000.00' },
      { lines: [{ description: 'Street art programme', quantity: 1, unitPrice: '3500.00' }], paid: null },
    ],
    invoicesLabel: 'Grants',
  },
  wellness: {
    resources: [
      'Morning mobility',
      'Strength foundations',
      'Mindful breathing',
      'Recovery yoga',
      'Nutrition basics',
    ],
    invoices: [
      { lines: [{ description: 'Ten-session pack', quantity: 1, unitPrice: '720.00' }], paid: '720.00' },
      { lines: [{ description: 'Monthly membership', quantity: 1, unitPrice: '290.00' }], paid: '100.00' },
      { lines: [{ description: 'Assessment + plan', quantity: 1, unitPrice: '180.00' }], paid: null },
    ],
    invoicesLabel: 'Packages',
  },
};

/** Logs in on a second session (the browser's own refresh token must not be reused) and creates the sample data. */
async function seed(page: Page, email: string, data: Seed): Promise<void> {
  const login = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = (): Record<string, string> => ({
    authorization: `Bearer ${accessToken}`,
    'idempotency-key': `gallery-${randomUUID()}`,
  });

  for (const name of data.resources) {
    const res = await page.request.post('/api/resources', {
      headers: headers(),
      data: { name, data: { sku: name } },
    });
    expect(res.ok(), `create resource ${name}`).toBeTruthy();
  }
  for (const invoice of data.invoices) {
    const created = await page.request.post('/api/invoices', {
      headers: headers(),
      data: { currency: 'BRL', lines: invoice.lines },
    });
    expect(created.ok(), 'create invoice').toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    expect((await page.request.post(`/api/invoices/${id}/issue`, { headers: headers() })).ok()).toBeTruthy();
    if (invoice.paid) {
      const paid = await page.request.post(`/api/invoices/${id}/payments`, {
        headers: headers(),
        data: { amount: invoice.paid },
      });
      expect(paid.ok(), 'record payment').toBeTruthy();
    }
  }
}

for (const niche of NICHES) {
  test(`gallery: ${niche.id}`, async ({ page }, info) => {
    const email = await signUp(page, niche);
    const data = SEEDS[niche.id];
    await seed(page, email, data);

    await page.reload();
    await page.getByRole('heading', { name: /Good to see you, Ana/ }).waitFor();
    await page.getByRole('main').getByText('Recent', { exact: false }).waitFor();
    await expect(page.getByRole('main').getByText('Nothing here yet')).toHaveCount(0);
    await page.waitForTimeout(600); // let the numbers and skeletons settle
    await page.screenshot({ path: `../docs/screenshots/${niche.id}-${info.project.name}.png` });

    await page.getByRole('link', { name: data.invoicesLabel, exact: true }).first().click();
    await page
      .getByRole('main')
      .getByText(/paid|open/i)
      .first()
      .waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `../docs/screenshots/${niche.id}-${info.project.name}-invoices.png` });
  });
}
