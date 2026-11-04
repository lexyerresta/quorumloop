import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { WebhookModule } from './webhook.module';

@Module({
  imports: [
    defineDatabaseModule({
      service: 'webhook-service',
      database: 'quorumloop_webhook',
      schema,
    }),
    defineMessagingModule({ service: 'webhook-service' }),
    WebhookModule,
  ],
})
export class AppModule {}
