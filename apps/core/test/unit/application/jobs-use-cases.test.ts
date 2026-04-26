import { describe, expect, it, vi } from 'vitest';

import { PauseJobUseCase } from '@core/application/jobs/pause-job-use-case.js';
import { UpdateJobUseCase } from '@core/application/jobs/update-job-use-case.js';
import type { OpsRepository } from '@core/domain/repositories/ops-repo.js';
import type { Job } from '@core/domain/types.js';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    name: 'Job',
    prompt: 'Run',
    model: null,
    script: null,
    schedule_type: 'manual',
    schedule_value: 'manual',
    status: 'active',
    linked_sessions: ['app:app-one:conv-1'],
    session_id: null,
    thread_id: null,
    group_scope: 'app-folder',
    created_by: 'human',
    created_at: '2026-04-24T00:00:00.000Z',
    updated_at: '2026-04-24T00:00:00.000Z',
    next_run: null,
    last_run: null,
    silent: false,
    cleanup_after_ms: 0,
    timeout_ms: 300000,
    max_retries: 0,
    retry_backoff_ms: 0,
    max_consecutive_failures: 3,
    consecutive_failures: 0,
    execution_mode: 'parallel',
    lease_run_id: null,
    lease_expires_at: null,
    pause_reason: null,
    ...overrides,
  };
}

function makeOps(
  job: Job | undefined,
): Pick<OpsRepository, 'getJobById' | 'updateJob'> {
  let current = job;
  return {
    getJobById: vi.fn(async () => current),
    updateJob: vi.fn(async (_id, updates) => {
      if (current) current = { ...current, ...updates };
    }),
  };
}

describe('job application use cases', () => {
  it('updates mutable job fields and requests scheduler sync', async () => {
    const ops = makeOps(makeJob());
    const scheduler = { requestSchedulerSync: vi.fn() };
    const useCase = new UpdateJobUseCase({
      ops: ops as OpsRepository,
      scheduler,
      clock: { now: () => '2026-04-24T01:00:00.000Z' },
    });

    const result = await useCase.execute({
      appId: 'app-one',
      jobId: 'job-1',
      patch: {
        name: 'Updated',
        prompt: 'New prompt',
        executionMode: 'serialized',
        threadId: 'thread-1',
        status: 'paused',
      },
    });

    expect(result.job).toMatchObject({
      name: 'Updated',
      prompt: 'New prompt',
      execution_mode: 'serialized',
      thread_id: 'thread-1',
      status: 'paused',
    });
    expect(ops.updateJob).toHaveBeenCalledWith('job-1', {
      name: 'Updated',
      prompt: 'New prompt',
      execution_mode: 'serialized',
      thread_id: 'thread-1',
      status: 'paused',
    });
    expect(scheduler.requestSchedulerSync).toHaveBeenCalledWith('job-1');
  });

  it('computes resume next_run in the application layer', async () => {
    const ops = makeOps(
      makeJob({
        schedule_type: 'cron',
        schedule_value: '0 * * * *',
        status: 'paused',
        next_run: null,
      }),
    );
    const scheduler = { requestSchedulerSync: vi.fn() };
    const useCase = new UpdateJobUseCase({
      ops: ops as OpsRepository,
      scheduler,
      clock: { now: () => '2026-04-24T01:00:00.000Z' },
    });

    await useCase.execute({
      appId: 'app-one',
      jobId: 'job-1',
      resume: true,
    });

    expect(ops.updateJob).toHaveBeenCalledWith('job-1', {
      status: 'active',
      pause_reason: null,
      next_run: '2026-04-24T01:00:00.000Z',
    });
  });

  it('pauses jobs without route-owned mutation logic', async () => {
    const ops = makeOps(makeJob());
    const scheduler = { requestSchedulerSync: vi.fn() };
    const useCase = new PauseJobUseCase({
      ops: ops as OpsRepository,
      scheduler,
    });

    await expect(
      useCase.execute({ appId: 'app-one', jobId: 'job-1' }),
    ).resolves.toEqual({ paused: true });
    expect(ops.updateJob).toHaveBeenCalledWith('job-1', {
      status: 'paused',
      pause_reason: 'Paused by SDK',
      next_run: null,
    });
    expect(scheduler.requestSchedulerSync).toHaveBeenCalledWith('job-1');
  });

  it('rejects cross-app job access', async () => {
    const ops = makeOps(makeJob());
    const useCase = new PauseJobUseCase({
      ops: ops as OpsRepository,
      scheduler: { requestSchedulerSync: vi.fn() },
    });

    await expect(
      useCase.execute({ appId: 'other-app', jobId: 'job-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ops.updateJob).not.toHaveBeenCalled();
  });
});
