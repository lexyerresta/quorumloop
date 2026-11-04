import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityRepository } from './activity.repository';
import { ActivityService } from './activity.service';
import { SseController } from './sse.controller';
import { SseHub } from './sse.hub';
import { ActivityConsumer } from '../consumers/activity.consumer';

@Module({
  controllers: [ActivityController, SseController],
  providers: [ActivityRepository, ActivityService, SseHub, ActivityConsumer],
  exports: [ActivityService],
})
export class ActivityModule {}
