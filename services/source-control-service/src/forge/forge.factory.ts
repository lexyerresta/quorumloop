import { readEnv } from '@quorumloop/config';
import { DomainError } from '@quorumloop/contracts';
import { createSecretBox, type SecretBox } from '@quorumloop/platform';
import { Injectable } from '@nestjs/common';
import type { ConnectionRow } from '../database/schema';
import { GithubAdapter } from './github.adapter';
import { mintInstallationToken } from './github-app';
import { GitlabAdapter } from './gitlab.adapter';
import type { ForgePort } from './forge.port';

/**
 * Builds a forge client from a stored connection. This is the only place a token is unsealed,
 * which keeps the plaintext lifetime short and the call sites free of crypto.
 */
@Injectable()
export class ForgeFactory {
  private readonly box: SecretBox | null;

  constructor() {
    const key = readEnv().SECRET_ENCRYPTION_KEY;
    this.box = key.length > 0 ? createSecretBox(key) : null;
  }

  /** True when connections can be stored at all. Connections fail closed without a key. */
  get canSeal(): boolean {
    return this.box !== null;
  }

  seal(token: string): string {
    if (!this.box) {
      throw new DomainError(
        'NOT_CONFIGURED',
        'SECRET_ENCRYPTION_KEY is not set, so forge credentials cannot be stored. Generate one with `pnpm setup`.',
      );
    }
    return this.box.encrypt(token);
  }

  async forConnection(connection: ConnectionRow): Promise<ForgePort> {
    if (connection.forge === 'github') {
      if (connection.authMode === 'github_app') {
        const env = readEnv();
        if (env.GITHUB_APP_ID.length === 0 || env.GITHUB_APP_PRIVATE_KEY.length === 0) {
          throw new DomainError(
            'NOT_CONFIGURED',
            'GitHub App connections require GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY',
          );
        }
        if (!connection.installationId) {
          throw new DomainError(
            'NOT_CONFIGURED',
            'this GitHub App connection has no installation id',
          );
        }
        const credential = await mintInstallationToken({
          apiBase: connection.baseUrl,
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
          installationId: connection.installationId,
        });
        return new GithubAdapter({
          apiBase: connection.baseUrl,
          token: credential.token,
          mode: 'github_app',
          accountLogin: credential.accountLogin,
        });
      }
      return new GithubAdapter({
        apiBase: connection.baseUrl,
        token: this.unseal(connection),
        mode: connection.authMode === 'oauth' ? 'oauth' : 'pat',
        accountLogin: connection.accountLogin,
      });
    }

    return new GitlabAdapter({
      baseUrl: connection.baseUrl,
      token: this.unseal(connection),
      tokenHeader: connection.authMode === 'oauth' ? 'authorization' : 'private-token',
    });
  }

  private unseal(connection: ConnectionRow): string {
    if (!this.box) {
      throw new DomainError(
        'NOT_CONFIGURED',
        'SECRET_ENCRYPTION_KEY is not set, so stored forge credentials cannot be read.',
      );
    }
    if (connection.sealedToken.length === 0) {
      throw new DomainError(
        'PRECONDITION_FAILED',
        'this connection has no stored credential; reconnect the forge',
      );
    }
    try {
      return this.box.decrypt(connection.sealedToken);
    } catch {
      throw new DomainError(
        'PRECONDITION_FAILED',
        'the stored credential cannot be decrypted with the current SECRET_ENCRYPTION_KEY; reconnect the forge',
      );
    }
  }
}
