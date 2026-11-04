import { z } from 'zod';
import { DomainError } from '@quorumloop/contracts';
import { ForgeHttp } from './forge-http';
import {
  FORGE_PAGE_SIZE,
  type ForgeBranch,
  type ForgeChecksStatus,
  type ForgeCommit,
  type ForgeIdentity,
  type ForgePort,
  type ForgeRepository,
  type ForgeRepositoryPage,
  type ForgeReview,
  type ForgeReviewState,
} from './forge.port';

const projectPayloadSchema = z.object({
  id: z.number().int(),
  path_with_namespace: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string().nullable().optional(),
  default_branch: z.string().nullable().optional(),
  web_url: z.string(),
  last_activity_at: z.string().nullable().optional(),
});

const userSchema = z.object({ username: z.string() });

const languagesSchema = z.record(z.string(), z.number());

const branchSchema = z.array(
  z.object({
    name: z.string(),
    commit: z.object({ id: z.string() }),
    protected: z.boolean().optional(),
  }),
);

const commitSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    author_name: z.string().nullable().optional(),
    authored_date: z.string(),
    web_url: z.string(),
  }),
);

const mergeRequestSchema = z.array(
  z.object({
    id: z.number().int(),
    iid: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean().optional(),
    work_in_progress: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    web_url: z.string(),
    source_branch: z.string(),
    target_branch: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    author: z.object({ username: z.string() }).nullable().optional(),
    head_pipeline: z.object({ status: z.string().nullable().optional() }).nullable().optional(),
  }),
);

export interface GitlabAdapterOptions {
  /** Instance root without the API path, for example `https://gitlab.com`. */
  baseUrl: string;
  token: string;
  /** GitLab accepts project access tokens and OAuth tokens; both are sent as private-token. */
  tokenHeader?: 'private-token' | 'authorization';
}

const PIPELINE_STATUS: Record<string, ForgeChecksStatus> = {
  success: 'success',
  failed: 'failure',
  running: 'pending',
  pending: 'pending',
  created: 'pending',
  preparing: 'pending',
  waiting_for_resource: 'pending',
  scheduled: 'pending',
  manual: 'pending',
};

/**
 * GitLab REST v4 adapter. The project id is GitLab's numeric id so a renamed path does not break
 * a stored mirror.
 */
export class GitlabAdapter implements ForgePort {
  readonly forge = 'gitlab' as const;
  private readonly http: ForgeHttp;

  constructor(private readonly options: GitlabAdapterOptions) {
    this.http = new ForgeHttp({
      apiBase: `${options.baseUrl.replace(/\/+$/, '')}/api/v4`,
      token: options.token,
      authHeader: options.tokenHeader ?? 'private-token',
      accept: 'application/json',
      userAgent: 'quorumloop',
    });
  }

  async verify(): Promise<ForgeIdentity> {
    const response = await this.http.get('/user', userSchema);
    const scopes = (response.headers.get('x-oauth-scopes') ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
    return {
      login: response.data.username,
      scopes: scopes.length > 0 ? scopes : ['api'],
      baseUrl: this.options.baseUrl,
    };
  }

  async listRepositories(cursor: string | null, perPage: number): Promise<ForgeRepositoryPage> {
    const page = pageFromCursor(cursor);
    const size = Math.min(Math.max(perPage, 1), 100);
    const response = await this.http.get(
      `/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=${size}&page=${page}`,
      z.array(projectPayloadSchema),
    );
    return {
      items: response.data.map(toRepository),
      nextCursor: response.data.length >= size ? String(page) : null,
    };
  }

  async getRepository(remoteId: string): Promise<ForgeRepository> {
    const response = await this.http.get(
      `/projects/${encodeURIComponent(remoteId)}`,
      projectPayloadSchema,
    );
    return {
      ...toRepository(response.data),
      language: await this.primaryLanguage(remoteId),
    };
  }

  async listBranches(remoteId: string, limit: number): Promise<ForgeBranch[]> {
    const response = await this.http.get(
      `/projects/${encodeURIComponent(remoteId)}/repository/branches?per_page=${bounded(limit)}`,
      branchSchema,
    );
    return response.data.map((branch) => ({
      name: branch.name,
      sha: branch.commit.id,
      isProtected: branch.protected ?? false,
    }));
  }

  async listCommits(remoteId: string, branch: string, limit: number): Promise<ForgeCommit[]> {
    const response = await this.http.get(
      `/projects/${encodeURIComponent(remoteId)}/repository/commits?ref_name=${encodeURIComponent(
        branch,
      )}&per_page=${bounded(limit)}`,
      commitSchema,
    );
    return response.data.map((entry) => ({
      sha: entry.id,
      message: (entry.title ?? firstLine(entry.message ?? '')).slice(0, 500),
      authorName: entry.author_name ?? 'unknown',
      authoredAt: new Date(entry.authored_date),
      url: entry.web_url,
    }));
  }

  async listReviews(remoteId: string, limit: number): Promise<ForgeReview[]> {
    const response = await this.http.get(
      `/projects/${encodeURIComponent(remoteId)}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=${bounded(limit)}`,
      mergeRequestSchema,
    );
    return response.data.map((request) => ({
      remoteId: String(request.id),
      number: request.iid,
      title: request.title,
      state: reviewState(request),
      author: request.author?.username ?? 'unknown',
      url: request.web_url,
      sourceBranch: request.source_branch,
      targetBranch: request.target_branch,
      checksStatus: PIPELINE_STATUS[request.head_pipeline?.status ?? ''] ?? 'unknown',
      openedAt: new Date(request.created_at),
      updatedAt: new Date(request.updated_at),
    }));
  }

  /**
   * GitLab exposes languages as a separate endpoint keyed by percentage. The dominant one is the
   * repository's language; an unreachable endpoint yields null rather than a guess.
   */
  private async primaryLanguage(remoteId: string): Promise<string | null> {
    try {
      const response = await this.http.get(
        `/projects/${encodeURIComponent(remoteId)}/languages`,
        languagesSchema,
      );
      const entries = Object.entries(response.data);
      if (entries.length === 0) {
        return null;
      }
      return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }
}

const toRepository = (payload: z.infer<typeof projectPayloadSchema>): ForgeRepository => ({
  remoteId: String(payload.id),
  fullName: payload.path_with_namespace,
  description: payload.description ?? null,
  isPrivate: (payload.visibility ?? 'private') !== 'public',
  defaultBranch: payload.default_branch ?? 'main',
  language: null,
  webUrl: payload.web_url,
  updatedAt: payload.last_activity_at ? new Date(payload.last_activity_at) : null,
});

const reviewState = (request: z.infer<typeof mergeRequestSchema>[number]): ForgeReviewState => {
  if (request.merged_at) {
    return 'merged';
  }
  if (request.draft || request.work_in_progress) {
    return 'draft';
  }
  return request.state === 'opened' ? 'open' : 'closed';
};

export const pageFromCursor = (cursor: string | null): number => {
  if (!cursor) {
    return 1;
  }
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed + 1 : 1;
};

const bounded = (limit: number): number =>
  Math.min(Math.max(Math.trunc(limit), 1), FORGE_PAGE_SIZE);

const firstLine = (message: string): string => message.split('\n')[0]?.trim() ?? '';
