import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import { DATABASE_SQL, DRIZZLE, uuidv7 } from '@quorumloop/platform';
import { notificationReads, notifications, schema, type NotificationRow } from '../database/schema';
import type { NotificationContent } from './notification.rules';

/**
 * The inbox is bounded because the gateway serves it as one page. The unread count is not, so a
 * member always knows how much is waiting even when the visible page is full.
 */
export const MAX_FEED_SIZE = 100;

export interface FeedRow {
  notification: NotificationRow;
  readAt: Date | null;
}

/** An event plus the scope the envelope carried, ready to become a row. */
export interface AppendableNotification extends NotificationContent {
  orgId: string;
}

@Injectable()
export class NotificationRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(DATABASE_SQL) private readonly sql: Sql,
  ) {}

  async feed(orgId: string, userId: string, unreadOnly: boolean): Promise<FeedRow[]> {
    const scoped = and(
      eq(notifications.orgId, orgId),
      unreadOnly ? isNull(notificationReads.notificationId) : undefined,
    );

    return this.db
      .select({ notification: notifications, readAt: notificationReads.readAt })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        ),
      )
      .where(scoped)
      .orderBy(desc(notifications.createdAt))
      .limit(MAX_FEED_SIZE);
  }

  async unreadCount(orgId: string, userId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        ),
      )
      .where(and(eq(notifications.orgId, orgId), isNull(notificationReads.notificationId)));
    return rows[0]?.count ?? 0;
  }

  /**
   * Returns null when the event was already projected. The unique key on `source_event_id` is the
   * guarantee, so a redelivery is a no-op even if the consumer inbox row were lost.
   */
  async append(
    record: AppendableNotification,
    sourceEventId: string,
    occurredAt: Date,
  ): Promise<NotificationRow | null> {
    const rows = await this.db
      .insert(notifications)
      .values({
        id: uuidv7(),
        orgId: record.orgId,
        projectId: record.projectId,
        kind: record.kind,
        title: record.title,
        body: record.body,
        severity: record.severity,
        sourceEventId,
        createdAt: occurredAt,
      })
      .onConflictDoNothing({ target: notifications.sourceEventId })
      .returning();
    return rows[0] ?? null;
  }

  /** False when the notification does not exist in this organization, which the caller reports. */
  async markRead(orgId: string, notificationId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), eq(notifications.id, notificationId)))
      .limit(1);
    if (!rows[0]) {
      return false;
    }
    await this.db
      .insert(notificationReads)
      .values({ notificationId, userId })
      .onConflictDoNothing({
        target: [notificationReads.notificationId, notificationReads.userId],
      });
    return true;
  }

  /**
   * One statement marks everything the member has not read yet. Doing it row by row would be a
   * round trip per notification on a fresh inbox.
   */
  async markAllRead(orgId: string, userId: string): Promise<number> {
    const result = await this.sql`
      insert into notification_reads (notification_id, user_id)
      select notification.id, ${userId}
      from notifications notification
      where notification.org_id = ${orgId}
        and not exists (
          select 1 from notification_reads existing
          where existing.notification_id = notification.id and existing.user_id = ${userId}
        )
      on conflict do nothing
      returning notification_id
    `;
    return result.count;
  }
}
