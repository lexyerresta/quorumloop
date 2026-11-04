#!/usr/bin/env node
// End-to-end smoke test against a running instance. It drives the real public API: first-run
// setup, session, project, task, the Done quality gate, the composer, the activity feed, the
// overview aggregate and the SSE stream. Nothing here is stubbed, and every assertion prints the
// value it actually received.
import { randomBytes } from 'node:crypto';
import { color, die, log, parseArgs, readRootEnv, requireEnvFile } from './lib/workspace.mjs';

const GATEWAY_PORT = 7001; // catalog default; Compose publishes it as 8080
const { flags, values } = parseArgs(process.argv.slice(2));

if (flags.has('help')) {
  console.log(
    'usage: pnpm smoke [--base http://127.0.0.1:7001] [--keep]\n' +
      '  --base  gateway origin to test (default: QUORUMLOOP_BASE_URL or the catalog port)\n' +
      '  --keep  leave the smoke project on the board instead of deleting it',
  );
  process.exit(0);
}

const env = requireEnvFile();
const base = (
  values.get('base') ??
  process.env.QUORUMLOOP_BASE_URL ??
  `http://127.0.0.1:${GATEWAY_PORT}`
).replace(/\/$/, '');
const keep = flags.has('keep');

const jar = new Map();
let csrf = null;
let passed = 0;

const ok = (message) => {
  passed += 1;
  log.ok(message);
};

const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const rememberCookies = (response) => {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0];
    const separator = pair.indexOf('=');
    if (separator > 0) {
      jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }
};

const send = async (method, route, options = {}) => {
  const { body, headers = {}, authenticated = true } = options;
  const requestHeaders = { accept: 'application/json', ...headers };
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
  }
  if (authenticated && jar.size > 0) {
    requestHeaders.cookie = [...jar].map(([name, entry]) => `${name}=${entry}`).join('; ');
  }
  // Double-submit CSRF: the token comes from the session body, never from a cookie. An
  // explicit header wins, otherwise the mismatch case would silently send the right token.
  if (authenticated && csrf && method !== 'GET' && requestHeaders['x-csrf-token'] === undefined) {
    requestHeaders['x-csrf-token'] = csrf;
  }

  let response;
  try {
    response = await fetch(`${base}${route}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    die(
      `cannot reach ${base}${route}`,
      `is the stack running? start it with \`pnpm dev:core\` or \`pnpm compose:core\` (${
        error instanceof Error ? error.message : 'connection refused'
      })`,
    );
  }
  rememberCookies(response);

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
};

const describe = (response) => {
  if (response.json && typeof response.json === 'object') {
    const { code, message } = response.json;
    if (code || message) {
      return `${response.status} ${code ?? ''} ${message ?? ''}`.trim();
    }
  }
  return `${response.status} ${response.text.slice(0, 160)}`;
};

console.log(`\n${color.bold(`Smoke testing ${base}`)}`);

