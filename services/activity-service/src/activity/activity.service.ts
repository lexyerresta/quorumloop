import {
  type ActivityEvent,
  type ActivityFeed,
  type ActivityKind,
  type EventEnvelope,
} from '@quorumloop/contracts';
import { SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { ActivityRow, ProjectionRow } from '../database/schema';
import { decodeCursor, encodeCursor } from './activity.cursor';
import { toActivity } from './activity.map';
import { ActivityRepository } from './activity.repository';
import { SseHub } from './sse.hub';

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;
const ALERT_LIMIT = 20;

export const toActivityEvent = (row: ActivityRow): ActivityEvent => ({
  id: row.id,
  org_id: row.orgId,
  project_id: row.projectId,
  kind: row.kind as ActivityKind,
  summary: row.summary,
  actor: row.actor,
  severity: row.severity as ActivityEvent['severity'],
  occurred_at: row.occurredAt.toISOString(),
  metadata: row.metadata,
});

/**
 * The activity timeline. It is a projection of the event stream, not a second source of truth:
 * every row is derived from an event another service published, and a redelivered event
 * produces the same row instead of a new one.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly repository: ActivityRepository,
    private readonly hub: SseHub,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async feed(
    orgId: string,
    options: { projectId: string | null; cursor: string | null; limit: number | null },
  ): Promise<ActivityFeed> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const beforeSeq = decodeCursor(options.cursor);

    // One extra row tells us whether another page exists without a second count query.
    const rows = await this.repository.list({
      orgId,
      projectId: options.projectId,
      beforeSeq,
      limit: limit + 1,
    });
    const items = rows.slice(0, limit);
    const oldest = items[items.length - 1];

    return {
      items: items.map(toActivityEvent),
      next_cursor: rows.length > limit && oldest ? encodeCursor(oldest.seq) : null,
      projection: options.projectId
        ? toProjection(await this.repository.projection(orgId, options.projectId))
        : null,
    };
  }

  async alerts(orgId: string): Promise<ActivityEvent[]> {
    const rows = await this.repository.alerts(orgId, ALERT_LIMIT);
    return rows.map(toActivityEvent);
  }

  /**
   * Records one durable event. Returns the row so the caller can acknowledge it, or null when the
   * event is out of scope (no organization) or deliberately silent (see the mapping module).
   */
  async record(envelope: EventEnvelope): Promise<ActivityRow | null> {
    if (!envelope.org_id) {
      this.logger.debug(
        { eventType: envelope.event_type, eventId: envelope.event_id },
        'event has no organization scope; not added to any timeline',
      );
      return null;
    }

    const mapped = toActivity(envelope);
    if (!mapped) {
      return null;
    }

    const occurredAt = new Date(envelope.occurred_at);
    const row = await this.repository.append(
      { ...mapped, orgId: envelope.org_id },
      envelope.event_id,
      Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    );

    if (row) {
      this.hub.publish(row);
    } else {
      this.logger.debug({ eventId: envelope.event_id }, 'activity entry already recorded');
    }
    return row;
  }

  async resumePoint(orgId: string, clientKey: string): Promise<number | null> {
    return this.repository.loadOffset(orgId, clientKey);
  }

  async saveResumePoint(orgId: string, clientKey: string, seq: number): Promise<void> {
    await this.repository.saveOffset(orgId, clientKey, seq);
  }

  async head(orgId: string): Promise<number> {
    return (await this.repository.latestSeq(orgId)) ?? 0;
  }

  async catchUp(
    orgId: string,
    projectId: string | null,
    afterSeq: number,
    limit: number,
  ): Promise<ActivityRow[]> {
    return this.repository.after(orgId, projectId, afterSeq, limit);
  }

  async projection(orgId: string, projectId: string): Promise<ProjectionRow | null> {
    return this.repository.projection(orgId, projectId);
  }
}

const toProjection = (row: ProjectionRow | null): ActivityFeed['projection'] =>
  row
    ? {
        last_event_at: row.lastEventAt.toISOString(),
        total_events: row.totalEvents,
        alert_count: row.alertCount,
      }
    : null;
