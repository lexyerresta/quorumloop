// Shared helpers for the repository scripts. They read the compiled @quorumloop/config and
// @quorumloop/platform output instead of re-deriving ports, databases or migration logic, so a
// script can never disagree with a running service.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

export const color = {
  bold: (text) => paint('1', text),
  dim: (text) => paint('2', text),
  red: (text) => paint('31', text),
  green: (text) => paint('32', text),
  yellow: (text) => paint('33', text),
  cyan: (text) => paint('36', text),
};

export const log = {
  step: (title) => console.log(`\n${color.bold(title)}`),
  info: (message) => console.log(`  ${message}`),
  ok: (message) => console.log(`  ${color.green('ok')} ${message}`),
  skip: (message) => console.log(`  ${color.dim('--')} ${message}`),
  warn: (message) => console.log(`  ${color.yellow('!')} ${message}`),
  fail: (message) => console.log(`  ${color.red('x')} ${message}`),
};

/** A fatal, explained error. Never a bare stack trace: every script failure names the fix. */
export const die = (message, hint) => {
  console.error(`\n${color.red('error')} ${message}`);
  if (hint) {
    console.error(`      ${color.dim(hint)}`);
  }
  process.exit(1);
};

/** Minimal `.env` reader. The scripts need raw values, not the validated service schema. */
export const parseEnvFile = (file) => {
  const values = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return values;
};

export const rootEnvFile = path.join(ROOT, '.env');

export const readRootEnv = () => (existsSync(rootEnvFile) ? parseEnvFile(rootEnvFile) : new Map());

export const requireEnvFile = () => {
  if (!existsSync(rootEnvFile)) {
    die('no .env file at the repository root', 'run `pnpm setup` to generate one');
  }
  return readRootEnv();
};

/** Loads the compiled workspace packages the scripts depend on. */
export const requireBuilt = (relativePaths) => {
  const missing = relativePaths.filter((relative) => !existsSync(path.join(ROOT, relative)));
  if (missing.length > 0) {
    die(
      `build output is missing: ${missing.join(', ')}`,
      'run `pnpm build` (or `pnpm dev:core`, which builds the shared packages first)',
    );
  }
  const require = createRequire(import.meta.url);
  return require;
};

/** Parses `--flag`, `--key value` and `--key=value` without a dependency. */
export const parseArgs = (argv) => {
  const flags = new Set();
  const values = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const [name, inline] = argument.slice(2).split('=');
    if (inline !== undefined) {
      values.set(name, inline);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values.set(name, argv[index + 1]);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  return { flags, values, positional };
};

/** Splits a host/port pair out of a URL such as `nats://127.0.0.1:4222`. */
export const hostPortOf = (url, fallbackPort) => {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || fallbackPort),
    };
  } catch {
    return { host: '127.0.0.1', port: fallbackPort };
  }
};
