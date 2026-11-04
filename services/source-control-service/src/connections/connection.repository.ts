import { and, desc, eq, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '@quorumloop/platform';
import { forgeConnections, schema, type ConnectionRow } from '../database/schema';

export interface ConnectionStatusPatch {
  status: 'connected' | 'expired' | 'revoked' | 'error';
  statusReason: string | null;
  scopes?: string[];
  accountLogin?: string | null;
  lastVerifiedAt?: Date | null;
}

@Injectable()
export class ConnectionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async list(orgId: string): Promise<ConnectionRow[]> {
    return this.db
      .select()
      .from(forgeConnections)
      .where(eq(forgeConnections.orgId, orgId))
      .orderBy(desc(forgeConnections.createdAt));
  }

  async findById(orgId: string, connectionId: string): Promise<ConnectionRow | null> {
    const rows = await this.db
      .select()
      .from(forgeConnections)
      .where(and(eq(forgeConnections.orgId, orgId), eq(forgeConnections.id, connectionId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByLabel(orgId: string, forge: string, label: string): Promise<ConnectionRow | null> {
    const rows = await this.db
      .select()
      .from(forgeConnections)
      .where(
        and(
          eq(forgeConnections.orgId, orgId),
          eq(forgeConnections.forge, forge),
          sql`lower(${forgeConnections.label}) = lower(${label})`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(row: typeof forgeConnections.$inferInsert): Promise<ConnectionRow> {
    const rows = await this.db.insert(forgeConnections).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('connection insert returned no row');
    }
    return created;
  }

  async updateStatus(
    orgId: string,
    connectionId: string,
    patch: ConnectionStatusPatch,
  ): Promise<ConnectionRow | null> {
    const rows = await this.db
      .update(forgeConnections)
      .set({
        status: patch.status,
        statusReason: patch.statusReason,
        updatedAt: new Date(),
        ...(patch.scopes ? { scopes: patch.scopes } : {}),
        ...(patch.accountLogin !== undefined ? { accountLogin: patch.accountLogin } : {}),
        ...(patch.lastVerifiedAt !== undefined ? { lastVerifiedAt: patch.lastVerifiedAt } : {}),
      })
      .where(and(eq(forgeConnections.orgId, orgId), eq(forgeConnections.id, connectionId)))
      .returning();
    return rows[0] ?? null;
  }

  /** Revocation keeps the row for the audit trail but drops the credential. */
  async revoke(orgId: string, connectionId: string): Promise<boolean> {
    const rows = await this.db
      .update(forgeConnections)
      .set({
        status: 'revoked',
        statusReason: 'disconnected by an administrator',
        sealedToken: '',
        updatedAt: new Date(),
      })
      .where(and(eq(forgeConnections.orgId, orgId), eq(forgeConnections.id, connectionId)))
      .returning({ id: forgeConnections.id });
    return rows.length > 0;
  }
}
