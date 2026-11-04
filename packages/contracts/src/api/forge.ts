import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';
import { FORGE } from '../events/catalog';

export const CONNECTION_STATUSES = ['connected', 'expired', 'revoked', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const connectionSchema = z.object({
  id: idSchema,
  forge: z.enum(FORGE),
  label: z.string(),
  account_login: z.string().nullable(),
  base_url: z.string(),
  status: z.enum(CONNECTION_STATUSES),
  status_reason: z.string().nullable(),
  auth_mode: z.enum(['github_app', 'pat', 'oauth']),
  scopes: z.array(z.string()),
  created_at: isoDateTimeSchema,
  last_verified_at: isoDateTimeSchema.nullable(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const connectForgeRequestSchema = z.object({
  mode: z.enum(['github_app', 'pat', 'oauth']),
  token: z.string().min(8).max(500).optional(),
  installation_id: z.string().min(1).max(64).optional(),
  base_url: z.string().url().optional(),
  label: z.string().min(1).max(80).optional(),
});
export type ConnectForgeRequest = z.infer<typeof connectForgeRequestSchema>;

export const remoteRepoSchema = z.object({
  remote_id: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  default_branch: z.string(),
  language: z.string().nullable(),
  updated_at: isoDateTimeSchema.nullable(),
  web_url: z.string(),
});
export type RemoteRepo = z.infer<typeof remoteRepoSchema>;

export const remoteRepoPageSchema = z.object({
  items: z.array(remoteRepoSchema),
  next_cursor: z.string().nullable(),
});
export type RemoteRepoPage = z.infer<typeof remoteRepoPageSchema>;

export const syncResultSchema = z.object({
  project_id: idSchema,
  repository_id: idSchema,
  synced_at: isoDateTimeSchema,
  stale: z.boolean(),
  commits_synced: z.number().int().nonnegative(),
  reviews_synced: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

export const webhookDeliverySchema = z.object({
  delivery_id: z.string(),
  forge: z.enum(FORGE),
  event: z.string(),
  received_at: isoDateTimeSchema,
  status: z.enum(['accepted', 'duplicate', 'rejected', 'ignored']),
  reason: z.string().nullable(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
