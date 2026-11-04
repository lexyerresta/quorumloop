-- Task backlog, Kanban state, dependency DAG and transition history.
-- Reachable only by the quorumloop_task role.

create table if not exists project_boards (
  project_id uuid primary key,
  org_id uuid not null,
  last_reference integer not null default 0 check (last_reference >= 0),
  wip_limit integer not null default 3 check (wip_limit between 1 and 50),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key,
  org_id uuid not null,
  project_id uuid not null,
  reference text not null,
  title text not null,
  description text,
  status text not null default 'backlog'
    check (status in ('backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'done',
                      'paused', 'canceled', 'failed', 'needs_human_approval')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  role text not null default 'implementation'
    check (role in ('product_lead', 'researcher', 'architect', 'design_lead',
                    'implementation', 'qa', 'security', 'release')),
  agent_session_id uuid,
  quality_state text not null default 'not_run'
    check (quality_state in ('not_run', 'running', 'passed', 'failed', 'inconclusive')),
  position double precision not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists tasks_project_reference_key on tasks (project_id, reference);
create index if not exists tasks_project_status_idx on tasks (project_id, status);
create index if not exists tasks_org_idx on tasks (org_id);

create table if not exists task_dependencies (
  task_id uuid not null references tasks (id) on delete cascade,
  depends_on_task_id uuid not null references tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index if not exists task_dependencies_depends_on_idx
  on task_dependencies (depends_on_task_id);

create table if not exists acceptance_criteria (
  id uuid primary key,
  task_id uuid not null references tasks (id) on delete cascade,
  text text not null,
  verified boolean not null default false,
  evidence_ref text,
  position integer not null default 0
);
create index if not exists acceptance_criteria_task_idx on acceptance_criteria (task_id);

create table if not exists task_history (
  id uuid primary key,
  task_id uuid not null references tasks (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null,
  reason text,
  occurred_at timestamptz not null default now()
);
create index if not exists task_history_task_idx on task_history (task_id, occurred_at);
