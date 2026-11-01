import { NavLink, Outlet } from 'react-router-dom';
import { useApi, useSession } from '../lib/ApiContext';
import { isAdmin } from '../lib/permissions';
import { useRealtime } from '../lib/realtime';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES } from '../theme/tokens';
import { Button } from '../ui/primitives';

export function Shell() {
  const api = useApi();
  const session = useSession();
  const { niche, preference, setPreference } = useTheme();
  const status = useRealtime();
  if (!session) return null;

  const v = THEMES[niche].vocabulary;
  const admin = isAdmin(session.tenant.role);
  const links: { to: string; label: string; show: boolean }[] = [
    { to: '/', label: 'Overview', show: true },
    { to: '/resources', label: v.resources, show: true },
    { to: '/invoices', label: v.invoices, show: true },
    { to: '/team', label: 'Team', show: true },
    { to: '/audit', label: 'Audit trail', show: admin },
    { to: '/webhooks', label: 'Webhooks', show: admin },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brandmark">
          <span className="dot" aria-hidden="true">
            {session.tenant.name.charAt(0).toUpperCase()}
          </span>
          <span>{session.tenant.name}</span>
        </div>
        <nav className="nav" aria-label="Main">
          {links
            .filter((l) => l.show)
            .map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'}>
                {l.label}
              </NavLink>
            ))}
        </nav>
        <footer>
          <span className="live" data-status={status} role="status">
            {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
          </span>
          <div className="seg" role="group" aria-label="Colour mode">
            {(['system', 'light', 'dark'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={preference === m} onClick={() => setPreference(m)}>
                {m[0]?.toUpperCase()}
                {m.slice(1)}
              </button>
            ))}
          </div>
          <div className="muted">
            {session.user.name} · {session.tenant.role}
          </div>
          <Button variant="ghost" small onClick={() => void api.logout()}>
            Sign out
          </Button>
        </footer>
      </aside>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
