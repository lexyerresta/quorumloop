import {
  createTaskRequestSchema,
  executeTaskRequestSchema,
  executeTaskResponseSchema,
  qualityReportSchema,
  runSchema,
  taskBoardSchema,
  taskHistoryEntrySchema,
  taskSchema,
  transitionTaskRequestSchema,
  transitionTaskResponseSchema,
  updateTaskRequestSchema,
  type ExecuteTaskResponse,
  type QualityReport,
  type Run,
  type Task,
  type TaskBoard,
  type TaskHistoryEntry,
  type TransitionTaskResponse,
} from '@quorumloop/contracts';
import { parseWith } from '@quorumloop/platform';
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GatewayProxy } from './gateway-proxy';

const taskControlSchema = z.object({
  reason: z.string().max(1000).optional(),
});

/**
 * Task reads and writes. Execution dispatch is proxied straight to orchestration-service so the
 * gateway never decides which engine runs a task; it only forwards the operator's hints.
 */
@Controller('api/v1')
export class TasksController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Get('projects/:projectId/tasks')
  board(@Req() request: FastifyRequest, @Param('projectId') projectId: string): Promise<TaskBoard> {
    return this.proxy.call(
      'task-service',
      'GET',
      `/v1/projects/${encodeURIComponent(projectId)}/board`,
      taskBoardSchema,
      { request },
    );
  }

  @Post('projects/:projectId/tasks')
  create(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<Task> {
    const input = parseWith(createTaskRequestSchema, body);
    return this.proxy.call(
      'task-service',
      'POST',
      `/v1/projects/${encodeURIComponent(projectId)}/tasks`,
      taskSchema,
      { request, body: input },
    );
  }

  @Get('tasks/:taskId')
  detail(@Req() request: FastifyRequest, @Param('taskId') taskId: string): Promise<Task> {
    return this.proxy.call(
      'task-service',
      'GET',
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      taskSchema,
      { request },
    );
  }

  @Patch('tasks/:taskId')
  update(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<Task> {
    const input = parseWith(updateTaskRequestSchema, body);
    return this.proxy.call(
      'task-service',
      'PATCH',
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      taskSchema,
      { request, body: input },
    );
  }

  @Post('tasks/:taskId/transition')
  transition(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<TransitionTaskResponse> {
    const input = parseWith(transitionTaskRequestSchema, body);
    return this.proxy.call(
      'task-service',
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/transition`,
      transitionTaskResponseSchema,
      { request, body: input },
    );
  }

  @Get('tasks/:taskId/history')
  history(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
  ): Promise<TaskHistoryEntry[]> {
    return this.proxy.call(
      'task-service',
      'GET',
      `/v1/tasks/${encodeURIComponent(taskId)}/history`,
      z.array(taskHistoryEntrySchema),
      { request },
    );
  }

  @Post('tasks/:taskId/execute')
  execute(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<ExecuteTaskResponse> {
    const input = parseWith(executeTaskRequestSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/execute`,
      executeTaskResponseSchema,
      { request, body: input },
    );
  }

  /** Pausing targets the active run; orchestration-service owns that decision. */
  @Post('tasks/:taskId/pause')
  pause(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<Run> {
    const input = parseWith(taskControlSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/pause`,
      runSchema,
      { request, body: input },
    );
  }

  @Post('tasks/:taskId/resume')
  resume(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<Run> {
    const input = parseWith(taskControlSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/resume`,
      runSchema,
      { request, body: input },
    );
  }

  @Post('tasks/:taskId/cancel')
  cancel(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<Run> {
    const input = parseWith(taskControlSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
      runSchema,
      { request, body: input },
    );
  }

  @Get('projects/:projectId/quality')
  quality(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Query('task_id') taskId?: string,
  ): Promise<QualityReport[]> {
    const suffix = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
    return this.proxy.call(
      'quality-service',
      'GET',
      `/v1/projects/${encodeURIComponent(projectId)}/reports${suffix}`,
      z.array(qualityReportSchema),
      { request },
    );
  }
}
