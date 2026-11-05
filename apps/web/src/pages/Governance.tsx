import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  useApprovals,
  useDecideApproval,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  usePolicy,
  useSession,
  useUpdatePolicy,
} from '../api/queries';
import type { Approval, AutonomyLevel, Policy, UpdatePolicyRequest } from '../api/types';
import {
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingRows,
  PageHead,
  Status,
} from '../components/ui';
import { label, stamp, timeAgo } from '../lib/format';

function useCanAdminister(): boolean {
  const role = useSession().data?.user.role;
  return role === 'owner' || role === 'admin';
}

/* ------------------------------------------------------------------ approvals */

const APPROVAL_FILTERS = ['pending', 'approved', 'rejected', 'expired'] as const;

export function ApprovalsPage() {
  const [status, setStatus] = useState<(typeof APPROVAL_FILTERS)[number]>('pending');
  const approvals = useApprovals(status);
  const canDecide = useCanAdminister();

  return (
    <div className="page">
      <PageHead
        title="Approvals"
        sub="Actions that need a human decision before they run: production deploys, publishing, credential changes."
      />
      <div className="tabs" role="tablist" aria-label="Approval status">
        {APPROVAL_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={status === value}
            onClick={() => setStatus(value)}
          >
            {label(value)}
          </button>
        ))}
      </div>
      {!canDecide ? (
        <p className="banner">
          Deciding an approval needs the owner or admin role. You can read the queue.
        </p>
      ) : null}
      <div role="tabpanel" aria-label={`${label(status)} approvals`}>
        {approvals.isPending ? (
          <LoadingRows label="Loading approvals" />
        ) : approvals.isError ? (
          <ErrorState
            error={approvals.error}
            what="approvals"
            onRetry={() => approvals.refetch()}
          />
        ) : approvals.data.length === 0 ? (
          <EmptyState>
            {status === 'pending'
              ? 'Nothing is waiting for a decision. A request appears here when a workflow asks to deploy, publish or change credentials.'
              : `No ${status} approvals.`}
          </EmptyState>
        ) : (
          <ul className="lane-list panel">
            {approvals.data.map((approval) => (
              <ApprovalRow key={approval.id} approval={approval} canDecide={canDecide} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ApprovalRow({ approval, canDecide }: { approval: Approval; canDecide: boolean }) {
  const decide = useDecideApproval();
  const [note, setNote] = useState('');
  const noteId = `note-${approval.id}`;
  const riskTone = approval.risk === 'high' ? 'fail' : approval.risk === 'medium' ? 'wait' : 'idle';

  return (
    <li className="task-row" style={{ padding: 16, gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{approval.summary}</strong>
        <Status tone={riskTone}>{label(approval.risk)} risk</Status>
      </div>
      <div className="task-meta">
        <span className="mono">{approval.action}</span>
        <span>requested by {approval.requested_by}</span>
        <span title={stamp(approval.created_at)}>{timeAgo(approval.created_at)}</span>
        {approval.project_id ? (
          <Link to="/projects/$projectId" params={{ projectId: approval.project_id }}>
            Open project
          </Link>
        ) : null}
      </div>
      {approval.status === 'pending' ? (
        canDecide ? (
          <div className="stack" style={{ gap: 8 }}>
            <Field label="Decision note" htmlFor={noteId} hint="Optional. Recorded with your name.">
              <input
                id={noteId}
                type="text"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    id: approval.id,
                    decision: 'approved',
                    note: note.trim() || undefined,
                  })
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    id: approval.id,
                    decision: 'rejected',
                    note: note.trim() || undefined,
                  })
                }
              >
                Reject
              </button>
            </div>
            <FormError error={decide.error} />
          </div>
        ) : null
      ) : (
        <p className="small">
          {label(approval.status)} by{' '}
          <span className="mono">{approval.decided_by ?? 'unknown'}</span>{' '}
          {approval.decided_at ? timeAgo(approval.decided_at) : ''}
          {approval.note ? `: ${approval.note}` : ''}
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ notifications */

export function NotificationsPage() {
  const feed = useNotifications();
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  return (
    <div className="page">
      <PageHead
        title="Notifications"
        sub={
          feed.data
            ? `${feed.data.unread} unread.`
            : 'Approval requests and new reviews addressed to you.'
        }
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || !feed.data?.unread}
            title={!feed.data?.unread ? 'Nothing unread' : undefined}
          >
            Mark all read
          </button>
        }
      />
      <FormError error={markAll.error ?? markOne.error} />
      {feed.isPending ? (
        <LoadingRows label="Loading notifications" />
      ) : feed.isError ? (
        <ErrorState error={feed.error} what="notifications" onRetry={() => feed.refetch()} />
      ) : feed.data.items.length === 0 ? (
        <EmptyState>
          No notifications. You get one when an approval is requested or a pull request opens on a
          connected repository.
        </EmptyState>
      ) : (
        <ul className="feed">
          {feed.data.items.map((item) => (
            <li key={item.id}>
              <time dateTime={item.created_at} title={stamp(item.created_at)}>
                {timeAgo(item.created_at)}
              </time>
              <div className="stack" style={{ gap: 4 }}>
                <span>
                  {item.read ? null : <Status tone="run">Unread</Status>}{' '}
                  <strong>{item.title}</strong>
                </span>
                <span className="muted">{item.body}</span>
                <span className="row">
                  {item.kind === 'approval.required' ? (
                    <Link to="/approvals">Open approvals</Link>
                  ) : null}
                  {item.project_id ? (
                    <Link to="/projects/$projectId" params={{ projectId: item.project_id }}>
                      Open project
                    </Link>
                  ) : null}
                  {!item.read ? (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => markOne.mutate(item.id)}
                      disabled={markOne.isPending}
                    >
                      Mark read
                    </button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

export function SettingsPage() {
  const policy = usePolicy();
  const session = useSession();

  return (
    <div className="page">
      <PageHead
        title="Settings"
        sub="Organization policy. Every service reads it before a policy decision."
      />
      <div className="split">
        <section aria-labelledby="policy-heading">
          <div className="section-head">
            <h2 id="policy-heading">Policy</h2>
            {policy.data ? (
              <span className="meta mono">
                revision {policy.data.revision} · {stamp(policy.data.updated_at)}
              </span>
            ) : null}
          </div>
          {policy.isPending ? (
            <LoadingRows label="Loading policy" />
          ) : policy.isError ? (
            <ErrorState error={policy.error} what="the policy" onRetry={() => policy.refetch()} />
          ) : (
            <PolicyForm policy={policy.data} />
          )}
        </section>
        <section aria-labelledby="account-heading">
          <div className="section-head">
            <h2 id="account-heading">Account</h2>
          </div>
          {session.data ? (
            <dl className="deflist panel panel-body">
              <dt>Name</dt>
              <dd>{session.data.user.display_name}</dd>
              <dt>Email</dt>
              <dd className="mono">{session.data.user.email}</dd>
              <dt>Role</dt>
              <dd>{label(session.data.user.role)}</dd>
              <dt>Organization</dt>
              <dd>
                {session.data.organization.name}{' '}
                <span className="mono muted">{session.data.organization.slug}</span>
              </dd>
              <dt>Session ends</dt>
              <dd className="mono small">{stamp(session.data.expires_at)}</dd>
            </dl>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const AUTONOMY: AutonomyLevel[] = ['observe', 'assist', 'autonomous_dev', 'restricted_release'];

function PolicyForm({ policy }: { policy: Policy }) {
  const update = useUpdatePolicy();
  const canEdit = useCanAdminister();
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(policy.autonomy_level);
  const [wip, setWip] = useState(String(policy.wip_limit));
  const [quality, setQuality] = useState(policy.quality_gate_required);
  const [antiSlop, setAntiSlop] = useState(policy.anti_slop_required);
  const [retention, setRetention] = useState(String(policy.audit_retention_days));
  const [saved, setSaved] = useState(false);

  // The settings service refuses an update that changes nothing, so only changed fields are sent.
  const changes: UpdatePolicyRequest = {};
  if (autonomy !== policy.autonomy_level) changes.autonomy_level = autonomy;
  if (Number(wip) !== policy.wip_limit) changes.wip_limit = Number(wip);
  if (quality !== policy.quality_gate_required) changes.quality_gate_required = quality;
  if (antiSlop !== policy.anti_slop_required) changes.anti_slop_required = antiSlop;
  if (Number(retention) !== policy.audit_retention_days)
    changes.audit_retention_days = Number(retention);
  const dirty = Object.keys(changes).length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    setSaved(false);
    update.mutate(changes, { onSuccess: () => setSaved(true) });
  };

  return (
    <form className="panel panel-body stack" onSubmit={submit}>
      {!canEdit ? (
        <p className="small muted">Changing policy needs the owner or admin role.</p>
      ) : null}
      <fieldset disabled={!canEdit} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <Field label="Default autonomy" htmlFor="pol-autonomy" hint="Projects start at this level.">
          <select
            id="pol-autonomy"
            value={autonomy}
            onChange={(e) => setAutonomy(e.target.value as AutonomyLevel)}
          >
            {AUTONOMY.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="WIP limit per board"
          htmlFor="pol-wip"
          hint="1 to 50 tasks in progress at once."
        >
          <input
            id="pol-wip"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            required
            value={wip}
            onChange={(e) => setWip(e.target.value)}
          />
        </Field>
        <Field label="Audit retention, days" htmlFor="pol-retention" hint="1 to 3650.">
          <input
            id="pol-retention"
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            required
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
        </Field>
        <label className="row" htmlFor="pol-quality">
          <input
            id="pol-quality"
            type="checkbox"
            checked={quality}
            onChange={(e) => setQuality(e.target.checked)}
          />
          Require a passed quality gate before Done
        </label>
        <label className="row" htmlFor="pol-antislop">
          <input
            id="pol-antislop"
            type="checkbox"
            checked={antiSlop}
            onChange={(e) => setAntiSlop(e.target.checked)}
          />
          Require the Anti-Slop Delivery Gate on UI tasks
        </label>
        <p className="small muted">
          Provider routing:{' '}
          {policy.provider_routing.priority.length
            ? policy.provider_routing.priority.join(', ')
            : 'no engines in priority order'}
          , up to {policy.provider_routing.max_active_agents_global} agents at once. Engines are Not
          connected in this build.
        </p>
      </fieldset>
      <FormError error={update.error} />
      <div className="row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canEdit || !dirty || update.isPending}
          title={!canEdit ? 'Owner or admin only' : !dirty ? 'Change a field first' : undefined}
        >
          {update.isPending ? 'Saving' : 'Save policy'}
        </button>
        <span className="small muted" aria-live="polite">
          {saved && !dirty ? 'Saved as a new revision.' : !dirty ? 'No unsaved changes.' : ''}
        </span>
      </div>
    </form>
  );
}
