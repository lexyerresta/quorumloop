import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useHealth, useLogout, useNotifications, useSession, useSetupStatus } from '../api/queries';
import type { InstanceHealth, Session } from '../api/types';
import { stamp, timeAgo } from '../lib/format';
import { useTheme } from '../lib/theme';
import { Dialog, ErrorState, Status } from './ui';

/** Every rail destination is a built page (R-24). Pages that need a scaffold service are absent. */
const NAV = [
  { to: '/', label: 'Overview', exact: true },
  { to: '/projects', label: 'Projects', exact: false },
  { to: '/connections', label: 'Connections', exact: false },
  { to: '/approvals', label: 'Approvals', exact: false },
  { to: '/notifications', label: 'Notifications', exact: false },
  { to: '/settings', label: 'Settings', exact: false },
] as const;

function NavLinks({ unread, onNavigate }: { unread: number | null; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="rail-link"
          activeOptions={{ exact: item.exact }}
          activeProps={{ 'aria-current': 'page' }}
          onClick={onNavigate}
        >
          <span>{item.label}</span>
          {item.to === '/notifications' && unread ? (
            <span className="rail-count" aria-label={`${unread} unread`}>
              {unread}
            </span>
          ) : null}
        </Link>
      ))}
    </>
  );
}

function HealthMarker({ health }: { health: InstanceHealth | undefined }) {
  if (!health) return <Status tone="idle">Checking services</Status>;
  // `unknown` is what the gateway reports for a service this deployment does not run.
  const absent = health.services.filter((service) => service.status === 'unknown');
  const running = health.services.filter((service) => service.status !== 'unknown');
  const failing = running.filter((service) => service.status !== 'ok');
  const title = [
    ...failing.map((service) => `${service.name}: ${service.status}`),
    ...absent.map((service) => `${service.name}: ${service.detail ?? 'not deployed'}`),
    `Checked ${stamp(health.checked_at)}`,
  ].join('\n');
  const deployedNote = absent.length ? `, ${absent.length} not deployed` : '';
  if (failing.length === 0) {
    return (
      <span title={title}>
        <Status tone="pass">
          {running.length} services ok{deployedNote}
        </Status>
      </span>
    );
  }
  return (
    <span title={title}>
      <Status tone={health.status === 'unavailable' ? 'fail' : 'wait'}>
        {failing.length} of {running.length} services not answering{deployedNote}
      </Status>
    </span>
  );
}

function Crumbs({ session }: { session: Session }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const parts = pathname.split('/').filter(Boolean);
  return (
    <div className="crumbs" aria-label="Location">
      <Link to="/">{session.organization.slug}</Link>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {' / '}
          {part.length > 16 ? `${part.slice(0, 8)}…` : part}
        </span>
      ))}
    </div>
  );
}

function AppFrame({ session }: { session: Session }) {
  const health = useHealth();
  const notifications = useNotifications();
  const logout = useLogout();
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = notifications.data?.unread ?? null;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <Link to="/" className="rail-brand">
          Quorumloop
        </Link>
        <nav aria-label="Sections">
          <NavLinks unread={unread} />
        </nav>
        <div className="rail-foot">
          <div>{session.organization.name}</div>
          <div className="mono">{session.user.email}</div>
        </div>
      </aside>

      <header className="strip">
        <Link to="/" className="strip-brand">
          Quorumloop
        </Link>
        <Crumbs session={session} />
        <div className="strip-meta">
          <span className="instance">
            <HealthMarker health={health.data} />
            {health.data ? (
              <span className="small muted"> · checked {timeAgo(health.data.checked_at)}</span>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn-quiet desktop-only"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button
            type="button"
            className="btn btn-quiet desktop-only"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
          <button
            type="button"
            className="btn menu-toggle"
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            Menu
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        {session.demo_mode ? (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner">
              <strong>Demo</strong> This instance runs in demo mode. Figures on every screen are
              demo data, not repository state.
            </div>
          </div>
        ) : null}
        <Outlet />
      </main>

      {menuOpen ? (
        <Dialog title="Sections" onClose={() => setMenuOpen(false)}>
          <nav aria-label="Sections" className="stack" style={{ gap: 4 }}>
            <NavLinks unread={unread} onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sign out
            </button>
          </div>
          <div className="small muted">
            <HealthMarker health={health.data} />
            <div className="mono" style={{ marginTop: 8 }}>
              {session.user.email}
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Signed-in area. Sends a visitor to first-run setup or sign-in when there is no session. */
export function AppLayout() {
  const session = useSession();
  const setup = useSetupStatus();

  if (session.isPending) {
    return (
      <div className="auth" role="status">
        <p className="muted">Checking your session</p>
      </div>
    );
  }
  if (session.isError) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="brand">Quorumloop</div>
          <ErrorState error={session.error} what="your session" onRetry={() => session.refetch()} />
        </div>
      </div>
    );
  }
  if (!session.data) {
    if (setup.data?.needs_setup) return <Navigate to="/setup" replace />;
    if (setup.isPending) {
      return (
        <div className="auth" role="status">
          <p className="muted">Checking instance setup</p>
        </div>
      );
    }
    return <Navigate to="/login" replace />;
  }
  return <AppFrame session={session.data} />;
}
