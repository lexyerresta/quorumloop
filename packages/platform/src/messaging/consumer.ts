import type { EventEnvelope } from '@quorumloop/contracts';
import { isKnownEventType } from '@quorumloop/contracts';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import type { NatsBus } from './nats-bus';

/**
 * Consumer-side idempotency. A JetStream message can be delivered more than once, so the
 * inbox row is claimed before the handler runs and released only if the handler throws.
 */
export class InboxStore {
  constructor(
    private readonly sql: Sql,
    private readonly consumer: string,
  ) {}

  async claim(eventId: string): Promise<boolean> {
    const rows = await this.sql<{ event_id: string }[]>`
      insert into inbox_messages (consumer_name, event_id)
      values (${this.consumer}, ${eventId})
      on conflict do nothing
      returning event_id
    `;
    return rows.length > 0;
  }

  async release(eventId: string): Promise<void> {
    await this.sql`
      delete from inbox_messages where consumer_name = ${this.consumer} and event_id = ${eventId}
    `;
  }
}

export interface EventConsumerOptions {
  name: string;
  durable: string;
  subject: string;
  stream?: string;
  bus: NatsBus;
  sql: Sql;
  logger: Logger;
  handler: (envelope: EventEnvelope) => Promise<void>;
}

/**
 * Durable consumer that deduplicates through the inbox and acknowledges only after the
 * handler persisted its work. Unknown event types are acknowledged and ignored so a newer
 * producer cannot poison an older consumer.
 */
export class EventConsumer {
  private readonly inbox: InboxStore;

  constructor(private readonly options: EventConsumerOptions) {
    this.inbox = new InboxStore(options.sql, options.name);
  }

  async start(): Promise<void> {
    try {
      await this.options.bus.subscribeDurable({
        stream: this.options.stream ?? 'QUORUMLOOP',
        durable: this.options.durable,
        filterSubject: this.options.subject,
        handler: async (envelope) => {
          if (!isKnownEventType(envelope.event_type)) {
            this.options.logger.debug(
              { event_type: envelope.event_type },
              'ignoring unknown event type',
            );
            return;
          }
          const claimed = await this.inbox.claim(envelope.event_id);
          if (!claimed) {
            this.options.logger.debug(
              { event_id: envelope.event_id, consumer: this.options.name },
              'duplicate event skipped',
            );
            return;
          }
          try {
            await this.options.handler(envelope);
          } catch (error) {
            await this.inbox.release(envelope.event_id);
            throw error;
          }
        },
      });
      this.options.logger.info(
        { subject: this.options.subject, durable: this.options.durable },
        'event consumer started',
      );
    } catch (error) {
      this.options.logger.warn(
        {
          subject: this.options.subject,
          err: error instanceof Error ? error.message : 'unknown error',
        },
        'event consumer not started, nats unavailable',
      );
    }
  }
}
