import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { readEnv } from '@quorumloop/config';
import { startService } from '@quorumloop/platform';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { GatewayModule } from './gateway/gateway.module';
import { registerWebRoutes } from './static-web';

const env = readEnv();

/**
 * The gateway is the only service without the `/internal` prefix and without the service
 * signature guard: it is the browser-facing boundary. Everything behind it is still signed.
 */
void startService({
  service: 'api-gateway',
  module: GatewayModule,
  prefix: false,
  insecure: true,
  configure: (app: NestFastifyApplication, logger) => {
    const origins = env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'accept', 'x-csrf-token'],
    });

    // Compose mounts the dashboard build here (infrastructure/compose/compose.core.yml).
    const webDist = process.env.WEB_DIST_DIR;
    if (webDist && existsSync(webDist)) {
      registerWebRoutes(app.getHttpAdapter().getInstance(), webDist);
      logger.info({ webDist }, 'serving the dashboard build');
    }
  },
}).catch((error: unknown) => {
  process.stderr.write(`api-gateway failed to start: ${String(error)}\n`);
  process.exit(1);
});