let projectId = null;
try {
  log.step('Gateway');

  const live = await send('GET', '/health/live', { authenticated: false });
  expect(live.status === 200, `/health/live returned ${describe(live)}`);
  ok('probe answers 200');

  const status = await send('GET', '/api/v1/setup/status', { authenticated: false });
  expect(status.status === 200, `setup/status returned ${describe(status)}`);
  ok(`setup/status needs_setup=${status.json.needs_setup} demo_mode=${status.json.demo_mode}`);

  log.step('Authentication');
  const stamp = Date.now().toString(36);
  let session;
  if (status.json.needs_setup) {
    const bootstrapToken = env.get('SETUP_BOOTSTRAP_TOKEN') ?? '';
    expect(
      bootstrapToken.length >= 16,
      'SETUP_BOOTSTRAP_TOKEN is missing from .env; it is required for the first-run setup',
    );
    const created = await send('POST', '/api/v1/setup/admin', {
      authenticated: false,
      body: {
        bootstrap_token: bootstrapToken,
        email: env.get('SMOKE_EMAIL') || `smoke-${stamp}@quorumloop.local`,
        password: env.get('SMOKE_PASSWORD') || randomBytes(18).toString('base64url'),
        display_name: 'Smoke Test',
        organization_name: 'Smoke Workspace',
      },
    });
    expect(
      created.status === 201 || created.status === 200,
      `setup/admin returned ${describe(created)}`,
    );
    session = created.json;
    ok('first-run admin account created');
  } else {
    const email = env.get('SMOKE_EMAIL') ?? process.env.SMOKE_EMAIL;
    const password = env.get('SMOKE_PASSWORD') ?? process.env.SMOKE_PASSWORD;
    if (!email || !password) {
      die(
        'this instance is already set up, so the smoke test needs credentials',
        'add SMOKE_EMAIL and SMOKE_PASSWORD to .env and run `pnpm smoke` again',
      );
    }
    const login = await send('POST', '/api/v1/auth/login', {
      authenticated: false,
      body: { email, password },
    });
    expect(login.status === 200 || login.status === 201, `auth/login returned ${describe(login)}`);
    session = login.json;
    ok(`signed in as ${session.user.email}`);
  }

  expect(typeof session?.csrf_token === 'string', 'session response carried no csrf token');
  csrf = session.csrf_token;

  const current = await send('GET', '/api/v1/session');
  expect(current.status === 200, `session returned ${describe(current)}`);
  expect(current.json.organization.id === session.organization.id, 'session organization changed');
  ok(`session valid in ${current.json.organization.slug}`);

  const unauthenticated = await send('GET', '/api/v1/projects', { authenticated: false });
  expect(
    unauthenticated.status === 401,
    `anonymous /projects returned ${describe(unauthenticated)}`,
  );
  ok('anonymous call rejected with 401');

  const badCsrf = await send('POST', '/api/v1/projects', {
    headers: { 'x-csrf-token': 'not-the-session-token' },
    body: { name: 'CSRF Probe', slug: `csrf-probe-${stamp}` },
  });
  expect(badCsrf.status === 403, `mismatched csrf token returned ${describe(badCsrf)}`);
  ok('mismatched CSRF token rejected with 403');

  log.step('Projects');
  const created = await send('POST', '/api/v1/projects', {
    body: {
      name: `Smoke ${stamp}`,
      slug: `smoke-${stamp}`,
      description: 'Created by `pnpm smoke` to verify the running stack.',
    },
  });
  expect(
    created.status === 201 || created.status === 200,
    `create project returned ${describe(created)}`,
  );
  projectId = created.json.id;
  ok(`project ${created.json.slug} (${projectId}) created`);

  const list = await send('GET', '/api/v1/projects');
  expect(list.status === 200, `list projects returned ${describe(list)}`);
  expect(
    list.json.some((project) => project.id === projectId),
    'the new project is missing from the project list',
  );
  ok(`project list contains it (${list.json.length} visible)`);

  log.step('Task board');
  const task = await send('POST', `/api/v1/projects/${projectId}/tasks`, {
    body: {
      title: 'Verify the smoke flow end to end',
      description: 'Created by the smoke test.',
      priority: 'high',
      acceptance_criteria: ['The task appears on the board'],
    },
  });
  expect(task.status === 201 || task.status === 200, `create task returned ${describe(task)}`);
  const taskId = task.json.id;
  ok(`task ${task.json.reference} created in ${task.json.status}`);

  const board = await send('GET', `/api/v1/projects/${projectId}/tasks`);
  expect(board.status === 200, `board returned ${describe(board)}`);
  const cards = board.json.tasks ?? [];
  const onBoard = cards.some((card) => card.id === taskId && card.status === 'backlog');
  expect(onBoard, 'the new task is not in the backlog column');
  ok(`board renders ${cards.length} task(s) ${JSON.stringify(board.json.counts_by_status)}`);

  // The board enforces backlog -> ready -> in_progress -> in_review -> done, so the smoke walks the
  // legal path instead of asserting a jump the domain rejects. Nest answers POST with 201 unless a
  // handler opts into 200, and these action endpoints do not, so any 2xx is accepted.
  for (const status of ['ready', 'in_progress', 'in_review']) {
    const moved = await send('POST', `/api/v1/tasks/${taskId}/transition`, {
      body: { to_status: status },
    });
    expect(
      moved.status === 200 || moved.status === 201,
      `transition to ${status} returned ${describe(moved)}`,
    );
    expect(
      moved.json.changed === true,
      `transition to ${status} refused: ${moved.json.blocked_reason}`,
    );
    ok(`task moved to ${moved.json.task.status}`);
  }

  log.step('Quality gate');
  const finished = await send('POST', `/api/v1/tasks/${taskId}/transition`, {
    body: { to_status: 'done' },
  });
  expect(
    finished.status === 200 || finished.status === 201,
    `transition to done returned ${describe(finished)}`,
  );
  const gateHonest =
    finished.json.changed === false && typeof finished.json.blocked_reason === 'string';
  const gateDisabled = finished.json.changed === true;
  expect(
    gateHonest || gateDisabled,
    `the Done transition neither completed nor explained itself: ${JSON.stringify(finished.json)}`,
  );
  ok(
    gateHonest
      ? `Done blocked as designed: ${finished.json.blocked_reason}`
      : 'Done allowed because QUALITY_GATE_REQUIRED is disabled in this install',
  );

  log.step('Composer');
  const instruction = await send('POST', `/api/v1/projects/${projectId}/instructions`, {
    body: {
      prompt: 'Review the smoke project and add a short README that explains the board columns.',
      role: 'implementation',
    },
  });
  expect(
    instruction.status === 201 || instruction.status === 200,
    `instruction returned ${describe(instruction)}`,
  );
  expect(instruction.json.task_id, 'the instruction was not attached to a task');
  ok(
    `instruction ${instruction.json.instruction_id} recorded, dispatch=${instruction.json.dispatch.decision} (${instruction.json.dispatch.reason.slice(0, 60)}...)`,
  );

  log.step('Activity feed');
  // The feed is an event projection, so it converges a moment after the writes.
  let feed = null;
  let kinds = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    feed = await send('GET', `/api/v1/projects/${projectId}/activity`);
    expect(feed.status === 200, `activity returned ${describe(feed)}`);
    kinds = feed.json.items.map((item) => item.kind);
    if (kinds.includes('instruction.received') && kinds.includes('task.created')) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(
    kinds.includes('task.created'),
    `activity never showed task.created (saw ${kinds.join(', ')})`,
  );
  expect(
    kinds.includes('instruction.received'),
    `activity never showed instruction.received (saw ${kinds.join(', ')})`,
  );
  ok(`feed shows ${[...new Set(kinds)].join(', ') || 'no rows'}`);

  // The project rollup is written by the same handler as the row; a null projection means the
  // rollup write failed and the feed is only half of the projection it claims to be.
  expect(feed.json.projection, 'the activity feed returned no project projection');
  expect(
    feed.json.projection.total_events >= 2,
    `projection counted only ${feed.json.projection.total_events} events`,
  );
  ok(
    `projection total_events=${feed.json.projection.total_events} alerts=${feed.json.projection.alert_count} last_event_at=${feed.json.projection.last_event_at}`,
  );

  log.step('Overview');
  const overview = await send('GET', '/api/v1/overview');
  expect(overview.status === 200, `overview returned ${describe(overview)}`);
  expect(overview.json.kpis.projects >= 1, 'the overview reports no projects');
  ok(
    `kpis projects=${overview.json.kpis.projects} in_progress=${overview.json.kpis.tasks_in_progress} blocked=${overview.json.kpis.tasks_blocked}`,
  );

  log.step('Event stream');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/api/v1/events/stream`, {
      headers: {
        accept: 'text/event-stream',
        cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; '),
      },
      signal: controller.signal,
    });
    expect(response.status === 200, `events/stream returned ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('event: ready')) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => undefined);
    expect(
      buffer.includes('event: ready'),
      `stream opened without a ready frame: ${buffer.slice(0, 200)}`,
    );
    ok('SSE stream opened and sent its ready frame');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  if (!keep && projectId) {
    log.step('Cleanup');
    const removed = await send('DELETE', `/api/v1/projects/${projectId}`);
    expect(removed.status === 200, `delete project returned ${describe(removed)}`);
    projectId = null;
    ok('smoke project deleted (the activity rows stay, the timeline is append-only)');
  }
} catch (error) {
  log.fail(error instanceof Error ? error.message : String(error));
  console.log(
    `\n${color.red('smoke failed')} after ${passed} passing check${passed === 1 ? '' : 's'}`,
  );
  if (projectId) {
    console.log(
      `  the smoke project ${projectId} was left in place for inspection (--keep keeps it by design)`,
    );
  }
  process.exit(1);
}

console.log(`\n${color.green(`smoke passed`)}: ${passed} checks against ${base}`);
