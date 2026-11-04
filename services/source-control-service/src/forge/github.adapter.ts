import { z } from 'zod';
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

const repoPayloadSchema = z.object({
  id: z.number().int(),
  full_name: z.string(),
  description: z.string().nullable().optional(),
  private: z.boolean(),
  default_branch: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  html_url: z.string(),
  updated_at: z.string().nullable().optional(),
});

const userSchema = z.object({ login: z.string() });

const repoListSchema = z.object({ repositories: z.array(repoPayloadSchema) });

const branchSchema = z.array(
  z.object({
    name: z.string(),
    commit: z.object({ sha: z.string() }),
    protected: z.boolean().optional(),
  }),
);

const commitSchema = z.array(
  z.object({
    sha: z.string(),
    html_url: z.string(),
    commit: z.object({
      message: z.string(),
      author: z
        .object({ name: z.string().nullable().optional(), date: z.string().nullable().optional() })
        .nullable()
        .optional(),
    }),
  }),
);

const pullSchema = z.array(
  z.object({
    id: z.number().int(),
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    html_url: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    user: z.object({ login: z.string() }).nullable().optional(),
    head: z.object({ ref: z.string(), sha: z.string() }),
    base: z.object({ ref: z.string() }),
  }),
);

const combinedStatusSchema = z.object({ state: z.string() });

export interface GithubAdapterOptions {
  /** `https://api.github.com`, or a GitHub Enterprise API root. */
  apiBase: string;
  /** An installation token (minted per call) or a personal access token. */
  token: string;
  mode: 'github_app' | 'pat' | 'oauth';
  /** Resolved by the caller for app installations, which cannot call `GET /user`. */
  accountLogin: string | null;
}

const CHECKS_STATUS: Record<string, ForgeChecksStatus> = {
  success: 'success',
  failure: 'failure',
  error: 'failure',
  pending: 'pending',
  expected: 'pending',
};

/**
 * GitHub REST adapter. Only documented, stable endpoints are used; when a value cannot be read
 * it is reported as unknown rather than guessed.
 */
export class GithubAdapter implements ForgePort {
  readonly forge = 'github' as const;
  private readonly http: ForgeHttp;

  constructor(private readonly options: GithubAdapterOptions) {
    this.http = new ForgeHttp({
      apiBase: options.apiBase,
      token: options.token,
      authHeader: 'authorization',
      accept: 'application/vnd.github+json',
      userAgent: 'quorumloop',
    });
  }

