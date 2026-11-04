import {
  APPROVAL_ACTIONS,
  EVENT_TYPES,
  eventPayloadSchemas,
  type EventEnvelope,
  type NotificationKind,
} from '@quorumloop/contracts';

/** What a notification says. The row also needs the scope, which the event envelope carries. */
export interface NotificationContent {
  kind: NotificationKind;
  projectId: string | null;
  title: string;
  body: string;
  severity: 'info' | 'warning';
}

const readable = (action: string): string => action.split('_').join(' ');

/**
 * Maps one event to one notification, or null when the payload does not match its contract. The
 * mapping is a pure function so the wording and the severity rule can be tested without a database,
 * and so the consumer has no excuse to hand-roll a second version of them.
 */
export const toNotification = (envelope: EventEnvelope): NotificationContent | null => {
  switch (envelope.event_type) {
    case EVENT_TYPES.approvalRequired: {
      const parsed = eventPayloadSchemas[EVENT_TYPES.approvalRequired].safeParse(envelope.payload);
      if (!parsed.success) {
        return null;
      }
      const { action, org_id: orgId, project_id: projectId, risk, summary } = parsed.data;
      if (!(APPROVAL_ACTIONS as readonly string[]).includes(action)) {
        // The audit service refuses to record an action outside the contract, so announcing it here
        // would send the approver to a request that does not exist.
        return null;
      }
      if (envelope.org_id && envelope.org_id !== orgId) {
        // A notification filed under the wrong organization would show one tenant's action to
        // another, so a disagreement between envelope and payload produces nothing at all.
        return null;
      }
      return {
        kind: 'approval.required',
        projectId,
        title: `Approval needed: ${readable(action)}`,
        body: summary,
        // A request nobody has to look at twice is ordinary; the dangerous one is the alert.
        severity: risk === 'high' ? 'warning' : 'info',
      };
    }
    case EVENT_TYPES.reviewCreated: {
      const parsed = eventPayloadSchemas[EVENT_TYPES.reviewCreated].safeParse(envelope.payload);
      if (!parsed.success) {
        return null;
      }
      const { forge, number, project_id: projectId, title } = parsed.data;
      return {
        kind: 'review.created',
        projectId,
        title: `Review #${number} opened`,
        body: `${title} (${forge})`,
        severity: 'info',
      };
    }
    default:
      return null;
  }
};
