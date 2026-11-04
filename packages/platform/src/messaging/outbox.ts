import type { EventEnvelope } from '@quorumloop/contracts';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import type { EventPublisher } from './nats-bus';

interface OutboxRow {
  id: string;
  subject: string;
  envelope: EventEnvelope;
  attempts: number;
}

/**
 * Transactional outbox writer. It is called inside the same transaction as the state change,
 * so an event cannot exist without its row and a committed row cannot be lost on a crash.
 *
 * The envelope is serialised here and cast instead of using `sql.json`. Drizzle wraps the same
 * client and replaces the json/jsonb serialisers with an identity function, because its own
 * columns stringify JSON themselves. After that patch `sql.json(object)` hands the raw object
 * to the wire encoder, which rejects it with ERR_INVALID_ARG_TYPE.
 */
export const appendOutbox = async (
  sql: Sql,
  subject: string,
  envelope: EventEnvelope,
): Promise<void> => {
  await sql`
    insert into outbox_events (id, event_type, subject, envelope, occurred_at)
    values (
      ${envelope.event_id},
      ${envelope.event_type},
      ${subject},
      ${JSON.stringify(envelope)}::jsonb,
      ${envelope.occurred_at}
    )
  `;
};

export interface OutboxPublisherOptions {
  sql: Sql;
  bus: EventPublisher;
  logger: Logger;
  service: string;
  intervalMs?: number;
  batchSize?: number;
}

/**
 * Publishes outbox rows in order. A failed publish stops the batch so ordering is preserved;
 * the row stays unpublished and the next tick retries it. Nothing here fabricates success.
 */
export class OutboxPublisher {
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(private readonly options: OutboxPublisherOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flushOnce();
    }, this.options.intervalMs ?? 1_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flushOnce(): Promise<number> {
    if (this.flushing) {
      return 0;
    }
    this.flushing = true;
    let published = 0;
    try {
      const rows = await this.options.sql<OutboxRow[]>`
        select id, subject, envelope, attempts
        from outbox_events
        where published_at is null
        order by occurred_at asc
        limit ${this.options.batchSize ?? 50}
      `;
      for (const row of rows) {
        const result = await this.options.bus.publish(row.subject, row.envelope);
        if (!result.ok) {
          await this.options.sql`
            update outbox_events
            set attempts = attempts + 1, last_error = ${result.error ?? 'publish failed'}
            where id = ${row.id}
          `;
          break;
        }
        await this.options.sql`
          update outbox_events
          set published_at = now(), attempts = attempts + 1, last_error = null
          where id = ${row.id}
        `;
        published += 1;
      }
      return published;
    } catch (error) {
      this.options.logger.error(
        { err: error instanceof Error ? error.message : 'unknown error' },
        'outbox flush failed',
      );
      return published;
    } finally {
      this.flushing = false;
    }
  }
}
