import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../lib/api';
import { ApiProvider } from '../lib/ApiContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AuthPage, validateAuth } from './AuthPage';

function renderPage(client: Partial<ApiClient>) {
  return render(
    <ThemeProvider initial={{ niche: 'general', preference: 'light' }}>
      <ApiProvider client={client as ApiClient}>
        <AuthPage />
      </ApiProvider>
    </ThemeProvider>,
  );
}

describe('validateAuth', () => {
  it('login only needs a well-formed e-mail and some password', () => {
    expect(
      validateAuth('login', { email: 'a@example.test', password: 'x', name: '', tenantName: '' }),
    ).toEqual({});
    expect(
      Object.keys(validateAuth('login', { email: 'nope', password: '', name: '', tenantName: '' })),
    ).toEqual(['email', 'password']);
  });
  it('registration enforces the same password minimum as the server (10)', () => {
    const base = { email: 'a@example.test', name: 'A', tenantName: 'T' };
    expect(validateAuth('register', { ...base, password: '123456789' }).password).toBeDefined();
    expect(validateAuth('register', { ...base, password: '1234567890' }).password).toBeUndefined();
  });
});

describe('AuthPage', () => {
  it('shows field errors and does not call the API when the form is invalid', async () => {
    const login = vi.fn();
    renderPage({ login });
    await userEvent.click(document.querySelector('button[type=submit]')!);
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in with trimmed e-mail', async () => {
    const login = vi.fn().mockResolvedValue({});
    renderPage({ login });
    await userEvent.type(screen.getByLabelText('E-mail'), '  ana@example.test ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(document.querySelector('button[type=submit]')!);
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({ email: 'ana@example.test', password: 'correct horse' }),
    );
  });

  it('turns server errors into plain language and never echoes internals', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'));
    renderPage({ login });
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(document.querySelector('button[type=submit]')!);
    expect(await screen.findByText('E-mail or password is incorrect.')).toBeInTheDocument();
  });

  it('registration sends the chosen niche', async () => {
    const register = vi.fn().mockResolvedValue({});
    renderPage({ register });
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace', pressed: false }));
    await userEvent.click(screen.getByRole('button', { name: /Legal/ }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Ana');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Ana & Co');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-passphrase');
    await userEvent.click(document.querySelector('button[type=submit]')!);
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        email: 'ana@example.test',
        password: 'a-long-passphrase',
        name: 'Ana',
        tenantName: 'Ana & Co',
        niche: 'legal',
      }),
    );
    expect(document.documentElement.dataset.niche).toBe('legal');
  });
});
