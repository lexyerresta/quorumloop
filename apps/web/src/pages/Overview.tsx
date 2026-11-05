import { Link } from '@tanstack/react-router';
import { useHealth, useOverview } from '../api/queries';
import type { InstanceHealth, Overview, ProjectStatus } from '../api/types';
import { EmptyState, ErrorState, LoadingRows, PageHead, Status } from '../components/ui';
import { NOT_IMPLEMENTED, PROJECT_STATUS_LABEL, projectTone } from '../lib/domain';
import { shortSha, stamp, timeAgo } from '../lib/format';

interface Kpi {
  label: string;
  value: number | null;
  reason?: string;
}

/**
 * The overview endpoint turns a failed dependency into 0. A figure is shown only when the service
 * that owns it answered its health probe and actually implements the summary; otherwise it reads
 * Unavailable with the reason in the tooltip and the note below the strip.
 */
function kpisFrom(overview: Overview, health: InstanceHealth | undefined): Kpi[] {
  const up = (name: string) =>
    !health || health.services.some((service) => service.name === name && service.status === 'ok');
  const fromService = (label: string, value: number, service: string): Kpi =>
    up(service)
      ? { label, value }
      : { label, value: null, reason: `${service} did not answer its health probe.` };
  return [
    fromService('Projects', overview.kpis.projects, 'project-service'),
    fromService('Tasks in progress', overview.kpis.tasks_in_progress, 'task-service'),
    fromService('Tasks blocked', overview.kpis.tasks_blocked, 'task-service'),
    fromService('Reviews awaiting', overview.kpis.reviews_awaiting, 'source-control-service'),
    { label: 'Quality passed', value: null, reason: NOT_IMPLEMENTED.quality },
    { label: 'Active agents', value: null, reason: NOT_IMPLEMENTED.agents },
  ];
}

export function OverviewPage() {
  const overview = useOverview();
  const health = useHealth();

  return (
    <div className="page">
      <PageHead
        title="Overview"
        sub={
          overview.data
            ? `Generated ${timeAgo(overview.data.generated_at)}, from the services that answered.`
            : 'Projects, blocked work and alerts across this organization.'
        }
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => {
              void overview.refetch();
              void health.refetch();
            }}
            disabled={overview.isFetching}
          >
            {overview.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
        }
      />

      {overview.isPending ? (
        <LoadingRows rows={6} label="Loading the overview" />
      ) : overview.isError ? (
        <ErrorState error={overview.error} what="the overview" onRetry={() => overview.refetch()} />
      ) : (
        <>
          <section className="section" aria-labelledby="kpi-heading">
            <h2 id="kpi-heading" className="sr-only">
              Figures
            </h2>
            <div className="kpis">
              {kpisFrom(overview.data, health.data).map((kpi) => (
                <div className="kpi" key={kpi.label} title={kpi.reason}>
                  <div className="kpi-label">{kpi.label}</div>
                  {kpi.value === null ? (
                    <div className="kpi-value unavailable">Unavailable</div>
                  ) : (
                    <div className="kpi-value">{kpi.value}</div>
                  )}
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Quality and agent figures read Unavailable: {NOT_IMPLEMENTED.execution}
            </p>
          </section>

          <ProjectLedger overview={overview.data} />
          <Alerts overview={overview.data} />
        </>
      )}
    </div>
  );
}

function ProjectLedger({ overview }: { overview: Overview }) {
  return (
    <section className="section" aria-labelledby="ledger-heading">
      <div className="section-head">
        <h2 id="ledger-heading">Project ledger</h2>
        <span className="meta">
          Sync is stale after 30 minutes. Open a project to sync its repository.
        </span>
      </div>
      {overview.projects.length === 0 ? (
        <EmptyState
          action={
            <Link to="/projects" className="btn btn-primary">
              Create project
            </Link>
          }
        >
          No projects yet. Create one from an idea, or import a repository from a forge connection,
          and it appears here with its branch and last commit.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="ledger stack-mobile">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Repository</th>
                <th scope="col">Head</th>
                <th scope="col" className="num">
                  Blocked
                </th>
                <th scope="col">Last sync</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.projects.map((project) => (
                <tr key={project.id}>
                  <td data-label="Project" className="primary-cell">
                    <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                      {project.name}
                    </Link>
                  </td>
                  <td data-label="Repository" className="mono">
                    {project.repository_full_name ? (
                      <>
                        {project.forge ? `${project.forge}:` : ''}
                        {project.repository_full_name}
                        <span className="muted"> @ {project.branch ?? 'unknown'}</span>
                      </>
                    ) : (
                      <span className="muted">Not connected</span>
                    )}
                  </td>
                  <td data-label="Head">
                    {project.head_sha ? (
                      <span title={project.head_message ?? undefined}>
                        <span className="mono">{shortSha(project.head_sha)}</span>{' '}
                        <span className="muted">{timeAgo(project.head_committed_at)}</span>
                      </span>
                    ) : (
                      <span className="muted">Unavailable</span>
                    )}
                  </td>
                  <td data-label="Blocked" className="num">
                    {project.tasks_blocked}
                  </td>
                  <td data-label="Last sync">
                    {project.last_synced_at ? (
                      <span title={stamp(project.last_synced_at)}>
                        {project.stale ? (
                          <Status tone="wait">Stale, {timeAgo(project.last_synced_at)}</Status>
                        ) : (
                          timeAgo(project.last_synced_at)
                        )}
                      </span>
                    ) : (
                      <span className="muted">Never synced</span>
                    )}
                  </td>
                  <td data-label="Status">
                    {project.status in PROJECT_STATUS_LABEL ? (
                      <Status tone={projectTone(project.status as ProjectStatus)}>
                        {PROJECT_STATUS_LABEL[project.status as ProjectStatus]}
                      </Status>
                    ) : (
                      <Status tone="idle">{project.status}</Status>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Alerts({ overview }: { overview: Overview }) {
  return (
    <section className="section" aria-labelledby="alerts-heading">
      <div className="section-head">
        <h2 id="alerts-heading">Alerts</h2>
        <span className="meta">Warnings and errors from the activity feed, newest first.</span>
      </div>
      {overview.alerts.length === 0 ? (
        <EmptyState>
          No warnings or errors. Failed syncs, refused transitions and provider limits show up here
          when they happen.
        </EmptyState>
      ) : (
        <ul className="feed">
          {overview.alerts.map((alert) => (
            <li key={alert.id}>
              <time dateTime={alert.occurred_at} title={stamp(alert.occurred_at)}>
                {timeAgo(alert.occurred_at)}
              </time>
              <span>
                <Status tone={alert.severity === 'error' ? 'fail' : 'wait'}>
                  {alert.severity === 'error' ? 'Error' : 'Warning'}
                </Status>{' '}
                {alert.summary}
                {alert.project_id ? (
                  <>
                    {' '}
                    <Link to="/projects/$projectId" params={{ projectId: alert.project_id }}>
                      Open project
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
