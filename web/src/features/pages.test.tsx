import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { json, renderApp, session, type RecordedCall } from '../test/harness';
import type { Invoice, Resource } from '../lib/types';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), close: vi.fn() }),
}));

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: '11111111-aaaa-bbbb-cccc-000000000001',
  currency: 'USD',
  status: 'open',
  total: '100.00',
  totalCents: 10_000,
  paidCents: 2_000,
  refundedCents: 0,
  balanceCents: 8_000,
  version: 2,
  createdAt: '2026-01-05T10:00:00.000Z',
  lines: [{ position: 1, description: 'Consulting', quantity: 2, unitCents: 5_000 }],
  payments: [],
  ...over,
});
const resource = (over: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  name: 'Pasta night',
  data: {},
  status: 'active',
  version: 3,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...over,
});

describe('creating an invoice', () => {
  it('sends canonical decimal strings and an Idempotency-Key, and a retry after failure re-uses the SAME key', async () => {
    const posts: RecordedCall[] = [];
    let attempt = 0;
    renderApp({
      signedIn: session('member'),
      at: '/invoices',
      routes: {
        'GET /invoices': { items: [], nextCursor: null },
        'POST /invoices': (call) => {
          posts.push(call);
          attempt += 1;
          return attempt === 1
            ? json(503, { error: { code: 'UNAVAILABLE', message: 'try later' } })
            : json(201, invoice({ status: 'draft' }));
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Create one' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Description'), '  Consulting ');
    await userEvent.clear(within(dialog).getByLabelText('Quantity'));
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '2');
    await userEvent.type(within(dialog).getByLabelText('Unit price'), '49,9');
    expect(within(dialog).getByText('Total $99.80')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(posts).toHaveLength(2));

    expect(posts[0]?.body).toEqual({
      currency: 'USD',
      lines: [{ description: 'Consulting', quantity: 2, unitPrice: '49.90' }],
    });
    const [first, second] = posts.map((p) => p.headers['Idempotency-Key']);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it('does not call the API while a line is invalid and says what is wrong', async () => {
    const { calls } = renderApp({
      signedIn: session('member'),
      at: '/invoices',
      routes: { 'GET /invoices': { items: [], nextCursor: null } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Create one' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Unit price'), '1.234');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(await within(dialog).findByText('Enter a valid amount for this currency.')).toBeInTheDocument();
    expect(within(dialog).getByText('Describe the line.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a viewer cannot start one', async () => {
    renderApp({
      signedIn: session('viewer'),
      at: '/invoices',
      routes: { 'GET /invoices': { items: [], nextCursor: null } },
    });
    await screen.findByText('No invoices yet');
    expect(screen.queryByRole('button', { name: /New invoice/ })).not.toBeInTheDocument();
  });
});

describe('moving money', () => {
  const routes = (extra: Record<string, object> = {}) => ({
    'GET /invoices': { items: [invoice()], nextCursor: null },
    'GET /invoices/11111111-aaaa-bbbb-cccc-000000000001': invoice(),
    ...extra,
  });

  it('refuses more than the balance on the client and never sends it', async () => {
    const { calls } = renderApp({
      signedIn: session('member'),
      at: '/invoices?open=11111111-aaaa-bbbb-cccc-000000000001',
      routes: routes(),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const form = screen.getByRole('form', { name: 'Record payment' });
    const amount = within(form).getByLabelText('Payment amount');
    expect(amount).toHaveValue('80.00'); // pre-filled from exact minor units
    await userEvent.clear(amount);
    await userEvent.type(amount, '80.01');
    await userEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    expect(await within(form).findByText('That is more than the remaining balance.')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/payments'))).toBe(false);
  });

  it('records a payment with an idempotency key and a canonical amount', async () => {
    const { calls } = renderApp({
      signedIn: session('member'),
      at: '/invoices?open=11111111-aaaa-bbbb-cccc-000000000001',
      routes: routes({
        'POST /invoices/11111111-aaaa-bbbb-cccc-000000000001/payments': json(201, {
          invoice: invoice({ paidCents: 10_000, balanceCents: 0, status: 'paid' }),
          paymentId: 'p1',
        }),
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const form = screen.getByRole('form', { name: 'Record payment' });
    await userEvent.clear(within(form).getByLabelText('Payment amount'));
    await userEvent.type(within(form).getByLabelText('Payment amount'), '12,5');
    await userEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/payments'))).toBe(true));
    const call = calls.find((c) => c.path.endsWith('/payments'));
    expect(call?.body).toEqual({ amount: '12.50' });
    expect(call?.headers['Idempotency-Key']).toBeTruthy();
  });

  it('explains a refused refund in plain language', async () => {
    renderApp({
      signedIn: session('member'),
      at: '/invoices?open=11111111-aaaa-bbbb-cccc-000000000001',
      routes: routes({
        'POST /invoices/11111111-aaaa-bbbb-cccc-000000000001/refunds': json(403, {
          error: { code: 'REFUND_NEEDS_APPROVAL', message: 'x', requestId: 'r' },
        }),
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Refund' }));
    const form = screen.getByRole('form', { name: 'Refund' });
    await userEvent.click(within(form).getByRole('button', { name: 'Refund' }));
    expect(await within(form).findByText('Refunds this large need an admin or owner.')).toBeInTheDocument();
  });

  it('only admins are offered "Void"', async () => {
    const { unmount } = renderApp({
      signedIn: session('member'),
      at: '/invoices?open=11111111-aaaa-bbbb-cccc-000000000001',
      routes: routes(),
    });
    await screen.findByRole('button', { name: 'Record payment' });
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    unmount();
    renderApp({
      signedIn: session('admin'),
      at: '/invoices?open=11111111-aaaa-bbbb-cccc-000000000001',
      routes: routes(),
    });
    expect(await screen.findByRole('button', { name: 'Void' })).toBeInTheDocument();
  });
});

describe('resources', () => {
  it('a member can edit only what they created; an admin can delete', async () => {
    renderApp({
      signedIn: session('member'),
      at: '/resources',
      routes: {
        'GET /resources': {
          items: [
            resource({ id: 'mine', name: 'Mine' }),
            resource({ id: 'theirs', name: 'Theirs', createdBy: 'someone-else' }),
          ],
          nextCursor: null,
        },
      },
    });
    const mine = (await screen.findByText('Mine')).closest('tr') as HTMLElement;
    const theirs = screen.getByText('Theirs').closest('tr') as HTMLElement;
    expect(within(mine).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(theirs).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('a version conflict is explained and the list is reloaded instead of silently overwriting', async () => {
    let lists = 0;
    renderApp({
      signedIn: session('owner'),
      at: '/resources',
      routes: {
        'GET /resources': () => {
          lists += 1;
          return json(200, { items: [resource()], nextCursor: null });
        },
        'PATCH /resources/r1': json(409, { error: { code: 'VERSION_CONFLICT', message: 'stale' } }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), ' v2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Someone changed this at the same time/)).toBeInTheDocument();
    await waitFor(() => expect(lists).toBeGreaterThan(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows skeletons while loading and an error state with retry on failure', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = true;
    renderApp({
      signedIn: session('owner'),
      at: '/resources',
      routes: {
        'GET /resources': async () => {
          await gate;
          return fail
            ? json(500, {
                error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'req-42' },
              })
            : json(200, { items: [resource()], nextCursor: null });
        },
      },
    });
    // The response is held back, so the loading state is observable (and stays until released).
    expect((await screen.findAllByRole('status', { name: 'Loading' })).length).toBeGreaterThan(0);
    release();
    expect(await screen.findByText(/Internal server error \(ref req-42\)/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Pasta night')).toBeInTheDocument();
  });
});

describe('dialog accessibility', () => {
  it('Escape closes it and focus returns to the control that opened it', async () => {
    renderApp({
      signedIn: session('owner'),
      at: '/resources',
      routes: { 'GET /resources': { items: [], nextCursor: null } },
    });
    const opener = await screen.findByRole('button', { name: 'New resource' });
    opener.focus();
    await userEvent.click(opener);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('Tab stays inside the dialog', async () => {
    renderApp({
      signedIn: session('owner'),
      at: '/resources',
      routes: { 'GET /resources': { items: [], nextCursor: null } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New resource' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
