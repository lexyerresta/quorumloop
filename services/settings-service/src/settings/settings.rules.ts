import { ENGINE_IDS, type RoutingPolicy, type UpdatePolicyRequest } from '@quorumloop/contracts';
import type { PolicyValues } from '../database/schema';

/** Values the install supplies through the environment; they only seed the first policy. */
export interface PolicyDefaults {
  demoMode: boolean;
  qualityGateRequired: boolean;
  auditRetentionDays: number;
  maxActiveAgentsGlobal: number;
}

/**
 * Provider routing starts on priority order with fallback, and refuses the handoffs that would hide
 * a policy denial or a security gate behind another engine's retry. The list is the catalog order,
 * so a new engine is added to the policy by editing the contract, not by editing this file.
 */
export const defaultRoutingPolicy = (maxActiveAgentsGlobal: number): RoutingPolicy => ({
  mode: 'priority_then_fallback',
  priority: [...ENGINE_IDS],
  allow_per_project_override: true,
  allow_per_role_override: false,
  max_active_agents_global: Math.min(Math.max(maxActiveAgentsGlobal, 1), 32),
  max_active_agents_per_project: 2,
  max_retries_per_engine: 1,
  fallback_on: ['rate_limited', 'quota_exhausted', 'provider_unavailable', 'recoverable_cli_error'],
  never_fallback_on: [
    'policy_denied',
    'missing_repo_permission',
    'untrusted_workspace',
    'security_gate_failed',
    'unsupported_capability',
    'ambiguous_state_without_checkpoint',
  ],
  cooldown_seconds_initial: 300,
  require_checkpoint_before_cross_engine_handoff: true,
});

/**
 * The policy an organization has before anybody writes one. A new install therefore answers
 * `GET /api/v1/settings/policies` with the same values the environment advertises, instead of a
 * second set of defaults that would have to be kept in sync.
 */
export const defaultPolicy = (defaults: PolicyDefaults): PolicyValues => ({
  autonomyLevel: 'assist',
  wipLimit: 3,
  qualityGateRequired: defaults.qualityGateRequired,
  antiSlopRequired: true,
  demoMode: defaults.demoMode,
  auditRetentionDays: defaults.auditRetentionDays,
  providerRouting: defaultRoutingPolicy(defaults.maxActiveAgentsGlobal),
});

export type PolicyField = keyof PolicyValues;

/**
 * Structural equality for the one field that is an object. Comparing serialized JSON directly
 * would call a reordered payload a change, and a spurious change costs a revision.
 */
const sameJson = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) =>
    sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
};

export interface PolicyChange {
  next: PolicyValues;
  changed: PolicyField[];
}

/**
 * Applies a partial update. Only the fields the caller sent change, and the returned list names
 * them, so the caller can refuse a no-op write instead of bumping the revision for nothing.
 */
export const applyPolicyPatch = (
  current: PolicyValues,
  patch: UpdatePolicyRequest,
): PolicyChange => {
  const next: PolicyValues = { ...current };
  const changed: PolicyField[] = [];

  if (patch.autonomy_level !== undefined && patch.autonomy_level !== current.autonomyLevel) {
    next.autonomyLevel = patch.autonomy_level;
    changed.push('autonomyLevel');
  }
  if (patch.wip_limit !== undefined && patch.wip_limit !== current.wipLimit) {
    next.wipLimit = patch.wip_limit;
    changed.push('wipLimit');
  }
  if (
    patch.quality_gate_required !== undefined &&
    patch.quality_gate_required !== current.qualityGateRequired
  ) {
    next.qualityGateRequired = patch.quality_gate_required;
    changed.push('qualityGateRequired');
  }
  if (
    patch.anti_slop_required !== undefined &&
    patch.anti_slop_required !== current.antiSlopRequired
  ) {
    next.antiSlopRequired = patch.anti_slop_required;
    changed.push('antiSlopRequired');
  }
  if (patch.demo_mode !== undefined && patch.demo_mode !== current.demoMode) {
    next.demoMode = patch.demo_mode;
    changed.push('demoMode');
  }
  if (
    patch.audit_retention_days !== undefined &&
    patch.audit_retention_days !== current.auditRetentionDays
  ) {
    next.auditRetentionDays = patch.audit_retention_days;
    changed.push('auditRetentionDays');
  }
  if (
    patch.provider_routing !== undefined &&
    !sameJson(patch.provider_routing, current.providerRouting)
  ) {
    next.providerRouting = patch.provider_routing;
    changed.push('providerRouting');
  }

  return { next, changed };
};
