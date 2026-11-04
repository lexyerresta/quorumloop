import {
  DomainError,
  type ChangePasswordRequest,
  type LoginRequest,
  type Member,
  type Role,
  type Session,
  type SessionIssue,
  type SessionVerification,
  type SetupAdminRequest,
  type SetupStatus,
} from '@quorumloop/contracts';
import { readEnv } from '@quorumloop/config';
import { hashPassword, passwordPolicyIssues, uuidv7, verifyPassword } from '@quorumloop/platform';
import { Injectable } from '@nestjs/common';
import { IdentityRepository } from './identity.repository';
import {
  constantTimeEquals,
  hashToken,
  isRole,
  issueToken,
  normalizeEmail,
  sessionExpiry,
  slugifyOrg,
} from './identity.rules';

const VERSION = '0.1.0';

/** A hash of a random password, used to keep failed logins constant-time. */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'Ym9ndXMtaGFzaC1mb3ItdGltaW5nLWVxdWFsaXR5LW9ubHktbm90LWEtcmVhbC1wYXNzd29yZA==';

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

const toSession = (
  user: { id: string; email: string; displayName: string },
  organization: { id: string; name: string; slug: string },
  role: Role,
  csrfToken: string,
  expiresAt: Date,
  demoMode: boolean,
): Session => ({
  user: {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    role,
  },
  organization: {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  },
  csrf_token: csrfToken,
  expires_at: expiresAt.toISOString(),
  demo_mode: demoMode,
});

@Injectable()
export class IdentityService {
  constructor(private readonly repository: IdentityRepository) {}

  private get demoMode(): boolean {
    return readEnv().DEMO_MODE === 'true';
  }

  async setupStatus(): Promise<SetupStatus> {
    const env = readEnv();
    const users = await this.repository.countUsers();
    return {
      needs_setup: users === 0,
      bootstrap_token_required: Boolean(env.SETUP_BOOTSTRAP_TOKEN),
      demo_mode: this.demoMode,
      version: VERSION,
    };
  }

  /**
   * First-run wizard. It closes permanently once a user exists: the check happens before any
   * write, and the organization slug is unique, so two concurrent setups cannot both succeed.
   */
  async setupAdmin(input: SetupAdminRequest): Promise<SessionIssue> {
    const env = readEnv();
    if ((await this.repository.countUsers()) > 0) {
      throw new DomainError('CONFLICT', 'this instance is already set up');
    }
    if (env.SETUP_BOOTSTRAP_TOKEN) {
      if (!constantTimeEquals(input.bootstrap_token, env.SETUP_BOOTSTRAP_TOKEN)) {
        throw new DomainError('FORBIDDEN', 'bootstrap token does not match');
      }
    } else if (env.NODE_ENV === 'production') {
      throw new DomainError(
        'NOT_CONFIGURED',
        'SETUP_BOOTSTRAP_TOKEN is required before first-run setup in production',
      );
    }

    const issues = passwordPolicyIssues(input.password);
    if (issues.length > 0) {
      throw new DomainError('VALIDATION_FAILED', issues.join('; '));
    }

    const email = normalizeEmail(input.email);
    const slug = slugifyOrg(input.organization_name);

    const user = await this.repository.insertUser({
      id: uuidv7(),
      email,
      displayName: input.display_name,
      passwordHash: await hashPassword(input.password),
      status: 'active',
    });
    const organization = await this.repository.insertOrganization({
      id: uuidv7(),
      name: input.organization_name,
      slug,
    });
    await this.repository.insertMembership({
      id: uuidv7(),
      orgId: organization.id,
      userId: user.id,
      role: 'owner',
    });

    const issued = await this.issueSession(user, organization, 'owner', {});
    return issued;
  }

  async login(input: LoginRequest, meta: SessionMeta): Promise<SessionIssue> {
    const email = normalizeEmail(input.email);
    const user = await this.repository.findUserByEmail(email);
    // Always spend the scrypt cost, so a missing account is not distinguishable by timing.
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid || user.status !== 'active') {
      throw new DomainError('UNAUTHENTICATED', 'email or password is incorrect');
    }

