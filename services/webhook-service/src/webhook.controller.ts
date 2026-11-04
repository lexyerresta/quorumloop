import { FORGE, DomainError, type Forge, type WebhookDelivery } from '@quorumloop/contracts';
import { Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { WebhookService, type WebhookHeaders } from './ingest/webhook.service';

const headerValue = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
};

/**
 * Internal webhook ingress. The gateway relays the provider's bytes untouched, so the signature
 * is checked over exactly what the provider sent.
 */
@Controller('v1/webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post(':forge')
  async receive(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WebhookDelivery> {
    const forge = (request.params as { forge?: string }).forge ?? '';
    if (!(FORGE as readonly string[]).includes(forge)) {
      throw new DomainError('NOT_FOUND', `unknown forge "${forge}"`);
    }
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new DomainError(
        'INTERNAL',
        'the raw request body is unavailable, so a signature cannot be verified',
      );
    }

    const headers: WebhookHeaders = {
      event: headerValue(request, 'x-github-event') ?? headerValue(request, 'x-gitlab-event'),
      deliveryId:
        headerValue(request, 'x-github-delivery') ?? headerValue(request, 'x-gitlab-event-uuid'),
      signature256: headerValue(request, 'x-hub-signature-256'),
      gitlabToken: headerValue(request, 'x-gitlab-token'),
    };

    const delivery = await this.webhooks.ingest(forge as Forge, headers, rawBody);
    // A duplicate is acknowledged, not refused: the provider would otherwise keep retrying.
    reply.status(delivery.status === 'accepted' ? 202 : 200);
    return delivery;
  }
}
