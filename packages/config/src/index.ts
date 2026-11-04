import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenvFile } from 'dotenv';
import { z } from 'zod';

/**
 * Service catalog is the single source of ports, database names and ownership. Scripts,
 * Compose and the gateway all read it, so a service can never silently answer on a port
 * another service also claims.
 */
export interface ServiceDefinition {
  readonly name: string;
  readonly port: number;
  readonly database: string;
  readonly domain: 'platform' | 'git' | 'ai' | 'management';
  readonly responsibility: string;
  readonly ownsData: boolean;
}

export const SERVICES: readonly ServiceDefinition[] = [
  {
    name: 'api-gateway',
    port: 7001,
    database: '',
    domain: 'platform',
    responsibility: 'public REST v1 and SSE boundary, authorization enforcement, aggregation',
    ownsData: false,
  },
  {
    name: 'identity-service',
    port: 7002,
    database: 'quorumloop_identity',
    domain: 'platform',
    responsibility: 'users, organizations, memberships, sessions, access claims',
    ownsData: true,
  },
  {
    name: 'project-service',
    port: 7003,
    database: 'quorumloop_project',
    domain: 'platform',
    responsibility: 'project lifecycle, repo binding, onboarding runs',
    ownsData: true,
  },
  {
    name: 'settings-service',
    port: 7004,
    database: 'quorumloop_settings',
    domain: 'platform',
    responsibility: 'org and project policy, feature flags, policy revisions',
    ownsData: true,
  },
  {
    name: 'notification-service',
    port: 7005,
    database: 'quorumloop_notification',
    domain: 'platform',
    responsibility: 'in-app notifications and delivery attempts',
    ownsData: true,
  },
  {
    name: 'source-control-service',
    port: 7006,
    database: 'quorumloop_source_control',
    domain: 'git',
    responsibility: 'forge connections, repository mirrors, commit and review cache',
    ownsData: true,
  },
  {
    name: 'webhook-service',
    port: 7007,
    database: 'quorumloop_webhook',
    domain: 'git',
    responsibility: 'signature verification, delivery dedup, normalized forge events',
    ownsData: true,
  },
  {
    name: 'workspace-service',
    port: 7008,
    database: 'quorumloop_workspace',
    domain: 'git',
    responsibility: 'worktree lifecycle, path guard, artifacts, cleanup',
    ownsData: true,
  },
  {
    name: 'agent-control-service',
    port: 7009,
    database: 'quorumloop_agent_control',
    domain: 'ai',
    responsibility: 'agent sessions, role profiles, presence, timeline index',
    ownsData: true,
  },
  {
    name: 'provider-registry-service',
    port: 7010,
    database: 'quorumloop_provider_registry',
    domain: 'ai',
    responsibility: 'engine installations, capability snapshots, provider health',
    ownsData: true,
  },
  {
    name: 'provider-router-service',
    port: 7011,
    database: 'quorumloop_provider_router',
    domain: 'ai',
    responsibility: 'priority routing, cooldown, circuit breaker, decision trace',
    ownsData: true,
  },
  {
    name: 'orchestration-service',
    port: 7012,
    database: 'quorumloop_orchestration',
    domain: 'ai',
    responsibility: 'task ownership, fenced leases, workflow runs, checkpoints, recovery',
    ownsData: true,
  },
  {
    name: 'execution-service',
    port: 7013,
    database: 'quorumloop_execution',
    domain: 'ai',
    responsibility: 'runner handoff, Paseo, Orca and Qoder runtime adapters',
    ownsData: true,
  },
  {
    name: 'product-planning-service',
    port: 7014,
    database: 'quorumloop_product_planning',
    domain: 'ai',
    responsibility: 'idea discovery, PRD proposals, roadmap and sprint planning',
    ownsData: true,
  },
  {
    name: 'scheduler-service',
    port: 7015,
    database: 'quorumloop_scheduler',
    domain: 'ai',
    responsibility: 'scheduled runs, heartbeats, backlog wake-ups, bounded retries',
    ownsData: true,
  },
  {
    name: 'task-service',
    port: 7016,
    database: 'quorumloop_task',
    domain: 'management',
    responsibility: 'epics, task backlog, Kanban state, dependencies, history',
    ownsData: true,
  },
  {
    name: 'quality-service',
    port: 7017,
    database: 'quorumloop_quality',
    domain: 'management',
    responsibility: 'test evidence, Anti-Slop gate, accessibility and security outcomes',
    ownsData: true,
  },
  {
    name: 'activity-service',
    port: 7018,
    database: 'quorumloop_activity',
    domain: 'management',
    responsibility: 'sanitized activity feed, projections, SSE cursors',
    ownsData: true,
  },
  {
    name: 'usage-service',
    port: 7019,
    database: 'quorumloop_usage',
    domain: 'management',
    responsibility: 'usage telemetry when exposed, cost estimates, resource budgets',
    ownsData: true,
  },
  {
    name: 'audit-service',
    port: 7020,
    database: 'quorumloop_audit',
    domain: 'management',
    responsibility: 'administrative audit trail, approval history, retention',
    ownsData: true,
  },
] as const;

