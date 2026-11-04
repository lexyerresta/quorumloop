import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { ProjectModule } from './projects/project.module';

@Module({
  imports: [
    defineDatabaseModule({
      service: 'project-service',
      database: 'quorumloop_project',
      schema,
    }),
    defineMessagingModule({ service: 'project-service' }),
    ProjectModule,
  ],
})
export class AppModule {}
