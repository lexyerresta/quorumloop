import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Role } from '@quorumloop/contracts';
import { DRIZZLE } from '@quorumloop/platform';
import {
  invitations,
  memberships,
  organizations,
  sessions,
  users,
  type InvitationRow,
  type MembershipRow,
  type OrganizationRow,
  type SessionRow,
  type UserRow,
  schema,
} from '../database/schema';

export interface MemberWithUser extends MembershipRow {
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface SessionWithContext {
  session: SessionRow;
  user: UserRow;
  organization: OrganizationRow;
  role: Role;
}

@Injectable()
export class IdentityRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async countUsers(): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(users);
    return Number(rows[0]?.value ?? 0);
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async insertUser(row: typeof users.$inferInsert): Promise<UserRow> {
    const rows = await this.db.insert(users).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('user insert returned no row');
    }
    return created;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async findOrganizationBySlug(slug: string): Promise<OrganizationRow | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async findOrganizationById(id: string): Promise<OrganizationRow | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertOrganization(row: typeof organizations.$inferInsert): Promise<OrganizationRow> {
    const rows = await this.db.insert(organizations).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('organization insert returned no row');
    }
    return created;
  }

  async firstOrganization(): Promise<OrganizationRow | null> {
    const rows = await this.db
      .select()
      .from(organizations)
      .orderBy(organizations.createdAt)
      .limit(1);
    return rows[0] ?? null;
  }

  async insertMembership(row: typeof memberships.$inferInsert): Promise<MembershipRow> {
    const rows = await this.db.insert(memberships).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('membership insert returned no row');
    }
    return created;
  }

  async findMembership(userId: string, orgId: string): Promise<MembershipRow | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async firstMembershipForUser(userId: string): Promise<MembershipRow | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(memberships.createdAt)
      .limit(1);
    return rows[0] ?? null;
  }

  async listMembers(orgId: string): Promise<MemberWithUser[]> {
    const rows = await this.db
      .select({
        membership: memberships,
        email: users.email,
        displayName: users.displayName,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(memberships.createdAt);

    return rows.map((row) => ({
      ...row.membership,
      email: row.email,
      displayName: row.displayName,
    }));
  }

  async updateMembershipRole(membershipId: string, role: Role): Promise<void> {
    await this.db.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
  }

  async deleteMembership(membershipId: string): Promise<void> {
    await this.db.delete(memberships).where(eq(memberships.id, membershipId));
  }

  async countOwners(orgId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
    return Number(rows[0]?.value ?? 0);
  }

  async insertSession(row: typeof sessions.$inferInsert): Promise<SessionRow> {
    const rows = await this.db.insert(sessions).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('session insert returned no row');
    }
    return created;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionWithContext | null> {
    const rows = await this.db
      .select({
        session: sessions,
        user: users,
        organization: organizations,
        role: memberships.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(organizations, eq(organizations.id, sessions.orgId))
      .innerJoin(
        memberships,
        and(eq(memberships.userId, sessions.userId), eq(memberships.orgId, sessions.orgId)),
      )
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      session: row.session,
      user: row.user,
      organization: row.organization,
      role: row.role as Role,
    };
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async listSessions(userId: string): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastSeenAt));
  }

  async insertInvitation(row: typeof invitations.$inferInsert): Promise<InvitationRow> {
    const rows = await this.db.insert(invitations).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('invitation insert returned no row');
    }
    return created;
  }

  async findInvitationByHash(tokenHash: string): Promise<InvitationRow | null> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.acceptedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async acceptInvitation(id: string): Promise<void> {
    await this.db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, id));
  }

  async purgeExpired(now = new Date()): Promise<void> {
    await this.db.delete(sessions).where(sql`${sessions.expiresAt} < ${now}`);
    await this.db.delete(invitations).where(sql`${invitations.expiresAt} < ${now}`);
  }
}
