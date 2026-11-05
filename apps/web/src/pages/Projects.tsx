import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useCreateProject, useProjectFromIdea, useProjects } from '../api/queries';
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
import { PROJECT_STATUS_LABEL, projectTone } from '../lib/domain';
import { slugify, stamp, timeAgo } from '../lib/format';

type Open = 'create' | 'idea' | null;

export function ProjectsPage() {
  const projects = useProjects();
  const [open, setOpen] = useState<Open>(null);

  return (
    <div className="page">
      <PageHead
        title="Projects"
        sub="Every project in this organization, with its repository and task load."
        actions={
          <>
            <Link to="/connections" className="btn">
              Import repository
            </Link>
            <button type="button" className="btn" onClick={() => setOpen('idea')}>
              Start from idea
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setOpen('create')}>
              Create project
            </button>
          </>
        }
      />

      {projects.isPending ? (
        <LoadingRows label="Loading projects" />
      ) : projects.isError ? (
        <ErrorState error={projects.error} what="projects" onRetry={() => projects.refetch()} />
      ) : projects.data.length === 0 ? (
        <EmptyState
          action={
            <button type="button" className="btn btn-primary" onClick={() => setOpen('create')}>
              Create project
            </button>
          }
        >
          No projects yet. A project holds a task board and, once a repository is bound, its commits
          and reviews.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="ledger stack-mobile">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Repository</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Tasks
                </th>
                <th scope="col" className="num">
                  In progress
                </th>
                <th scope="col" className="num">
                  Blocked
                </th>
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {projects.data.map((project) => (
                <tr key={project.id}>
                  <td data-label="Project" className="primary-cell">
                    <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                      {project.name}
                    </Link>
                    <div className="mono muted small">{project.slug}</div>
                  </td>
                  <td data-label="Repository" className="mono">
                    {project.repository ? (
                      project.repository.full_name
                    ) : (
                      <span className="muted">Not connected</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <Status tone={projectTone(project.status)}>
                      {PROJECT_STATUS_LABEL[project.status]}
                    </Status>
                  </td>
                  <td data-label="Tasks" className="num">
                    {project.tasks_total}
                  </td>
                  <td data-label="In progress" className="num">
                    {project.tasks_in_progress}
                  </td>
                  <td data-label="Blocked" className="num">
                    {project.tasks_blocked}
                  </td>
                  <td data-label="Last activity">
                    <span title={stamp(project.last_activity_at)}>
                      {timeAgo(project.last_activity_at)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open === 'create' ? <CreateProjectDialog onClose={() => setOpen(null)} /> : null}
      {open === 'idea' ? <FromIdeaDialog onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const effectiveSlug = slugTouched ? slug : slugify(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        slug: effectiveSlug,
        description: description.trim() || undefined,
        forge: null,
        connection_id: null,
        remote_repository_id: null,
        default_branch: 'main',
        runtime_preference: 'paseo',
        analyze_only: true,
      },
      {
        onSuccess: (project) => {
          onClose();
          void navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
        },
      },
    );
  };

  return (
    <Dialog
      title="Create project"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-project"
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Creating' : 'Create project'}
          </button>
        </>
      }
    >
      <form id="create-project" className="stack" onSubmit={submit}>
        <p className="muted">
          The project starts without a repository. Bind one later by importing it from a forge
          connection.
        </p>
        <Field label="Name" htmlFor="project-name">
          <input
            id="project-name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label="Slug"
          htmlFor="project-slug"
          hint="Lowercase words joined by hyphens. Task references use it. If it is taken, the server picks a free variant."
        >
          <input
            id="project-slug"
            type="text"
            className="mono"
            required
            minLength={2}
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="project-description"
          hint="Optional, up to 2000 characters."
        >
          <textarea
            id="project-description"
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <FormError error={create.error} />
      </form>
    </Dialog>
  );
}

function FromIdeaDialog({ onClose }: { onClose: () => void }) {
  const create = useProjectFromIdea();
  const navigate = useNavigate();
  const [idea, setIdea] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [platform, setPlatform] = useState('');
  const [constraints, setConstraints] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        idea: idea.trim(),
        target_user: targetUser.trim() || undefined,
        platform: platform.trim() || undefined,
        constraints: constraints.trim() || undefined,
        runtime_preference: 'paseo',
      },
      {
        onSuccess: (project) => {
          onClose();
          void navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
        },
      },
    );
  };

  return (
    <Dialog
      title="Start from idea"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="from-idea"
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Recording idea' : 'Record idea'}
          </button>
        </>
      }
    >
      <form id="from-idea" className="stack" onSubmit={submit}>
        <p className="muted">
          The idea is stored as a project in the Idea state and its name is derived from the text.
          Planning agents that turn it into a backlog are not connected in this build.
        </p>
        <Field
          label="Idea"
          htmlFor="idea-text"
          hint="20 to 4000 characters. Say what it does and for whom."
        >
          <textarea
            id="idea-text"
            required
            minLength={20}
            maxLength={4000}
            rows={5}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
          />
        </Field>
        <Field label="Target user" htmlFor="idea-user" hint="Optional.">
          <input
            id="idea-user"
            type="text"
            maxLength={300}
            value={targetUser}
            onChange={(event) => setTargetUser(event.target.value)}
          />
        </Field>
        <Field
          label="Platform"
          htmlFor="idea-platform"
          hint="Optional, for example web or Android."
        >
          <input
            id="idea-platform"
            type="text"
            maxLength={200}
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          />
        </Field>
        <Field label="Constraints" htmlFor="idea-constraints" hint="Optional.">
          <textarea
            id="idea-constraints"
            maxLength={1000}
            value={constraints}
            onChange={(event) => setConstraints(event.target.value)}
          />
        </Field>
        <FormError error={create.error} />
      </form>
    </Dialog>
  );
}
