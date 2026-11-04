import {
  PROJECT_STATUSES,
  type AutonomyLevel,
  type ProjectStatus,
  type Role,
} from '@quorumloop/contracts';

/**
 * Allowed lifecycle moves. `archived` is terminal for normal use and only a privileged restore
 * brings a project back, so the UI can rely on the fact that archiving is not silent.
 */
const TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  idea: ['connected', 'archived'],
  connected: ['syncing', 'read_only', 'error', 'archived'],
  syncing: ['connected', 'read_only', 'error', 'archived'],
  read_only: ['connected', 'syncing', 'error', 'archived'],
  error: ['connected', 'syncing', 'read_only', 'archived'],
  archived: ['connected'],
};

export const canTransitionProjectStatus = (from: ProjectStatus, to: ProjectStatus): boolean =>
  from === to || TRANSITIONS[from].includes(to);

export const isProjectStatus = (value: string): value is ProjectStatus =>
  (PROJECT_STATUSES as readonly string[]).includes(value);

/**
 * Slugs are URLs and worktree directory names, so the rule is deliberately narrow: lowercase
 * alphanumerics joined by single hyphens.
 */
export const slugifyProjectName = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : `project-${slug}`.slice(0, 48);
};

/**
 * Collisions are expected (two "Website redesign" projects), so the second one becomes
 * `website-redesign-2` instead of failing the request.
 */
export const slugCandidate = (base: string, attempt: number): string =>
  attempt <= 1 ? base : `${base}-${attempt}`.slice(0, 64);

const AUTONOMY_ORDER: readonly AutonomyLevel[] = [
  'observe',
  'assist',
  'autonomous_dev',
  'restricted_release',
];

export const autonomyRank = (level: AutonomyLevel): number => AUTONOMY_ORDER.indexOf(level);

/**
 * Raising autonomy is an admin decision; lowering it is always allowed for a developer so a
 * stuck project can be made safer by whoever is on call.
 */
export const canSetAutonomyLevel = (
  role: Role,
  from: AutonomyLevel,
  to: AutonomyLevel,
): boolean => {
  if (role === 'owner' || role === 'admin') {
    return true;
  }
  if (role !== 'developer') {
    return false;
  }
  return autonomyRank(to) < autonomyRank(from);
};

/**
 * GitHub and GitLab both identify a repository by a positive numeric id. Storing it as text keeps
 * the value exact across forges and leaves room for a self-managed instance that changes it.
 */
export const isValidRemoteRepositoryId = (id: string): boolean => /^[1-9]\d{0,19}$/.test(id);

export const repositoryFullName = (owner: string, name: string): string =>
  `${owner.trim()}/${name.trim()}`.replace(/\/+/g, '/');

/** `read_only` is derived, not chosen: it means "we can read but must not write". */
export const statusForCapability = (canWrite: boolean, hasRepository: boolean): ProjectStatus => {
  if (!hasRepository) {
    return 'idea';
  }
  return canWrite ? 'connected' : 'read_only';
};
