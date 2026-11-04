import { z } from 'zod';
import { isoDateTimeSchema } from '../ids';

/**
 * Names of the shared dependency probes every service may publish. A service can register a
 * custom probe name as well; the enum only documents the ones the dashboard knows how to
 * label, so the schema stays open via `.or(z.string())`.
 */
export const HEALTH_PROBE_NAMES = [
  'database',
  'nats',
  'redis',
  'provider',
  'runtime',
  'forge',
] as const;
export type HealthProbeName = (typeof HEALTH_PROBE_NAMES)[number];

export const PROBE_STATUSES = ['ok', 'degraded', 'down', 'unconfigured'] as const;
export type ProbeStatus = (typeof PROBE_STATUSES)[number];

export const healthCheckSchema = z.object({
  name: z.string(),
  status: z.enum(PROBE_STATUSES),
  detail: z.string().nullable(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.string(),
  version: z.string(),
  checked_at: isoDateTimeSchema,
  checks: z.array(healthCheckSchema),
});
export type HealthReport = z.infer<typeof healthReportSchema>;
