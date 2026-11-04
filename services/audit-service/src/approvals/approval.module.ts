import { Module } from '@nestjs/common';
import { ApprovalConsumer } from '../consumers/approval.consumer';
import { ApprovalController } from './approval.controller';
import { ApprovalRepository } from './approval.repository';
import { ApprovalService } from './approval.service';

@Module({
  controllers: [ApprovalController],
  providers: [ApprovalRepository, ApprovalService, ApprovalConsumer],
  exports: [ApprovalService],
})
export class ApprovalModule {}
