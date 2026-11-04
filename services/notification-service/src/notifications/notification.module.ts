import { Module } from '@nestjs/common';
import { NotificationConsumer } from '../consumers/notification.consumer';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationRepository, NotificationService, NotificationConsumer],
  exports: [NotificationService],
})
export class NotificationModule {}
