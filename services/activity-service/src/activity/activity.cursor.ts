import { DomainError } from '@quorumloop/contracts';

const CURSOR_PREFIX = 'v1:';

/**
 * A cursor is opaque on purpose: a client passes back what it was given and never builds one.
 * It carries the log sequence, which is monotonic and therefore safe to resume from.
 */
export const encodeCursor = (seq: number): string =>
  Buffer.from(`${CURSOR_PREFIX}${seq}`, 'utf8').toString('base64url');

export const decodeCursor = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  if (!decoded.startsWith(CURSOR_PREFIX)) {
    throw new DomainError('VALIDATION_FAILED', 'cursor is not a valid activity cursor');
  }
  const seq = Number(decoded.slice(CURSOR_PREFIX.length));
  if (!Number.isInteger(seq) || seq < 0) {
    throw new DomainError('VALIDATION_FAILED', 'cursor is not a valid activity cursor');
  }
  return seq;
};
