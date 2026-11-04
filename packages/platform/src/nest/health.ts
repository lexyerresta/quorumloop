import { Controller, Get, Global, Inject, Module, type DynamicModule } from '@nestjs/common';
import type { HealthProbeName, HealthReport } from '@quorumloop/contracts';
import type { Logger } from 'pino';

export const SERVICE_NAME = Symbol('quorumloop:service-name');
export const HEALTH_PROBES = Symbol('quorumloop:health-probes');
export const SERVICE_LOGGER = Symbol('quorumloop:service-logger');

export type ProbeStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

export interface ProbeResult {
  status: ProbeStatus;
  detail?: string;
}

/**
 * A probe must answer quickly and must never throw. Anything slower than the deadline is
 * reported as degraded rather than hanging the readiness endpoint.
 */
export type HealthProbe = () => Promise<ProbeResult>;

export interface HealthRegistry {
  register(name: HealthProbeName | string, probe: HealthProbe): void;
}

const PROBE_TIMEOUT_MS = 1500;

const withDeadline = async (name: string, probe: HealthProbe): Promise<ProbeResult> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: 'degraded', detail: 'probe timed out' }),
      PROBE_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([
      probe().catch((error: unknown): ProbeResult => ({
        status: 'down',
        detail: error instanceof Error ? `${name}: ${error.message}` : `${name}: unknown error`,
      })),
      deadline,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export class InMemoryHealthRegistry implements HealthRegistry {
  private readonly probes = new Map<string, HealthProbe>();

  register(name: string, probe: HealthProbe): void {
    this.probes.set(name, probe);
  }

  entries(): [string, HealthProbe][] {
    return [...this.probes.entries()];
  }
}

@Controller()
export class HealthController {
  constructor(
    @Inject(SERVICE_NAME) private readonly service: string,
    @Inject(HEALTH_PROBES) private readonly probes: InMemoryHealthRegistry,
    @Inject(SERVICE_LOGGER) private readonly logger: Logger,
  ) {}

  @Get('/health/live')
  live(): { status: 'ok'; service: string; uptime_seconds: number } {
    return {
      status: 'ok',
      service: this.service,
      uptime_seconds: Math.round(process.uptime()),
    };
  }

  @Get('/health/ready')
  async ready(): Promise<HealthReport> {
    const checks = await Promise.all(
      this.probes.entries().map(async ([name, probe]) => {
        const result = await withDeadline(name, probe);
        return [name, result] as const;
      }),
    );
    const list = checks.map(([name, result]) => ({
      name,
      status: result.status,
      detail: result.detail ?? null,
    }));
    const status: HealthReport['status'] = list.some((check) => check.status === 'down')
      ? 'down'
      : list.some((check) => check.status === 'degraded' || check.status === 'unconfigured')
        ? 'degraded'
        : 'ok';
    const report: HealthReport = {
      status,
      service: this.service,
      version: process.env.npm_package_version ?? '0.1.0',
      checked_at: new Date().toISOString(),
      checks: list,
    };
    if (status !== 'ok') {
      this.logger.warn({ checks: list }, 'readiness degraded');
    }
    return report;
  }

  @Get('/health')
  async health(): Promise<HealthReport> {
    return this.ready();
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}

/**
 * Runtime context is global because every feature module needs the service name, the shared
 * logger and the health registry without repeating a provider declaration twenty times.
 */
@Global()
@Module({})
export class RuntimeContextModule {
  static forService(service: string, logger: Logger): DynamicModule {
    return {
      module: RuntimeContextModule,
      providers: [
        { provide: SERVICE_NAME, useValue: service },
        { provide: SERVICE_LOGGER, useValue: logger },
        { provide: HEALTH_PROBES, useClass: InMemoryHealthRegistry },
        { provide: InMemoryHealthRegistry, useExisting: HEALTH_PROBES },
      ],
      exports: [SERVICE_NAME, SERVICE_LOGGER, HEALTH_PROBES, InMemoryHealthRegistry],
    };
  }
}
