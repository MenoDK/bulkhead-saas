import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { REFUSALS, active, cards, labSignUp, latest, leaveSplash, press, tab, watch } from './helpers';

// The lab drives the real API through the real front door. Each test registers its own workspace through the form on
// screen, so nothing depends on what an earlier run left in the database.

test.describe('the lab', () => {
  test('creating a workspace is real: it signs you in and opens six tabs, with no console problem', async ({
    page,
  }) => {
    const problems = watch(page, { allowStatus: REFUSALS });
    await labSignUp(page);
    for (const name of ['Isolation', 'Money', 'Sessions', 'Webhooks', 'Audit', 'Console']) {
      await expect(tab(page, name)).toBeVisible();
    }
    expect(problems).toEqual([]);
  });

  test('a wrong password on the sign-in form is refused with a message', async ({ page }) => {
    await page.goto('/lab.html');
    await leaveSplash(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('E-mail').fill('nobody@example.test');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(page.getByRole('alert')).toContainText('Invalid e-mail or password');
  });

  test('isolation: another workspace cannot read, change or delete a record, and a forged token is refused', async ({
    page,
  }) => {
    await labSignUp(page);
    await expect(active(page).getByText('Okoye & Partners')).toBeVisible(); // the second tenant exists
    await press(page, 'Create a record in A');
    await expect(latest(page)).toContainText('201');
    await expect(page.locator('#iso-id')).not.toHaveValue('');

    await press(page, 'Read it as A');
    await expect(latest(page)).toContainText('200');
    await press(page, 'Read it as B');
    await expect(latest(page)).toContainText('404');
    await expect(latest(page)).toContainText('NOT_FOUND');
    await press(page, 'Change it as B');
    await expect(latest(page)).toContainText('404');
    await press(page, 'Delete it as B');
    await expect(latest(page)).toContainText('404');
    await press(page, 'Read it as A'); // still there, untouched
    await expect(latest(page)).toContainText('200');
    await expect(latest(page)).not.toContainText('hijacked');

    await press(page, 'List what B can see');
    await expect(latest(page)).toContainText('none of them A’s');

    await press(page, 'Swap the tenant in A’s token');
    await expect(latest(page)).toContainText('401');
    await expect(latest(page)).toContainText('INVALID_TOKEN');
    await press(page, 'Use an unsigned token');
    await expect(latest(page)).toContainText('INVALID_TOKEN');
    await press(page, 'Claim A’s tenant in a header, as B');
    await expect(latest(page)).toContainText('404');
  });

  test('isolation: pressing “Read it as B” while B is still being created waits for B instead of leaving without a token', async ({
    page,
  }) => {
    // Registrations: the first is the visitor's own workspace, the second is the lab's workspace B. Make B slow, so the
    // click arrives while it does not exist yet. Before the fix that request left with no token and answered 401.
    let registrations = 0;
    await page.route('**/api/auth/register', async (route) => {
      registrations += 1;
      if (registrations === 2) await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });
    await page.goto('/lab.html');
    await leaveSplash(page);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(tab(page, 'Isolation')).toBeVisible();
    await press(page, 'Create a record in A');
    await expect(latest(page)).toContainText('201');
    await press(page, 'Read it as B');
    await expect(latest(page)).toContainText('404');
    await expect(latest(page)).not.toContainText('401');
    expect(registrations).toBe(2); // one workspace B, not two
  });

  test('money: twenty payments race for a hundred dollars and exactly ten win; one key is applied once', async ({
    page,
  }) => {
    await labSignUp(page);
    await tab(page, 'Money').click();
    await press(page, 'Create an invoice of 100.00');
    await expect(active(page).getByText('100.00 USD')).toBeVisible();
    await press(page, 'Pay all at once');
    const race = cards(page).filter({ hasText: '20 payments of 10.00 sent together' });
    await expect(race).toContainText('INVOICE_NOT_OPEN');
    await expect(race.locator('li', { hasText: '201' })).toContainText('× 10');
    await expect(race.locator('li', { hasText: '409' })).toContainText('× 10');
    await expect(race).toContainText('ends at 100.00 paid and a balance of 0.00');

    await press(page, 'Create an invoice of 100.00');
    await press(page, 'Send the same payment 10 times');
    const same = cards(page).filter({ hasText: 'The same 5.00 payment, ten times at once' });
    await expect(same.locator('li', { hasText: 'applied' })).toContainText('× 1');
    await expect(same.locator('li', { hasText: 'replay' })).toContainText('× 9');
    await expect(same).toContainText('5.00 paid: one payment, not ten');
    await press(page, 'Reuse the key with another amount');
    await expect(latest(page)).toContainText('IDEMPOTENCY_KEY_REUSED');
  });

  test('money: a team member cannot refund above the threshold, and nobody can refund more than was paid', async ({
    page,
  }) => {
    await labSignUp(page);
    await tab(page, 'Money').click();
    await press(page, 'Settle a 200.00 invoice');
    await expect(active(page).getByText('200.00 USD')).toBeVisible();
    await press(page, 'Refund 150.00 as a member');
    await expect(latest(page)).toContainText('403');
    await expect(latest(page)).toContainText('REFUND_NEEDS_APPROVAL');
    await press(page, 'Refund 50.00 as a member');
    await expect(latest(page)).toContainText('201');
    await press(page, 'Refund 150.00 as the owner');
    await expect(latest(page)).toContainText('201');
    await press(page, 'Refund more than was paid');
    await expect(latest(page)).toContainText('EXCEEDS_PAID');
  });

  test('sessions: replaying a rotated refresh token revokes the family, and guessing is cut off', async ({
    page,
  }) => {
    await labSignUp(page);
    await tab(page, 'Sessions').click();
    await press(page, 'Register a throwaway account');
    await expect(active(page).getByText('@example.test').first()).toBeVisible();
    await press(page, 'Rotate');
    await expect(latest(page)).toContainText('200');
    await press(page, 'Replay the old token');
    await expect(latest(page)).toContainText('INVALID_REFRESH_TOKEN');
    await press(page, 'Use the newest token');
    await expect(latest(page)).toContainText('INVALID_REFRESH_TOKEN'); // the family went with it

    await press(page, 'Guess 12 passwords');
    const guesses = cards(page).filter({ hasText: 'Twelve wrong passwords' });
    await expect(guesses.locator('li', { hasText: 'INVALID_CREDENTIALS' })).toContainText('× 10');
    await expect(guesses.locator('li', { hasText: 'RATE_LIMITED' })).toContainText('× 2');
    await press(page, 'Sign in with the right password');
    await expect(latest(page)).toContainText('429');

    await press(page, 'Compare a wrong password with an unknown e-mail');
    await expect(latest(page)).toContainText('same answer');
  });

  test('webhooks: every private way of writing an address is refused, and a public one is delivered by the worker', async ({
    page,
  }) => {
    await labSignUp(page);
    await tab(page, 'Webhooks').click();
    await press(page, 'Try all the targets');
    const rows = active(page).locator('ul.trace li');
    await expect(rows).toHaveCount(9, { timeout: 30_000 });
    await expect(rows.filter({ hasText: 'UNSAFE_TARGET' })).toHaveCount(8);
    await expect(rows.filter({ hasText: 'UNRESOLVABLE_TARGET' })).toHaveCount(1);
    await expect(rows.filter({ hasText: '169.254.169.254' })).toContainText('400');

    await press(page, 'Register 203.0.113.7');
    await expect(latest(page)).toContainText('201');
    await expect(active(page).getByText('returned once')).toBeVisible();
    await press(page, 'Create a record that fires an event');
    // the worker is a separate process that polls about once a second
    await expect(async () => {
      await press(page, 'Show deliveries');
      await expect(active(page).getByText('resource.created')).toBeVisible();
      await expect(active(page).getByText(/attempt [1-9]/)).toBeVisible();
    }).toPass({ timeout: 30_000 });
  });

  test('audit: the trail is readable, verifies, and exports a signed copy', async ({ page }) => {
    await labSignUp(page);
    await tab(page, 'Money').click();
    await press(page, 'Settle a 200.00 invoice'); // writes rows to the trail
    await expect(active(page).getByText('200.00 USD')).toBeVisible();
    await tab(page, 'Audit').click();
    await expect(active(page).locator('ul.trace li').first()).toBeVisible();
    await expect(active(page).getByText('payment.recorded').first()).toBeVisible();
    await press(page, 'Verify');
    await expect(latest(page)).toContainText('intact');
    await press(page, 'Export it signed');
    await expect(latest(page)).toContainText('Signed export');
    await expect(active(page).getByText('scripts/tamper-demo.sh')).toBeVisible();
  });

  test('console: each business opens the same app with its own look and vocabulary', async ({ page }) => {
    await labSignUp(page);
    await tab(page, 'Console').click();
    await press(page, 'Open the console as Legal');
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.locator('html')).toHaveAttribute('data-niche', 'legal');
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByText('Cases', { exact: true }),
    ).toBeVisible();
  });

  test('start over forgets what the lab made and keeps your workspace', async ({ page }) => {
    await labSignUp(page);
    await expect(active(page).getByText('Okoye & Partners')).toBeVisible();
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByText('Back to a clean slate.')).toBeVisible();
    await expect(tab(page, 'Isolation')).toBeVisible(); // still signed in
    await expect(active(page).getByText('Okoye & Partners')).toBeVisible(); // a new second workspace was made
  });
});

for (const scheme of ['light', 'dark'] as const) {
  for (const name of ['Isolation', 'Money', 'Sessions', 'Webhooks', 'Audit', 'Console']) {
    test(`accessibility: the ${name} tab has no WCAG A/AA violations (${scheme})`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await labSignUp(page);
      await tab(page, name).click();
      await expect(active(page).locator('.box').first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([]);
      await context.close();
    });
  }
}
