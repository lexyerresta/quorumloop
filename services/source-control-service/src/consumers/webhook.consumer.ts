import { EVENT_TYPES, validatePayload, type EventEnvelope } from '@quorumloop/contracts';
import { DATABASE_SQL, EventConsumer, NatsBus, SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';
import { SyncService } from '../repositories/sync.service';

export const WEBHOOK_CONSUMER = 'source-control-webhook';

/**
 * Consumes normalized webhook events and reconciles the affected repositories. Delivery is
 * at-least-once, so the handler is idempotent: a sync reads the forge and overwrites the cache,
 * which produces the same rows whether it runs once or twice.
 */
@Injectable()
export class WebhookReconciliationConsumer implements OnModuleInit {
  constructor(
    @Inject(NatsBus) private readonly bus: NatsBus,
    @Inject(DATABASE_SQL) private readonly sql: Sql,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
    private readonly sync: SyncService,
  ) {}

  onModuleInit(): void {
    const consumer = new EventConsumer({
      name: WEBHOOK_CONSUMER,
      durable: WEBHOOK_CONSUMER,
      subject: EVENT_TYPES.repoWebhookReceived,
      bus: this.bus,
      sql: this.sql,
      logger: this.logger,
      handler: (envelope) => this.handle(envelope),
    });
    void consumer.start();
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const payload = validatePayload(EVENT_TYPES.repoWebhookReceived, envelope.payload) as {
      forge: 'github' | 'gitlab';
      delivery_id: string;
      remote_repository_id: string | null;
      kind: string;
    };

    if (!payload.remote_repository_id) {
      return;
    }

    this.logger.info(
      {
        forge: payload.forge,
        deliveryId: payload.delivery_id,
        kind: payload.kind,
        remoteRepositoryId: payload.remote_repository_id,
      },
      'reconciling repository after webhook',
    );

    await this.sync.syncByWebhook(payload.forge, payload.remote_repository_id);
  }
}
