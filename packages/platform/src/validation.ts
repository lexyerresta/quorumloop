import { z, type ZodType } from 'zod';
import { DomainError } from '@quorumloop/contracts';

/**
 * Transport validation. Domain code receives parsed values only, and the failure is a typed
 * VALIDATION_FAILED instead of a framework exception leaking a class name or a stack.
 */
export const parseWith = <T extends ZodType>(schema: T, input: unknown): z.infer<T> => {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new DomainError('VALIDATION_FAILED', 'request validation failed', false, {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
};

export const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

export const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError('VALIDATION_FAILED', `${field} is required`);
  }
  return value.trim();
};
