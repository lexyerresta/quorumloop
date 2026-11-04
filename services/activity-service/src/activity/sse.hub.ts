import { Injectable } from '@nestjs/common';
import type { ActivityRow } from '../database/schema';

export interface StreamScope {
  orgId: string;
  /** Null means every project in the organization. */
  projectId: string | null;
}

type Listener = (row: ActivityRow) => void;

interface Subscription {
  scope: StreamScope;
  listener: Listener;
}

/**
 * In-process fan-out for live streams. The hub gives immediate delivery on the replica that
 * recorded an event; the stream's periodic catch-up read covers events recorded by another
 * replica, so the feed stays correct without sticky sessions.
 */
@Injectable()
export class SseHub {
  private readonly subscriptions = new Set<Subscription>();

  subscribe(scope: StreamScope, listener: Listener): () => void {
    const subscription: Subscription = { scope, listener };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  publish(row: ActivityRow): void {
    for (const subscription of this.subscriptions) {
      if (subscription.scope.orgId !== row.orgId) {
        continue;
      }
      if (subscription.scope.projectId && subscription.scope.projectId !== row.projectId) {
        continue;
      }
      try {
        subscription.listener(row);
      } catch {
        // One broken socket must not stop delivery to the others; the next catch-up read
        // delivers the row again to anyone whose listener failed.
      }
    }
  }

  get size(): number {
    return this.subscriptions.size;
  }
}
