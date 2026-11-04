import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { ApprovalModule } from './approvals/approval.module';
import { schema } from './database/schema';

/**
 * Audit owns approvals today. The rest of the trail (privileged actions, retention) has no
 * producer yet, so the service does not pretend to store what nobody sends.
 */
@Module({
  imports: [
    defineDatabaseModule({
      service: 'audit-service',
      database: 'quorumloop_audit',
      schema,
    }),
    defineMessagingModule({ service: 'audit-service' }),
    ApprovalModule,
  ],
})
export class AppModule {}
