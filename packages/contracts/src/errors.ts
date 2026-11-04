import { z } from 'zod';

/**
 * Error codes are part of the public contract. They are stable strings because clients
 * branch on them, and `retryable` tells the UI whether a retry control is honest.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'POLICY_DENIED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'NOT_CONFIGURED',
  'UNSUPPORTED_CAPABILITY',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    correlation_id: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const errorResponse = (
  code: ErrorCode,
  message: string,
  correlationId: string,
  retryable = false,
  details?: Record<string, unknown>,
): ErrorEnvelope => ({
  error: {
    code,
    message,
    correlation_id: correlationId,
    retryable,
    ...(details ? { details } : {}),
  },
});

/** Machine readable failure raised by domain code and mapped at the transport boundary. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
