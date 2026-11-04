import type { EventEnvelope } from '@quorumloop/contracts';
import { DATABASE_SQL, EventConsumer, NatsBus, SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';
import { ActivityService } from '../activity/activity.service';

export const ACTIVITY_CONSUMER = 'activity-stream';

/** Every subject in the catalog shares the stream's root token. */
const ALL_SUBJECTS = 'quorumloop.>';

/**
 * The timeline is a projection of every domain event, so this consumer subscribes to the whole
 * stream rather than one subject. The inbox makes it idempotent; the unique index on
 * `source_event_id` makes it idempotent even if the inbox row were lost.
 */
@Injectable()
export class ActivityConsumer implements OnModuleInit {
  constructor(
    @Inject(NatsBus) private readonly bus: NatsBus,
    @Inject(DATABASE_SQL) private readonly sql: Sql,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit(): void {
    const consumer = new EventConsumer({
      name: ACTIVITY_CONSUMER,
      durable: ACTIVITY_CONSUMER,
      subject: ALL_SUBJECTS,
      bus: this.bus,
      sql: this.sql,
      logger: this.logger,
      handler: (envelope) => this.handle(envelope),
    });
    void consumer.start();
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    await this.activity.record(envelope);
  }
}
