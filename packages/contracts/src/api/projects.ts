import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';
import { FORGE } from '../events/catalog';

export const PROJECT_STATUSES = [
  'connected',
  'syncing',
  'read_only',
  'error',
  'idea',
  'archived',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const RUNTIME_PREFERENCES = ['paseo', 'orca', 'direct_cli'] as const;
export type RuntimePreference = (typeof RUNTIME_PREFERENCES)[number];

export const repositoryRefSchema = z.object({
  repository_id: idSchema,
  /** The forge connection the repository was imported through, if it was imported. */
  connection_id: idSchema.nullable(),
  /** The forge's own numeric identifier. Remote, not a Quorumloop id. */
  remote_repository_id: z.string().nullable(),
  full_name: z.string(),
  default_branch: z.string(),
  head_sha: z.string().nullable(),
  head_message: z.string().nullable(),
  head_committed_at: isoDateTimeSchema.nullable(),
  open_reviews: z.number().int().nonnegative().nullable(),
  synced_at: isoDateTimeSchema.nullable(),
  stale: z.boolean(),
});
export type RepositoryRef = z.infer<typeof repositoryRefSchema>;

export const projectSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  forge: z.enum(FORGE).nullable(),
  status: z.enum(PROJECT_STATUSES),
  autonomy_level: z.enum(['observe', 'assist', 'autonomous_dev', 'restricted_release']),
  runtime_preference: z.enum(RUNTIME_PREFERENCES),
  repository: repositoryRefSchema.nullable(),
  tasks_total: z.number().int().nonnegative(),
  tasks_in_progress: z.number().int().nonnegative(),
  tasks_blocked: z.number().int().nonnegative(),
  active_agents: z.number().int().nonnegative(),
  last_activity_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const createProjectRequestSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase words separated by hyphens'),
  description: z.string().max(2000).optional(),
  forge: z.enum(FORGE).nullable().default(null),
  connection_id: idSchema.nullable().default(null),
  remote_repository_id: z.string().min(1).nullable().default(null),
  default_branch: z.string().min(1).default('main'),
  runtime_preference: z.enum(RUNTIME_PREFERENCES).default('paseo'),
  analyze_only: z.boolean().default(true),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const importProjectRequestSchema = createProjectRequestSchema.extend({
  connection_id: idSchema,
  remote_repository_id: z.string().min(1),
  forge: z.enum(FORGE),
  /** The forge's `owner/name`. Optional because the caller may only know the numeric id. */
  full_name: z.string().min(3).max(200).optional(),
});
export type ImportProjectRequest = z.infer<typeof importProjectRequestSchema>;

export const fromIdeaRequestSchema = z.object({
  idea: z.string().min(20).max(4000),
  target_user: z.string().max(300).optional(),
  platform: z.string().max(200).optional(),
  constraints: z.string().max(1000).optional(),
  name: z.string().min(2).max(120).optional(),
  runtime_preference: z.enum(RUNTIME_PREFERENCES).default('paseo'),
});
export type FromIdeaRequest = z.infer<typeof fromIdeaRequestSchema>;

export const instructionRequestSchema = z.object({
  prompt: z.string().min(10).max(8000),
  target_task_id: idSchema.nullable().default(null),
  base_ref: z.string().min(1).nullable().default(null),
  role: z
    .enum([
      'product_lead',
      'researcher',
      'architect',
      'design_lead',
      'implementation',
      'qa',
      'security',
      'release',
    ])
    .default('implementation'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  autonomy_policy_override: z
    .enum(['observe', 'assist', 'autonomous_dev'])
    .nullable()
    .default(null),
});
export type InstructionRequest = z.infer<typeof instructionRequestSchema>;

export const instructionResponseSchema = z.object({
  instruction_id: idSchema,
  task_id: idSchema,
  queued_at: isoDateTimeSchema,
  status: z.string(),
  dispatch: z.object({
    engine_id: z.string().nullable(),
    runtime_id: z.string().nullable(),
    decision: z.enum(['queued', 'blocked', 'not_configured']),
    reason: z.string(),
  }),
});
export type InstructionResponse = z.infer<typeof instructionResponseSchema>;

export const updateProjectRequestSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  runtime_preference: z.enum(RUNTIME_PREFERENCES).optional(),
  default_branch: z.string().min(1).optional(),
  autonomy_level: z.enum(['observe', 'assist', 'autonomous_dev', 'restricted_release']).optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const commitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author_name: z.string(),
  authored_at: isoDateTimeSchema,
  url: z.string(),
});
export type Commit = z.infer<typeof commitSchema>;

export const branchSchema = z.object({
  name: z.string(),
  sha: z.string(),
  protected: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

export const codeReviewSchema = z.object({
  id: idSchema,
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged', 'draft']),
  author: z.string(),
  url: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  checks_status: z.enum(['pending', 'success', 'failure', 'unknown']),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type CodeReview = z.infer<typeof codeReviewSchema>;
