#!/usr/bin/env node
// Applies every service's SQL migrations. The runner is the same one a booting service uses
// (`runSqlMigrations` in @quorumloop/platform), so this script cannot drift from the runtime
// path: same advisory lock, same `_migrations` bookkeeping, same one-transaction-per-file rule.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  die,
  log,
  parseArgs,
  requireBuilt,
  requireEnvFile,
  rootEnvFile,
} from './lib/workspace.mjs';

const { flags, values } = parseArgs(process.argv.slice(2));

if (flags.has('help')) {
  console.log('usage: pnpm db:migrate [--only identity-service,task-service]');
  process.exit(0);
}

const env = requireEnvFile();
if (!env.get('POSTGRES_SERVICE_PASSWORD')) {
  die('.env has no POSTGRES_SERVICE_PASSWORD', 'run `pnpm setup --force` to regenerate it');
}

// The platform reads `.env` from the working directory; a script may be run from anywhere.
process.env.ENV_FILE = rootEnvFile;

const require = requireBuilt([
  'packages/config/dist/index.js',
  'packages/platform/dist/database/postgres.js',
]);
const config = require(path.join(ROOT, 'packages/config/dist/index.js'));
const { createPostgres, runSqlMigrations } = require(
  path.join(ROOT, 'packages/platform/dist/database/postgres.js'),
);

const only = (values.get('only') ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const known = new Set(config.SERVICES.map((service) => service.name));
const unknown = only.filter((name) => !known.has(name));
if (unknown.length > 0) {
  die(`unknown service in --only: ${unknown.join(', ')}`);
}

const resolvedEnv = config.readEnv();
const targets = config.SERVICES.filter(
  (service) => service.ownsData && (only.length === 0 || only.includes(service.name)),
);

log.step(`Migrating ${targets.length} service database${targets.length === 1 ? '' : 's'}`);

let applied = 0;
let skipped = 0;
const failures = [];

for (const service of targets) {
  const dir = path.join(ROOT, 'services', service.name, 'migrations');
  if (!existsSync(dir)) {
    log.skip(`${service.name}: owns ${service.database} but ships no migrations directory`);
    continue;
  }
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql'));
  if (files.length === 0) {
    log.skip(`${service.name}: owns ${service.database}, no schema yet (scaffolded service)`);
    continue;
  }

  const handle = createPostgres(config.serviceDatabaseUrl(service.database, resolvedEnv), {});
  try {
    const result = await runSqlMigrations(handle.sql, dir);
    applied += result.applied.length;
    skipped += result.skipped.length;
    const detail =
      result.applied.length > 0 ? `applied ${result.applied.join(', ')}` : 'up to date';
    log.ok(`${service.name}: ${detail} (${result.skipped.length} already applied)`);
  } catch (error) {
    failures.push({
      service: service.name,
      message: error instanceof Error ? error.message : String(error),
    });
    log.fail(`${service.name}: ${failures.at(-1).message}`);
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

console.log();
if (failures.length > 0) {
  log.fail(`${failures.length} database(s) failed; schema is incomplete`);
  log.info(
    'check that postgres is reachable: `pnpm infra:up`, then `docker compose logs postgres`',
  );
  process.exit(1);
}

log.ok(`migrations complete: ${applied} applied, ${skipped} already present`);
