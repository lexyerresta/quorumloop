import {
  EVENT_TYPES,
  DomainError,
  type CreateTaskRequest,
  type InstructionRequest,
  type InstructionResponse,
  type Task,
  type TaskBoard,
  type TaskHistoryEntry,
  type TaskStatus,
  type TaskSummary,
  type TransitionTaskRequest,
  type TransitionTaskResponse,
  type UpdateTaskRequest,
} from '@quorumloop/contracts';
import {
  EVENT_PUBLISHER,
  SERVICE_LOGGER,
  uuidv7,
  type CallerIdentity,
  type TransactionalPublisher,
} from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable } from '@nestjs/common';
import {
  tasks,
  type AcceptanceCriterionRow,
  type TaskDependencyRow,
  type TaskRow,
} from '../database/schema';
import { ProjectDirectory } from './project-directory';
import {
  compareForBoard,
  deriveInstructionTitle,
  evaluateTransition,
  formatReference,
  nextPosition,
  summariseInstruction,
} from './task.rules';
import { TaskRepository, type BoardData } from './task.repository';

export interface RequestContext {
  identity: CallerIdentity;
  actor: string;
}

/**
 * Task lifecycle. Two invariants are enforced here rather than in the UI: a task cannot start
 * while a prerequisite is unfinished, and a task cannot reach Done without the quality gate and
 * verified acceptance criteria. Both refusals are returned as a verdict with a reason, not as an
 * error, so the board can explain itself.
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: ProjectDirectory,
    @Inject(EVENT_PUBLISHER) private readonly events: TransactionalPublisher,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async board(context: RequestContext, projectId: string): Promise<TaskBoard> {
    await this.projects.get(context.identity, projectId);
    const data = await this.repository.board(context.identity.orgId ?? '', projectId);
    return toBoard(projectId, data);
  }

  async get(context: RequestContext, taskId: string): Promise<Task> {
    const data = await this.load(context, taskId);
    const dependencies = await this.repository.dependenciesWithStatus(taskId);
    return toTask(
      data.task,
      data.dependencies,
      data.criteria,
      dependencies
        .filter((dependency) => !isResolved(dependency.status))
        .map((dependency) => dependency.id),
    );
  }

  async create(
    context: RequestContext,
    projectId: string,
    input: CreateTaskRequest,
  ): Promise<Task> {
    const project = await this.projects.get(context.identity, projectId);
    const orgId = context.identity.orgId ?? '';

    const duplicate = await this.repository.findSimilar(projectId, input.title);
    if (duplicate) {
      throw new DomainError(
        'CONFLICT',
        `a task with this title already exists (${duplicate.reference})`,
      );
    }

    const sequence = await this.repository.nextReference(orgId, projectId);
    const positions = await this.repository.positionsInColumn(projectId, 'backlog');
    const taskId = uuidv7();

    const created = await this.repository.insertTask({
      id: taskId,
      orgId,
      projectId,
      reference: formatReference(project.slug, sequence),
      title: input.title,
      description: input.description ?? null,
      status: 'backlog',
      priority: input.priority,
      role: input.role,
      position: nextPosition(positions),
      createdBy: context.actor,
    });

    await this.repository.insertCriteria(
      input.acceptance_criteria.map((text, index) => ({
        id: uuidv7(),
        taskId,
        text,
        position: index,
      })),
    );

    for (const dependencyId of input.priority_dependency_ids) {
      if (dependencyId === taskId) {
        continue;
      }
      await this.repository.insertDependency(taskId, dependencyId);
    }

    await this.repository.appendHistory({
      id: uuidv7(),
      taskId,
      fromStatus: null,
      toStatus: 'backlog',
      actor: context.actor,
      reason: null,
    });

    await this.events.publish(
      EVENT_TYPES.taskCreated,
      {
        task_id: created.id,
        project_id: projectId,
        title: created.title,
        status: created.status,
        priority: created.priority,
        source: 'user',
      },
      { orgId, projectId, aggregateId: created.id, actor: context.actor },
    );

    this.logger.info({ taskId: created.id, reference: created.reference }, 'task created');
    return this.get(context, created.id);
  }

  /**
   * A direct instruction from the composer. It creates a real card on the board (or attaches to
   * the task it revises) and records the instruction as a durable event. Dispatching it to an
   * agent needs an execution runtime, which this deployment does not have yet, so the response
   * says `not_configured` with the reason instead of claiming work was queued.
   */
  async instruct(
    context: RequestContext,
    projectId: string,
    input: InstructionRequest,
  ): Promise<InstructionResponse> {
    const userId = context.identity.userId;
    if (!userId) {
      throw new DomainError('FORBIDDEN', 'an instruction must be authored by a user');
    }

    await this.projects.get(context.identity, projectId);
    const orgId = context.identity.orgId ?? '';

    let taskId: string;
    if (input.target_task_id) {
      const target = await this.repository.findTask(orgId, input.target_task_id);
      if (!target || target.projectId !== projectId) {
        throw new DomainError(
          'NOT_FOUND',
          'the task this instruction revises is not in this project',
        );
      }
      taskId = target.id;
    } else {
      const created = await this.create(context, projectId, {
        title: deriveInstructionTitle(input.prompt),
        description: input.prompt,
        priority: input.priority,
        role: input.role,
        priority_dependency_ids: [],
        acceptance_criteria: [],
        auto_assign: false,
      });
      taskId = created.id;
    }

    const instructionId = uuidv7();
    await this.events.publish(
      EVENT_TYPES.instructionReceived,
      {
        instruction_id: instructionId,
        project_id: projectId,
        task_id: taskId,
        author_id: userId,
        summary: summariseInstruction(input.prompt),
      },
      { orgId, projectId, aggregateId: taskId, actor: context.actor },
    );

    const task = await this.get(context, taskId);
    this.logger.info(
      { taskId, instructionId, revises: input.target_task_id },
      'instruction received',
    );

    return {
      instruction_id: instructionId,
      task_id: taskId,
      queued_at: new Date().toISOString(),
      status: task.status,
      dispatch: {
        engine_id: null,
        runtime_id: null,
        decision: 'not_configured',
        reason:
          'no execution runtime is connected in this deployment; the task is on the board and will be dispatched once orchestration-service and a provider adapter are configured',
      },
    };
  }

  async update(context: RequestContext, taskId: string, input: UpdateTaskRequest): Promise<Task> {
    const existing = await this.repository.findTask(context.identity.orgId ?? '', taskId);
    if (!existing) {
      throw new DomainError('NOT_FOUND', 'task not found');
    }
    const patch: Partial<typeof tasks.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.role !== undefined) patch.role = input.role;

    if (Object.keys(patch).length > 0) {
      const updated = await this.repository.updateTask(context.identity.orgId ?? '', taskId, patch);
      if (!updated) {
        throw new DomainError('NOT_FOUND', 'task not found');
      }
    }
    return this.get(context, taskId);
  }

  async transition(
    context: RequestContext,
    taskId: string,
    input: TransitionTaskRequest,
    options: { qualityGateRequired: boolean },
  ): Promise<TransitionTaskResponse> {
    const data = await this.load(context, taskId);
    const projectId = data.task.projectId;

    const dependencies = await this.repository.dependenciesWithStatus(taskId);
    const blocking = dependencies
      .filter((dependency) => dependency.status !== 'done' && dependency.status !== 'canceled')
      .map((dependency) => dependency.reference);

    const verdict = evaluateTransition({
      task: {
        status: data.task.status as TaskStatus,
        quality_state: data.task.qualityState,
        acceptance_criteria: data.criteria.map((criterion) => ({ verified: criterion.verified })),
      },
      target: input.to_status,
      blockingDependencies: blocking,
      inProgressCount: await this.repository.countInProgress(projectId, taskId),
      wipLimit: data.board.wipLimit,
      qualityGateRequired: options.qualityGateRequired,
    });

    if (!verdict.allowed) {
      this.logger.info(
        { taskId, target: input.to_status, reason: verdict.reason },
        'task transition refused',
      );
      return {
        task: toTask(
          data.task,
          data.dependencies,
          data.criteria,
          dependencies
            .filter((dependency) => !isResolved(dependency.status))
            .map((dependency) => dependency.id),
        ),
        changed: false,
        blocked_reason: verdict.reason,
        evidence_refs: verdict.evidenceRefs,
      };
    }

    const patch: Partial<typeof tasks.$inferInsert> = {
      status: input.to_status,
      completedAt: input.to_status === 'done' ? new Date() : null,
    };
    if (input.to_status === 'in_progress') {
      const positions = await this.repository.positionsInColumn(projectId, 'in_progress');
      patch.position = nextPosition(positions);
    }

    const updated = await this.repository.updateTask(context.identity.orgId ?? '', taskId, patch);
    if (!updated) {
      throw new DomainError('NOT_FOUND', 'task not found');
    }

    await this.repository.appendHistory({
      id: uuidv7(),
      taskId,
      fromStatus: data.task.status,
      toStatus: input.to_status,
      actor: context.actor,
      reason: input.reason ?? null,
    });

    if (input.to_status === 'ready') {
      await this.events.publish(
        EVENT_TYPES.taskReady,
        {
          task_id: taskId,
          project_id: projectId,
          title: updated.title,
          priority: updated.priority,
          required_capabilities: [updated.role],
          dependency_ids: data.dependencies.map((dependency) => dependency.dependsOnTaskId),
        },
        { orgId: updated.orgId, projectId, aggregateId: taskId, actor: context.actor },
      );
    }

    if (input.to_status === 'done') {
      await this.events.publish(
        EVENT_TYPES.taskCompleted,
        {
          task_id: taskId,
          project_id: projectId,
          completed_at: new Date().toISOString(),
          evidence_refs: data.criteria
            .map((criterion) => criterion.evidenceRef)
            .filter((ref): ref is string => Boolean(ref)),
        },
        { orgId: updated.orgId, projectId, aggregateId: taskId, actor: context.actor },
      );
    }

    this.logger.info({ taskId, to: input.to_status }, 'task transitioned');
    const fresh = await this.load(context, taskId);
    const freshDependencies = await this.repository.dependenciesWithStatus(taskId);
    return {
      task: toTask(
        fresh.task,
        fresh.dependencies,
        fresh.criteria,
        freshDependencies
          .filter((dependency) => !isResolved(dependency.status))
          .map((dependency) => dependency.id),
      ),
      changed: true,
      blocked_reason: null,
      evidence_refs: [],
    };
  }

  async history(context: RequestContext, taskId: string): Promise<TaskHistoryEntry[]> {
    await this.load(context, taskId);
    const rows = await this.repository.history(taskId);
    return rows.map((row) => ({
      id: row.id,
      task_id: row.taskId,
      from_status: row.fromStatus as TaskStatus | null,
      to_status: row.toStatus as TaskStatus,
      actor: row.actor,
      reason: row.reason,
      occurred_at: row.occurredAt.toISOString(),
    }));
  }

  async setCriterion(
    context: RequestContext,
    taskId: string,
    criterionId: string,
    verified: boolean,
    evidenceRef: string | null,
  ): Promise<Task> {
    await this.load(context, taskId);
    const updated = await this.repository.setCriterionVerified(
      taskId,
      criterionId,
      verified,
      evidenceRef,
    );
    if (!updated) {
      throw new DomainError('NOT_FOUND', 'acceptance criterion not found');
    }
    return this.get(context, taskId);
  }

  /**
   * Quality results arrive from quality-service. Recording the state here is what makes the Done
   * gate real: the board reads this column, not the report itself.
   */
  async recordQualityState(
    orgId: string,
    taskId: string,
    state: 'not_run' | 'running' | 'passed' | 'failed' | 'inconclusive',
    evidenceRefs: string[],
  ): Promise<void> {
    const task = await this.repository.findTask(orgId, taskId);
    if (!task) {
      this.logger.warn({ taskId }, 'quality state for unknown task ignored');
      return;
    }
    await this.repository.updateTask(orgId, taskId, { qualityState: state });
    if (evidenceRefs.length > 0 && state === 'passed') {
      const criteria = await this.repository.criteriaFor(taskId);
      for (const criterion of criteria) {
        if (!criterion.verified) {
          await this.repository.setCriterionVerified(
            taskId,
            criterion.id,
            true,
            evidenceRefs[0] ?? null,
          );
        }
      }
    }
  }

  async summary(orgId: string): Promise<TaskSummary> {
    const counts = await this.repository.countOrgTasks(orgId);
    return {
      in_progress: counts['in_progress'] ?? 0,
      blocked: counts['blocked'] ?? 0,
      done: counts['done'] ?? 0,
      by_status: counts,
    };
  }

  async setWipLimit(context: RequestContext, projectId: string, wipLimit: number): Promise<number> {
    await this.projects.get(context.identity, projectId);
    const board = await this.repository.setWipLimit(projectId, wipLimit);
    return board.wipLimit;
  }

  private async load(
    context: RequestContext,
    taskId: string,
  ): Promise<{
    task: TaskRow;
    board: { wipLimit: number };
    dependencies: TaskDependencyRow[];
    criteria: AcceptanceCriterionRow[];
  }> {
    const orgId = context.identity.orgId ?? '';
    const task = await this.repository.findTask(orgId, taskId);
    if (!task) {
      throw new DomainError('NOT_FOUND', 'task not found');
    }
    const [board, dependencies, criteria] = await Promise.all([
      this.repository.ensureBoard(orgId, task.projectId),
      this.repository.dependenciesOf(taskId),
      this.repository.criteriaFor(taskId),
    ]);
    return { task, board, dependencies, criteria };
  }
}

