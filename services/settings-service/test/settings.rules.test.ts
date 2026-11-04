import { describe, expect, it } from 'vitest';
import type { RoutingPolicy } from '@quorumloop/contracts';
import type { PolicyValues } from '../src/database/schema';
import {
  applyPolicyPatch,
  defaultPolicy,
  defaultRoutingPolicy,
  type PolicyDefaults,
} from '../src/settings/settings.rules';

const defaults: PolicyDefaults = {
  demoMode: false,
  qualityGateRequired: true,
  auditRetentionDays: 365,
  maxActiveAgentsGlobal: 4,
};

const basePolicy = (): PolicyValues => defaultPolicy(defaults);

const reordered = (routing: RoutingPolicy): RoutingPolicy => ({
  require_checkpoint_before_cross_engine_handoff:
    routing.require_checkpoint_before_cross_engine_handoff,
  cooldown_seconds_initial: routing.cooldown_seconds_initial,
  never_fallback_on: [...routing.never_fallback_on],
  fallback_on: [...routing.fallback_on],
  max_retries_per_engine: routing.max_retries_per_engine,
  max_active_agents_per_project: routing.max_active_agents_per_project,
  max_active_agents_global: routing.max_active_agents_global,
  allow_per_role_override: routing.allow_per_role_override,
  allow_per_project_override: routing.allow_per_project_override,
  priority: [...routing.priority],
  mode: routing.mode,
});

describe('defaultPolicy', () => {
  it('seeds the quality gate from the install, not from a second copy of the defaults', () => {
    const disabled = defaultPolicy({ ...defaults, qualityGateRequired: false });
    expect(disabled.qualityGateRequired).toBe(false);
    expect(defaultPolicy(defaults).qualityGateRequired).toBe(true);
  });

  it('carries the environment demo flag and audit retention', () => {
    const policy = defaultPolicy({ ...defaults, demoMode: true, auditRetentionDays: 30 });
    expect(policy.demoMode).toBe(true);
    expect(policy.auditRetentionDays).toBe(30);
  });

  it('starts in assist with a bounded work-in-progress limit', () => {
    const policy = basePolicy();
    expect(policy.autonomyLevel).toBe('assist');
    expect(policy.wipLimit).toBe(3);
    expect(policy.antiSlopRequired).toBe(true);
  });
});

describe('defaultRoutingPolicy', () => {
  it('follows the engine catalog order', () => {
    expect(defaultRoutingPolicy(4).priority).toEqual([
      'claude_code',
      'codex',
      'opencode',
      'qoder_cli',
    ]);
  });

  it('clamps the global agent limit into the range the contract accepts', () => {
    expect(defaultRoutingPolicy(0).max_active_agents_global).toBe(1);
    expect(defaultRoutingPolicy(99).max_active_agents_global).toBe(32);
    expect(defaultRoutingPolicy(6).max_active_agents_global).toBe(6);
  });

  it('refuses the handoffs that would hide a policy denial behind a retry', () => {
    const routing = defaultRoutingPolicy(4);
    expect(routing.never_fallback_on).toContain('policy_denied');
    expect(routing.never_fallback_on).toContain('security_gate_failed');
    expect(routing.require_checkpoint_before_cross_engine_handoff).toBe(true);
  });
});

describe('applyPolicyPatch', () => {
  it('changes only the fields that were sent', () => {
    const { next, changed } = applyPolicyPatch(basePolicy(), { wip_limit: 5 });

    expect(changed).toEqual(['wipLimit']);
    expect(next.wipLimit).toBe(5);
    expect(next.autonomyLevel).toBe('assist');
    expect(next.auditRetentionDays).toBe(365);
  });

  it('reports a no-op write as empty, so the caller can refuse to bump the revision', () => {
    const current = basePolicy();
    expect(applyPolicyPatch(current, { wip_limit: current.wipLimit }).changed).toEqual([]);
    expect(applyPolicyPatch(current, {}).changed).toEqual([]);
  });

  it('treats a reordered routing policy as unchanged', () => {
    const current = basePolicy();
    const { changed } = applyPolicyPatch(current, {
      provider_routing: reordered(current.providerRouting),
    });
    expect(changed).toEqual([]);
  });

  it('accepts a routing change that actually differs', () => {
    const current = basePolicy();
    const { next, changed } = applyPolicyPatch(current, {
      provider_routing: { ...current.providerRouting, max_retries_per_engine: 3 },
    });
    expect(changed).toEqual(['providerRouting']);
    expect(next.providerRouting.max_retries_per_engine).toBe(3);
  });

  it('can lower autonomy and disable the gate in one write without touching other fields', () => {
    const { next, changed } = applyPolicyPatch(basePolicy(), {
      autonomy_level: 'observe',
      quality_gate_required: false,
    });

    expect(changed).toEqual(['autonomyLevel', 'qualityGateRequired']);
    expect(next.autonomyLevel).toBe('observe');
    expect(next.qualityGateRequired).toBe(false);
    expect(next.antiSlopRequired).toBe(true);
  });

  it('does not mutate the policy it was given', () => {
    const current = basePolicy();
    applyPolicyPatch(current, { wip_limit: 9 });
    expect(current.wipLimit).toBe(3);
  });
});
