import { readEnv } from '@quorumloop/config';
import { EVENT_TYPES, DomainError, type Forge, type WebhookDelivery } from '@quorumloop/contracts';
import {
  EVENT_PUBLISHER,
  SERVICE_LOGGER,
  uuidv7,
  type TransactionalPublisher,
} from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable } from '@nestjs/common';
import { digestOf, verifyGithubSignature, verifyGitlabToken } from './signature';
import { normalize } from './normalize';
import { WebhookRepository } from './webhook.repository';

export interface WebhookHeaders {
  event: string | undefined;
  deliveryId: string | undefined;
  signature256: string | undefined;
  gitlabToken: string | undefined;
}

/**
 * Webhook intake. Order matters: the signature is checked against the untouched bytes before the
 * payload is parsed, the delivery is claimed before any work is queued, and a redelivery is
 * answered with `duplicate` instead of repeating the side effect.
 */
@Injectable()
export class WebhookService {
  constructor(
    private readonly repository: WebhookRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: TransactionalPublisher,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async ingest(forge: Forge, headers: WebhookHeaders, rawBody: Buffer): Promise<WebhookDelivery> {
    const env = readEnv();
    const secret = forge === 'github' ? env.GITHUB_WEBHOOK_SECRET : env.GITLAB_WEBHOOK_SECRET;
    const digest = digestOf(rawBody);
    const receivedAt = new Date();

    if (secret.length === 0) {
      throw new DomainError(
        'NOT_CONFIGURED',
        `${forge} webhooks are refused because ${
          forge === 'github' ? 'GITHUB_WEBHOOK_SECRET' : 'GITLAB_WEBHOOK_SECRET'
        } is not set`,
      );
    }

    const verified =
      forge === 'github'
        ? verifyGithubSignature(secret, rawBody, headers.signature256)
        : verifyGitlabToken(secret, headers.gitlabToken);

    if (!verified) {
      await this.repository.recordFailure({
        id: uuidv7(),
        forge,
        deliveryId: headers.deliveryId ?? null,
        reason: 'signature verification failed',
        payloadDigest: digest,
      });
      this.logger.warn({ forge, deliveryId: headers.deliveryId }, 'webhook signature rejected');
      throw new DomainError('UNAUTHENTICATED', 'the webhook signature is not valid');
    }

    let payload: unknown;
    try {
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      await this.repository.recordFailure({
        id: uuidv7(),
        forge,
        deliveryId: headers.deliveryId ?? null,
        reason: 'payload is not valid json',
        payloadDigest: digest,
      });
      throw new DomainError('VALIDATION_FAILED', 'the webhook payload is not valid json');
    }

    const event = headers.event ?? 'unknown';
    const normalized = normalize(forge, event, payload, headers.deliveryId);
    const deliveryId = normalized.deliveryId ?? digest;

    const claimed = await this.repository.claimDelivery(forge, deliveryId);
    if (!claimed) {
      await this.repository.bumpDuplicate(forge, deliveryId);
      this.logger.info({ forge, deliveryId }, 'webhook redelivery ignored');
      return {
        delivery_id: deliveryId,
        forge,
        event: normalized.event,
        received_at: receivedAt.toISOString(),
        status: 'duplicate',
        reason: 'this delivery was already accepted',
      };
    }

    const needsIdentity = normalized.kind !== 'other';
    const status: WebhookDelivery['status'] = !needsIdentity
      ? 'ignored'
      : normalized.remoteRepositoryId
        ? 'accepted'
        : 'rejected';
    const reason = !needsIdentity
      ? `event "${normalized.event}" does not affect a repository`
      : normalized.remoteRepositoryId
        ? null
        : 'the payload carried no repository identity';

    await this.repository.insertDelivery({
      id: uuidv7(),
      orgId: null,
      forge,
      deliveryId,
      event: normalized.event,
      kind: normalized.kind,
      remoteRepositoryId: normalized.remoteRepositoryId,
      fullName: normalized.fullName,
      status,
      reason,
      payloadDigest: digest,
      receivedAt,
    });

    if (status === 'accepted' && normalized.remoteRepositoryId) {
      // Source-control resolves the repository to a project and reconciles with the forge.
      await this.events.publish(
        EVENT_TYPES.repoWebhookReceived,
        {
          forge,
          delivery_id: deliveryId,
          event: normalized.event,
          kind: normalized.kind,
          remote_repository_id: normalized.remoteRepositoryId,
          full_name: normalized.fullName,
          actor: normalized.actor,
          received_at: receivedAt.toISOString(),
        },
        { aggregateId: deliveryId, actor: normalized.actor ?? forge },
      );
    }

    this.logger.info(
      { forge, deliveryId, event: normalized.event, kind: normalized.kind, status },
      'webhook ingested',
    );

    return {
      delivery_id: deliveryId,
      forge,
      event: normalized.event,
      received_at: receivedAt.toISOString(),
      status,
      reason,
    };
  }
}
