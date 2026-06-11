import { logger } from '../infrastructure/logging/logger.js';
import {
  getRuntimeControlRepository,
  getRuntimeEventExchange,
  getRuntimeRepositories,
  getWorkerCoordinationRepository,
} from '../adapters/storage/postgres/runtime-store.js';
import { PgBossSchedulerEngine } from '../infrastructure/pgboss/scheduler-engine.js';
import {
  configureRunSlotBackend,
  resetSchedulerRunSlots,
} from './concurrency.js';
import {
  registerWorkerInstance,
  stopWorkerHeartbeat,
} from './worker-identity.js';
import { sweepCompletedOneTimeJobs } from './cleanup.js';
import { runJob } from './execution.js';
import { computeNextJobRun } from './schedule-math.js';
import { runtimeJobSchedulePlanner } from './job-schedule-planner.js';
import { notifyReleasedStaleJobLeases } from './stale-lease-terminal.js';
import {
  _setMemoryMaintenanceQueueForTests,
  registerSystemJobs,
  resetSystemJobStateForTests,
} from './system-jobs.js';
import type {
  SchedulerDependencies,
  SchedulerDispatchPayload,
} from './types.js';

let activeSchedulerEngine: PgBossSchedulerEngine | null = null;
let schedulerRunning = false;
/**
 * Set at bootstrap when the process role does not claim scheduled jobs
 * (`jobExecution=false`). The scheduler loop is never started in that case, so
 * `isSchedulerReady()` is permanently false — but the *reason* is the role, not
 * a transient startup window. Threaded into trigger error messages so the user
 * gets a plain explanation instead of "Scheduler is not ready".
 */
let roleHasNoJobExecution = false;

/** Record that this process role does not run the scheduler (bootstrap-only). */
export function markRoleHasNoJobExecution(): void {
  roleHasNoJobExecution = true;
}

/**
 * Role-aware reason for an unready scheduler, or undefined when the cause is
 * transient (the role runs jobs but the engine is still starting).
 */
export function schedulerNotReadyReason(): string | undefined {
  if (!roleHasNoJobExecution) return undefined;
  return (
    'This process role does not claim scheduled jobs; the job will run on ' +
    'its schedule, or trigger it from a job-execution process.'
  );
}

export type { SchedulerDependencies, SchedulerDispatchPayload };
export { computeNextJobRun, registerSystemJobs, runJob };
export { runtimeJobSchedulePlanner };
export { sweepCompletedOneTimeJobs };
export { _setMemoryMaintenanceQueueForTests };

export async function runSchedulerTick(
  deps: SchedulerDependencies,
): Promise<void> {
  deps = {
    ...deps,
    opsRepository: deps.opsRepository ?? getRuntimeRepositories(),
  };
  await registerSystemJobs(deps);
  activeSchedulerEngine?.requestSync();
}

export function requestSchedulerSync(jobId?: string): void {
  activeSchedulerEngine?.requestSync(jobId);
}

export async function enqueueJobTrigger(
  jobId: string,
  triggerId: string,
  options?: { runId?: string },
): Promise<void> {
  if (!activeSchedulerEngine) {
    throw new Error('Scheduler engine is not running');
  }
  await activeSchedulerEngine.enqueueTrigger(jobId, triggerId, options);
}

export async function startSchedulerLoop(
  deps: SchedulerDependencies,
): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  const resolvedDeps = {
    ...deps,
    opsRepository: deps.opsRepository ?? getRuntimeRepositories(),
  };
  const warn = (context: Record<string, unknown>, message: string): void =>
    logger.warn(context, message);
  const workerCoordination = getWorkerCoordinationRepository();
  const workerInstanceId = await registerWorkerInstance(workerCoordination, {
    warn,
    processRole: deps.processRole,
  });
  configureRunSlotBackend({
    repository: workerCoordination,
    workerInstanceId,
    warn,
  });
  const engine = new PgBossSchedulerEngine(resolvedDeps, {
    registerSystemJobs,
    runJob,
    sweepCompletedOneTimeJobs,
    handleReleasedStaleLeases: (releases, callbackDeps) =>
      notifyReleasedStaleJobLeases({
        releases,
        opsRepository: callbackDeps.opsRepository,
        sendMessage: callbackDeps.sendMessage,
        controlRepository: getRuntimeControlRepository(),
        publishRuntimeEvent: async (event) => {
          await getRuntimeEventExchange().publish(event);
        },
        logger,
      }),
  });
  activeSchedulerEngine = engine;
  try {
    await engine.start();
  } catch (err) {
    schedulerRunning = false;
    activeSchedulerEngine = null;
    stopWorkerHeartbeat();
    configureRunSlotBackend(null);
    await engine
      .stop()
      .catch((stopErr) =>
        logger.warn(
          { err: stopErr },
          'Failed to stop pg-boss after startup failure',
        ),
      );
    throw err;
  }
}

export async function stopSchedulerLoop(): Promise<void> {
  schedulerRunning = false;
  const engine = activeSchedulerEngine;
  activeSchedulerEngine = null;
  stopWorkerHeartbeat();
  configureRunSlotBackend(null);
  await engine?.stop();
}

export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
  activeSchedulerEngine = null;
  stopWorkerHeartbeat();
  resetSchedulerRunSlots();
  resetSystemJobStateForTests();
}

export function isSchedulerReady(): boolean {
  return activeSchedulerEngine?.isReady() === true;
}
