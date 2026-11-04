import { DomainError, type NotificationFeed } from '@quorumloop/contracts';
import { getIdentity } from '@quorumloop/platform';
import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { NotificationService } from './notification.service';

interface Viewer {
  orgId: string;
  userId: string;
}

/**
 * An inbox without a member is not a thing: read state is personal, so a service caller (which has
 * no user id) is refused rather than answered with somebody else's reading.
 */
const viewerOf = (request: FastifyRequest): Viewer => {
  const identity = getIdentity(request);
  if (!identity.orgId) {
    throw new DomainError('FORBIDDEN', 'request is not scoped to an organization');
  }
  if (!identity.userId) {
    throw new DomainError('FORBIDDEN', 'the inbox belongs to a signed-in member');
  }
  return { orgId: identity.orgId, userId: identity.userId };
};

@Controller('v1/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  feed(
    @Req() request: FastifyRequest,
    @Query('unread_only') unreadOnly?: string,
  ): Promise<NotificationFeed> {
    const viewer = viewerOf(request);
    return this.notifications.feed(
      viewer.orgId,
      viewer.userId,
      unreadOnly === 'true' || unreadOnly === '1',
    );
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@Req() request: FastifyRequest): Promise<void> {
    const viewer = viewerOf(request);
    await this.notifications.markAllRead(viewer.orgId, viewer.userId);
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  async read(
    @Req() request: FastifyRequest,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    const viewer = viewerOf(request);
    await this.notifications.markRead(viewer.orgId, notificationId, viewer.userId);
  }
}
