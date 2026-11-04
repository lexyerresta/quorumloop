import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';

export const ROLES = ['owner', 'admin', 'developer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  organization_slug: z.string().min(1).max(64).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const setupStatusSchema = z.object({
  needs_setup: z.boolean(),
  bootstrap_token_required: z.boolean(),
  demo_mode: z.boolean(),
  version: z.string(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupAdminRequestSchema = z.object({
  bootstrap_token: z.string().min(16),
  email: z.string().email(),
  password: z.string().min(12).max(200),
  display_name: z.string().min(1).max(120),
  organization_name: z.string().min(1).max(120),
});
export type SetupAdminRequest = z.infer<typeof setupAdminRequestSchema>;

export const sessionSchema = z.object({
  user: z.object({
    id: idSchema,
    email: z.string(),
    display_name: z.string(),
    role: z.enum(ROLES),
  }),
  organization: z.object({
    id: idSchema,
    name: z.string(),
    slug: z.string(),
  }),
  csrf_token: z.string(),
  expires_at: isoDateTimeSchema,
  demo_mode: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

/** Internal session verification response consumed by the gateway only. */
export const sessionVerificationSchema = z.object({
  valid: z.boolean(),
  session: sessionSchema.optional(),
  reason: z.string().optional(),
});
export type SessionVerification = z.infer<typeof sessionVerificationSchema>;

/** Login result. The token is only ever carried by the gateway's httpOnly cookie. */
export const sessionIssueSchema = z.object({
  token: z.string().min(20),
  session: sessionSchema,
});
export type SessionIssue = z.infer<typeof sessionIssueSchema>;

export const sessionTokenRequestSchema = z.object({
  token: z.string().min(20).max(200),
  touch: z.boolean().default(true),
});
export type SessionTokenRequest = z.infer<typeof sessionTokenRequestSchema>;

export const changePasswordRequestSchema = z.object({
  current_password: z.string().min(12).max(200),
  new_password: z.string().min(12).max(200),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const memberSchema = z.object({
  id: idSchema,
  email: z.string(),
  display_name: z.string(),
  role: z.enum(ROLES),
  created_at: isoDateTimeSchema,
});
export type Member = z.infer<typeof memberSchema>;
