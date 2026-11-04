import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayProxy } from './gateway-proxy';

/**
 * Relays a server-sent event stream from an owning service. The gateway copies bytes instead of
 * re-serialising them, so event ids and comments that drive EventSource reconnect behaviour
 * survive the hop untouched.
 */
export const relayEventStream = async (
  proxy: GatewayProxy,
  target: string,
  path: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const upstream = await proxy.stream(target, path, request);
  reply.raw.statusCode = upstream.status;
  reply.raw.setHeader('content-type', 'text/event-stream');
  reply.raw.setHeader('cache-control', 'no-store');
  reply.raw.setHeader('connection', 'keep-alive');
  reply.raw.setHeader('x-accel-buffering', 'no');

  if (!upstream.body) {
    reply.raw.end();
    return;
  }

  const reader = upstream.body.getReader();
  const abort = (): void => {
    void reader.cancel();
  };
  request.raw.on('close', abort);
  reply.raw.on('close', abort);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) reply.raw.write(value);
    }
  } finally {
    request.raw.off('close', abort);
    reply.raw.off('close', abort);
    reply.raw.end();
  }
};
