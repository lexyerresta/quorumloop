import { DomainError, type Policy, type UpdatePolicyRequest } from '@quorumloop/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { readEnv } from '@quorumloop/config';
import type { ServiceLogger } from '@quorumloop/observability';
import { SERVICE_LOGGER } from '@quorumloop/platform';
import type { PolicyRow, PolicyValues } from '../database/schema';
import { SettingsRepository } from './settings.repository';
import { applyPolicyPatch, defaultPolicy, type PolicyDefaults } from './settings.rules';

/**
 * Policy reads and writes. A GET never writes: an organization that has not touched its policy is
 * served the same defaults the environment advertises, with revision 0, which is also how the
 * dashboard can tell "never configured" from "configured to the defaults".
 */
@Injectable()
export class SettingsService {
  private readonly defaults: PolicyDefaults;

  constructor(
    private readonly repository: SettingsRepository,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {
    const env = readEnv();
    this.defaults = {
      demoMode: env.DEMO_MODE === 'true',
      qualityGateRequired: env.QUALITY_GATE_REQUIRED === 'true',
      auditRetentionDays: env.AUDIT_RETENTION_DAYS,
      maxActiveAgentsGlobal: env.MAX_ACTIVE_AGENTS_GLOBAL,
    };
  }

  async getPolicy(orgId: string): Promise<Policy> {
    const row = await this.repository.findPolicy(orgId);
    return row ? toPolicy(row) : this.defaultsFor(orgId);
  }

  async updatePolicy(orgId: string, actor: string, patch: UpdatePolicyRequest): Promise<Policy> {
    const current = await this.readValues(orgId);
    const { next, changed } = applyPolicyPatch(current, patch);
    if (changed.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'the update does not change any policy field');
    }

    const { row } = await this.repository.savePolicy(orgId, next, actor);
    this.logger.info({ orgId, revision: row.revision, changed, actor }, 'policy updated');
    return toPolicy(row);
  }

  private async readValues(orgId: string): Promise<PolicyValues> {
    const row = await this.repository.findPolicy(orgId);
    return row ? toValues(row) : defaultPolicy(this.defaults);
  }

  private defaultsFor(orgId: string): Policy {
    const values = defaultPolicy(this.defaults);
    return {
      org_id: orgId,
      autonomy_level: values.autonomyLevel,
      wip_limit: values.wipLimit,
      quality_gate_required: values.qualityGateRequired,
      anti_slop_required: values.antiSlopRequired,
      demo_mode: values.demoMode,
      audit_retention_days: values.auditRetentionDays,
      provider_routing: values.providerRouting,
      revision: 0,
      // No stored row means no stored timestamp, so the response carries the moment the defaults were
      // served. `revision: 0` is what tells a caller these values were never written down.
      updated_at: new Date().toISOString(),
    };
  }
}

const toValues = (row: PolicyRow): PolicyValues => ({
  autonomyLevel: row.autonomyLevel as PolicyValues['autonomyLevel'],
  wipLimit: row.wipLimit,
  qualityGateRequired: row.qualityGateRequired,
  antiSlopRequired: row.antiSlopRequired,
  demoMode: row.demoMode,
  auditRetentionDays: row.auditRetentionDays,
  providerRouting: row.providerRouting,
});

const toPolicy = (row: PolicyRow): Policy => {
  const values = toValues(row);
  return {
    org_id: row.orgId,
    autonomy_level: values.autonomyLevel,
    wip_limit: values.wipLimit,
    quality_gate_required: values.qualityGateRequired,
    anti_slop_required: values.antiSlopRequired,
    demo_mode: values.demoMode,
    audit_retention_days: values.auditRetentionDays,
    provider_routing: values.providerRouting,
    revision: row.revision,
    updated_at: row.updatedAt.toISOString(),
  };
};
