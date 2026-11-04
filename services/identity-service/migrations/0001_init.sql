-- Identity owns users, organizations, memberships, sessions and invitations.
-- Every table is reachable only by the quorumloop_identity role.

create table if not exists users (
  id uuid primary key,
  email text not null,
  display_name text not null,
  password_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists users_email_key on users (email);

create table if not exists organizations (
  id uuid primary key,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists organizations_slug_key on organizations (slug);

create table if not exists memberships (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'developer', 'viewer')),
  created_at timestamptz not null default now()
);
create unique index if not exists memberships_org_user_key on memberships (org_id, user_id);
create index if not exists memberships_user_idx on memberships (user_id);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  token_hash text not null,
  csrf_token text not null,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create unique index if not exists sessions_token_key on sessions (token_hash);
create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists invitations (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'developer', 'viewer')),
  invited_by uuid not null references users (id),
  token_hash text not null,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists invitations_org_idx on invitations (org_id);
