import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE, uuidv7 } from '@quorumloop/platform';
import {
  policies,
  policyRevisions,
  schema,
  type PolicyRow,
  type PolicyValues,
} from '../database/schema';

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findPolicy(orgId: string): Promise<PolicyRow | null> {
    const rows = await this.db.select().from(policies).where(eq(policies.orgId, orgId)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Writes the policy and its history row together. The revision is computed from the stored value
   * inside the transaction, so two concurrent admins cannot produce the same revision number: the
   * second one either sees the incremented value or fails the unique index and retries.
   */
  async savePolicy(
    orgId: string,
    values: PolicyValues,
    actor: string,
  ): Promise<{ row: PolicyRow; revision: number }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ revision: policies.revision })
        .from(policies)
        .where(eq(policies.orgId, orgId))
        .limit(1)
        .for('update');

      const revision = (existing[0]?.revision ?? 0) + 1;
      const rows = await tx
        .insert(policies)
        .values({
          orgId,
          autonomyLevel: values.autonomyLevel,
          wipLimit: values.wipLimit,
          qualityGateRequired: values.qualityGateRequired,
          antiSlopRequired: values.antiSlopRequired,
          demoMode: values.demoMode,
          auditRetentionDays: values.auditRetentionDays,
          providerRouting: values.providerRouting,
          revision,
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: policies.orgId,
          set: {
            autonomyLevel: values.autonomyLevel,
            wipLimit: values.wipLimit,
            qualityGateRequired: values.qualityGateRequired,
            antiSlopRequired: values.antiSlopRequired,
            demoMode: values.demoMode,
            auditRetentionDays: values.auditRetentionDays,
            providerRouting: values.providerRouting,
            revision,
            updatedBy: actor,
            updatedAt: new Date(),
          },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('policy upsert returned no row');
      }

      await tx.insert(policyRevisions).values({
        id: uuidv7(),
        orgId,
        revision,
        snapshot: values,
        actor,
      });

      return { row, revision };
    });
  }
}
