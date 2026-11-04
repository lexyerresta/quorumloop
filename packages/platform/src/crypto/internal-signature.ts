import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureInput {
  secret: string;
  caller: string;
  method: string;
  path: string;
  timestamp: string;
  body: string;
}

export const MAX_CLOCK_SKEW_MS = 120_000;

/**
 * Internal service calls are signed with an HMAC over the method, path, timestamp and a body
 * hash. This is a service identity boundary, not a user session: it proves the caller holds
 * the shared runner secret and keeps a replayed request outside the skew window useless.
 */
export const signInternalRequest = (input: SignatureInput): string => {
  const bodyHash = createHmac('sha256', input.secret).update(input.body).digest('hex');
  const payload = [
    input.caller,
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', input.secret).update(payload).digest('hex');
};

export interface VerifyInput extends SignatureInput {
  signature: string;
  now?: number;
}

export const verifyInternalRequest = (input: VerifyInput): { ok: boolean; reason?: string } => {
  const now = input.now ?? Date.now();
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'missing or invalid timestamp' };
  }
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'timestamp outside the allowed window' };
  }
  const expected = signInternalRequest(input);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(input.signature, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return { ok: false, reason: 'signature mismatch' };
  }
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
};

export const INTERNAL_HEADERS = {
  caller: 'x-quorumloop-service',
  timestamp: 'x-quorumloop-timestamp',
  signature: 'x-quorumloop-signature',
  orgId: 'x-quorumloop-org-id',
  userId: 'x-quorumloop-user-id',
  roles: 'x-quorumloop-roles',
  correlationId: 'x-correlation-id',
} as const;
