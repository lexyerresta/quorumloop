import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type DatabaseSchema = Record<string, unknown>;

export interface PostgresHandle<TSchema extends DatabaseSchema> {
  sql: Sql;
  db: PostgresJsDatabase<TSchema>;
}

export const createPostgres = <TSchema extends DatabaseSchema>(
  url: string,
  schema: TSchema,
): PostgresHandle<TSchema> => {
  const sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
    transform: { undefined: null },
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
};

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies ordered SQL files inside one transaction guarded by an advisory lock, so two
 * replicas booting at the same time cannot race. Migrations are expand-contract: they add
 * columns and tables, and destructive steps ship in a later release after readers move.
 */
export const runSqlMigrations = async (
  sql: Sql,
  migrationsDir: string,
  logger?: Logger,
): Promise<MigrationResult> => {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  const applied: string[] = [];
  const skipped: string[] = [];

  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('quorumloop_migrations'))`;
    await transaction`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now(),
        checksum text not null
      )
    `;
    await transaction`
      create table if not exists outbox_events (
        id uuid primary key,
        event_type text not null,
        subject text not null,
        envelope jsonb not null,
        occurred_at timestamptz not null,
        published_at timestamptz,
        attempts integer not null default 0,
        last_error text
      )
    `;
    await transaction`
      create index if not exists outbox_events_pending_idx
        on outbox_events (occurred_at) where published_at is null
    `;
    await transaction`
      create table if not exists inbox_messages (
        consumer_name text not null,
        event_id uuid not null,
        received_at timestamptz not null default now(),
        primary key (consumer_name, event_id)
      )
    `;
    for (const file of files) {
      const content = await readFile(path.join(migrationsDir, file), 'utf8');
      const existing = await transaction<{ name: string }[]>`
        select name from _migrations where name = ${file}
      `;
      if (existing.length > 0) {
        skipped.push(file);
        continue;
      }
      logger?.info({ migration: file }, 'applying migration');
      await transaction.unsafe(content);
      await transaction`
        insert into _migrations (name, checksum) values (${file}, ${String(content.length)})
      `;
      applied.push(file);
    }
  });

  return { applied, skipped };
};
