import { DomainError } from '@quorumloop/contracts';
import { SERVICE_LOGGER, getIdentity, headerValue } from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ActivityRow } from '../database/schema';
import { decodeCursor, encodeCursor } from './activity.cursor';
import { ActivityService, toActivityEvent } from './activity.service';
import { SseHub } from './sse.hub';
import { SentWindow } from './sse.window';

const HEARTBEAT_MS = 20_000;
const CATCH_UP_MS = 5_000;
const CATCH_UP_LIMIT = 100;

const projectIdSchema = z.string().uuid();

/** `Last-Event-ID` is whatever we last wrote as `id:`; only a plain sequence is meaningful. */
const resumedFromHeader = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const seq = Number(value);
  return Number.isInteger(seq) && seq >= 0 ? seq : null;
};

/**
 * Server-sent events for the timeline. Writes standard `id:` / `event:` / `data:` frames so a
 * browser's native EventSource can reconnect and resume by itself.
 *
 * Two sources feed one stream: the in-process hub (immediate, but only for events recorded by
 * this replica) and a periodic catch-up read (slightly later, but complete). The catch-up cursor
 * only advances on rows it actually read, so an event delivered by the hub cannot make the
 * reader skip past a gap.
 */
@Controller('v1/events')
export class SseController {
  constructor(
    private readonly activity: ActivityService,
    private readonly hub: SseHub,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  @Get('stream')
  async stream(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query('project_id') rawProjectId?: string,
    @Query('cursor') cursor?: string,
  ): Promise<void> {
    const identity = getIdentity(request);
    const orgId = identity.orgId;
    if (!orgId) {
      throw new DomainError('FORBIDDEN', 'the stream requires an organization scope');
    }
    if (rawProjectId !== undefined && !projectIdSchema.safeParse(rawProjectId).success) {
      throw new DomainError('VALIDATION_FAILED', 'project_id is not a valid id');
    }

    const scope = { orgId, projectId: rawProjectId ?? null };
    const clientKey = `${identity.userId ?? identity.service}:${scope.projectId ?? 'all'}`;

    const resume =
      decodeCursor(cursor) ??
      resumedFromHeader(headerValue(request, 'last-event-id')) ??
      (await this.activity.resumePoint(orgId, clientKey));
    let pollSeq = resume ?? (await this.activity.head(orgId));

    // The socket belongs to this handler from here on: Fastify must not send its own response.
    reply.hijack();
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-store, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.setHeader('x-accel-buffering', 'no');
    reply.raw.flushHeaders();

    let closed = false;
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const window = new SentWindow();

    const write = (chunk: string): void => {
      if (closed || reply.raw.writableEnded) {
        return;
      }
      reply.raw.write(chunk);
    };

    const frame = (row: ActivityRow): void => {
      if (window.has(row.seq)) {
        return;
      }
      window.add(row.seq);
      write(`id: ${row.seq}\nevent: activity\ndata: ${JSON.stringify(toActivityEvent(row))}\n\n`);
    };

    // A client that reconnects too aggressively is throttled to one retry every five seconds.
    write('retry: 5000\n\n');
    const projection = scope.projectId
      ? await this.activity.projection(orgId, scope.projectId)
      : null;
    write(
      `event: ready\ndata: ${JSON.stringify({
        cursor: encodeCursor(window.reached ?? pollSeq),
        project_id: scope.projectId,
        projection: projection
          ? {
              last_event_at: projection.lastEventAt.toISOString(),
              total_events: projection.totalEvents,
              alert_count: projection.alertCount,
            }
          : null,
      })}\n\n`,
    );

    const unsubscribe = this.hub.subscribe(scope, frame);

    let draining = false;
    const drain = async (): Promise<void> => {
      if (draining || closed) {
        return;
      }
      draining = true;
      try {
        for (;;) {
          const rows = await this.activity.catchUp(orgId, scope.projectId, pollSeq, CATCH_UP_LIMIT);
          if (rows.length === 0) {
            break;
          }
          for (const row of rows) {
            frame(row);
            pollSeq = row.seq;
          }
          if (rows.length < CATCH_UP_LIMIT) {
            break;
          }
        }
      } finally {
        draining = false;
      }
    };

    const catchUpTimer = setInterval(() => {
      void drain().catch((error: unknown) => {
        this.logger.warn(
          { err: error instanceof Error ? error.message : 'unknown error' },
          'activity stream catch-up failed; will retry',
        );
      });
    }, CATCH_UP_MS);

    const heartbeatTimer = setInterval(() => {
      write(': keep-alive\n\n');
    }, HEARTBEAT_MS);

    const stop = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(catchUpTimer);
      clearInterval(heartbeatTimer);
      unsubscribe();

      const reached = window.reached;
      if (reached !== null) {
        void this.activity.saveResumePoint(orgId, clientKey, reached).catch((error: unknown) => {
          this.logger.warn(
            { err: error instanceof Error ? error.message : 'unknown error' },
            'activity stream resume point not saved',
          );
        });
      }
      reply.raw.end();
      finish();
    };

    request.raw.on('close', stop);
    reply.raw.on('close', stop);

    await drain().catch((error: unknown) => {
      this.logger.warn(
        { err: error instanceof Error ? error.message : 'unknown error' },
        'activity stream could not replay from the resume point',
      );
    });

    // Hold the handler open for the life of the socket, so nothing sends a second response.
    await finished;
  }
}
