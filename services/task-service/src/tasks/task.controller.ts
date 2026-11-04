import {
  DomainError,
  createTaskRequestSchema,
  instructionRequestSchema,
  transitionTaskRequestSchema,
  updateTaskRequestSchema,
  type InstructionResponse,
  type Task,
  type TaskBoard,
  type TaskHistoryEntry,
  type TaskSummary,
  type TransitionTaskResponse,
} from '@quorumloop/contracts';
import { getIdentity, parseWith, requireAnyRole, requireOrgId } from '@quorumloop/platform';
import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TaskService, type RequestContext } from './task.service';

const WRITE_ROLES = ['owner', 'admin', 'developer'] as const;

const verifyCriterionSchema = z.object({
  verified: z.boolean(),
  evidence_ref: z.string().max(2000).nullable().default(null),
});

const wipLimitSchema = z.object({ wip_limit: z.number().int().min(1).max(50) });

const qualityStateSchema = z.object({
  task_id: z.string().uuid(),
  state: z.enum(['not_run', 'running', 'passed', 'failed', 'inconclusive']),
  evidence_refs: z.array(z.string()).default([]),
});

const contextOf = (request: FastifyRequest): RequestContext => {
  const identity = getIdentity(request);
  return { identity, actor: identity.actor };
};

/**
 * Internal task API. Write routes require a developer or above; the Done gate is enforced in the
 * service so no caller — gateway, scheduler or agent — can bypass it by changing the route.
 */
@Controller('v1')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  @Get('summary')
  summary(@Req() request: FastifyRequest): Promise<TaskSummary> {
    return this.tasks.summary(requireOrgId(request));
  }

  @Get('projects/:projectId/board')
  board(@Req() request: FastifyRequest, @Param('projectId') projectId: string): Promise<TaskBoard> {
    return this.tasks.board(contextOf(request), projectId);
  }

  @Post('projects/:projectId/tasks')
  create(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<Task> {
    requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(createTaskRequestSchema, body);
    return this.tasks.create(contextOf(request), projectId, input);
  }

  /**
   * The revision composer's entry point. An instruction is written by a person, so a service
   * caller without a user identity is refused rather than attributed to a robot.
   */
  @Post('projects/:projectId/instructions')
  instruct(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<InstructionResponse> {
    requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(instructionRequestSchema, body);
    return this.tasks.instruct(contextOf(request), projectId, input);
  }

  @Patch('projects/:projectId/board')
  async setWipLimit(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<{ wip_limit: number }> {
    requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(wipLimitSchema, body);
    return {
      wip_limit: await this.tasks.setWipLimit(contextOf(request), projectId, input.wip_limit),
    };
  }

  @Get('tasks/:taskId')
  detail(@Req() request: FastifyRequest, @Param('taskId') taskId: string): Promise<Task> {
    return this.tasks.get(contextOf(request), taskId);
  }

  @Patch('tasks/:taskId')
  update(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<Task> {
    requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(updateTaskRequestSchema, body);
    return this.tasks.update(contextOf(request), taskId, input);
  }

  @Post('tasks/:taskId/transition')
  transition(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<TransitionTaskResponse> {
    requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(transitionTaskRequestSchema, body);
    return this.tasks.transition(contextOf(request), taskId, input, {
      qualityGateRequired: process.env.QUALITY_GATE_REQUIRED !== 'false',
    });
  }

  @Get('tasks/:taskId/history')
  history(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
  ): Promise<TaskHistoryEntry[]> {
    return this.tasks.history(contextOf(request), taskId);
  }

  @Post('tasks/:taskId/criteria/:criterionId')
  verifyCriterion(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Param('criterionId') criterionId: string,
    @Body() body: unknown,
  ): Promise<Task> {
    requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(verifyCriterionSchema, body);
    return this.tasks.setCriterion(
      contextOf(request),
      taskId,
      criterionId,
      input.verified,
      input.evidence_ref,
    );
  }

  /**
   * Called by quality-service once a report is final. Kept separate from the user transitions so
   * quality can never move a card by accident.
   */
  @Post('quality-state')
  async qualityState(@Req() request: FastifyRequest, @Body() body: unknown): Promise<{ ok: true }> {
    const identity = getIdentity(request);
    if (identity.userId) {
      throw new DomainError('FORBIDDEN', 'quality state updates are accepted from services only');
    }
    const input = parseWith(qualityStateSchema, body);
    await this.tasks.recordQualityState(
      identity.orgId ?? '',
      input.task_id,
      input.state,
      input.evidence_refs,
    );
    return { ok: true };
  }
}
