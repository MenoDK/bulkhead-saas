import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthPage } from './features/AuthPage';
import { DashboardPage } from './features/DashboardPage';
import { InvoicesPage } from './features/InvoicesPage';
import { ResourcesPage } from './features/ResourcesPage';
import { Shell } from './features/Shell';
import { useApi, useSession } from './lib/ApiContext';
import { isAdmin } from './lib/permissions';
import { useTheme } from './theme/ThemeProvider';
import { Splash } from './ui/Splash';
import { SkeletonRows } from './ui/Skeleton';
import { useMinimumPresentation } from './ui/useMinimumPresentation';

// Rarely-used, admin-leaning screens are split out of the first download.
const TeamPage = lazy(() => import('./features/TeamPage').then((m) => ({ default: m.TeamPage })));
const AuditPage = lazy(() => import('./features/AuditPage').then((m) => ({ default: m.AuditPage })));
const WebhooksPage = lazy(() => import('./features/WebhooksPage').then((m) => ({ default: m.WebhooksPage })));
const lazyFallback = <SkeletonRows rows={5} columns={4} />;

/** Boot sequence: try to resume a session from the stored refresh token, then show the app (never a blank flash). */
export function App({ splashMinimumMs = 900 }: { splashMinimumMs?: number }) {
  const api = useApi();
  const session = useSession();
  const { niche, setNiche } = useTheme();
  const [booting, setBooting] = useState(true);
  const showSplash = useMinimumPresentation(booting, splashMinimumMs);

  useEffect(() => {
    let cancelled = false;
    void api.bootstrap().finally(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // The workspace decides the look: sign in to a legal workspace and the whole UI becomes the legal theme.
  const tenantNiche = session?.tenant.niche;
  useEffect(() => {
    if (tenantNiche) setNiche(tenantNiche);
  }, [tenantNiche, setNiche]);

  if (showSplash) return <Splash niche={niche} />;
  if (!session) return <AuthPage />;

  const admin = isAdmin(session.tenant.role);
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route
          path="team"
          element={
            <Suspense fallback={lazyFallback}>
              <TeamPage />
            </Suspense>
          }
        />
        <Route
          path="audit"
          element={
            admin ? (
              <Suspense fallback={lazyFallback}>
                <AuditPage />
              </Suspense>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="webhooks"
          element={
            admin ? (
              <Suspense fallback={lazyFallback}>
                <WebhooksPage />
              </Suspense>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
