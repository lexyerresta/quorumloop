import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EventEnvelope } from '@quorumloop/contracts';
import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  JSONCodec,
  RetentionPolicy,
  StorageType,
  connect,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from 'nats';
import type { Logger } from 'pino';

export interface PublishResult {
  ok: boolean;
  error?: string;
}

export interface EventPublisher {
  publish(subject: string, envelope: EventEnvelope): Promise<PublishResult>;
}

export interface DurableSubscription {
  stream: string;
  durable: string;
  filterSubject: string;
  maxDeliver?: number;
  handler: (
    envelope: EventEnvelope,
    meta: { deliveryCount: number; subject: string },
  ) => Promise<void>;
}

export interface NatsBusOptions {
  url: string;
  service: string;
  logger: Logger;
  streamName?: string;
}

const codec = JSONCodec<EventEnvelope>();

/**
 * Thin wrapper over the official NATS client. Core NATS is used for nothing here: every
 * durable event goes through JetStream with an explicit message ID so a republish of the same
 * outbox row is deduplicated by the server as well as by the consumer inbox.
 *
 * The bus never throws during boot. If NATS is unreachable the service starts, reports
 * `degraded` from the health probe, and the outbox keeps events until the connection returns.
 */
export class NatsBus implements OnModuleInit, OnModuleDestroy, EventPublisher {
  private connection: NatsConnection | null = null;
  private jetstream: JetStreamClient | null = null;
  private manager: JetStreamManager | null = null;
  private readonly subscriptions: ConsumerMessages[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastError = 'not connected yet';

  constructor(private readonly options: NatsBusOptions) {}

  private get streamName(): string {
    return this.options.streamName ?? 'QUORUMLOOP';
  }

  async onModuleInit(): Promise<void> {
    await this.connectSafely();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (const subscription of this.subscriptions) {
      try {
        subscription.stop();
      } catch {
        // already stopped
      }
    }
    if (this.connection) {
      await this.connection.drain().catch(() => this.connection?.close());
      this.connection = null;
    }
  }

  status(): { status: 'ok' | 'degraded'; detail: string } {
    if (this.connection && !this.connection.isClosed()) {
      return { status: 'ok', detail: `connected to ${this.options.url}` };
    }
    return { status: 'degraded', detail: this.lastError };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectSafely();
    }, 5_000);
    this.retryTimer.unref();
  }

  private async connectSafely(): Promise<void> {
    try {
      await this.connect();
      this.options.logger.info({ url: this.options.url }, 'nats connected');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'unknown connection error';
      this.options.logger.warn({ err: this.lastError }, 'nats unavailable, running degraded');
      this.scheduleRetry();
    }
  }

  async connect(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      return;
    }
    const connection = await connect({
      servers: this.options.url,
      name: `${this.options.service}-${process.pid}`,
      timeout: 3_000,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2_000,
      pingInterval: 15_000,
    });
    this.connection = connection;
    this.manager = await connection.jetstreamManager();
    this.jetstream = connection.jetstream();
    await this.ensureStream();
  }

  private async ensureStream(): Promise<void> {
    const manager = this.manager;
    if (!manager) {
      throw new Error('jetstream manager is not ready');
    }
    try {
      await manager.streams.info(this.streamName);
    } catch {
      await manager.streams.add({
        name: this.streamName,
        subjects: ['quorumloop.>'],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
        duplicate_window: 120 * 1_000_000_000,
        discard: DiscardPolicy.Old,
        max_msgs: 1_000_000,
      });
      this.options.logger.info({ stream: this.streamName }, 'jetstream stream created');
    }
  }

  async publish(subject: string, envelope: EventEnvelope): Promise<PublishResult> {
    if (!this.jetstream) {
      return { ok: false, error: 'jetstream is not connected' };
    }
    try {
      await this.jetstream.publish(subject, codec.encode(envelope), {
        msgID: envelope.event_id,
        timeout: 5_000,
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'publish failed';
      this.lastError = message;
      return { ok: false, error: message };
    }
  }

  async subscribeDurable(subscription: DurableSubscription): Promise<void> {
    if (!this.connection || !this.manager || !this.jetstream) {
      throw new Error('jetstream is not connected');
    }
    const maxDeliver = subscription.maxDeliver ?? 5;
    try {
      await this.manager.consumers.info(subscription.stream, subscription.durable);
    } catch {
      await this.manager.consumers.add(subscription.stream, {
        durable_name: subscription.durable,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        filter_subject: subscription.filterSubject,
        max_deliver: maxDeliver,
        ack_wait: 60 * 1_000_000_000,
        max_ack_pending: 100,
      });
    }

    const consumer = await this.jetstream.consumers.get(subscription.stream, subscription.durable);
    const messages = await consumer.consume();
    this.subscriptions.push(messages);

    void (async () => {
      for await (const message of messages) {
        try {
          const envelope = codec.decode(message.data);
          await subscription.handler(envelope, {
            deliveryCount: message.info.deliveryCount,
            subject: message.subject,
          });
          message.ack();
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'handler failed';
          this.options.logger.error(
            { subject: message.subject, delivery: message.info.deliveryCount, err: detail },
            'event handler failed',
          );
          if (message.info.deliveryCount >= maxDeliver) {
            message.term();
          } else {
            message.nak(5_000);
          }
        }
      }
    })();
  }
}
