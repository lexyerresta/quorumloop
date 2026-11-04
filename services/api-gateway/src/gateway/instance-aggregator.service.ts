import { SERVICES, readEnv } from '@quorumloop/config';
import {
  agentSummarySchema,
  activityEventSchema,
  projectSummarySchema,
  qualitySummarySchema,
  reviewSummarySchema,
  taskSummarySchema,
  type InstanceHealth,
  type Overview,
} from '@quorumloop/contracts';
import { ServiceClient } from '@quorumloop/platform';
import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { identityOf } from './gateway-proxy';

const SELF = 'api-gateway';
const alertsSchema = z.array(activityEventSchema);

/**
 * Instance-wide read model. The gateway is the only service allowed to fan out across owners,
 * and it does so with the caller's own scope so an aggregation can never leak another org.
 * A failing upstream degrades the answer instead of inventing a zero.
 */
@Injectable()
export class InstanceAggregator {
  private readonly client = new ServiceClient({ caller: SELF });
  private readonly logger = new Logger('instance-aggregator');

  async health(): Promise<InstanceHealth> {
    const env = readEnv();
    const targets = SERVICES.filter((service) => service.name !== SELF);

    const results = await Promise.all(
      targets.map(async (service) => {
        const report = await this.client.health(service.name);
        return {
          name: service.name,
          status: report.status === 'down' ? ('down' as const) : report.status,
          detail: report.detail,
        };
      }),
    );

    const services = [{ name: SELF, status: 'ok' as const, detail: null }, ...results];
    const down = services.filter((service) => service.status === 'down').length;
    const degraded = services.filter((service) => service.status === 'degraded').length;
    const unreachable = down >= services.length - 1;

    return {
      status: unreachable ? 'unavailable' : down > 0 || degraded > 0 ? 'degraded' : 'ok',
      version: env.APP_VERSION,
      services,
      checked_at: new Date().toISOString(),
    };
  }

  async overview(request: FastifyRequest): Promise<Overview> {
    const identity = identityOf(request);
    const call = <T>(target: string, path: string, schema: z.ZodType<T>): Promise<T> =>
      this.client.request<T>({ target, method: 'GET', path, identity }, schema);

    const [projects, tasks, reviews, quality, agents, alerts] = await Promise.allSettled([
      call('project-service', '/v1/projects', z.array(projectSummarySchema)),
      call('task-service', '/v1/summary', taskSummarySchema),
      call('source-control-service', '/v1/reviews/summary', reviewSummarySchema),
      call('quality-service', '/v1/summary', qualitySummarySchema),
      call('agent-control-service', '/v1/presence/summary', agentSummarySchema),
      call('activity-service', '/v1/alerts', alertsSchema),
    ]);

    const projectList = settled(projects, 'projects', this.logger) ?? [];
    const taskCounts = settled(tasks, 'tasks', this.logger);
    const reviewCounts = settled(reviews, 'reviews', this.logger);
    const qualityCounts = settled(quality, 'quality', this.logger);
    const agentCounts = settled(agents, 'agents', this.logger);
    const alertList = settled(alerts, 'alerts', this.logger) ?? [];

    const now = Date.now();
    const staleAfterMs = 30 * 60 * 1000;

    return {
      kpis: {
        projects: projectList.length,
        active_agents: agentCounts?.active ?? 0,
        tasks_in_progress: taskCounts?.in_progress ?? 0,
        tasks_blocked: taskCounts?.blocked ?? 0,
        reviews_awaiting: reviewCounts?.awaiting ?? 0,
        quality_passed: qualityCounts?.passed ?? 0,
      },
      projects: projectList.map((project) => ({
        id: project.id,
        name: project.name,
        forge: project.forge,
        repository_full_name: project.repository?.full_name ?? null,
        branch: project.repository?.default_branch ?? null,
        head_sha: project.repository?.head_sha ?? null,
        head_message: project.repository?.head_message ?? null,
        head_committed_at: project.repository?.head_committed_at ?? null,
        active_agents: agentCounts?.by_project[project.id] ?? project.active_agents,
        tasks_blocked: project.tasks_blocked,
        last_synced_at: project.repository?.synced_at ?? null,
        stale: project.repository
          ? project.repository.stale ||
            (project.repository.synced_at !== null &&
              now - Date.parse(project.repository.synced_at) > staleAfterMs)
          : false,
        status: project.status,
      })),
      alerts: alertList
        .filter((event) => event.severity !== 'info')
        .slice(0, 20)
        .map((event) => ({
          id: event.id,
          severity: event.severity === 'error' ? ('error' as const) : ('warning' as const),
          summary: event.summary,
          project_id: event.project_id,
          occurred_at: event.occurred_at,
        })),
      demo_mode: readEnv().DEMO_MODE === 'true',
      generated_at: new Date().toISOString(),
    };
  }
}

/**
 * A projection is optional: when one owner is unreachable the overview still renders. Returning
 * `undefined` (rather than zeros) is what lets the caller distinguish "none" from "unknown".
 */
const settled = <T>(
  result: PromiseSettledResult<T>,
  label: string,
  logger: Logger,
): T | undefined => {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  logger.warn(`overview projection "${label}" unavailable: ${String(result.reason)}`);
  return undefined;
};