export const serviceByName = (name: string): ServiceDefinition => {
  const found = SERVICES.find((service) => service.name === name);
  if (!found) {
    throw new Error(`unknown service "${name}"`);
  }
  return found;
};

export const findDotEnv = (startDir = process.cwd()): string | undefined => {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
};

let envLoaded = false;

export const loadEnvironment = (): void => {
  if (envLoaded) {
    return;
  }
  const explicitPath = process.env.ENV_FILE;
  const envPath = explicitPath ?? findDotEnv();
  if (envPath) {
    loadDotenvFile({ path: envPath, override: false, quiet: true });
  }
  envLoaded = true;
};

export const boolFromEnv = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().default('dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_SUPERUSER: z.string().default('quorumloop'),
  POSTGRES_SUPERUSER_PASSWORD: z.string().default('quorumloop'),
  POSTGRES_SERVICE_PASSWORD: z.string().default('quorumloop-service'),
  NATS_URL: z.string().default('nats://127.0.0.1:4222'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  INTERNAL_SHARED_SECRET: z.string().min(16).default('dev-internal-shared-secret-change-me'),
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me-please'),
  SECRET_ENCRYPTION_KEY: z.string().default(''),
  SETUP_BOOTSTRAP_TOKEN: z.string().default(''),
  SERVICE_DISCOVERY: z.enum(['local', 'dns']).default('local'),
  AUTO_MIGRATE: z.string().default('true'),
  DEMO_MODE: z.string().default('false'),
  EXECUTION_ENABLED: z.string().default('false'),
  ENABLE_CLI_PROBING: z.string().default('true'),
  ORCA_ENABLED: z.string().default('false'),
  PASEO_DAEMON_URL: z.string().default(''),
  PASEO_TOKEN: z.string().default(''),
  WORKSPACE_ROOT: z.string().default('.quorumloop/worktrees'),
  QUALITY_GATE_REQUIRED: z.string().default('true'),
  MAX_ACTIVE_AGENTS_GLOBAL: z.coerce.number().int().min(1).default(4),
  MAX_ACTIVE_AGENTS_PER_PROJECT: z.coerce.number().int().min(1).default(2),
  MAX_RETRIES_PER_ENGINE: z.coerce.number().int().min(0).default(2),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(365),
  GITHUB_API_BASE_URL: z.string().default('https://api.github.com'),
  GITHUB_APP_ID: z.string().default(''),
  GITHUB_APP_PRIVATE_KEY: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GITHUB_WEBHOOK_SECRET: z.string().default(''),
  GITLAB_BASE_URL: z.string().default('https://gitlab.com'),
  GITLAB_CLIENT_ID: z.string().default(''),
  GITLAB_CLIENT_SECRET: z.string().default(''),
  GITLAB_WEBHOOK_SECRET: z.string().default(''),
  GITLAB_ALLOWED_HOSTS: z.string().default(''),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export const readEnv = (): BaseEnv => {
  loadEnvironment();
  const parsed = baseEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`invalid environment:\n${issues.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    const placeholders = [
      ['INTERNAL_SHARED_SECRET', parsed.data.INTERNAL_SHARED_SECRET],
      ['SESSION_SECRET', parsed.data.SESSION_SECRET],
      ['SECRET_ENCRYPTION_KEY', parsed.data.SECRET_ENCRYPTION_KEY],
    ].filter(([, value]) => !value || value.startsWith('dev-') || value.startsWith('change-me'));
    if (placeholders.length > 0) {
      throw new Error(
        `production requires real secrets for: ${placeholders.map(([name]) => name).join(', ')}`,
      );
    }
  }
  return parsed.data;
};

export const serviceDatabaseUrl = (database: string, env: BaseEnv = readEnv()): string => {
  const explicit = process.env.DATABASE_URL;
  if (explicit) {
    return explicit;
  }
  const user = database;
  const password = encodeURIComponent(env.POSTGRES_SERVICE_PASSWORD);
  return `postgresql://${user}:${password}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${database}`;
};

export const servicePort = (name: string): number => serviceByName(name).port;

/**
 * Resolves the internal base URL of a service. Local development uses loopback, Compose and
 * Kubernetes use DNS, and both are explicit so a misconfigured install fails loudly instead
 * of silently calling the wrong host.
 */
export const internalServiceUrl = (name: string, env: BaseEnv = readEnv()): string => {
  const override = process.env[`${name.toUpperCase().replace(/-/g, '_')}_URL`];
  if (override) {
    return override.replace(/\/$/, '');
  }
  const { port } = serviceByName(name);
  if (env.SERVICE_DISCOVERY === 'dns') {
    const host = process.env.SERVICE_DNS_SUFFIX ?? name;
    return `http://${host}:${port}`;
  }
  return `http://127.0.0.1:${port}`;
};
