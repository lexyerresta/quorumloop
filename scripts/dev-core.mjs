#!/usr/bin/env node
// Runs the services, one labelled process per service. It is the development counterpart of
// `compose:core`: same service set, same ports, same `.env`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  ROOT,
  color,
  die,
  hostPortOf,
  log,
  parseArgs,
  readRootEnv,
  requireBuilt,
  requireEnvFile,
} from './lib/workspace.mjs';

/**
 * The core profile answers "what can a single operator run on a laptop". It mirrors the service
 * list in infrastructure/compose/compose.core.yml: identity, project, task and activity flow plus
 * the services the gateway calls on every dashboard page. Orchestration and execution stay out so
 * nothing can spend provider quota by accident.
 */
const CORE_SERVICES = [
  'identity-service',
  'project-service',
  'settings-service',
  'notification-service',
  'source-control-service',
  'webhook-service',
  'task-service',
  'activity-service',
  'audit-service',
  'api-gateway',
];

const { flags, values } = parseArgs(process.argv.slice(2));

if (flags.has('help')) {
  console.log(
    'usage: pnpm dev:core [--full] [--only identity-service,task-service] [--no-web] [--compiled]\n' +
      '  --full      every service, including orchestration and execution\n' +
      '  --only      a comma separated subset of the catalog\n' +
      '  --no-web    skip the dashboard\n' +
      '  --compiled  run `dist` instead of `tsx watch` (one esbuild per service is the memory cost)',
  );
  process.exit(0);
}

const env = requireEnvFile();
const full = flags.has('full');
// `tsx watch` spawns an esbuild service per process. On a small machine running the whole
// catalog, `--compiled` is the difference between a working cluster and an out-of-memory one.
const compiled = flags.has('compiled');
const only = (values.get('only') ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const probe = (host, port, timeoutMs = 1500) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    const done = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

const value = (key, fallback) => env.get(key) || process.env[key] || fallback;

// Shared packages are consumed as build output, so a stale dist would silently serve old
// contracts. The install sequence is `pnpm install && pnpm build && pnpm setup`.
log.step('Preparing shared packages');
if (!existsSync(path.join(ROOT, 'packages/config/dist/index.js'))) {
  die(
    'the shared packages are not built',
    'run `pnpm build` first (or `pnpm install && pnpm build`)',
  );
}
log.skip('shared packages are built (re-run `pnpm build` after editing one)');

const require = requireBuilt(['packages/config/dist/index.js']);
const config = require(path.join(ROOT, 'packages/config/dist/index.js'));

const catalog = new Map(config.SERVICES.map((service) => [service.name, service]));
const unknown = only.filter((name) => !catalog.has(name));
if (unknown.length > 0) {
  die(`unknown service in --only: ${unknown.join(', ')}`);
}

const selected = (
  only.length > 0
    ? config.SERVICES.map((service) => service.name).filter((name) => only.includes(name))
    : full
      ? [...catalog.keys()]
      : CORE_SERVICES
).filter((name) => catalog.has(name));

if (selected.length === 0) {
  die('no services selected');
}

log.step('Checking dependencies');
const postgresHost = value('POSTGRES_HOST', '127.0.0.1');
const postgresPort = value('POSTGRES_PORT', '5432');
const nats = hostPortOf(value('NATS_URL', 'nats://127.0.0.1:4222'), 4222);
const redis = hostPortOf(value('REDIS_URL', 'redis://127.0.0.1:6379'), 6379);

const dependencies = [
  { name: 'postgres', host: postgresHost, port: postgresPort },
  { name: 'nats', host: nats.host, port: nats.port },
  { name: 'redis', host: redis.host, port: redis.port },
];

const unreachable = [];
for (const dependency of dependencies) {
  const reachable = await probe(dependency.host, dependency.port);
  if (reachable) {
    log.ok(`${dependency.name} ${dependency.host}:${dependency.port}`);
  } else {
    log.fail(`${dependency.name} ${dependency.host}:${dependency.port} is not reachable`);
    unreachable.push(dependency);
  }
}

if (unreachable.length > 0) {
  die(
    `${unreachable.length} dependency connection(s) refused`,
    'start the bundled infrastructure with `pnpm infra:up`, or point .env at a running instance',
  );
}

const children = [];
let shuttingDown = false;

const prefix = (name, line) => `${color.cyan(name.padEnd(24))} ${line}\n`;
const forward = (stream, name, target) => {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      target.write(prefix(name, line));
    }
  });
};

/**
 * Units are started with the Node binary directly. Spawning `pnpm` on Windows needs a shell
 * (`.cmd` shims cannot be executed without one, and Node refuses to do it), and a shell would
 * put an extra `cmd.exe` between every service and its output.
 */
const start = (name, dir, args) => {
  const child = spawn(process.execPath, args, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
  });
  children.push({ name, child });
  forward(child.stdout, name, process.stdout);
  forward(child.stderr, name, process.stderr);
  child.on('exit', (code) => {
    if (shuttingDown) {
      return;
    }
    // One service crashing must not leave the rest running against a half-present cluster.
    log.fail(`${name} exited with code ${code ?? 'unknown'}; stopping the cluster`);
    shutdown(1);
  });
};

const killChild = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
};

const shutdown = (code = 0) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const { child } of children) {
    killChild(child);
  }
  setTimeout(() => process.exit(code), 200);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

log.step(`Starting ${selected.length} service${selected.length === 1 ? '' : 's'}`);
if (compiled) {
  const missing = selected.filter(
    (name) => !existsSync(path.join(ROOT, 'services', name, 'dist', 'main.js')),
  );
  if (missing.length > 0) {
    die(
      `no build output for ${missing.join(', ')}`,
      'run `pnpm build`, then `pnpm dev:core --compiled`',
    );
  }
  log.info(color.dim('compiled mode: rebuild and restart after editing a service'));
}

// Staggered on purpose: ten simultaneous compilers is a memory spike, not a feature.
const serviceArgs = compiled ? ['dist/main.js'] : ['--watch', '--import', 'tsx', 'src/main.ts'];
for (const name of selected) {
  start(name, path.join(ROOT, 'services', name), serviceArgs);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const webDir = path.join(ROOT, 'apps', 'web');
const webEnabled = !flags.has('no-web');
if (webEnabled && existsSync(path.join(webDir, 'package.json'))) {
  start('web', webDir, [path.join('node_modules', 'vite', 'bin', 'vite.js')]);
} else if (webEnabled) {
  log.warn('apps/web is not in this checkout yet; the API is running without the dashboard');
}

log.step('Cluster starting');
const gateway = catalog.get('api-gateway');
if (gateway && selected.includes('api-gateway')) {
  log.info(`api      http://127.0.0.1:${gateway.port}`);
}
if (webEnabled && existsSync(path.join(webDir, 'package.json'))) {
  log.info('dashboard http://localhost:5173');
}
if (!compiled) {
  log.info(
    color.dim('each service compiles with esbuild; use --compiled on a memory-tight machine'),
  );
}
log.info(color.dim('ctrl-c stops every child process'));
