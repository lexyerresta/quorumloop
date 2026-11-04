import {
  DomainError,
  EVENT_TYPES,
  eventPayloadSchemas,
  type Approval,
  type DecideApprovalRequest,
  type EventEnvelope,
} from '@quorumloop/contracts';
import { SERVICE_LOGGER } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalRow } from '../database/schema';
import { ApprovalRepository } from './approval.repository';
import {
  canDecideApproval,
  isKnownApprovalAction,
  sortForQueue,
  type ApprovalStatus,
} from './approval.rules';

const approvalPayload = eventPayloadSchemas[EVENT_TYPES.approvalRequired];

/**
 * Approvals are the human gate the rest of the platform asks for. Requests arrive as events,
 * decisions arrive as commands, and a decision is final: nothing in this service can reopen one.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly repository: ApprovalRepository,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async list(orgId: string, status: ApprovalStatus | null): Promise<Approval[]> {
    const rows = await this.repository.list(orgId, status);
    return sortForQueue(rows).map(toApproval);
  }

  async decide(
    orgId: string,
    approvalId: string,
    actor: string,
    request: DecideApprovalRequest,
  ): Promise<Approval> {
    const current = await this.repository.findById(orgId, approvalId);
    if (!current) {
      throw new DomainError('NOT_FOUND', 'approval not found');
    }
    if (!canDecideApproval(current.status as ApprovalStatus)) {
      throw new DomainError('CONFLICT', `approval is already ${current.status}`);
    }

    const note = request.note?.trim();
    const row = await this.repository.decide({
      orgId,
      approvalId,
      decision: request.decision,
      actor,
      note: note ? note : null,
      decidedAt: new Date(),
    });
    if (!row) {
      // Another approver won the race between our read and our write. Reporting the conflict is
      // the honest answer: the decision belongs to whoever committed first, not to us.
      throw new DomainError('CONFLICT', 'approval was decided concurrently; reload the queue');
    }

    this.logger.info(
      { orgId, approvalId, decision: row.status, actor, noted: row.note !== null },
      'approval decided',
    );
    return toApproval(row);
  }

  /**
   * Materializes one approval request. Returns null for anything that cannot become a row: an event
   * outside the contract, an action the contract does not list, or a redelivery. Each of those is
   * acknowledged rather than retried, because replaying the same message changes nothing.
   */
  async recordFromEvent(envelope: EventEnvelope): Promise<ApprovalRow | null> {
    const parsed = approvalPayload.safeParse(envelope.payload);
    if (!parsed.success) {
      this.logger.warn(
        {
          eventId: envelope.event_id,
          issues: parsed.error.issues.map((issue) => issue.path.join('.')),
        },
        'approval event does not match the contract; not recorded',
      );
      return null;
    }

    const payload = parsed.data;
    if (!isKnownApprovalAction(payload.action)) {
      this.logger.warn(
        { eventId: envelope.event_id, action: payload.action },
        'approval action is not in the contract; not recorded',
      );
      return null;
    }
    if (envelope.org_id && envelope.org_id !== payload.org_id) {
      // Filing the request under the envelope's organization while its payload names another one
      // would put the approval in front of the wrong approvers, so neither is trusted here.
      this.logger.warn(
        { eventId: envelope.event_id, envelopeOrg: envelope.org_id, payloadOrg: payload.org_id },
        'approval event disagrees with its envelope about the organization; not recorded',
      );
      return null;
    }

    const occurredAt = new Date(envelope.occurred_at);
    const row = await this.repository.insertFromEvent({
      id: payload.approval_id,
      orgId: payload.org_id,
      projectId: payload.project_id,
      action: payload.action,
      summary: payload.summary,
      // The payload names the action, not the person. Until agents request approvals on their own
      // behalf, the publishing service is the requester, and saying so is better than inventing one.
      requestedBy: envelope.producer,
      risk: payload.risk,
      createdAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    });

    if (!row) {
      this.logger.debug({ eventId: envelope.event_id }, 'approval already recorded');
      return null;
    }

    this.logger.info(
      { approvalId: row.id, orgId: row.orgId, action: row.action, risk: row.risk },
      'approval queued',
    );
    return row;
  }
}

const toApproval = (row: ApprovalRow): Approval => ({
  id: row.id,
  org_id: row.orgId,
  project_id: row.projectId,
  action: row.action as Approval['action'],
  summary: row.summary,
  requested_by: row.requestedBy,
  risk: row.risk as Approval['risk'],
  status: row.status as ApprovalStatus,
  decided_by: row.decidedBy,
  decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
  note: row.note,
  created_at: row.createdAt.toISOString(),
});
