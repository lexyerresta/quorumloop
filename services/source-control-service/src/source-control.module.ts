import { Module } from '@nestjs/common';
import { ForgeFactory } from './forge/forge.factory';
import { ConnectionRepository } from './connections/connection.repository';
import { ConnectionService } from './connections/connection.service';
import { WebhookReconciliationConsumer } from './consumers/webhook.consumer';
import { MirrorRepository } from './repositories/mirror.repository';
import { SyncService } from './repositories/sync.service';
import { SourceControlController } from './source-control.controller';

@Module({
  controllers: [SourceControlController],
  providers: [
    ConnectionRepository,
    ConnectionService,
    MirrorRepository,
    SyncService,
    ForgeFactory,
    WebhookReconciliationConsumer,
  ],
  exports: [ConnectionService, SyncService],
})
export class SourceControlModule {}
