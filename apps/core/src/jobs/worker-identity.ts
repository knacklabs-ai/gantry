import { randomUUID } from 'node:crypto';
import os from 'node:os';

import type { WorkerRegistryRepository } from '../domain/ports/worker-coordination.js';
import { WORKER_HEARTBEAT_INTERVAL_MS } from '../shared/worker-heartbeat.js';

type WarnLog = (context: Record<string, unknown>, message: string) => void;

interface ActiveWorkerIdentity {
  id: string;
  bootNonce: string;
  registry: WorkerRegistryRepository;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

let activeWorker: ActiveWorkerIdentity | null = null;

export async function registerWorkerInstance(
  registry: WorkerRegistryRepository,
  options?: { warn?: WarnLog },
): Promise<string> {
  if (activeWorker) return activeWorker.id;
  const id = `worker-${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const bootNonce = randomUUID();
  await registry.registerWorker({
    id,
    bootNonce,
    imageDigest: process.env.GANTRY_IMAGE_DIGEST ?? null,
    version: process.env.npm_package_version ?? null,
  });
  const heartbeatTimer = setInterval(() => {
    void registry
      .heartbeatWorker({ id })
      .catch((err) =>
        options?.warn?.(
          { err, workerInstanceId: id },
          'Worker heartbeat failed',
        ),
      );
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  (
    heartbeatTimer as ReturnType<typeof setInterval> & { unref?: () => void }
  ).unref?.();
  activeWorker = { id, bootNonce, registry, heartbeatTimer };
  return id;
}

export function requireWorkerInstanceId(): string {
  if (!activeWorker) {
    throw new Error('Worker instance is not registered');
  }
  return activeWorker.id;
}

export function currentWorkerInstanceId(): string | null {
  return activeWorker?.id ?? null;
}

export function stopWorkerHeartbeat(): void {
  if (!activeWorker) return;
  clearInterval(activeWorker.heartbeatTimer);
  activeWorker = null;
}
