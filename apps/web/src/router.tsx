import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppLayout } from './components/Shell';
import { PageHead } from './components/ui';
import { LoginPage, SetupPage } from './pages/Auth';
import { ConnectionsPage } from './pages/Connections';
import { ApprovalsPage, NotificationsPage, SettingsPage } from './pages/Governance';
import { OverviewPage } from './pages/Overview';
import {
  ActivityTab,
  BoardTab,
  CodeTab,
  ProjectLayout,
  ProjectSettingsTab,
} from './pages/ProjectDetail';
import { ProjectsPage } from './pages/Projects';
import { TaskPage } from './pages/TaskDetail';

function NotFound() {
  return (
    <div className="page">
      <PageHead
        title="Page not found"
        sub="This address does not match a screen in the dashboard."
      />
      <Link to="/" className="btn">
        Open the overview
      </Link>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: SetupPage,
});

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppLayout });

const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: OverviewPage,
});
const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: ProjectsPage,
});
const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectId',
  component: ProjectLayout,
});
const boardRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/',
  component: BoardTab,
});
const activityRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/activity',
  component: ActivityTab,
});
const codeRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/code',
  component: CodeTab,
});
const projectSettingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/settings',
  component: ProjectSettingsTab,
});
const taskRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/$taskId',
  component: TaskPage,
});
const connectionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/connections',
  component: ConnectionsPage,
});
const approvalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/approvals',
  component: ApprovalsPage,
});
const notificationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/notifications',
  component: NotificationsPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  appRoute.addChildren([
    overviewRoute,
    projectsRoute,
    projectRoute.addChildren([boardRoute, activityRoute, codeRoute, projectSettingsRoute]),
    taskRoute,
    connectionsRoute,
    approvalsRoute,
    notificationsRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
