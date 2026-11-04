-- In-app notifications and per-member read state.
-- Reachable only by the quorumloop_notification role.

create table if not exists notifications (
  id uuid primary key,
  org_id uuid not null,
  project_id uuid,
  kind text not null check (kind in ('approval.required', 'review.created')),
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info', 'warning')),
  source_event_id uuid not null,
  created_at timestamptz not null default now()
);

-- The unique key is what makes a redelivered event a no-op at the storage layer, not only in the
-- consumer inbox.
create unique index if not exists notifications_source_event_key
  on notifications (source_event_id);
create index if not exists notifications_org_created_idx
  on notifications (org_id, created_at);

create table if not exists notification_reads (
  notification_id uuid not null references notifications (id) on delete cascade,
  user_id text not null,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
