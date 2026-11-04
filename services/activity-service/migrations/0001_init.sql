-- activity-service owns the sanitized activity log, its per-project projection and the
-- resume offsets used by SSE reconnects. Every statement is idempotent so a re-run is safe.

create table if not exists activity_events (
  id uuid primary key,
  -- Monotonic order for cursors and SSE resume. Independent of occurred_at, which can arrive
  -- out of order when two producers publish a second apart.
  seq bigserial not null unique,
  org_id uuid not null,
  project_id uuid,
  kind text not null,
  summary text not null,
  actor text not null,
  severity text not null,
  -- The envelope id. A redelivered event maps to the same row instead of a second entry.
  source_event_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists activity_events_source_key
  on activity_events (source_event_id);

create index if not exists activity_events_org_seq_idx
  on activity_events (org_id, seq desc);

create index if not exists activity_events_project_seq_idx
  on activity_events (project_id, seq desc);

create index if not exists activity_events_org_severity_seq_idx
  on activity_events (org_id, severity, seq desc);

-- Read model per project: the dashboard shows "last activity" and an alert badge without
-- scanning the log. Updated in the same statement as the insert it summarises.
create table if not exists feed_projections (
  org_id uuid not null,
  project_id uuid not null,
  last_seq bigint not null,
  last_event_at timestamptz not null,
  total_events bigint not null default 0,
  alert_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, project_id)
);

-- Resume points. A browser that reconnects without Last-Event-ID still resumes where its last
-- stream ended, and the row is per user so two tabs do not overwrite each other's progress.
create table if not exists sse_offsets (
  org_id uuid not null,
  client_key text not null,
  last_seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, client_key)
);
