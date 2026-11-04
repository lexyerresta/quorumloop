import { ServiceClient, type CallerIdentity } from '@quorumloop/platform';
import { projectSummarySchema, type ProjectSummary } from '@quorumloop/contracts';
import { Injectable } from '@nestjs/common';

/**
 * Read-only view of project-service. A task needs its project's slug for the board reference and
 * needs to know the project still exists before it writes a task against it.
 */
@Injectable()
export class ProjectDirectory {
  private readonly client = new ServiceClient({ caller: 'task-service' });

  async get(identity: CallerIdentity, projectId: string): Promise<ProjectSummary> {
    return this.client.request<ProjectSummary>(
      {
        target: 'project-service',
        method: 'GET',
        path: `/v1/projects/${encodeURIComponent(projectId)}`,
        identity,
      },
      projectSummarySchema,
    );
  }
}