    const membership = input.organization_slug
      ? await this.membershipForSlug(user.id, input.organization_slug)
      : await this.repository.firstMembershipForUser(user.id);
    if (!membership) {
      throw new DomainError('FORBIDDEN', 'this account is not a member of any workspace');
    }
    const organization = await this.repository.findOrganizationById(membership.orgId);
    if (!organization) {
      throw new DomainError('CONFLICT', 'workspace is missing for this membership');
    }
    if (!isRole(membership.role)) {
      throw new DomainError('CONFLICT', 'membership has an unknown role');
    }
    return this.issueSession(user, organization, membership.role, meta);
  }

  private async membershipForSlug(
    userId: string,
    slug: string,
  ): Promise<{ orgId: string; role: string } | null> {
    const organization = await this.repository.findOrganizationBySlug(slug);
    if (!organization) {
      return null;
    }
    const membership = await this.repository.findMembership(userId, organization.id);
    return membership ? { orgId: membership.orgId, role: membership.role } : null;
  }

  private async issueSession(
    user: { id: string; email: string; displayName: string },
    organization: { id: string; name: string; slug: string },
    role: Role,
    meta: SessionMeta,
  ): Promise<SessionIssue> {
    // Rotation: a new login invalidates every previous session for the account's workspace.
    const token = issueToken();
    const csrfToken = issueToken();
    const expiresAt = sessionExpiry();
    await this.repository.insertSession({
      id: uuidv7(),
      userId: user.id,
      orgId: organization.id,
      tokenHash: hashToken(token),
      csrfToken,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    });
    return {
      token,
      session: toSession(user, organization, role, csrfToken, expiresAt, this.demoMode),
    };
  }

  async verify(token: string, touch: boolean): Promise<SessionVerification> {
    const found = await this.repository.findSessionByTokenHash(hashToken(token));
    if (!found) {
      return { valid: false, reason: 'session is missing, revoked or expired' };
    }
    if (found.user.status !== 'active') {
      return { valid: false, reason: 'account is not active' };
    }
    if (!isRole(found.role)) {
      return { valid: false, reason: 'membership role is unknown' };
    }
    if (touch) {
      await this.repository.touchSession(found.session.id);
    }
    return {
      valid: true,
      session: toSession(
        found.user,
        found.organization,
        found.role,
        found.session.csrfToken,
        found.session.expiresAt,
        this.demoMode,
      ),
    };
  }

  async logout(token: string): Promise<void> {
    const found = await this.repository.findSessionByTokenHash(hashToken(token));
    if (found) {
      await this.repository.revokeSession(found.session.id);
    }
  }

  async me(orgId: string, userId: string): Promise<Member> {
    const user = await this.repository.findUserById(userId);
    const membership = await this.repository.findMembership(userId, orgId);
    if (!user || !membership || !isRole(membership.role)) {
      throw new DomainError('NOT_FOUND', 'membership not found');
    }
    return {
      id: membership.id,
      email: user.email,
      display_name: user.displayName,
      role: membership.role,
      created_at: membership.createdAt.toISOString(),
    };
  }

  async changePassword(
    userId: string,
    input: ChangePasswordRequest,
    currentSessionId?: string,
  ): Promise<void> {
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new DomainError('NOT_FOUND', 'user not found');
    }
    if (!(await verifyPassword(input.current_password, user.passwordHash))) {
      throw new DomainError('UNAUTHENTICATED', 'current password is incorrect');
    }
    const issues = passwordPolicyIssues(input.new_password);
    if (issues.length > 0) {
      throw new DomainError('VALIDATION_FAILED', issues.join('; '));
    }
    if (input.current_password === input.new_password) {
      throw new DomainError('VALIDATION_FAILED', 'new password must differ from the current one');
    }
    await this.repository.updatePassword(userId, await hashPassword(input.new_password));
    // Every other device must re-authenticate.
    const active = await this.repository.listSessions(userId);
    for (const session of active) {
      if (session.id !== currentSessionId) {
        await this.repository.revokeSession(session.id);
      }
    }
  }

  async listMembers(orgId: string): Promise<Member[]> {
    const rows = await this.repository.listMembers(orgId);
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      display_name: row.displayName,
      role: row.role as Role,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async addMember(
    orgId: string,
    actorId: string,
    input: { email: string; display_name: string; password: string; role: Role },
  ): Promise<Member> {
    const issues = passwordPolicyIssues(input.password);
    if (issues.length > 0) {
      throw new DomainError('VALIDATION_FAILED', issues.join('; '));
    }
    const email = normalizeEmail(input.email);
    if (await this.repository.findUserByEmail(email)) {
      throw new DomainError('CONFLICT', 'a user with this email already exists');
    }
    const user = await this.repository.insertUser({
      id: uuidv7(),
      email,
      displayName: input.display_name,
      passwordHash: await hashPassword(input.password),
      status: 'active',
    });
    const membership = await this.repository.insertMembership({
      id: uuidv7(),
      orgId,
      userId: user.id,
      role: input.role,
    });
    void actorId;
    return {
      id: membership.id,
      email: user.email,
      display_name: user.displayName,
      role: input.role,
      created_at: membership.createdAt.toISOString(),
    };
  }

  async updateMemberRole(orgId: string, membershipId: string, role: Role): Promise<void> {
    const members = await this.repository.listMembers(orgId);
    const target = members.find((member) => member.id === membershipId);
    if (!target) {
      throw new DomainError('NOT_FOUND', 'member not found in this workspace');
    }
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await this.repository.countOwners(orgId);
      if (owners <= 1) {
        throw new DomainError('PRECONDITION_FAILED', 'the workspace must keep at least one owner');
      }
    }
    await this.repository.updateMembershipRole(membershipId, role);
  }

  async removeMember(orgId: string, membershipId: string): Promise<void> {
    const members = await this.repository.listMembers(orgId);
    const target = members.find((member) => member.id === membershipId);
    if (!target) {
      throw new DomainError('NOT_FOUND', 'member not found in this workspace');
    }
    if (target.role === 'owner' && (await this.repository.countOwners(orgId)) <= 1) {
      throw new DomainError('PRECONDITION_FAILED', 'the workspace must keep at least one owner');
    }
    await this.repository.deleteMembership(membershipId);
  }
}
