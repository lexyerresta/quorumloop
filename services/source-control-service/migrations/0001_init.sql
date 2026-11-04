-- source-control-service owns forge connections, repository mirrors and the remote cache.
-- The forge stays authoritative for Git data; everything here is a projection with a timestamp.
-- The access token is stored sealed (AES-256-GCM) and is never selected by a public route.

create table if not exists forge_connections (
  id uuid primary key,
  org_id uuid not null,
  forge text not null check (forge in ('github', 'gitlab')),
  label text not null,
  account_login text,
  base_url text not null,
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked', 'error')),
  status_reason text,
  auth_mode text not null check (auth_mode in ('github_app', 'pat', 'oauth')),
  scopes jsonb not null default '[]'::jsonb,
  -- Empty for `github_app`: the credential is the installation, minted per request.
  sealed_token text not null default '',
  installation_id text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create unique index if not exists forge_connections_label_key
  on forge_connections (org_id, forge, lower(label));
create index if not exists forge_connections_org_idx on forge_connections (org_id);

create table if not exists repository_mirrors (
  id uuid primary key,
  org_id uuid not null,
  connection_id uuid not null references forge_connections (id) on delete cascade,
  -- Null while a repository is known to the forge but not yet bound to a project.
  project_id uuid,
  forge text not null check (forge in ('github', 'gitlab')),
  remote_repository_id text not null,
  full_name text not null,
  description text,
  private boolean not null default false,
  default_branch text not null,
  language text,
  web_url text not null,
  head_sha text,
  head_message text,
  head_committed_at timestamptz,
  open_reviews integer,
  synced_at timestamptz,
  stale boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists repository_mirrors_remote_key
  on repository_mirrors (connection_id, remote_repository_id);
create unique index if not exists repository_mirrors_project_key
  on repository_mirrors (project_id) where project_id is not null;
create index if not exists repository_mirrors_org_idx on repository_mirrors (org_id, forge);

create table if not exists commits_cache (
  id uuid primary key,
  mirror_id uuid not null references repository_mirrors (id) on delete cascade,
  branch text not null,
  sha text not null,
  message text not null,
  author_name text not null,
  authored_at timestamptz not null,
  url text not null,
  fetched_at timestamptz not null default now()
);

create unique index if not exists commits_cache_sha_key on commits_cache (mirror_id, sha);
create index if not exists commits_cache_branch_idx
  on commits_cache (mirror_id, branch, authored_at desc);

create table if not exists review_requests_cache (
  id uuid primary key,
  mirror_id uuid not null references repository_mirrors (id) on delete cascade,
  forge_review_id text not null,
  number integer not null check (number > 0),
  title text not null,
  state text not null check (state in ('open', 'closed', 'merged', 'draft')),
  author text not null,
  url text not null,
  source_branch text not null,
  target_branch text not null,
  checks_status text not null default 'unknown'
    check (checks_status in ('pending', 'success', 'failure', 'unknown')),
  opened_at timestamptz not null,
  updated_at_remote timestamptz not null,
  fetched_at timestamptz not null default now()
);

create unique index if not exists review_requests_cache_remote_key
  on review_requests_cache (mirror_id, forge_review_id);
create index if not exists review_requests_cache_state_idx
  on review_requests_cache (mirror_id, state, updated_at_remote desc);
