import { notificationFeedSchema, type NotificationFeed } from '@quorumloop/contracts';
import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { GatewayProxy } from './gateway-proxy';

/**
 * The inbox surface. The gateway forwards and nothing else: the notification service decides what
 * exists and what "read" means for the caller.
 */
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Get()
  feed(
    @Req() request: FastifyRequest,
    @Query('unread_only') unreadOnly?: string,
  ): Promise<NotificationFeed> {
    const unread = unreadOnly === 'true' || unreadOnly === '1';
    const suffix = unread ? '?unread_only=true' : '';
    return this.proxy.call(
      'notification-service',
      'GET',
      `/v1/notifications${suffix}`,
      notificationFeedSchema,
      { request },
    );
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@Req() request: FastifyRequest): Promise<void> {
    await this.proxy.command('notification-service', 'POST', '/v1/notifications/read-all', {
      request,
    });
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  async read(
    @Req() request: FastifyRequest,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    await this.proxy.command(
      'notification-service',
      'POST',
      `/v1/notifications/${encodeURIComponent(notificationId)}/read`,
      { request },
    );
  }
}
