#!/usr/bin/env node
// Applies the GitHub repository settings that no file in the tree can carry on its own: the About
// description, topics, merge options, security toggles and the branch ruleset. The desired state
// lives in `.github/repo-settings.json` and `.github/rulesets/*.json`, so a change is a reviewable
// diff instead of a click nobody remembers; this script is the part that talks to the API.
//
// Usage: pnpm github:setup [--dry-run]   (needs GITHUB_TOKEN with Administration write)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, color, die, log } from './lib/workspace.mjs';

const API = 'https://api.github.com';
const dryRun = process.argv.includes('--dry-run');

/** `$comment` is documentation for the file, not a field the API accepts. */
const dropComments = (value) => {
  if (Array.isArray(value)) {
    return value.map(dropComments);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$comment')
        .map(([key, inner]) => [key, dropComments(inner)]),
    );
  }
  return value;
};

const readJson = (file) => dropComments(JSON.parse(readFileSync(file, 'utf8')));

/** `owner/repo` from `GITHUB_REPOSITORY`, or from the origin remote of this checkout. */
const resolveSlug = () => {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  let remote;
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    die('this checkout has no origin remote', 'pass GITHUB_REPOSITORY=owner/repo');
  }
  const match = /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/.exec(remote);
  if (!match?.groups) {
    die(`unrecognised origin remote: ${remote}`, 'pass GITHUB_REPOSITORY=owner/repo');
  }
  return `${match.groups.owner}/${match.groups.repo}`;
};

const settings = readJson(path.join(ROOT, '.github', 'repo-settings.json'));
const rulesetDir = path.join(ROOT, '.github', 'rulesets');
const rulesets = readdirSync(rulesetDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file, body: readJson(path.join(rulesetDir, file)) }));

const slug = resolveSlug();
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

if (!token && !dryRun) {
  die(
    'no GitHub token',
    'set GITHUB_TOKEN to a token with Administration write, or pass --dry-run to print the calls',
  );
}

const call = async (method, route, body) => {
  if (dryRun) {
    log.skip(`${method} ${route}${body ? ` ${JSON.stringify(body)}` : ''}`);
    return null;
  }
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'quorumloop-repo-setup',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${route} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
};

/**
 * Applies a call that may be unavailable on this plan or token. A repository cannot be half
 * configured by an optional toggle, so a refusal is reported and the run continues.
 */
const attempt = async (label, run) => {
  try {
    await run();
  } catch (error) {
    log.warn(`${label}: ${error.message}`);
  }
};

const securityFields = (security) =>
  Object.fromEntries(
    Object.entries(security).map(([key, enabled]) => [
      key,
      { status: enabled ? 'enabled' : 'disabled' },
    ]),
  );

const main = async () => {
  const security = settings.security ?? {};

  log.step(`repository ${slug}`);
  await call('PATCH', `/repos/${slug}`, {
    description: settings.description,
    homepage: settings.homepage || null,
    ...settings.features,
    ...settings.merge,
  });
  log.ok('description, features and merge options');

  log.step('topics');
  await call('PUT', `/repos/${slug}/topics`, { names: settings.topics });
  log.ok(`${settings.topics.length} topics`);

  log.step('security');
  const toggles = Object.fromEntries(
    Object.entries(security).filter(([key]) => key !== 'private_vulnerability_reporting'),
  );
  await attempt('security_and_analysis', () =>
    call('PATCH', `/repos/${slug}`, { security_and_analysis: securityFields(toggles) }),
  );
  if (security.private_vulnerability_reporting !== undefined) {
    await attempt('private vulnerability reporting', () =>
      call('PUT', `/repos/${slug}/private-vulnerability-reporting`, {
        enabled: security.private_vulnerability_reporting,
      }),
    );
  }
  log.ok('security toggles requested');

  log.step('rulesets');
  const existing = (await call('GET', `/repos/${slug}/rulesets`)) ?? [];
  for (const { file, body } of rulesets) {
    const match = existing.find((entry) => entry.name === body.name);
    if (match) {
      await call('PUT', `/repos/${slug}/rulesets/${match.id}`, body);
      log.ok(`${body.name}: updated from ${color.dim(`.github/rulesets/${file}`)}`);
    } else {
      const created = await call('POST', `/repos/${slug}/rulesets`, body);
      const id = created ? ` (id ${created.id})` : '';
      log.ok(`${body.name}: created from ${color.dim(`.github/rulesets/${file}`)}${id}`);
    }
  }

  log.step('done');
  log.info(
    `https://github.com/${slug}${dryRun ? ` ${color.yellow('(dry run: nothing was changed)')}` : ''}`,
  );
  log.info('the ruleset starts blocking merges once the CI checks have reported at least once');
};

try {
  await main();
} catch (error) {
  die(error.message, 'check the token permissions and that the repository exists');
}
