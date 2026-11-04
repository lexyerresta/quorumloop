import type { Forge } from '@quorumloop/contracts';

export type WebhookKind = 'push' | 'merge_request' | 'review' | 'other';

export interface NormalizedWebhook {
  kind: WebhookKind;
  /** The provider's event name, kept verbatim so an operator can correlate with their UI. */
  event: string;
  deliveryId: string | null;
  remoteRepositoryId: string | null;
  fullName: string | null;
  actor: string | null;
}

/** Walks an unknown payload without trusting its shape. */
const read = (value: unknown, ...path: readonly string[]): unknown => {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const asString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const GITHUB_KIND: Record<string, WebhookKind> = {
  push: 'push',
  pull_request: 'merge_request',
  pull_request_review: 'review',
  pull_request_review_comment: 'review',
  issue_comment: 'review',
};

const GITLAB_KIND: Record<string, WebhookKind> = {
  'Push Hook': 'push',
  'Tag Push Hook': 'push',
  'Merge Request Hook': 'merge_request',
  'Note Hook': 'review',
};

export const normalizeGithub = (
  event: string,
  payload: unknown,
  deliveryHeader: string | undefined,
): NormalizedWebhook => ({
  kind: GITHUB_KIND[event] ?? 'other',
  event,
  deliveryId: deliveryHeader && deliveryHeader.length > 0 ? deliveryHeader : null,
  remoteRepositoryId: asString(read(payload, 'repository', 'id')),
  fullName: asString(read(payload, 'repository', 'full_name')),
  actor: asString(read(payload, 'sender', 'login')),
});

export const normalizeGitlab = (
  event: string,
  payload: unknown,
  deliveryHeader: string | undefined,
): NormalizedWebhook => ({
  kind: GITLAB_KIND[event] ?? 'other',
  event,
  deliveryId: deliveryHeader && deliveryHeader.length > 0 ? deliveryHeader : null,
  remoteRepositoryId: asString(read(payload, 'project', 'id')),
  fullName: asString(read(payload, 'project', 'path_with_namespace')),
  actor: asString(read(payload, 'user_username')),
});

export const normalize = (
  forge: Forge,
  event: string,
  payload: unknown,
  deliveryHeader: string | undefined,
): NormalizedWebhook =>
  forge === 'github'
    ? normalizeGithub(event, payload, deliveryHeader)
    : normalizeGitlab(event, payload, deliveryHeader);
