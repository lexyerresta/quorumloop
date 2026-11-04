import { createSign } from 'node:crypto';
import { DomainError } from '@quorumloop/contracts';

/**
 * GitHub App authentication: sign a short lived RS256 JWT with the app key, exchange it for an
 * installation token. The installation token is minted per call and never persisted, which is
 * why a GitHub App connection stores no secret at all.
 */
const base64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

export const createAppJwt = (appId: string, privateKeyPem: string, now = Date.now()): string => {
  const issuedAt = Math.floor(now / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKeyPem).toString('base64url');
  return `${header}.${payload}.${signature}`;
};

/** PEM keys are usually stored in the environment with literal `\n` escapes. */
export const normalizePem = (value: string): string => value.replace(/\\n/g, '\n').trim();

export interface InstallationCredential {
  token: string;
  expiresAt: Date;
  /** The installation's account login, which an installation token cannot look up itself. */
  accountLogin: string | null;
}

const readJson = async (url: string, jwt: string): Promise<Record<string, unknown> | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${jwt}`,
        'user-agent': 'quorumloop',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return null;
    }
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const mintInstallationToken = async (options: {
  apiBase: string;
  appId: string;
  privateKey: string;
  installationId: string;
}): Promise<InstallationCredential> => {
  const jwt = createAppJwt(options.appId, normalizePem(options.privateKey));
  const base = options.apiBase.replace(/\/+$/, '');
  const installation = await readJson(
    `${base}/app/installations/${encodeURIComponent(options.installationId)}`,
    jwt,
  );
  const account = installation?.['account'];
  const accountLogin =
    typeof account === 'object' &&
    account !== null &&
    typeof (account as { login?: unknown }).login === 'string'
      ? (account as { login: string }).login
      : null;

  let response: Response;
  try {
    response = await fetch(
      `${base}/app/installations/${encodeURIComponent(options.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${jwt}`,
          'user-agent': 'quorumloop',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    throw new DomainError(
      'UPSTREAM_UNAVAILABLE',
      `cannot reach GitHub: ${error instanceof Error ? error.message : 'unknown error'}`,
      true,
    );
  }

  const body = await response.text();
  if (!response.ok) {
    throw new DomainError(
      response.status === 401 ? 'NOT_CONFIGURED' : 'UPSTREAM_UNAVAILABLE',
      `GitHub refused the app installation token (status ${response.status}). Check GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and the installation id.`,
      response.status >= 500,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DomainError('UPSTREAM_UNAVAILABLE', 'GitHub returned malformed json', true);
  }
  const record = parsed as { token?: unknown; expires_at?: unknown };
  if (typeof record.token !== 'string' || record.token.length === 0) {
    throw new DomainError('UPSTREAM_UNAVAILABLE', 'GitHub returned no installation token');
  }
  const expiresAt =
    typeof record.expires_at === 'string'
      ? new Date(record.expires_at)
      : new Date(Date.now() + 3_600_000);
  return { token: record.token, expiresAt, accountLogin };
};
