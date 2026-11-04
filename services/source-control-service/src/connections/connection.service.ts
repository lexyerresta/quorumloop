import { readEnv } from '@quorumloop/config';
import {
  DomainError,
  type ConnectForgeRequest,
  type Connection,
  type Forge,
  type RemoteRepoPage,
} from '@quorumloop/contracts';
import { uuidv7 } from '@quorumloop/platform';
import { Inject, Injectable } from '@nestjs/common';
import type { ServiceLogger } from '@quorumloop/observability';
import { SERVICE_LOGGER } from '@quorumloop/platform';
import { type ConnectionRow } from '../database/schema';
import { ForgeFactory } from '../forge/forge.factory';
import { FORGE_PAGE_SIZE, type ForgePort } from '../forge/forge.port';
import { ConnectionRepository } from './connection.repository';

export interface RequestIdentity {
  orgId: string;
  actor: string;
}

/**
 * Forge connections. The token is verified against the host before it is stored, so a wrong
 * credential fails here rather than on the first sync, and it is sealed before it reaches the
 * database so a leaked row is not a leaked token.
 */
@Injectable()
export class ConnectionService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly forges: ForgeFactory,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async list(orgId: string): Promise<Connection[]> {
    const rows = await this.repository.list(orgId);
    return rows.map(toConnection);
  }

  async connect(
    identity: RequestIdentity,
    forge: Forge,
    input: ConnectForgeRequest,
  ): Promise<Connection> {
    const baseUrl = resolveBaseUrl(forge, input.base_url);
    const label = input.label?.trim() || `${forge} connection`;

    const existing = await this.repository.findByLabel(identity.orgId, forge, label);
    if (existing) {
      throw new DomainError('CONFLICT', `a connection labelled "${label}" already exists`);
    }

    let token = '';
    let installationId: string | null = null;

    if (forge === 'github' && input.mode === 'github_app') {
      const env = readEnv();
      if (env.GITHUB_APP_ID.length === 0 || env.GITHUB_APP_PRIVATE_KEY.length === 0) {
        throw new DomainError(
          'NOT_CONFIGURED',
          'GitHub App connections need GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY in the environment',
        );
      }
      if (!input.installation_id) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'a GitHub App connection requires installation_id',
        );
      }
      installationId = input.installation_id;
    } else {
      if (!input.token) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `connecting ${forge} with ${input.mode} requires a token`,
        );
      }
      token = input.token;
    }

    const draft: ConnectionRow = {
      id: uuidv7(),
      orgId: identity.orgId,
      forge,
      label,
      accountLogin: null,
      baseUrl,
      status: 'connected',
      statusReason: null,
      authMode: input.mode,
      scopes: [],
      sealedToken: token ? this.forges.seal(token) : '',
      installationId,
      createdBy: identity.actor,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastVerifiedAt: null,
    };

    // Verify before persisting: an unusable credential must not look connected.
    const forgePort = await this.forges.forConnection(draft);
    const verified = await forgePort.verify();

    const created = await this.repository.insert({
      ...draft,
      accountLogin: verified.login,
      scopes: verified.scopes,
      lastVerifiedAt: new Date(),
    });

    this.logger.info(
      { connectionId: created.id, forge, login: verified.login },
      'forge connection established',
    );
    return toConnection(created);
  }

  /** Re-verifies a stored credential and records the outcome on the connection. */
  async test(orgId: string, connectionId: string): Promise<Connection> {
    const connection = await this.load(orgId, connectionId);
    if (connection.status === 'revoked') {
      throw new DomainError(
        'PRECONDITION_FAILED',
        'this connection was revoked; reconnect the forge',
      );
    }
    try {
      const port = await this.forges.forConnection(connection);
      const identity = await port.verify();
      const updated = await this.repository.updateStatus(orgId, connectionId, {
        status: 'connected',
        statusReason: null,
        scopes: identity.scopes,
        accountLogin: identity.login,
        lastVerifiedAt: new Date(),
      });
      return toConnection(updated ?? connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'verification failed';
      const expired = isCredentialFailure(error);
      const updated = await this.repository.updateStatus(orgId, connectionId, {
        status: expired ? 'expired' : 'error',
        statusReason: message,
        lastVerifiedAt: new Date(),
      });
      this.logger.warn({ connectionId, expired }, 'forge connection verification failed');
      return toConnection(updated ?? connection);
    }
  }

  async disconnect(orgId: string, connectionId: string): Promise<void> {
    const revoked = await this.repository.revoke(orgId, connectionId);
    if (!revoked) {
      throw new DomainError('NOT_FOUND', 'connection not found');
    }
    this.logger.info({ connectionId }, 'forge connection revoked');
  }

  async repositories(
    orgId: string,
    connectionId: string,
    cursor: string | null,
  ): Promise<RemoteRepoPage> {
    const connection = await this.load(orgId, connectionId);
    if (connection.status !== 'connected') {
      throw new DomainError(
        'PRECONDITION_FAILED',
        `this connection is ${connection.status}; test or reconnect it first`,
      );
    }
    const port = await this.forges.forConnection(connection);
    const page = await port.listRepositories(cursor, FORGE_PAGE_SIZE);
    return {
      items: page.items.map((repository) => ({
        remote_id: repository.remoteId,
        full_name: repository.fullName,
        description: repository.description,
        private: repository.isPrivate,
        default_branch: repository.defaultBranch,
        language: repository.language,
        updated_at: repository.updatedAt?.toISOString() ?? null,
        web_url: repository.webUrl,
      })),
      next_cursor: page.nextCursor,
    };
  }

  async load(orgId: string, connectionId: string): Promise<ConnectionRow> {
    const connection = await this.repository.findById(orgId, connectionId);
    if (!connection) {
      throw new DomainError('NOT_FOUND', 'connection not found');
    }
    return connection;
  }

  async portFor(connection: ConnectionRow): Promise<ForgePort> {
    return this.forges.forConnection(connection);
  }
}

