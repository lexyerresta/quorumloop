import { and, eq, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '@quorumloop/platform';
import {
  ingestFailures,
  schema,
  webhookDeliveries,
  webhookReplayKeys,
  type DeliveryRow,
} from '../database/schema';

const REPLAY_RETENTION_DAYS = 30;

@Injectable()
export class WebhookRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Claims a delivery id. The primary key does the arbitration, so two concurrent redeliveries
   * cannot both be treated as first arrival.
   */
  async claimDelivery(forge: string, deliveryId: string): Promise<boolean> {
    const rows = await this.db
      .insert(webhookReplayKeys)
      .values({
        forge,
        deliveryId,
        expiresAt: new Date(Date.now() + REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing()
      .returning({ deliveryId: webhookReplayKeys.deliveryId });
    return rows.length > 0;
  }

  async insertDelivery(row: typeof webhookDeliveries.$inferInsert): Promise<DeliveryRow> {
    const rows = await this.db.insert(webhookDeliveries).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('webhook delivery insert returned no row');
    }
    return created;
  }

  async bumpDuplicate(forge: string, deliveryId: string): Promise<DeliveryRow | null> {
    const rows = await this.db
      .update(webhookDeliveries)
      .set({ duplicateCount: sql`${webhookDeliveries.duplicateCount} + 1` })
      .where(and(eq(webhookDeliveries.forge, forge), eq(webhookDeliveries.deliveryId, deliveryId)))
      .returning();
    return rows[0] ?? null;
  }

  async recordFailure(row: typeof ingestFailures.$inferInsert): Promise<void> {
    await this.db.insert(ingestFailures).values(row);
  }
}
