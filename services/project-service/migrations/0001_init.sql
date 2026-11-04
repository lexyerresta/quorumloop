-- Project lifecycle, repository binding and onboarding runs.
-- Reachable only by the quorumloop_project role.

create table if not exists projects (
  id uuid primary key,
  org_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  forge text check (forge is null or forge in ('github', 'gitlab')),
  status text not null default 'connected'
    check (status in ('connected', 'syncing', 'read_only', 'error', 'idea', 'archived')),
  autonomy_level text not null default 'assist'
    check (autonomy_level in ('observe', 'assist', 'autonomous_dev', 'restricted_release')),
  runtime_preference text not null default 'paseo'
    check (runtime_preference in ('paseo', 'orca', 'direct_cli')),
  tasks_total integer not null default 0 check (tasks_total >= 0),
  tasks_in_progress integer not null default 0 check (tasks_in_progress >= 0),
  tasks_blocked integer not null default 0 check (tasks_blocked >= 0),
  active_agents integer not null default 0 check (active_agents >= 0),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists projects_org_slug_key on projects (org_id, slug);
create index if not exists projects_org_idx on projects (org_id);

create table if not exists project_repo_bindings (
  project_id uuid primary key references projects (id) on delete cascade,
  org_id uuid not null,
  repository_id uuid not null,
  forge text not null check (forge in ('github', 'gitlab')),
  connection_id uuid,
  remote_repository_id text not null,
  full_name text not null,
  default_branch text not null default 'main',
  head_sha text,
  head_message text,
  head_committed_at timestamptz,
  open_reviews integer,
  synced_at timestamptz,
  stale boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists project_repo_bindings_org_remote_key
  on project_repo_bindings (org_id, forge, remote_repository_id);

create table if not exists onboarding_runs (
  id uuid primary key,
  project_id uuid not null references projects (id) on delete cascade,
  org_id uuid not null,
  kind text not null check (kind in ('repository_import', 'idea_intake', 'relink', 'resync')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  detail text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_runs_project_idx on onboarding_runs (project_id);
