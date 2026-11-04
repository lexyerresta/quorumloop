import { describe, expect, it } from 'vitest';
import {
  autonomyRank,
  canSetAutonomyLevel,
  canTransitionProjectStatus,
  isValidRemoteRepositoryId,
  repositoryFullName,
  slugCandidate,
  slugifyProjectName,
  statusForCapability,
} from '../src/projects/project.rules';

describe('project slug rules', () => {
  it('normalizes a human name into a url-safe slug', () => {
    expect(slugifyProjectName('Website Redesign')).toBe('website-redesign');
    expect(slugifyProjectName('  Café  Üptime!! ')).toBe('cafe-uptime');
    expect(slugifyProjectName('a--b___c')).toBe('a-b-c');
  });

  it('never returns a slug shorter than two characters', () => {
    expect(slugifyProjectName('x').length).toBeGreaterThanOrEqual(2);
  });

  it('adds a bounded numeric suffix on collision', () => {
    expect(slugCandidate('website', 1)).toBe('website');
    expect(slugCandidate('website', 2)).toBe('website-2');
    expect(slugCandidate('a'.repeat(60), 3).length).toBeLessThanOrEqual(64);
  });
});

describe('project lifecycle rules', () => {
  it('allows the documented transitions and rejects invented ones', () => {
    expect(canTransitionProjectStatus('idea', 'connected')).toBe(true);
    expect(canTransitionProjectStatus('connected', 'archived')).toBe(true);
    expect(canTransitionProjectStatus('archived', 'connected')).toBe(true);
    expect(canTransitionProjectStatus('archived', 'idea')).toBe(false);
    expect(canTransitionProjectStatus('idea', 'read_only')).toBe(false);
  });

  it('derives read_only from capability instead of trusting a caller', () => {
    expect(statusForCapability(true, true)).toBe('connected');
    expect(statusForCapability(false, true)).toBe('read_only');
    expect(statusForCapability(true, false)).toBe('idea');
  });
});

describe('project autonomy rules', () => {
  it('orders autonomy levels from least to most powerful', () => {
    expect(autonomyRank('observe')).toBeLessThan(autonomyRank('autonomous_dev'));
  });

  it('lets a developer reduce autonomy but not raise it', () => {
    expect(canSetAutonomyLevel('developer', 'autonomous_dev', 'assist')).toBe(true);
    expect(canSetAutonomyLevel('developer', 'assist', 'autonomous_dev')).toBe(false);
    expect(canSetAutonomyLevel('admin', 'observe', 'autonomous_dev')).toBe(true);
    expect(canSetAutonomyLevel('viewer', 'observe', 'assist')).toBe(false);
  });
});

describe('repository identity rules', () => {
  it('accepts numeric forge repository ids only', () => {
    expect(isValidRemoteRepositoryId('123456')).toBe(true);
    expect(isValidRemoteRepositoryId('0')).toBe(false);
    expect(isValidRemoteRepositoryId('../../etc/passwd')).toBe(false);
  });

  it('builds a stable owner/name reference', () => {
    expect(repositoryFullName('quorumloop', 'dashboard')).toBe('quorumloop/dashboard');
  });
});
