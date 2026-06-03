import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';

import { nowIso, nowMs } from '../shared/time/datetime.js';
import { logger } from '../infrastructure/logging/logger.js';
import {
  ensurePrivateDirSync,
  writePrivateFileSync,
} from '../shared/private-fs.js';
import { isPlainObject, toTrimmedString } from '../shared/object.js';
import { IPC_GROUP_SUBDIRS } from './agent-spawn-layout.js';

interface IpcRootLockDetails {
  pid?: number;
  startedAt?: string;
}

export function isTrustedDirectory(dirPath: string): boolean {
  try {
    const stat = fs.lstatSync(dirPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function ensureGroupIpcLayout(
  ipcBaseDir: string,
  groupFolder: string,
): void {
  const groupDir = path.join(ipcBaseDir, groupFolder);
  ensurePrivateDirSync(groupDir);
  for (const subdir of IPC_GROUP_SUBDIRS) {
    ensurePrivateDirSync(path.join(groupDir, subdir));
  }
}

export function hasCompleteTrustedGroupIpcLayout(
  ipcBaseDir: string,
  groupFolder: string,
): boolean {
  const groupDir = path.join(ipcBaseDir, groupFolder);
  if (!isTrustedDirectory(groupDir)) return false;
  for (const subdir of IPC_GROUP_SUBDIRS) {
    if (!isTrustedDirectory(path.join(groupDir, subdir))) return false;
  }
  return true;
}

export function claimIpcFile(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('IPC payload must be a regular file');
  }
  const claimed = path.join(
    path.dirname(filePath),
    `.processing-${process.pid}-${nowMs()}-${randomUUID()}-${path.basename(filePath)}`,
  );
  fs.renameSync(filePath, claimed);
  return claimed;
}

export function isPendingIpcJsonFile(filename: string): boolean {
  return filename.endsWith('.json') && !filename.startsWith('.processing-');
}

export function archiveIpcErrorFile(
  ipcBaseDir: string,
  sourceAgentFolder: string,
  filename: string,
  claimedPath: string,
): void {
  const errorDir = path.join(ipcBaseDir, 'errors');
  ensurePrivateDirSync(errorDir);
  try {
    fs.renameSync(
      claimedPath,
      path.join(errorDir, `${sourceAgentFolder}-${filename}`),
    );
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code !== 'ENOENT') {
      throw err;
    }
  }
}

export function readIpcRootLockDetails(lockPath: string): IpcRootLockDetails {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return {};
    const pidRaw = parsed.pid;
    const pid =
      typeof pidRaw === 'number' && Number.isInteger(pidRaw) && pidRaw > 0
        ? pidRaw
        : undefined;
    const startedAt = toTrimmedString(parsed.startedAt, { maxLen: 128 });
    return { pid, startedAt };
  } catch {
    return {};
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    logger.warn(
      { err, pid },
      'Unable to validate IPC lock PID liveness, assuming process is active',
    );
    return true;
  }
}

// Best-effort wall-clock start time (ms since epoch) of a live PID, via `ps`.
// macOS `ps` has no `etimes`, so we parse `lstart` (e.g. "Wed Jun  3 16:38:23
// 2026", local time — Date.parse handles it). Returns undefined when it cannot
// be determined; callers then fall back to the conservative "assume the holder
// is alive" behaviour.
function processStartTimeMs(pid: number): number | undefined {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    if (!out) return undefined;
    const parsed = Date.parse(out);
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

// Detects PID recycling: a live PID that started materially LATER than the
// lock's recorded startedAt cannot be the original holder — that process died
// and the OS reassigned its PID to an unrelated one (e.g. a system daemon, which
// is exactly how a crashed Gantry can leave the IPC watcher wedged forever). The
// lock writer records startedAt right after its own process start, so a genuine
// holder's actual start time is at/just-before startedAt; only a recycled PID
// starts well after it. Conservative: returns false whenever it cannot prove
// recycling (no startedAt, unparseable, or `ps` unavailable).
const PID_RECYCLE_SKEW_MS = 60_000;
function isRecycledPid(
  pid: number,
  recordedStartedAt: string | undefined,
): boolean {
  if (!recordedStartedAt) return false;
  const recordedMs = Date.parse(recordedStartedAt);
  if (Number.isNaN(recordedMs)) return false;
  const actualMs = processStartTimeMs(pid);
  if (actualMs === undefined) return false;
  return actualMs - recordedMs > PID_RECYCLE_SKEW_MS;
}

export function recoverStaleIpcRootLock(
  lockPath: string,
): IpcRootLockDetails & { recovered: boolean; recoveryReason?: string } {
  const details = readIpcRootLockDetails(lockPath);
  if (typeof details.pid !== 'number') {
    return {
      ...details,
      recovered: false,
      recoveryReason: 'invalid_or_missing_pid',
    };
  }
  if (details.pid === process.pid) {
    return { ...details, recovered: false, recoveryReason: 'same_process' };
  }
  let recoveryReason: string;
  if (isProcessAlive(details.pid)) {
    // A live PID alone is not proof the original holder survives — guard against
    // PID recycling, or a crashed runtime's lock blocks the IPC watcher forever.
    if (!isRecycledPid(details.pid, details.startedAt)) {
      return { ...details, recovered: false, recoveryReason: 'pid_alive' };
    }
    recoveryReason = 'pid_recycled';
  } else {
    recoveryReason = 'pid_not_running';
  }
  try {
    fs.rmSync(lockPath, { force: true });
    return { ...details, recovered: true, recoveryReason };
  } catch (err) {
    logger.warn({ err, lockPath }, 'Failed to remove stale IPC watcher lock');
    return { ...details, recovered: false, recoveryReason: 'remove_failed' };
  }
}

export function acquireIpcRootLock(ipcBaseDir: string): string {
  const lockPath = path.join(ipcBaseDir, '.lock');
  writePrivateFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      startedAt: nowIso(),
    }),
    { flag: 'wx' },
  );
  return lockPath;
}
