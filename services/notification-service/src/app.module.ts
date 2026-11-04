import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { NotificationModule } from './notifications/notification.module';

/**
 * In-app notifications only. Outbound e-mail and Telegram adapters are part of the service's
 * boundary in the PRD, but nothing in the platform produces a delivery policy yet, so the service
 * does not ship a delivery table it would never write to.
 */
@Module({
  imports: [
    defineDatabaseModule({
      service: 'notification-service',
      database: 'quorumloop_notification',
      schema,
    }),
    defineMessagingModule({ service: 'notification-service' }),
    NotificationModule,
  ],
})
export class AppModule {}