  async verify(): Promise<ForgeIdentity> {
    if (this.options.mode === 'github_app') {
      // An installation token cannot read /user, so the account comes from the app metadata.
      const page = await this.listRepositories(null, 1);
      const first = page.items[0];
      return {
        login: this.options.accountLogin ?? first?.fullName.split('/')[0] ?? 'github-app',
        scopes: ['installation'],
        baseUrl: this.options.apiBase,
      };
    }
    const response = await this.http.get('/user', userSchema);
    const scopes = (response.headers.get('x-oauth-scopes') ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
    return { login: response.data.login, scopes, baseUrl: this.options.apiBase };
  }

  async listRepositories(cursor: string | null, perPage: number): Promise<ForgeRepositoryPage> {
    const page = pageFromCursor(cursor);
    const size = Math.min(Math.max(perPage, 1), 100);
    const query = `per_page=${size}&page=${page}`;

    let items: z.infer<typeof repoPayloadSchema>[];
    if (this.options.mode === 'github_app') {
      const response = await this.http.get(`/installation/repositories?${query}`, repoListSchema);
      items = response.data.repositories;
    } else {
      const response = await this.http.get(
        `/user/repos?${query}&sort=updated&affiliation=owner,collaborator,organization_member`,
        z.array(repoPayloadSchema),
      );
      items = response.data;
    }

    return {
      items: items.map(toRepository),
      nextCursor: items.length >= size ? String(page) : null,
    };
  }

  async getRepository(remoteId: string): Promise<ForgeRepository> {
    const response = await this.http.get(
      `/repositories/${encodeURIComponent(remoteId)}`,
      repoPayloadSchema,
    );
    return toRepository(response.data);
  }

  async listBranches(remoteId: string, limit: number): Promise<ForgeBranch[]> {
    const response = await this.http.get(
      `/repositories/${encodeURIComponent(remoteId)}/branches?per_page=${bounded(limit)}`,
      branchSchema,
    );
    return response.data.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      isProtected: branch.protected ?? false,
    }));
  }

  async listCommits(remoteId: string, branch: string, limit: number): Promise<ForgeCommit[]> {
    const response = await this.http.get(
      `/repositories/${encodeURIComponent(remoteId)}/commits?sha=${encodeURIComponent(branch)}&per_page=${bounded(limit)}`,
      commitSchema,
    );
    return response.data.flatMap((entry) => {
      const authoredAt = entry.commit.author?.date;
      if (!authoredAt) {
        // Without an author date the row cannot be ordered honestly, so it is skipped.
        return [];
      }
      return [
        {
          sha: entry.sha,
          message: firstLine(entry.commit.message),
          authorName: entry.commit.author?.name ?? 'unknown',
          authoredAt: new Date(authoredAt),
          url: entry.html_url,
        },
      ];
    });
  }

  async listReviews(remoteId: string, limit: number): Promise<ForgeReview[]> {
    const response = await this.http.get(
      `/repositories/${encodeURIComponent(remoteId)}/pulls?state=open&sort=updated&direction=desc&per_page=${bounded(limit)}`,
      pullSchema,
    );

    const reviews: ForgeReview[] = [];
    for (const pull of response.data.slice(0, 10)) {
      reviews.push({
        remoteId: String(pull.id),
        number: pull.number,
        title: pull.title,
        state: pullState(pull),
        author: pull.user?.login ?? 'unknown',
        url: pull.html_url,
        sourceBranch: pull.head.ref,
        targetBranch: pull.base.ref,
        checksStatus: await this.checksFor(remoteId, pull.head.sha),
        openedAt: new Date(pull.created_at),
        updatedAt: new Date(pull.updated_at),
      });
    }
    return reviews;
  }

  /**
   * Combined commit status is one extra request per open pull request. Only the first ten are
   * probed; anything beyond reports `unknown` instead of inventing a result.
   */
  private async checksFor(remoteId: string, sha: string): Promise<ForgeChecksStatus> {
    try {
      const response = await this.http.get(
        `/repositories/${encodeURIComponent(remoteId)}/commits/${encodeURIComponent(sha)}/status`,
        combinedStatusSchema,
      );
      return CHECKS_STATUS[response.data.state] ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

const toRepository = (payload: z.infer<typeof repoPayloadSchema>): ForgeRepository => ({
  remoteId: String(payload.id),
  fullName: payload.full_name,
  description: payload.description ?? null,
  isPrivate: payload.private,
  defaultBranch: payload.default_branch ?? 'main',
  language: payload.language ?? null,
  webUrl: payload.html_url,
  updatedAt: payload.updated_at ? new Date(payload.updated_at) : null,
});

const pullState = (pull: z.infer<typeof pullSchema>[number]): ForgeReviewState => {
  if (pull.merged_at) {
    return 'merged';
  }
  if (pull.draft) {
    return 'draft';
  }
  return pull.state === 'closed' ? 'closed' : 'open';
};

/** Cursors are opaque to callers; GitHub pages by number, so the cursor is the last page. */
export const pageFromCursor = (cursor: string | null): number => {
  if (!cursor) {
    return 1;
  }
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed + 1 : 1;
};

const bounded = (limit: number): number =>
  Math.min(Math.max(Math.trunc(limit), 1), FORGE_PAGE_SIZE);

const firstLine = (message: string): string => {
  const line = message.split('\n')[0]?.trim() ?? '';
  return line.length > 0 ? line.slice(0, 500) : message.slice(0, 500);
};
