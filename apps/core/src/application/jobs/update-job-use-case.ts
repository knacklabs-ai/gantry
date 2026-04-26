import type { Job, JobExecutionMode, JobStatus } from '../../domain/types.js';
import type { OpsRepository } from '../../domain/repositories/ops-repo.js';
import { ApplicationError } from '../common/application-error.js';
import type { Clock } from '../common/clock.js';
import { assertJobBelongsToApp } from './job-access.js';
import type { SchedulerCoordinationPort } from './scheduler-coordination-port.js';

export interface UpdateJobInput {
  appId: string;
  jobId: string;
  patch?: {
    name?: string;
    prompt?: string;
    executionMode?: JobExecutionMode;
    threadId?: string;
    status?: Extract<JobStatus, 'active' | 'paused'>;
  };
  resume?: boolean;
}

export class UpdateJobUseCase {
  constructor(
    private readonly deps: {
      ops: OpsRepository;
      scheduler: SchedulerCoordinationPort;
      clock: Clock;
    },
  ) {}

  async execute(input: UpdateJobInput): Promise<{ job: Job }> {
    const existing = await this.deps.ops.getJobById(input.jobId);
    if (!existing) throw new ApplicationError('NOT_FOUND', 'Job not found');
    assertJobBelongsToApp(existing, input.appId);

    const updates: Partial<Job> = {};
    if (input.patch) {
      if (typeof input.patch.name === 'string') updates.name = input.patch.name;
      if (typeof input.patch.prompt === 'string') {
        updates.prompt = input.patch.prompt;
      }
      if (input.patch.executionMode) {
        updates.execution_mode = input.patch.executionMode;
      }
      if (typeof input.patch.threadId === 'string') {
        updates.thread_id = input.patch.threadId;
      }
      if (input.patch.status) updates.status = input.patch.status;
    }

    if (input.resume) {
      updates.status = 'active';
      updates.pause_reason = null;
      updates.next_run =
        existing.schedule_type === 'manual'
          ? null
          : existing.schedule_type === 'once' && existing.schedule_value
            ? existing.schedule_value
            : this.deps.clock.now();
    }

    await this.deps.ops.updateJob(existing.id, updates);
    this.deps.scheduler.requestSchedulerSync(existing.id);
    const updated = await this.deps.ops.getJobById(existing.id);
    if (!updated) throw new ApplicationError('NOT_FOUND', 'Job not found');
    return { job: updated };
  }
}
