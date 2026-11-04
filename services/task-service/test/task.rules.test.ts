import { describe, expect, it } from 'vitest';
import {
  blockingDependencies,
  canTransitionTaskStatus,
  compareForBoard,
  deriveInstructionTitle,
  evaluateTransition,
  formatReference,
  nextPosition,
  summariseInstruction,
  wouldCreateCycle,
  type TransitionCheck,
} from '../src/tasks/task.rules';

const baseCheck = (overrides: Partial<TransitionCheck> = {}): TransitionCheck => ({
  task: {
    status: 'in_review',
    quality_state: 'passed',
    acceptance_criteria: [{ verified: true }, { verified: true }],
  },
  target: 'done',
  blockingDependencies: [],
  inProgressCount: 0,
  wipLimit: 3,
  qualityGateRequired: true,
  ...overrides,
});

describe('kanban transition matrix', () => {
  it('allows the documented happy path', () => {
    expect(canTransitionTaskStatus('backlog', 'ready')).toBe(true);
    expect(canTransitionTaskStatus('ready', 'in_progress')).toBe(true);
    expect(canTransitionTaskStatus('in_progress', 'in_review')).toBe(true);
    expect(canTransitionTaskStatus('in_review', 'done')).toBe(true);
  });

  it('rejects shortcuts that skip review', () => {
    expect(canTransitionTaskStatus('backlog', 'done')).toBe(false);
    expect(canTransitionTaskStatus('ready', 'in_review')).toBe(false);
    expect(canTransitionTaskStatus('in_progress', 'done')).toBe(false);
  });

  it('treats a move to the same column as a no-op', () => {
    expect(canTransitionTaskStatus('ready', 'ready')).toBe(true);
    expect(
      evaluateTransition(
        baseCheck({ task: { ...baseCheck().task, status: 'ready' }, target: 'ready' }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'task is already ready',
      evidenceRefs: [],
    });
  });

  it('lets a done task reopen for rework', () => {
    expect(canTransitionTaskStatus('done', 'in_progress')).toBe(true);
    expect(canTransitionTaskStatus('done', 'ready')).toBe(false);
  });
});

describe('done quality gate', () => {
  it('allows done when the gate passed and every criterion is verified', () => {
    expect(evaluateTransition(baseCheck())).toEqual({ allowed: true });
  });

  it('refuses done when no quality report has run', () => {
    const verdict = evaluateTransition(
      baseCheck({ task: { ...baseCheck().task, quality_state: 'not_run' } }),
    );
    expect(verdict).toEqual({
      allowed: false,
      reason: 'quality gate has not run for this task',
      evidenceRefs: [],
    });
  });

  it('refuses done when the gate failed', () => {
    const verdict = evaluateTransition(
      baseCheck({ task: { ...baseCheck().task, quality_state: 'failed' } }),
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('quality gate is failed');
    }
  });

  it('refuses done while acceptance criteria are unverified', () => {
    const verdict = evaluateTransition(
      baseCheck({
        task: {
          ...baseCheck().task,
          acceptance_criteria: [{ verified: true }, { verified: false }],
        },
      }),
    );
    expect(verdict).toEqual({
      allowed: false,
      reason: '1 acceptance criterion is not verified',
      evidenceRefs: [],
    });
  });

  it('honours an instance that disables the gate but still requires criteria', () => {
    const disabled = baseCheck({
      qualityGateRequired: false,
      task: {
        status: 'in_review',
        quality_state: 'not_run',
        acceptance_criteria: [{ verified: true }],
      },
    });
    expect(evaluateTransition(disabled)).toEqual({ allowed: true });

    const missingCriteria = baseCheck({
      qualityGateRequired: false,
      task: {
        status: 'in_review',
        quality_state: 'not_run',
        acceptance_criteria: [{ verified: false }],
      },
    });
    expect(evaluateTransition(missingCriteria).allowed).toBe(false);
  });
});

describe('dependency and WIP guards', () => {
  it('refuses to start a task with an unfinished prerequisite', () => {
    const verdict = evaluateTransition(
      baseCheck({
        task: { ...baseCheck().task, status: 'ready' },
        target: 'in_progress',
        blockingDependencies: ['QL-2'],
      }),
    );
    expect(verdict).toEqual({
      allowed: false,
      reason: 'waiting on 1 unfinished dependency',
      evidenceRefs: ['QL-2'],
    });
  });

  it('refuses to start when the WIP limit is reached', () => {
    const verdict = evaluateTransition(
      baseCheck({
        task: { ...baseCheck().task, status: 'ready' },
        target: 'in_progress',
        inProgressCount: 3,
        wipLimit: 3,
      }),
    );
    expect(verdict).toEqual({
      allowed: false,
      reason: 'work-in-progress limit reached (3/3)',
      evidenceRefs: [],
    });
  });

  it('does not apply the WIP guard to other columns', () => {
    const verdict = evaluateTransition(
      baseCheck({
        task: { ...baseCheck().task, status: 'in_progress' },
        target: 'in_review',
        inProgressCount: 9,
        wipLimit: 1,
      }),
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('derives blocking dependencies, ignoring done and canceled tasks', () => {
    expect(
      blockingDependencies([
        { id: 'a', status: 'done' },
        { id: 'b', status: 'canceled' },
        { id: 'c', status: 'in_progress' },
      ]),
    ).toEqual(['c']);
  });
});

describe('dependency cycles', () => {
  it('rejects a self reference', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('rejects an edge that closes a loop', () => {
    const edges = [
      { taskId: 'a', dependsOnTaskId: 'b' },
      { taskId: 'b', dependsOnTaskId: 'c' },
    ];
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
  });

  it('accepts a diamond that does not loop', () => {
    const edges = [
      { taskId: 'b', dependsOnTaskId: 'd' },
      { taskId: 'c', dependsOnTaskId: 'd' },
    ];
    expect(wouldCreateCycle(edges, 'a', 'b')).toBe(false);
  });
});

describe('board ordering and references', () => {
  it('orders by urgency before insertion order', () => {
    const low = { priority: 'low', position: 1, createdAt: new Date('2026-01-01T00:00:00Z') };
    const urgent = {
      priority: 'urgent',
      position: 900,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    };
    expect([low, urgent].sort(compareForBoard)).toEqual([urgent, low]);
  });

  it('falls back to creation time when priority and position match', () => {
    const earlier = {
      priority: 'medium',
      position: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const later = { priority: 'medium', position: 1, createdAt: new Date('2026-01-02T00:00:00Z') };
    expect([later, earlier].sort(compareForBoard)).toEqual([earlier, later]);
  });

  it('appends new cards after the last position', () => {
    expect(nextPosition([])).toBe(1024);
    expect(nextPosition([1024])).toBe(2048);
    expect(nextPosition([1024, 4096])).toBe(5120);
  });

  it('builds a readable reference prefix from the project slug', () => {
    expect(formatReference('quorumloop', 7)).toBe('Q-7');
    expect(formatReference('website-redesign', 3)).toBe('WR-3');
    expect(formatReference('', 1)).toBe('QL-1');
  });
});

describe('instruction prompt handling', () => {
  it('uses the first meaningful line as the task title', () => {
    expect(deriveInstructionTitle('Add a dark mode toggle to the header')).toBe(
      'Add a dark mode toggle to the header',
    );
  });

  it('strips a bullet or heading marker instead of putting it on the card', () => {
    expect(deriveInstructionTitle('- Fix the flaky login test')).toBe('Fix the flaky login test');
    expect(deriveInstructionTitle('## Rewrite the composer')).toBe('Rewrite the composer');
  });

  it('skips a line too short to describe the work', () => {
    expect(deriveInstructionTitle('Do\nRepair the Kanban drag handler')).toBe(
      'Repair the Kanban drag handler',
    );
  });

  it('falls back when there is no usable line', () => {
    expect(deriveInstructionTitle('ok\n\nno')).toBe('Instruction from the composer');
  });

  it('cuts a very long line on a word boundary', () => {
    const title = deriveInstructionTitle('word '.repeat(80));
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith(' ')).toBe(false);
  });

  it('collapses a multi-line prompt into one summary', () => {
    expect(summariseInstruction('first line\n\nsecond   line')).toBe('first line second line');
  });

  it('caps the summary and marks the cut', () => {
    const summary = summariseInstruction('x'.repeat(400));
    expect(summary.length).toBe(160);
    expect(summary.endsWith('…')).toBe(true);
  });
});
