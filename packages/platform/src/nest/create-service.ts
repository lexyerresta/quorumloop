import 'reflect-metadata';
import { readEnv, serviceByName, type BaseEnv } from '@quorumloop/config';
import { createLogger, NestPinoLogger, type ServiceLogger } from '@quorumloop/observability';
import { Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';
import { DomainExceptionFilter } from './exception.filter';
import { HealthModule, InMemoryHealthRegistry, RuntimeContextModule } from './health';
import { InternalAuthGuard, RequestContextMiddleware } from './internal-auth';

export interface ServiceBootstrapOptions<TModule> {
  /** Catalog name, for example `identity-service`. */
  service: string;
  /** The feature root module of the service. */
  module: Type<TModule>;
  /** Skips the signed internal auth guard. Reserved for contract tests. */
  insecure?: boolean;
  /** Route prefix. Defaults to `internal`; the public gateway passes `false`. */
  prefix?: string | false;
  /** Registers extra Fastify plugins before the listener starts. */
  configure?: (app: NestFastifyApplication, logger: Logger) => Promise<void> | void;
}

export interface RunningService {
  app: NestFastifyApplication;
  logger: ServiceLogger;
  env: BaseEnv;
  health: InMemoryHealthRegistry;
  port: number;
  close(): Promise<void>;
}

const portFor = (service: string): number => {
  const override = process.env[`${service.toUpperCase().replace(/-/g, '_')}_PORT`];
  if (!override) {
    return serviceByName(service).port;
  }
  const parsed = Number(override);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid port override for ${service}: ${override}`);
  }
  return parsed;
};

/**
 * Boots a service the same way in development, Compose and Kubernetes: structured logs,
 * signed internal auth, one error envelope, a public probe surface and graceful shutdown.
 * Nothing here hides a dependency failure; a probe reports it instead.
 */
export const startService = async <TModule>(
  options: ServiceBootstrapOptions<TModule>,
): Promise<RunningService> => {
  const env = readEnv();
  const logger = createLogger({ service: options.service, level: env.LOG_LEVEL });
  const port = portFor(options.service);

  // The root module wraps the feature module so health, logging and request context are
  // present even when a service has not wired its own infrastructure yet.
  @Module({
    imports: [
      RuntimeContextModule.forService(options.service, logger),
      HealthModule,
      options.module,
    ],
  })
  class ServiceRootModule {}

  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    disableRequestLogging: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(ServiceRootModule, adapter, {
    logger: new NestPinoLogger(logger),
    rawBody: true,
  });

  // Every service exposes the same surface: public probes, everything else under /internal
  // behind the service signature. The gateway opts out because it is the public boundary.
  if (options.prefix !== false) {
    app.setGlobalPrefix(options.prefix ?? 'internal', {
      exclude: ['health', 'health/live', 'health/ready'],
    });
  }
  app.enableShutdownHooks();

  const contextMiddleware = new RequestContextMiddleware(options.service);
  app.use((request: never, response: never, next: (error?: unknown) => void) =>
    contextMiddleware.use(request, response, next),
  );

  if (!options.insecure) {
    app.useGlobalGuards(new InternalAuthGuard(env.INTERNAL_SHARED_SECRET));
  }
  app.useGlobalFilters(new DomainExceptionFilter(options.service, logger));

  if (options.configure) {
    await options.configure(app, logger);
  }

  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port, service: options.service, env: env.NODE_ENV }, 'service listening');

  return {
    app,
    logger,
    env,
    health: app.get(InMemoryHealthRegistry, { strict: false }),
    port,
    close: async () => {
      await app.close();
      logger.info('service stopped');
    },
  };
};
