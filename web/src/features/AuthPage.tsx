import { useState, type FormEvent } from 'react';
import { useApi } from '../lib/ApiContext';
import { ApiError } from '../lib/api';
import { useTheme } from '../theme/ThemeProvider';
import { NICHES, THEMES, type Niche } from '../theme/tokens';
import { Button, TextField } from '../ui/primitives';

const PASSWORD_MIN = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthErrors {
  email?: string;
  password?: string;
  name?: string;
  tenantName?: string;
}

export function validateAuth(
  mode: 'login' | 'register',
  v: { email: string; password: string; name: string; tenantName: string },
): AuthErrors {
  const errors: AuthErrors = {};
  if (!EMAIL.test(v.email.trim())) errors.email = 'Enter a valid e-mail address.';
  if (mode === 'login') {
    if (!v.password) errors.password = 'Enter your password.';
  } else {
    if (v.password.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
    if (!v.name.trim()) errors.name = 'Tell us your name.';
    if (!v.tenantName.trim()) errors.tenantName = 'Give your workspace a name.';
  }
  return errors;
}

function friendly(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') return 'E-mail or password is incorrect.';
    if (error.code === 'EMAIL_TAKEN') return 'That e-mail is already registered. Try signing in.';
    if (error.status === 429) return 'Too many attempts. Wait a moment and try again.';
    return error.message;
  }
  return 'Could not reach the server. Check your connection.';
}

export function AuthPage() {
  const api = useApi();
  const { niche, setNiche } = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [values, setValues] = useState({ email: '', password: '', name: '', tenantName: '' });
  const [errors, setErrors] = useState<AuthErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const theme = THEMES[niche];

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const found = validateAuth(mode, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (mode === 'login') await api.login({ email: values.email.trim(), password: values.password });
      else
        await api.register({
          email: values.email.trim(),
          password: values.password,
          name: values.name.trim(),
          tenantName: values.tenantName.trim(),
          niche,
        });
    } catch (error) {
      setFormError(friendly(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-hero" aria-label="About this workspace">
        <div className="brandmark">
          <span className="dot" aria-hidden="true">
            {theme.label.charAt(0)}
          </span>
          <span>Bulkhead Console</span>
        </div>
        <h1>{theme.tagline}</h1>
        <p>
          Every workspace is isolated at the database layer, every change is written to a tamper-evident audit
          trail, and money moves exactly once.
        </p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="auth-title">
          <div className="seg" role="group" aria-label="Sign in or create a workspace">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
              Sign in
            </button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>
              Create workspace
            </button>
          </div>
          <h2 id="auth-title">{mode === 'login' ? 'Welcome back' : 'Start a new workspace'}</h2>

          {mode === 'register' && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="muted" style={{ marginBottom: '.5rem', fontWeight: 700 }}>
                What kind of business is it?
              </legend>
              <div className="niche-grid">
                {NICHES.map((n: Niche) => (
                  <button
                    key={n}
                    type="button"
                    className="niche-card"
                    aria-pressed={niche === n}
                    onClick={() => setNiche(n)}
                  >
                    <strong>{THEMES[n].label}</strong>
                    <span className="swatches" aria-hidden="true">
                      <i style={{ background: THEMES[n].light.brand }} />
                      <i style={{ background: THEMES[n].light.bg }} />
                      <i style={{ background: THEMES[n].dark.bg }} />
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {mode === 'register' && (
            <TextField
              label="Your name"
              autoComplete="name"
              value={values.name}
              onChange={set('name')}
              error={errors.name}
            />
          )}
          {mode === 'register' && (
            <TextField
              label="Workspace name"
              value={values.tenantName}
              onChange={set('tenantName')}
              error={errors.tenantName}
            />
          )}
          <TextField
            label="E-mail"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set('email')}
            error={errors.email}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={values.password}
            onChange={set('password')}
            error={errors.password}
            hint={mode === 'register' ? `At least ${PASSWORD_MIN} characters.` : undefined}
          />
          {formError && (
            <p role="alert" className="field error" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {formError}
            </p>
          )}
          <Button type="submit" busy={busy}>
            {mode === 'login' ? 'Sign in' : 'Create workspace'}
          </Button>
        </form>
      </section>
    </main>
  );
}
