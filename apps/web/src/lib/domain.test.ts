import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_LANES, TRANSITIONS } from './domain';
import { label, shortSha, slugify, timeAgo } from './format';

describe('transition table', () => {
  // The dashboard only offers moves; task-service decides them. Guard against the copies drifting.
  it('matches task-service task.rules.ts', () => {
    const rules = readFileSync(
      path.resolve(__dirname, '../../../../services/task-service/src/tasks/task.rules.ts'),
      'utf8',
    );
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      const line = new RegExp(`${from}:\\s*\\[([^\\]]*)\\]`).exec(rules);
      expect(line, `${from} row in task.rules.ts`).not.toBeNull();
      const server = [...(line?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
      expect([...targets].sort(), from).toEqual(server);
    }
  });

  it('shows the six board columns in server order', () => {
    expect(BOARD_LANES).toEqual([
      'backlog',
      'ready',
      'in_progress',
      'in_review',
      'blocked',
      'done',
    ]);
  });
});

describe('format helpers', () => {
  it('slugify follows the project slug rule', () => {
    expect(slugify('  Quorum Loop: v2!  ')).toBe('quorum-loop-v2');
    expect(slugify('---')).toBe('');
    expect(slugify('a'.repeat(80))).toHaveLength(64);
    expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugify('Héllo Wörld 2026'))).toBe(true);
  });

  it('timeAgo names missing and recent times honestly', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    expect(timeAgo(null, now)).toBe('Never');
    expect(timeAgo('not a date', now)).toBe('Unknown');
    expect(timeAgo('2026-11-04T23:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-04T23:48:00Z', now)).toBe('12 minutes ago');
  });

  it('label and shortSha', () => {
    expect(label('in_progress')).toBe('In progress');
    expect(shortSha('0123456789abcdef')).toBe('0123456');
    expect(shortSha(null)).toBe('none');
  });
});
