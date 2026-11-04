import { Module } from '@nestjs/common';
import { WebhookService } from './ingest/webhook.service';
import { WebhookRepository } from './ingest/webhook.repository';
import { WebhookController } from './webhook.controller';

@Module({
  controllers: [WebhookController],
  providers: [WebhookRepository, WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
