import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  assertNoSecrets,
  eventPayloadSchemas,
  EVENT_TYPES,
  type EventEnvelope,
  type EventType,
} from '@quorumloop/contracts';
import { uuidv7 } from '../ids';
import { currentContext } from '@quorumloop/observability';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { appendOutbox, OutboxPublisher } from './outbox';
import { NatsBus } from './nats-bus';
import { SERVICE_LOGGER } from '../nest/health';
import { DATABASE_SQL } from '../database/database.module';
import { readEnv } from '@quorumloop/config';

export const EVENT_PUBLISHER = Symbol('quorumloop:event-publisher');
export const OUTBOX_PUBLISHER = Symbol('quorumloop:outbox-publisher');

export interface PublishOptions {
  orgId?: string | null;
  projectId?: string | null;
  aggregateId?: string;
  actor?: string;
  correlationId?: string;
  causationId?: string | null;
  occurredAt?: string;
}

const EVENT_VERSION: Record<string, number> = Object.fromEntries(
  Object.values(EVENT_TYPES).map((subject) => [
    subject,
    Number(subject.split('.').pop()?.replace('v', '') ?? 1),
  ]),
);

/**
 * Publishing always means "write to my outbox". Delivery is the publisher's job, so a caller
 * that just committed state can never claim an event was sent when NATS was down.
 */
export class TransactionalPublisher {
  constructor(
    private readonly sql: Sql,
    private readonly service: string,
  ) {}

  async publish<T extends EventType>(
    eventType: T,
    payload: Record<string, unknown>,
    options: PublishOptions = {},
  ): Promise<EventEnvelope> {
    assertNoSecrets(payload);
    const schema = eventPayloadSchemas[eventType as keyof typeof eventPayloadSchemas];
    if (schema) {
      const result = schema.safeParse(payload);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new Error(
          `event ${eventType} payload rejected: ${issue?.path.join('.') ?? 'payload'} ${issue?.message ?? ''}`,
        );
      }
    }

    const context = currentContext();
    const occurredAt = options.occurredAt ?? new Date().toISOString();
    const envelope: EventEnvelope = {
      event_id: uuidv7(),
      event_type: eventType,
      version: EVENT_VERSION[eventType] ?? 1,
      occurred_at: occurredAt,
      published_at: occurredAt,
      producer: this.service,
      org_id: options.orgId ?? context?.orgId ?? null,
      project_id: options.projectId ?? null,
      aggregate_id:
        options.aggregateId ??
        (typeof payload.id === 'string' ? payload.id : `${this.service}:${occurredAt}`),
      correlation_id: options.correlationId ?? context?.correlationId ?? uuidv7(),
      causation_id: options.causationId ?? null,
      traceparent: null,
      data_classification: 'internal',
      payload,
    };
    await appendOutbox(this.sql, eventType, envelope);
    return envelope;
  }
}

@Injectable()
export class MessagingLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
    @Inject(NatsBus) private readonly bus: NatsBus,
  ) {}

  onModuleInit(): void {
    this.outbox.start();
    void this.bus.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.outbox.stop();
    await this.bus.onModuleDestroy();
  }
}

@Module({})
export class MessagingModule {}

/**
 * Every data-owning service gets the same bus, outbox loop and publisher. The module is global
 * because a service has exactly one database and one stream.
 */
export const defineMessagingModule = (options: { service: string }): DynamicModule => ({
  module: MessagingModule,
  global: true,
  providers: [
    {
      provide: NatsBus,
      useFactory: (logger: Logger) =>
        new NatsBus({ url: readEnv().NATS_URL, service: options.service, logger }),
      inject: [SERVICE_LOGGER],
    },
    {
      provide: OUTBOX_PUBLISHER,
      useFactory: (sql: Sql, bus: NatsBus, logger: Logger) =>
        new OutboxPublisher({ sql, bus, logger, service: options.service }),
      inject: [DATABASE_SQL, NatsBus, SERVICE_LOGGER],
    },
    {
      provide: EVENT_PUBLISHER,
      useFactory: (sql: Sql) => new TransactionalPublisher(sql, options.service),
      inject: [DATABASE_SQL],
    },
    MessagingLifecycle,
  ],
  exports: [EVENT_PUBLISHER, NatsBus, OUTBOX_PUBLISHER],
});
