import type { EventEnvelope } from '@quorumloop/contracts';
import { EVENT_TYPES } from '@quorumloop/contracts';
import { DATABASE_SQL, EventConsumer, NatsBus, SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';
import { ApprovalService } from '../approvals/approval.service';

export const APPROVAL_CONSUMER = 'audit-approvals';

/**
 * Only approval requests are materialized here. Everything else the audit service will eventually
 * persist (decisions, privileged actions) is either written by this service directly or arrives on
 * a subject that does not exist yet, so subscribing to the whole stream would be a promise the
 * service cannot keep.
 */
@Injectable()
export class ApprovalConsumer implements OnModuleInit {
  constructor(
    @Inject(NatsBus) private readonly bus: NatsBus,
    @Inject(DATABASE_SQL) private readonly sql: Sql,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
    private readonly approvals: ApprovalService,
  ) {}

  onModuleInit(): void {
    const consumer = new EventConsumer({
      name: APPROVAL_CONSUMER,
      durable: APPROVAL_CONSUMER,
      subject: EVENT_TYPES.approvalRequired,
      bus: this.bus,
      sql: this.sql,
      logger: this.logger,
      handler: (envelope) => this.handle(envelope),
    });
    void consumer.start();
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    await this.approvals.recordFromEvent(envelope);
  }
}
