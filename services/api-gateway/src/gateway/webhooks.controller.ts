import {
  FORGE,
  DomainError,
  errorEnvelopeSchema,
  webhookDeliverySchema,
  type WebhookDelivery,
} from '@quorumloop/contracts';
import { Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayProxy } from './gateway-proxy';
import { Public } from './session.guard';

/**
 * Forge webhook ingress. These routes are unauthenticated by design — the provider proves
 * itself with a signature over the raw body — so the gateway relays bytes and lets
 * webhook-service decide. It never trusts, rewrites or parses the payload.
 */
@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Public()
  @Post(':forge')
  async receive(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WebhookDelivery> {
    const forge = (request.params as { forge?: string }).forge ?? '';
    if (!(FORGE as readonly string[]).includes(forge)) {
      throw new DomainError('NOT_FOUND', `unknown forge ${forge}`);
    }
    const forwarded = await this.proxy.forward(
      'webhook-service',
      `/v1/webhooks/${encodeURIComponent(forge)}`,
      request,
    );
    reply.status(forwarded.status);

    if (forwarded.status >= 400) {
      const envelope = errorEnvelopeSchema.safeParse(safeJson(forwarded.body));
      if (envelope.success) {
        throw new DomainError(
          envelope.data.error.code,
          envelope.data.error.message,
          envelope.data.error.retryable,
        );
      }
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `webhook intake responded with ${forwarded.status}`,
      );
    }

    return webhookDeliverySchema.parse(safeJson(forwarded.body));
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError('UPSTREAM_UNAVAILABLE', 'webhook intake returned malformed json');
  }
};
