import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';

export const TASK_STATUSES = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'paused',
  'canceled',
  'failed',
  'needs_human_approval',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const AGENT_ROLES = [
  'product_lead',
  'researcher',
  'architect',
  'design_lead',
  'implementation',
  'qa',
  'security',
  'release',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const QUALITY_STATES = ['not_run', 'running', 'passed', 'failed', 'inconclusive'] as const;
export type QualityState = (typeof QUALITY_STATES)[number];

export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  verified: z.boolean(),
  evidence_ref: z.string().nullable(),
});
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

export const taskSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  reference: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  role: z.enum(AGENT_ROLES),
  agent_session_id: idSchema.nullable(),
  quality_state: z.enum(QUALITY_STATES),
  dependencies: z.array(idSchema),
  blocked_by: z.array(idSchema),
  acceptance_criteria: z.array(acceptanceCriterionSchema),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskRequestSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(8000).optional(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  role: z.enum(AGENT_ROLES).default('implementation'),
  priority_dependency_ids: z.array(idSchema).default([]),
  acceptance_criteria: z.array(z.string().min(3).max(400)).default([]),
  auto_assign: z.boolean().default(false),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(8000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  role: z.enum(AGENT_ROLES).optional(),
});
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const transitionTaskRequestSchema = z.object({
  to_status: z.enum(TASK_STATUSES),
  reason: z.string().max(1000).optional(),
});
export type TransitionTaskRequest = z.infer<typeof transitionTaskRequestSchema>;

export const transitionTaskResponseSchema = z.object({
  task: taskSchema,
  changed: z.boolean(),
  blocked_reason: z.string().nullable(),
  evidence_refs: z.array(z.string()),
});
export type TransitionTaskResponse = z.infer<typeof transitionTaskResponseSchema>;

export const taskDependencySchema = z.object({
  task_id: idSchema,
  depends_on_task_id: idSchema,
  created_at: isoDateTimeSchema,
});
export type TaskDependency = z.infer<typeof taskDependencySchema>;

export const taskHistoryEntrySchema = z.object({
  id: idSchema,
  task_id: idSchema,
  from_status: z.enum(TASK_STATUSES).nullable(),
  to_status: z.enum(TASK_STATUSES),
  actor: z.string(),
  reason: z.string().nullable(),
  occurred_at: isoDateTimeSchema,
});
export type TaskHistoryEntry = z.infer<typeof taskHistoryEntrySchema>;

export const taskBoardSchema = z.object({
  project_id: idSchema,
  tasks: z.array(taskSchema),
  counts_by_status: z.record(z.string(), z.number().int().nonnegative()),
  wip_limit: z.number().int().positive(),
});
export type TaskBoard = z.infer<typeof taskBoardSchema>;
