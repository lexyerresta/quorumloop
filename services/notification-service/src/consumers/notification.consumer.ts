import { EVENT_TYPES, type EventEnvelope } from '@quorumloop/contracts';
import { DATABASE_SQL, EventConsumer, NatsBus, SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';
import { NotificationService } from '../notifications/notification.service';

/**
 * One durable consumer per subject, named after what it produces rather than after the subject, so
 * the inbox table reads as a list of projections. PRD section 28.2 names exactly these two events as
 * notification consumers; anything else would be a subscription with no product behind it.
 */
const SUBSCRIPTIONS = [
  { name: 'notification-approvals', subject: EVENT_TYPES.approvalRequired },
  { name: 'notification-reviews', subject: EVENT_TYPES.reviewCreated },
] as const;

@Injectable()
export class NotificationConsumer implements OnModuleInit {
  constructor(
    @Inject(NatsBus) private readonly bus: NatsBus,
    @Inject(DATABASE_SQL) private readonly sql: Sql,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    for (const subscription of SUBSCRIPTIONS) {
      const consumer = new EventConsumer({
        name: subscription.name,
        durable: subscription.name,
        subject: subscription.subject,
        bus: this.bus,
        sql: this.sql,
        logger: this.logger,
        handler: (envelope) => this.handle(envelope),
      });
      void consumer.start();
    }
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    await this.notifications.record(envelope);
  }
}
