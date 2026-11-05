import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  ActivityFeed,
  Approval,
  Branch,
  CodeReview,
  Commit,
  Connection,
  ConnectForgeRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  DecideApprovalRequest,
  FromIdeaRequest,
  ImportProjectRequest,
  InstanceHealth,
  InstructionRequest,
  InstructionResponse,
  NotificationFeed,
  Overview,
  Policy,
  ProjectSummary,
  RemoteRepoPage,
  Session,
  SetupAdminRequest,
  SetupStatus,
  SyncResult,
  Task,
  TaskBoard,
  TaskHistoryEntry,
  TransitionTaskRequest,
  TransitionTaskResponse,
  UpdatePolicyRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from './types';
import { ApiError, api } from './client';

export const keys = {
  session: ['session'] as const,
  setup: ['setup-status'] as const,
  health: ['health'] as const,
  overview: ['overview'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  board: (id: string) => ['projects', id, 'board'] as const,
  activity: (id: string) => ['projects', id, 'activity'] as const,
  commits: (id: string) => ['projects', id, 'commits'] as const,
  branches: (id: string) => ['projects', id, 'branches'] as const,
  reviews: (id: string) => ['projects', id, 'reviews'] as const,
  task: (id: string) => ['tasks', id] as const,
  taskHistory: (id: string) => ['tasks', id, 'history'] as const,
  connections: ['connections'] as const,
  remoteRepos: (id: string, cursor: string | null) => ['connections', id, 'repos', cursor] as const,
  approvals: (status: string) => ['approvals', status] as const,
  notifications: ['notifications'] as const,
  policy: ['policy'] as const,
};

/** The session query resolves to `null` when nobody is signed in, never throws for a 401. */
export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api<Session>('/session');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useSetupStatus() {
  return useQuery({
    queryKey: keys.setup,
    queryFn: () => api<SetupStatus>('/setup/status'),
    staleTime: 30_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: () => api<InstanceHealth>('/health'),
    refetchInterval: 60_000,
  });
}

export function useOverview() {
  return useQuery({ queryKey: keys.overview, queryFn: () => api<Overview>('/overview') });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => api<ProjectSummary[]>('/projects'),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: () => api<ProjectSummary>(`/projects/${id}`),
  });
}

export function useBoard(projectId: string) {
  return useQuery({
    queryKey: keys.board(projectId),
    queryFn: () => api<TaskBoard>(`/projects/${projectId}/tasks`),
  });
}

export function useCommits(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.commits(projectId),
    queryFn: () => api<Commit[]>(`/projects/${projectId}/commits`),
    enabled,
  });
}

export function useBranches(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.branches(projectId),
    queryFn: () => api<Branch[]>(`/projects/${projectId}/branches`),
    enabled,
  });
}

export function useReviews(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.reviews(projectId),
    queryFn: () => api<CodeReview[]>(`/projects/${projectId}/reviews`),
    enabled,
  });
}

export function fetchActivity(projectId: string, cursor: string | null) {
  const query = new URLSearchParams({ limit: '30' });
  if (cursor) query.set('cursor', cursor);
  return api<ActivityFeed>(`/projects/${projectId}/activity?${query.toString()}`);
}

export function useTask(id: string) {
  return useQuery({ queryKey: keys.task(id), queryFn: () => api<Task>(`/tasks/${id}`) });
}

export function useTaskHistory(id: string) {
  return useQuery({
    queryKey: keys.taskHistory(id),
    queryFn: () => api<TaskHistoryEntry[]>(`/tasks/${id}/history`),
  });
}

export function useConnections() {
  return useQuery({
    queryKey: keys.connections,
    queryFn: () => api<Connection[]>('/forge/connections'),
  });
}

export function useRemoteRepos(connectionId: string, cursor: string | null) {
  return useQuery({
    queryKey: keys.remoteRepos(connectionId, cursor),
    queryFn: () => {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      return api<RemoteRepoPage>(`/forge/connections/${connectionId}/repositories${query}`);
    },
  });
}

