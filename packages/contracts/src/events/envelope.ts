import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';

/**
 * Durable event envelope defined by PRD section 14.3. Every JetStream message carries it,
 * and consumers persist `event_id` in their inbox table for deduplication.
 */
export const eventEnvelopeSchema = z.object({
  event_id: z.string().regex(/^[0-9a-f-]{36}$/),
  event_type: z.string().min(3),
  version: z.number().int().positive(),
  occurred_at: isoDateTimeSchema,
  published_at: isoDateTimeSchema,
  producer: z.string().min(3),
  org_id: idSchema.nullable(),
  project_id: idSchema.nullable(),
  aggregate_id: z.string().min(1),
  correlation_id: z.string().min(1),
  causation_id: z.string().nullable(),
  traceparent: z.string().nullable(),
  data_classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const DATA_CLASSIFICATION = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  RESTRICTED: 'restricted',
} as const;

export interface EnvelopeInput {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  producer: string;
  orgId: string | null;
  projectId: string | null;
  aggregateId: string;
  correlationId: string;
  causationId?: string | null;
  traceparent?: string | null;
  dataClassification?: EventEnvelope['data_classification'];
  payload: Record<string, unknown>;
}

export const buildEnvelope = (input: EnvelopeInput): EventEnvelope => {
  const envelope: EventEnvelope = {
    event_id: input.eventId,
    event_type: input.eventType,
    version: input.version,
    occurred_at: input.occurredAt,
    published_at: new Date().toISOString(),
    producer: input.producer,
    org_id: input.orgId,
    project_id: input.projectId,
    aggregate_id: input.aggregateId,
    correlation_id: input.correlationId,
    causation_id: input.causationId ?? null,
    traceparent: input.traceparent ?? null,
    data_classification: input.dataClassification ?? 'internal',
    payload: input.payload,
  };
  return eventEnvelopeSchema.parse(envelope);
};

/** Strips fields that must never cross a service or log boundary. */
export const REDACTED_KEYS = [
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'cookie',
  'authorization',
  'private_key',
  'client_secret',
  'secret',
  'prompt',
  'reasoning',
] as const;

export const assertNoSecrets = (payload: Record<string, unknown>): void => {
  for (const key of Object.keys(payload)) {
    if ((REDACTED_KEYS as readonly string[]).includes(key.toLowerCase())) {
      throw new Error(`event payload must not contain the field "${key}"`);
    }
  }
};