const toBoard = (projectId: string, data: BoardData): TaskBoard => {
  const dependencyMap = groupBy(
    data.dependencies,
    (row) => row.taskId,
    (row) => row,
  );
  const criteriaMap = groupBy(
    data.criteria,
    (row) => row.taskId,
    (row) => row,
  );
  const statusById = new Map(data.tasks.map((task) => [task.id, task.status]));
  const counts: Record<string, number> = {};

  const ordered = [...data.tasks].sort((a, b) =>
    compareForBoard(
      { priority: a.priority, position: a.position, createdAt: a.createdAt },
      { priority: b.priority, position: b.position, createdAt: b.createdAt },
    ),
  );

  for (const task of ordered) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }

  return {
    project_id: projectId,
    tasks: ordered.map((task) => {
      const dependencies = dependencyMap.get(task.id) ?? [];
      return toTask(
        task,
        dependencies,
        criteriaMap.get(task.id) ?? [],
        dependencies
          .map((dependency) => dependency.dependsOnTaskId)
          .filter((id) => !isResolved(statusById.get(id))),
      );
    }),
    counts_by_status: counts,
    wip_limit: data.board.wipLimit,
  };
};

const groupBy = <T, K, V>(
  rows: readonly T[],
  key: (row: T) => K,
  value: (row: T) => V,
): Map<K, V[]> => {
  const map = new Map<K, V[]>();
  for (const row of rows) {
    const bucket = map.get(key(row));
    if (bucket) {
      bucket.push(value(row));
    } else {
      map.set(key(row), [value(row)]);
    }
  }
  return map;
};

const toTask = (
  row: TaskRow,
  dependencies: readonly TaskDependencyRow[],
  criteria: readonly AcceptanceCriterionRow[],
  blockedBy: readonly string[],
): Task => ({
  id: row.id,
  project_id: row.projectId,
  reference: row.reference,
  title: row.title,
  description: row.description,
  status: row.status as TaskStatus,
  priority: row.priority as Task['priority'],
  role: row.role as Task['role'],
  agent_session_id: row.agentSessionId,
  quality_state: row.qualityState as Task['quality_state'],
  dependencies: dedupe(dependencies.map((dependency) => dependency.dependsOnTaskId)),
  blocked_by: dedupe(blockedBy),
  acceptance_criteria: criteria.map((criterion) => ({
    id: criterion.id,
    text: criterion.text,
    verified: criterion.verified,
    evidence_ref: criterion.evidenceRef,
  })),
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

const isResolved = (status: string | undefined): boolean =>
  status === 'done' || status === 'canceled';

const dedupe = (values: readonly string[]): string[] => [...new Set(values)];
