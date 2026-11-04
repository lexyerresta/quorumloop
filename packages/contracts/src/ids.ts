import { z } from 'zod';

/** Canonical identifier format. Values are opaque to every consumer. */
export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const idSchema = z.string().regex(ID_PATTERN, 'must be a canonical uuid');

/** ISO 8601 UTC timestamp. Storage is always UTC; display formatting is a client concern. */
export const isoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO 8601 timestamp');

export const isoDateTime = (): string => new Date().toISOString();

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  });
