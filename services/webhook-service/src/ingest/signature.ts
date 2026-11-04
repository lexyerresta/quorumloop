import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Comparison hashes both sides first so the timing does not depend on the length of either
 * value. A signature check that leaks length is still a signature check with a side channel.
 */
const constantTimeEquals = (left: string, right: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(left, 'utf8').digest(),
    createHash('sha256').update(right, 'utf8').digest(),
  );

/** GitHub signs `sha256=` followed by the hex HMAC of the raw body. */
export const githubSignature = (secret: string, body: Buffer): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export const verifyGithubSignature = (
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean => {
  if (secret.length === 0 || typeof header !== 'string' || header.length === 0) {
    return false;
  }
  return constantTimeEquals(githubSignature(secret, body), header.trim());
};

/** GitLab sends the shared secret itself, so it is compared, never hashed into a signature. */
export const verifyGitlabToken = (secret: string, header: string | undefined): boolean => {
  if (secret.length === 0 || typeof header !== 'string' || header.length === 0) {
    return false;
  }
  return constantTimeEquals(secret, header.trim());
};

export const digestOf = (body: Buffer): string => createHash('sha256').update(body).digest('hex');
