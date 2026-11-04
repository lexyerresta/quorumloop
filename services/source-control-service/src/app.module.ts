import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { SourceControlModule } from './source-control.module';

@Module({
  imports: [
    defineDatabaseModule({
      service: 'source-control-service',
      database: 'quorumloop_source_control',
      schema,
    }),
    defineMessagingModule({ service: 'source-control-service' }),
    SourceControlModule,
  ],
})
export class AppModule {}
