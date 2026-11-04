import type { Forge } from '@quorumloop/contracts';

/**
 * Everything source-control-service needs from a Git host, expressed in Quorumloop terms rather
 * than vendor terms. Adapters translate; the rest of the service never sees a vendor payload.
 */
export interface ForgeRepository {
  remoteId: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  language: string | null;
  webUrl: string;
  updatedAt: Date | null;
}

export interface ForgeRepositoryPage {
  items: ForgeRepository[];
  nextCursor: string | null;
}

export interface ForgeBranch {
  name: string;
  sha: string;
  isProtected: boolean;
}

export interface ForgeCommit {
  sha: string;
  message: string;
  authorName: string;
  authoredAt: Date;
  url: string;
}

export type ForgeReviewState = 'open' | 'closed' | 'merged' | 'draft';
export type ForgeChecksStatus = 'pending' | 'success' | 'failure' | 'unknown';

export interface ForgeReview {
  remoteId: string;
  number: number;
  title: string;
  state: ForgeReviewState;
  author: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  checksStatus: ForgeChecksStatus;
  openedAt: Date;
  updatedAt: Date;
}

export interface ForgeIdentity {
  /** The account the credential belongs to, shown on the connection card. */
  login: string;
  scopes: string[];
  baseUrl: string;
}

export interface ForgePort {
  readonly forge: Forge;
  verify(): Promise<ForgeIdentity>;
  listRepositories(cursor: string | null, perPage: number): Promise<ForgeRepositoryPage>;
  getRepository(remoteId: string): Promise<ForgeRepository>;
  listBranches(remoteId: string, limit: number): Promise<ForgeBranch[]>;
  listCommits(remoteId: string, branch: string, limit: number): Promise<ForgeCommit[]>;
  listReviews(remoteId: string, limit: number): Promise<ForgeReview[]>;
}

/** Page size the adapters ask for; also the point where a "next cursor" becomes possible. */
export const FORGE_PAGE_SIZE = 50;
