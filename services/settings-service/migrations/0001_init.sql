-- Organization policy and its append-only revision history.
-- Reachable only by the quorumloop_settings role.

create table if not exists settings_policies (
  org_id uuid primary key,
  autonomy_level text not null default 'assist'
    check (autonomy_level in ('observe', 'assist', 'autonomous_dev', 'restricted_release')),
  wip_limit integer not null default 3 check (wip_limit between 1 and 50),
  quality_gate_required boolean not null default true,
  anti_slop_required boolean not null default true,
  demo_mode boolean not null default false,
  audit_retention_days integer not null default 365
    check (audit_retention_days between 1 and 3650),
  provider_routing jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

-- One snapshot per accepted write. A unique key on the revision is what makes two concurrent
-- admins fail loudly instead of silently overwriting each other's history.
create table if not exists settings_policy_revisions (
  id uuid primary key,
  org_id uuid not null references settings_policies (org_id) on delete cascade,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  actor text,
  created_at timestamptz not null default now()
);
create unique index if not exists settings_policy_revisions_org_revision_key
  on settings_policy_revisions (org_id, revision);
create index if not exists settings_policy_revisions_org_idx
  on settings_policy_revisions (org_id);
