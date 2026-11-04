import { DATABASE_SQL, DRIZZLE, uuidv7 } from '@quorumloop/platform';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import {
  activityEvents,
  feedProjections,
  schema,
  sseOffsets,
  type ActivityRow,
  type ProjectionRow,
} from '../database/schema';
import type { ActivityRecord } from './activity.map';

export interface FeedFilter {
  orgId: string;
  projectId: string | null;
  /** Exclusive: return entries strictly older than this sequence. */
  beforeSeq: number | null;
  limit: number;
}

/** A mapped event plus the organization it belongs to, which the envelope carries separately. */
export interface AppendableActivity extends ActivityRecord {
  orgId: string;
}

@Injectable()
export class ActivityRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(DATABASE_SQL) private readonly sql: Sql,
  ) {}

  /**
   * Appends an event and updates its project rollup together. The unique index on
   * `source_event_id` is the idempotency guarantee: a redelivered envelope inserts nothing and
   * returns null, so the caller knows not to publish it again to live streams.
   */
  async append(
    record: AppendableActivity,
    sourceEventId: string,
    occurredAt: Date,
  ): Promise<ActivityRow | null> {
    const inserted = await this.db
      .insert(activityEvents)
      .values({
        id: uuidv7(),
        orgId: record.orgId,
        projectId: record.projectId,
        kind: record.kind,
        summary: record.summary,
        actor: record.actor,
        severity: record.severity,
        sourceEventId,
        metadata: record.metadata,
        occurredAt,
      })
      .onConflictDoNothing({ target: activityEvents.sourceEventId })
      .returning();

    const row = inserted[0];
    if (!row || !row.projectId) {
      return row ?? null;
    }

    const alert = row.severity === 'info' ? 0 : 1;
    // The timestamp is sent as an ISO string with an explicit cast: postgres@4 fails to encode a
    // Date parameter whose type the server infers from the insert target, so the raw statement
    // passes it as text the same way every other statement in this service does.
    await this.sql`
      insert into feed_projections
        (org_id, project_id, last_seq, last_event_at, total_events, alert_count, updated_at)
      values
        (${row.orgId}::uuid, ${row.projectId}::uuid, ${row.seq}, ${row.occurredAt.toISOString()}::timestamptz, 1, ${alert}, now())
      on conflict (org_id, project_id) do update set
        last_seq = greatest(feed_projections.last_seq, excluded.last_seq),
        last_event_at = greatest(feed_projections.last_event_at, excluded.last_event_at),
        total_events = feed_projections.total_events + 1,
        alert_count = feed_projections.alert_count + excluded.alert_count,
        updated_at = now()
    `;
    return row;
  }

  async list(filter: FeedFilter): Promise<ActivityRow[]> {
    const scope = filter.projectId
      ? and(eq(activityEvents.orgId, filter.orgId), eq(activityEvents.projectId, filter.projectId))
      : eq(activityEvents.orgId, filter.orgId);
    const where =
      filter.beforeSeq === null ? scope : and(scope, lt(activityEvents.seq, filter.beforeSeq));

    return this.db
      .select()
      .from(activityEvents)
      .where(where)
      .orderBy(desc(activityEvents.seq))
      .limit(filter.limit);
  }

  /** Only warning and error entries: an alert is an item that asks for attention. */
  async alerts(orgId: string, limit: number): Promise<ActivityRow[]> {
    return this.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.orgId, orgId), sql`${activityEvents.severity} <> 'info'`))
      .orderBy(desc(activityEvents.seq))
      .limit(limit);
  }

  /** Ascending read used by the SSE stream to catch up on events written elsewhere. */
  async after(
    orgId: string,
    projectId: string | null,
    afterSeq: number,
    limit: number,
  ): Promise<ActivityRow[]> {
    const scope = projectId
      ? and(eq(activityEvents.orgId, orgId), eq(activityEvents.projectId, projectId))
      : eq(activityEvents.orgId, orgId);

    return this.db
      .select()
      .from(activityEvents)
      .where(and(scope, gt(activityEvents.seq, afterSeq)))
      .orderBy(activityEvents.seq)
      .limit(limit);
  }

  async projection(orgId: string, projectId: string): Promise<ProjectionRow | null> {
    const rows = await this.db
      .select()
      .from(feedProjections)
      .where(and(eq(feedProjections.orgId, orgId), eq(feedProjections.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async latestSeq(orgId: string): Promise<number | null> {
    const rows = await this.db
      .select({ seq: sql<number | null>`max(${activityEvents.seq})` })
      .from(activityEvents)
      .where(eq(activityEvents.orgId, orgId));
    return rows[0]?.seq ?? null;
  }

  async saveOffset(orgId: string, clientKey: string, lastSeq: number): Promise<void> {
    await this.db
      .insert(sseOffsets)
      .values({ orgId, clientKey, lastSeq, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [sseOffsets.orgId, sseOffsets.clientKey],
        set: { lastSeq, updatedAt: new Date() },
      });
  }

  async loadOffset(orgId: string, clientKey: string): Promise<number | null> {
    const rows = await this.db
      .select({ lastSeq: sseOffsets.lastSeq })
      .from(sseOffsets)
      .where(and(eq(sseOffsets.orgId, orgId), eq(sseOffsets.clientKey, clientKey)))
      .limit(1);
    return rows[0]?.lastSeq ?? null;
  }
}
