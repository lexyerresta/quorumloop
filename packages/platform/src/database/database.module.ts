import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { readEnv, serviceDatabaseUrl } from '@quorumloop/config';
import {
  createPostgres,
  runSqlMigrations,
  type DatabaseSchema,
  type PostgresHandle,
} from './postgres';
import { HEALTH_PROBES, SERVICE_LOGGER, InMemoryHealthRegistry } from '../nest/health';

export const MIGRATION_SETTINGS = Symbol('quorumloop:migration-settings');

export const DATABASE_HANDLE = Symbol('quorumloop:database-handle');
export const DATABASE_SQL = Symbol('quorumloop:database-sql');
export const DRIZZLE = Symbol('quorumloop:drizzle');

/**
 * Migrations live next to the service source. The candidate list covers `tsx` (cwd is the
 * service package), the compiled layout (`dist/main.js`) and the container working directory.
 */
export const resolveMigrationsDir = (service: string): string | undefined => {
  const explicit = process.env.MIGRATIONS_DIR;
  const candidates = [
    explicit,
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '..', 'migrations'),
    path.resolve(process.cwd(), 'services', service, 'migrations'),
    path.resolve(__dirname, '..', '..', '..', '..', 'services', service, 'migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
};

@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(DATABASE_SQL) private readonly sql: Sql,
    @Inject(SERVICE_LOGGER) private readonly logger: Logger,
    @Inject(HEALTH_PROBES) private readonly health: InMemoryHealthRegistry,
    @Inject(MIGRATION_SETTINGS)
    private readonly settings: { service: string; migrate: boolean; migrationsDir?: string },
  ) {}

  async onModuleInit(): Promise<void> {
    const env = readEnv();
    this.health.register('database', async () => {
      try {
        await this.sql`select 1`;
        return { status: 'ok' };
      } catch (error) {
        return {
          status: 'down',
          detail: error instanceof Error ? error.message : 'database unreachable',
        };
      }
    });

    if (!this.settings.migrate || env.AUTO_MIGRATE !== 'true') {
      return;
    }
    const dir = this.settings.migrationsDir ?? resolveMigrationsDir(this.settings.service);
    if (!dir) {
      this.logger.warn({ service: this.settings.service }, 'no migrations directory found');
      return;
    }
    try {
      const result = await runSqlMigrations(this.sql, dir, this.logger);
      this.logger.info(
        { applied: result.applied.length, skipped: result.skipped.length },
        'migrations checked',
      );
    } catch (error) {
      // A failed migration must stop the boot: serving with a stale schema corrupts data.
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown error' },
        'migration failed',
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

export interface DatabaseModuleOptions<TSchema extends DatabaseSchema> {
  database: string;
  schema: TSchema;
  service: string;
  migrationsDir?: string;
  /** Disables migrations for a service that deliberately owns no schema. */
  migrate?: boolean;
}

/**
 * Binds one service to its own database and role. The module is global because every feature
 * module in a service needs the same connection, and there is exactly one per process.
 */
export const defineDatabaseModule = <TSchema extends DatabaseSchema>(
  options: DatabaseModuleOptions<TSchema>,
): DynamicModule => ({
  module: DatabaseModule,
  global: true,
  providers: [
    {
      provide: DATABASE_HANDLE,
      useFactory: () => createPostgres(serviceDatabaseUrl(options.database), options.schema),
    },
    {
      provide: DATABASE_SQL,
      useFactory: (handle: PostgresHandle<TSchema>) => handle.sql,
      inject: [DATABASE_HANDLE],
    },
    {
      provide: DRIZZLE,
      useFactory: (handle: PostgresHandle<TSchema>) => handle.db,
      inject: [DATABASE_HANDLE],
    },
    {
      provide: MIGRATION_SETTINGS,
      useValue: {
        service: options.service,
        migrate: options.migrate ?? true,
        migrationsDir: options.migrationsDir,
      },
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_HANDLE, DATABASE_SQL, DRIZZLE],
});

@Module({})
export class DatabaseModule {}
