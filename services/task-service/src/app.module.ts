import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { TaskModule } from './tasks/task.module';

@Module({
  imports: [
    defineDatabaseModule({
      service: 'task-service',
      database: 'quorumloop_task',
      schema,
    }),
    defineMessagingModule({ service: 'task-service' }),
    TaskModule,
  ],
})
export class AppModule {}
