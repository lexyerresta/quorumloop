-- Approval requests and their single decision.
-- Reachable only by the quorumloop_audit role.

create table if not exists approvals (
  id uuid primary key,
  org_id uuid not null,
  project_id uuid,
  -- The action set lives in the shared contract; keeping it out of a check constraint means adding
  -- an action is a contract change, not a migration on every install.
  action text not null,
  summary text not null,
  requested_by text not null,
  risk text not null check (risk in ('low', 'medium', 'high')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by text,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists approvals_org_status_idx on approvals (org_id, status);
create index if not exists approvals_org_created_idx on approvals (org_id, created_at);