const toConnection = (row: ConnectionRow): Connection => ({
  id: row.id,
  forge: row.forge as Forge,
  label: row.label,
  account_login: row.accountLogin,
  base_url: row.baseUrl,
  status: row.status as Connection['status'],
  status_reason: row.statusReason,
  auth_mode: row.authMode as Connection['auth_mode'],
  scopes: row.scopes,
  created_at: row.createdAt.toISOString(),
  last_verified_at: row.lastVerifiedAt?.toISOString() ?? null,
});

const isCredentialFailure = (error: unknown): boolean =>
  error instanceof DomainError &&
  (error.code === 'UNAUTHENTICATED' || error.code === 'NOT_CONFIGURED');

/**
 * A connection URL becomes an outbound request target, so it is validated rather than trusted.
 * Self-hosted GitLab instances must be listed explicitly; anything else is refused.
 */
export const resolveBaseUrl = (forge: Forge, requested: string | undefined): string => {
  const env = readEnv();
  const fallback = forge === 'github' ? env.GITHUB_API_BASE_URL : env.GITLAB_BASE_URL;
  const candidate = (requested ?? fallback).trim().replace(/\/+$/, '');

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'base_url must be an absolute URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && env.NODE_ENV !== 'production')) {
    throw new DomainError('VALIDATION_FAILED', 'base_url must use https');
  }
  if (url.username || url.password) {
    throw new DomainError('VALIDATION_FAILED', 'base_url must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new DomainError('VALIDATION_FAILED', 'base_url must not carry a query or fragment');
  }

  if (forge === 'gitlab') {
    const allowed = env.GITLAB_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0);
    const host = url.hostname.toLowerCase();
    if (host !== 'gitlab.com' && !allowed.includes(host)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `self-managed GitLab hosts must be listed in GITLAB_ALLOWED_HOSTS (received ${host})`,
      );
    }
  }

  return url.toString().replace(/\/+$/, '');
};
