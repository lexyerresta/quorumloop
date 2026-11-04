import { APPROVAL_ACTIONS, approvalSchema, type Approval } from '@quorumloop/contracts';

export type ApprovalAction = Approval['action'];
export type ApprovalStatus = Approval['status'];

/**
 * The contract is the only place the status set is written down. Deriving it here means a status
 * added to the schema reaches the query validator without a second copy to keep in sync.
 */
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = approvalSchema.shape.status.options;

/**
 * An approval is a human gate on an action the platform refuses to take on its own. The only legal
 * transition is from `pending`, so a decision can never be revised: reversing an approval would mean
 * the risk was accepted twice.
 */
export const canDecideApproval = (status: ApprovalStatus): boolean => status === 'pending';

/** Lower risk actions still need a decision, but the queue can put the dangerous ones on top. */
export const RISK_ORDER: Record<Approval['risk'], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const isKnownApprovalAction = (action: string): action is ApprovalAction =>
  (APPROVAL_ACTIONS as readonly string[]).includes(action);

/**
 * The minimum a row needs to take part in the queue order; tests can use plain objects. `status` is
 * a plain string because the column is text: an unknown value costs its row a rank, not a crash.
 */
export interface QueueEntry {
  status: string;
  risk: string;
  createdAt: Date;
}

const riskRank = (risk: string): number => RISK_ORDER[risk as Approval['risk']] ?? 0;

/**
 * Pending first, then riskiest, then newest. The list is a work queue: a decision already taken is
 * history, and among the ones that still need a human the order should not make the approver hunt
 * for the dangerous request.
 */
export const sortForQueue = <T extends QueueEntry>(rows: readonly T[]): T[] =>
  [...rows].sort((left, right) => {
    const pending = Number(right.status === 'pending') - Number(left.status === 'pending');
    if (pending !== 0) {
      return pending;
    }
    const risk = riskRank(right.risk) - riskRank(left.risk);
    if (risk !== 0) {
      return risk;
    }
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
