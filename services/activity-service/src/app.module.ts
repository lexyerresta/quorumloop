import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module';
import { schema } from './database/schema';

@Module({
  imports: [
    defineDatabaseModule({
      service: 'activity-service',
      database: 'quorumloop_activity',
      schema,
    }),
    defineMessagingModule({ service: 'activity-service' }),
    ActivityModule,
  ],
})
export class AppModule {}
