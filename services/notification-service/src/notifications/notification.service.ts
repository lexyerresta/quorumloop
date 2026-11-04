import {
  DomainError,
  type EventEnvelope,
  type Notification,
  type NotificationFeed,
  type NotificationKind,
} from '@quorumloop/contracts';
import { SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { NotificationRow } from '../database/schema';
import { NotificationRepository, type FeedRow } from './notification.repository';
import { toNotification } from './notification.rules';

/**
 * The inbox is a projection of durable events, never a source of truth. Nothing here decides who
 * should be told what beyond the event's own scope: the mapping does that, and this service only
 * persists it and answers questions about read state.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async feed(orgId: string, userId: string, unreadOnly: boolean): Promise<NotificationFeed> {
    const [rows, unread] = await Promise.all([
      this.repository.feed(orgId, userId, unreadOnly),
      this.repository.unreadCount(orgId, userId),
    ]);
    return { items: rows.map(toModel), unread };
  }

  async markRead(orgId: string, notificationId: string, userId: string): Promise<void> {
    const found = await this.repository.markRead(orgId, notificationId, userId);
    if (!found) {
      throw new DomainError('NOT_FOUND', 'notification not found');
    }
  }

  async markAllRead(orgId: string, userId: string): Promise<number> {
    const marked = await this.repository.markAllRead(orgId, userId);
    this.logger.info({ orgId, userId, marked }, 'notifications marked read');
    return marked;
  }

  /**
   * Projects one durable event. Returns null for a redelivery, for an event outside this service's
   * scope, and for a payload that does not match its contract; all three are acknowledged, because
   * replaying the same message changes none of them.
   */
  async record(envelope: EventEnvelope): Promise<NotificationRow | null> {
    if (!envelope.org_id) {
      this.logger.debug(
        { eventId: envelope.event_id, eventType: envelope.event_type },
        'event has no organization scope; no notification',
      );
      return null;
    }

    const content = toNotification(envelope);
    if (!content) {
      this.logger.warn(
        { eventId: envelope.event_id, eventType: envelope.event_type },
        'event cannot become a notification; nothing recorded',
      );
      return null;
    }

    const occurredAt = new Date(envelope.occurred_at);
    const row = await this.repository.append(
      { ...content, orgId: envelope.org_id },
      envelope.event_id,
      Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    );
    if (!row) {
      this.logger.debug({ eventId: envelope.event_id }, 'notification already recorded');
      return null;
    }

    this.logger.info(
      { notificationId: row.id, orgId: row.orgId, kind: row.kind },
      'notification recorded',
    );
    return row;
  }
}

const toModel = (row: FeedRow): Notification => ({
  id: row.notification.id,
  org_id: row.notification.orgId,
  project_id: row.notification.projectId,
  kind: row.notification.kind as NotificationKind,
  title: row.notification.title,
  body: row.notification.body,
  severity: row.notification.severity as Notification['severity'],
  read: row.readAt !== null,
  created_at: row.notification.createdAt.toISOString(),
});
