import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp, session } from './test/harness';

// The real socket would try to open a connection; the realtime logic itself is covered in lib/realtime.test.ts.
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), close: vi.fn() }),
}));

const emptyLists = {
  'GET /resources': { items: [], nextCursor: null },
  'GET /invoices': { items: [], nextCursor: null },
  'GET /members': [],
  'GET /audit': { items: [], nextBefore: null },
};

describe('boot sequence', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('shows the splash for the minimum presentation time, then the sign-in page when there is no session', async () => {
    renderApp({ routes: emptyLists, splashMinimumMs: 150 });
    expect(screen.getByTestId('splash')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('resumes a session from the stored refresh token and adopts the workspace theme', async () => {
    window.sessionStorage.setItem('auth.refresh', 'refresh-1');
    renderApp({ routes: { ...emptyLists, 'POST /auth/refresh': json(200, session('owner', 'legal')) } });
    expect(await screen.findByRole('heading', { name: /Good to see you, Ana/ })).toBeInTheDocument();
    // Legal vocabulary: the same screens are called "Cases" / "Fee notes".
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByText('Cases')).toBeInTheDocument();
    expect(within(nav).getByText('Fee notes')).toBeInTheDocument();
    expect(document.documentElement.dataset.niche).toBe('legal');
  });

  it('a rejected refresh token lands on sign-in, not on a broken app', async () => {
    window.sessionStorage.setItem('auth.refresh', 'stale');
    renderApp({
      routes: {
        'POST /auth/refresh': json(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'no' } }),
      },
    });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('auth.refresh')).toBeNull();
  });
});

describe('role-based navigation', () => {
  it('a viewer sees no admin sections and is redirected away from them', async () => {
    renderApp({ signedIn: session('viewer'), routes: emptyLists, at: '/audit' });
    expect(await screen.findByRole('heading', { name: /Good to see you/ })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByText('Audit trail')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Webhooks')).not.toBeInTheDocument();
  });

  it('an admin sees them', async () => {
    renderApp({ signedIn: session('admin'), routes: emptyLists });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByText('Audit trail')).toBeInTheDocument();
    expect(within(nav).getByText('Webhooks')).toBeInTheDocument();
  });

  it('signing out clears the session and returns to sign-in', async () => {
    const { store } = renderApp({
      signedIn: session('owner'),
      routes: { ...emptyLists, 'POST /auth/logout': json(204) },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(store.get()).toBeNull();
  });
});

describe('dashboard figures', () => {
  it('sums outstanding and collected per currency without mixing them', async () => {
    const inv = (currency: string, status: string, total: number, paid: number, refunded: number) => ({
      id: crypto.randomUUID(),
      currency,
      status,
      total: '',
      totalCents: total,
      paidCents: paid,
      refundedCents: refunded,
      balanceCents: total - paid + refunded,
      version: 1,
      createdAt: new Date().toISOString(),
    });
    renderApp({
      signedIn: session('owner'),
      routes: {
        ...emptyLists,
        'GET /invoices': {
          items: [
            inv('USD', 'open', 10_000, 2_500, 0),
            inv('USD', 'paid', 5_000, 5_000, 1_000),
            inv('EUR', 'open', 3_000, 0, 0),
          ],
          nextCursor: null,
        },
      },
    });
    await waitFor(() => expect(screen.getByText('Outstanding · USD')).toBeInTheDocument());
    const usd = screen.getByText('Outstanding · USD').closest('.kpi') as HTMLElement;
    expect(within(usd).getByText('$75.00')).toBeInTheDocument(); // only the OPEN invoice's balance
    expect(within(usd).getByText(/Collected \$65\.00/)).toBeInTheDocument(); // (2500) + (5000 - 1000)
    const eur = screen.getByText('Outstanding · EUR').closest('.kpi') as HTMLElement;
    expect(within(eur).getByText('€30.00')).toBeInTheDocument();
  });
});