export function useApprovals(status: string) {
  return useQuery({
    queryKey: keys.approvals(status),
    queryFn: () => api<Approval[]>(`/approvals?status=${encodeURIComponent(status)}`),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api<NotificationFeed>('/notifications'),
    refetchInterval: 60_000,
  });
}

export function usePolicy() {
  return useQuery({ queryKey: keys.policy, queryFn: () => api<Policy>('/settings/policies') });
}

/* ---------------- mutations ---------------- */

function useInvalidate() {
  const client = useQueryClient();
  return (...queryKeys: QueryKey[]) =>
    Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<Session>('/auth/login', { method: 'POST', body }),
    onSuccess: (session) => client.setQueryData(keys.session, session),
  });
}

export function useSetupAdmin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SetupAdminRequest) => api<Session>('/setup/admin', { method: 'POST', body }),
    onSuccess: async (session) => {
      client.setQueryData(keys.session, session);
      await client.invalidateQueries({ queryKey: keys.setup });
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      client.setQueryData(keys.session, null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    },
  });
}

export function useCreateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateProjectRequest) =>
      api<ProjectSummary>('/projects', { method: 'POST', body }),
    onSuccess: () => invalidate(keys.projects, keys.overview),
  });
}

export function useProjectFromIdea() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: FromIdeaRequest) =>
      api<ProjectSummary>('/projects/from-idea', { method: 'POST', body }),
    onSuccess: () => invalidate(keys.projects, keys.overview),
  });
}

export function useImportProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: ImportProjectRequest) =>
      api<ProjectSummary>('/projects/import', { method: 'POST', body }),
    onSuccess: () => invalidate(keys.projects, keys.overview),
  });
}

export function useUpdateProject(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateProjectRequest) =>
      api<ProjectSummary>(`/projects/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(keys.project(id), keys.projects, keys.overview),
  });
}

export function useArchiveProject(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(keys.projects, keys.overview),
  });
}

export function useSyncProject(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api<SyncResult>(`/projects/${id}/sync`, { method: 'POST' }),
    onSuccess: () =>
      invalidate(keys.project(id), keys.commits(id), keys.branches(id), keys.reviews(id)),
  });
}

export function useSendInstruction(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: InstructionRequest) =>
      api<InstructionResponse>(`/projects/${projectId}/instructions`, { method: 'POST', body }),
    onSuccess: () => invalidate(keys.board(projectId), keys.activity(projectId)),
  });
}

export function useCreateTask(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateTaskRequest) =>
      api<Task>(`/projects/${projectId}/tasks`, { method: 'POST', body }),
    onSuccess: () => invalidate(keys.board(projectId), keys.project(projectId), keys.overview),
  });
}

export function useUpdateTask(taskId: string, projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateTaskRequest) =>
      api<Task>(`/tasks/${taskId}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(keys.task(taskId), keys.board(projectId)),
  });
}

export function useTransitionTask(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ taskId, ...body }: TransitionTaskRequest & { taskId: string }) =>
      api<TransitionTaskResponse>(`/tasks/${taskId}/transition`, { method: 'POST', body }),
    onSuccess: (_result, variables) =>
      invalidate(
        keys.board(projectId),
        keys.task(variables.taskId),
        keys.taskHistory(variables.taskId),
        keys.project(projectId),
        keys.overview,
      ),
  });
}

export function useConnectForge() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ forge, ...body }: ConnectForgeRequest & { forge: 'github' | 'gitlab' }) =>
      api<Connection>(`/forge/${forge}/connect`, { method: 'POST', body }),
    onSuccess: () => invalidate(keys.connections),
  });
}

export function useRemoveConnection() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/forge/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(keys.connections),
  });
}

export function useDecideApproval() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: DecideApprovalRequest & { id: string }) =>
      api<Approval>(`/approvals/${id}/decision`, { method: 'POST', body }),
    onSuccess: () => invalidate(['approvals'], keys.notifications),
  });
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => invalidate(keys.notifications),
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api<void>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => invalidate(keys.notifications),
  });
}

export function useUpdatePolicy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePolicyRequest) =>
      api<Policy>('/settings/policies', { method: 'PUT', body }),
    onSuccess: (policy) => client.setQueryData(keys.policy, policy),
  });
}
