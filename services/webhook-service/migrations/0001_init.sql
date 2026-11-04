-- webhook-service owns ingest receipts, replay keys and failure records. It never stores a
-- repository payload verbatim: a digest plus the normalized facts are enough to prove what
-- arrived and to deduplicate a redelivery.

create table if not exists webhook_deliveries (
  id uuid primary key,
  org_id uuid,
  forge text not null check (forge in ('github', 'gitlab')),
  delivery_id text not null,
  event text not null,
  kind text not null check (kind in ('push', 'merge_request', 'review', 'other')),
  remote_repository_id text,
  full_name text,
  status text not null check (status in ('accepted', 'duplicate', 'rejected', 'ignored')),
  reason text,
  duplicate_count integer not null default 0,
  payload_digest text not null,
  received_at timestamptz not null default now()
);

create unique index if not exists webhook_deliveries_key on webhook_deliveries (forge, delivery_id);
create index if not exists webhook_deliveries_received_idx on webhook_deliveries (received_at desc);

-- The replay ledger is the atomic dedupe claim: one insert decides who owns a delivery id.
create table if not exists webhook_replay_keys (
  forge text not null,
  delivery_id text not null,
  first_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (forge, delivery_id)
);

create index if not exists webhook_replay_keys_expiry_idx on webhook_replay_keys (expires_at);

create table if not exists ingest_failures (
  id uuid primary key,
  forge text not null,
  delivery_id text,
  reason text not null,
  payload_digest text not null,
  received_at timestamptz not null default now()
);

create index if not exists ingest_failures_received_idx on ingest_failures (received_at desc);
