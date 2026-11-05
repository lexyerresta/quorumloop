import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  useConnectForge,
  useConnections,
  useImportProject,
  useRemoteRepos,
  useRemoveConnection,
  useSession,
} from '../api/queries';
import type { Connection, RemoteRepo } from '../api/types';
import {
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingRows,
  PageHead,
  Status,
} from '../components/ui';
import { label, slugify, stamp, timeAgo } from '../lib/format';

type Forge = 'github' | 'gitlab';

export function ConnectionsPage() {
  const connections = useConnections();
  const session = useSession();
  const [connecting, setConnecting] = useState<Forge | null>(null);
  const [browsing, setBrowsing] = useState<Connection | null>(null);
  const role = session.data?.user.role;
  const canManage = role === 'owner' || role === 'admin';
  const manageHint = canManage ? undefined : 'Only an owner or admin can connect a forge';

  return (
    <div className="page">
      <PageHead
        title="Connections"
        sub="Forge accounts this organization reads repositories through. Tokens are encrypted at rest and never shown again."
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={!canManage}
              title={manageHint}
              onClick={() => setConnecting('gitlab')}
            >
              Connect GitLab
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canManage}
              title={manageHint}
              onClick={() => setConnecting('github')}
            >
              Connect GitHub
            </button>
          </>
        }
      />
      {!canManage ? (
        <p className="banner">
          Your role is {role ?? 'unknown'}. Connecting or removing a forge needs owner or admin.
        </p>
      ) : null}

      {connections.isPending ? (
        <LoadingRows label="Loading connections" />
      ) : connections.isError ? (
        <ErrorState
          error={connections.error}
          what="forge connections"
          onRetry={() => connections.refetch()}
        />
      ) : connections.data.length === 0 ? (
        <EmptyState
          action={
            canManage ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConnecting('github')}
              >
                Connect GitHub
              </button>
            ) : undefined
          }
        >
          GitHub and GitLab are Not connected. Add a connection with a personal access token, then
          browse its repositories and import one into a project.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="ledger stack-mobile">
            <thead>
              <tr>
                <th scope="col">Connection</th>
                <th scope="col">Account</th>
                <th scope="col">Status</th>
                <th scope="col">Auth</th>
                <th scope="col">Verified</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.data.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  canManage={canManage}
                  onBrowse={() => setBrowsing(connection)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connecting ? <ConnectDialog forge={connecting} onClose={() => setConnecting(null)} /> : null}
      {browsing ? <RepoBrowser connection={browsing} onClose={() => setBrowsing(null)} /> : null}
    </div>
  );
}

function ConnectionRow({
  connection,
  canManage,
  onBrowse,
}: {
  connection: Connection;
  canManage: boolean;
  onBrowse: () => void;
}) {
  const remove = useRemoveConnection();
  const [confirming, setConfirming] = useState(false);
  const tone =
    connection.status === 'connected' ? 'pass' : connection.status === 'expired' ? 'wait' : 'fail';

  return (
    <tr>
      <td data-label="Connection" className="primary-cell">
        <strong>{connection.label}</strong>
        <div className="mono small muted">
          {connection.forge} · {connection.base_url}
        </div>
      </td>
      <td data-label="Account" className="mono">
        {connection.account_login ?? <span className="muted">Unknown</span>}
      </td>
      <td data-label="Status">
        <Status tone={tone}>{label(connection.status)}</Status>
        {connection.status_reason ? (
          <div className="small muted">{connection.status_reason}</div>
        ) : null}
      </td>
      <td data-label="Auth" className="small">
        {label(connection.auth_mode)}
        {connection.scopes.length ? (
          <div className="mono muted">{connection.scopes.join(' ')}</div>
        ) : null}
      </td>
      <td data-label="Verified" title={stamp(connection.last_verified_at)}>
        {timeAgo(connection.last_verified_at)}
      </td>
      <td data-label="Actions">
        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={onBrowse}
            disabled={connection.status !== 'connected'}
            title={connection.status !== 'connected' ? 'Reconnect before browsing' : undefined}
          >
            Browse repositories
          </button>
          {canManage ? (
            confirming ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => remove.mutate(connection.id)}
                  disabled={remove.isPending}
                >
                  {remove.isPending ? 'Removing' : `Remove ${connection.label}`}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
                Remove
              </button>
            )
          ) : null}
        </div>
        {remove.isError ? <FormError error={remove.error} /> : null}
      </td>
    </tr>
  );
}

