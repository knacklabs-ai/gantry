import type { Job } from '../domain/types.js';
import {
  abortReason,
  MEMORY_DREAM_SYSTEM_JOB_FINALIZATION_GRACE_MS,
} from '../shared/memory-dreaming-timeout.js';
import { nowMs } from '../shared/time/datetime.js';
import { handleSystemJob, MEMORY_DREAM_SYSTEM_PROMPT } from './system-jobs.js';

type SystemJobContext = Parameters<typeof handleSystemJob>[1];

function systemJobWorkDeadlineAtMs(input: {
  job: Job;
  startedAtMs: number;
  timeoutMs: number;
}): number {
  const finalizationGraceMs =
    input.job.prompt === MEMORY_DREAM_SYSTEM_PROMPT
      ? MEMORY_DREAM_SYSTEM_JOB_FINALIZATION_GRACE_MS
      : 0;
  return input.startedAtMs + Math.max(1, input.timeoutMs - finalizationGraceMs);
}

export async function runSystemJobWithDeadline(input: {
  currentJob: Job;
  context: SystemJobContext;
  startedAtMs: number;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeoutAtMs = input.startedAtMs + input.timeoutMs;
  const timeoutHandle = setTimeout(
    () => {
      controller.abort(
        new Error(`System job timed out after ${input.timeoutMs}ms`),
      );
    },
    Math.max(1, timeoutAtMs - nowMs()),
  );
  timeoutHandle.unref?.();
  const work = handleSystemJob(input.currentJob, input.context, {
    signal: controller.signal,
    deadlineAtMs: systemJobWorkDeadlineAtMs({
      job: input.currentJob,
      startedAtMs: input.startedAtMs,
      timeoutMs: input.timeoutMs,
    }),
  });
  work.catch(() => {
    // Avoid unhandled rejection noise when the scheduler deadline wins first.
  });
  let onAbort: (() => void) | undefined;
  const abort = new Promise<unknown>((_, reject) => {
    onAbort = () => reject(abortReason(controller.signal));
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, abort]);
  } finally {
    clearTimeout(timeoutHandle);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}
