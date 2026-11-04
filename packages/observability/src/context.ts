import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  correlationId: string;
  orgId: string | null;
  userId: string | null;
  service: string;
  actor: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const newCorrelationId = (): string => randomUUID();

export const runWithContext = <T>(context: Partial<RequestContext>, fn: () => T): T => {
  const current = storage.getStore();
  const merged: RequestContext = {
    correlationId: context.correlationId ?? current?.correlationId ?? newCorrelationId(),
    orgId: context.orgId ?? current?.orgId ?? null,
    userId: context.userId ?? current?.userId ?? null,
    service: context.service ?? current?.service ?? 'unknown',
    actor: context.actor ?? current?.actor ?? 'system',
  };
  return storage.run(merged, fn);
};

export const currentContext = (): RequestContext | undefined => storage.getStore();

export const correlationId = (): string => storage.getStore()?.correlationId ?? newCorrelationId();