function ConnectDialog({ forge, onClose }: { forge: Forge; onClose: () => void }) {
  const connect = useConnectForge();
  const [mode, setMode] = useState<'pat' | 'github_app'>('pat');
  const [token, setToken] = useState('');
  const [installation, setInstallation] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [labelText, setLabelText] = useState(forge === 'github' ? 'GitHub' : 'GitLab');
  const name = forge === 'github' ? 'GitHub' : 'GitLab';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    connect.mutate(
      {
        forge,
        mode,
        token: mode === 'pat' ? token : undefined,
        installation_id: mode === 'github_app' ? installation.trim() : undefined,
        base_url: forge === 'gitlab' && baseUrl.trim() ? baseUrl.trim() : undefined,
        label: labelText.trim() || undefined,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title={`Connect ${name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="connect-forge"
            className="btn btn-primary"
            disabled={connect.isPending}
          >
            {connect.isPending ? 'Verifying token' : `Connect ${name}`}
          </button>
        </>
      }
    >
      <form id="connect-forge" className="stack" onSubmit={submit}>
        {forge === 'github' ? (
          <Field
            label="Method"
            htmlFor="forge-mode"
            hint="A GitHub App needs GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY on the server. Without them the server answers Not configured."
          >
            <select
              id="forge-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as 'pat' | 'github_app')}
            >
              <option value="pat">Personal access token</option>
              <option value="github_app">GitHub App installation</option>
            </select>
          </Field>
        ) : null}
        {mode === 'pat' ? (
          <Field
            label="Token"
            htmlFor="forge-token"
            hint={
              forge === 'github'
                ? 'Fine-grained token with read access to Contents, Metadata and Pull requests.'
                : 'Personal access token with the api scope.'
            }
          >
            <input
              id="forge-token"
              type="password"
              autoComplete="off"
              required
              minLength={8}
              maxLength={500}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
        ) : (
          <Field label="Installation id" htmlFor="forge-installation">
            <input
              id="forge-installation"
              type="text"
              className="mono"
              required
              value={installation}
              onChange={(event) => setInstallation(event.target.value)}
            />
          </Field>
        )}
        {forge === 'gitlab' ? (
          <Field
            label="GitLab URL"
            htmlFor="forge-url"
            hint="Leave empty for gitlab.com. A self-managed host must be in GITLAB_ALLOWED_HOSTS."
          >
            <input
              id="forge-url"
              type="url"
              placeholder="https://gitlab.example.com"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Label" htmlFor="forge-label" hint="Shown in this list. Must be unique.">
          <input
            id="forge-label"
            type="text"
            maxLength={80}
            value={labelText}
            onChange={(event) => setLabelText(event.target.value)}
          />
        </Field>
        <p className="small muted">
          The server checks the token against {name} before it saves anything.
        </p>
        <FormError error={connect.error} />
      </form>
    </Dialog>
  );
}

function RepoBrowser({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const page = useRemoteRepos(connection.id, cursor);

  return (
    <Dialog title={`Repositories in ${connection.label}`} onClose={onClose}>
      {page.isPending ? (
        <LoadingRows label="Loading repositories" />
      ) : page.isError ? (
        <ErrorState error={page.error} what="repositories" onRetry={() => page.refetch()} />
      ) : page.data.items.length === 0 ? (
        <EmptyState>This account can see no repositories with the token's permissions.</EmptyState>
      ) : (
        <ul className="lane-list panel">
          {page.data.items.map((repo) => (
            <RepoRow key={repo.remote_id} repo={repo} connection={connection} />
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={cursors.length < 2}
          onClick={() => setCursors((list) => list.slice(0, -1))}
        >
          Previous page
        </button>
        <button
          type="button"
          className="btn"
          disabled={!page.data?.next_cursor}
          onClick={() => {
            const next = page.data?.next_cursor;
            if (next) setCursors((list) => [...list, next]);
          }}
        >
          Next page
        </button>
      </div>
    </Dialog>
  );
}

function RepoRow({ repo, connection }: { repo: RemoteRepo; connection: Connection }) {
  const importProject = useImportProject();
  const navigate = useNavigate();
  const [analyzeOnly, setAnalyzeOnly] = useState(true);
  const checkId = `analyze-${repo.remote_id}`;
  const name = repo.full_name.split('/').pop() ?? repo.full_name;

  const run = () =>
    importProject.mutate(
      {
        name,
        slug: slugify(name) || 'project',
        description: repo.description ?? undefined,
        forge: connection.forge,
        connection_id: connection.id,
        remote_repository_id: repo.remote_id,
        full_name: repo.full_name,
        default_branch: repo.default_branch,
        runtime_preference: 'paseo',
        analyze_only: analyzeOnly,
      },
      {
        onSuccess: (project) =>
          navigate({ to: '/projects/$projectId', params: { projectId: project.id } }),
      },
    );

  return (
    <li className="task-row">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <a href={repo.web_url} target="_blank" rel="noreferrer" className="mono">
          {repo.full_name}
        </a>
        <span className="small muted">
          {repo.private ? 'Private' : 'Public'} · {repo.default_branch}
          {repo.language ? ` · ${repo.language}` : ''} · updated {timeAgo(repo.updated_at)}
        </span>
      </div>
      {repo.description ? <p className="small muted">{repo.description}</p> : null}
      <div className="row">
        <label htmlFor={checkId} className="row small">
          <input
            id={checkId}
            type="checkbox"
            checked={analyzeOnly}
            onChange={(e) => setAnalyzeOnly(e.target.checked)}
          />
          Read only, agents may not push
        </label>
        <button type="button" className="btn" onClick={run} disabled={importProject.isPending}>
          {importProject.isPending ? 'Importing' : `Import ${name}`}
        </button>
      </div>
      <FormError error={importProject.error} />
    </li>
  );
}
