# ADR-004: NATS JetStream with a transactional outbox

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Services must react to each other without sharing tables. Events include task transitions, execution lifecycle, provider limits, quality outcomes and approvals, and losing one means a task silently never progresses.
- **Decision:**
  - One JetStream stream `QUORUMLOOP` on `quorumloop.>`, file storage, 30 day `max_age`, `duplicate_window` 120s, `discard: old`, `max_msgs` 1,000,000.
  - Producers write the event into their own `outbox_events` table inside the same transaction as the state change. `OutboxPublisher` polls in batches, publishes with `msgID = event_id`, and marks rows published.
  - Consumers create durable pull consumers, explicit ACK, `ack_wait` 60s. Each consumer claims `(consumer_name, event_id)` in `inbox_messages` before handling, releases the claim on failure, and acknowledges only after its own writes commit.
  - Unknown event types are acknowledged and ignored, so a newer producer cannot poison an older consumer.
- **Consequences:**
  - At-least-once delivery with idempotent handlers; no distributed transaction.
  - A NATS outage degrades the platform instead of corrupting it: state commits, the outbox grows, and health reports `degraded` until the publisher drains.
  - Ordering is per subject per producer, not global. Handlers must tolerate out-of-order events by comparing versions or timestamps.
- **Rejected:** Redis Streams (weaker persistence guarantees, second broker), Kafka (operationally heavier for self-hosting), direct HTTP fan-out (no delivery guarantee, cascading failures).
