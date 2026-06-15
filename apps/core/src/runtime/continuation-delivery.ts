import { randomUUID } from 'crypto';

import type { IpcConnection } from '../shared/ipc-connection.js';
import {
  writeCloseSignal,
  writeContinuationInput,
} from './continuation-input.js';

/**
 * Identity of the continuation mailbox a follow-up message (or close signal) is
 * destined for. `groupFolder` + `chatJid` (+ optional `threadId`) address the
 * per-conversation mailbox today; `runHandle` lets the socket carrier resolve
 * the single live runner connection serving that run.
 */
export interface ContinuationTarget {
  groupFolder: string;
  chatJid: string;
  threadId: string | null;
  runHandle: string | null;
}

/**
 * Carrier-agnostic seam for delivering a continuation follow-up / close to a
 * live agent run. Default carrier is the filesystem mailbox (today's behavior);
 * the socket carrier pushes over IPC and falls back to fs on a race/drop.
 */
export interface ContinuationDelivery {
  deliverContinuation: (
    target: ContinuationTarget,
    text: string,
    sequence: number,
  ) => boolean;
  deliverClose: (target: ContinuationTarget) => void;
}

/**
 * Default fs delivery — exactly today's behavior. Exported so GroupQueue's
 * default and the socket fallback share it.
 */
export const fsContinuationDelivery: ContinuationDelivery = {
  deliverContinuation(target, text, sequence) {
    writeContinuationInput(
      target.groupFolder,
      target.chatJid,
      text,
      sequence,
      target.threadId ?? undefined,
    );
    return true;
  },
  deliverClose(target) {
    writeCloseSignal(
      target.groupFolder,
      target.chatJid,
      target.threadId ?? undefined,
    );
  },
};

/**
 * Socket delivery: push to the matching runner connection, else fall back to fs
 * (race/drop safety, R1). The runner's startup `drainIpcInput` + poll consumes
 * anything written to the durable mailbox during a connect gap, so a missed
 * push never loses a message.
 */
export function makeSocketContinuationDelivery(
  connectionsForFolder: (folder: string) => IpcConnection[],
): ContinuationDelivery {
  function findRunner(target: ContinuationTarget): IpcConnection | undefined {
    // R2: runHandle is fresh-per-spawn and cleared on run end, so only the
    // current run resolves. The folder match is asserted too (defense in depth).
    if (!target.runHandle) return undefined;
    return connectionsForFolder(target.groupFolder).find(
      (c) =>
        c.scope?.role === 'runner' &&
        c.scope?.runHandle === target.runHandle &&
        c.scope?.sourceAgentFolder === target.groupFolder,
    );
  }
  return {
    deliverContinuation(target, text, sequence) {
      const conn = findRunner(target);
      if (conn) {
        conn.send({
          v: 1,
          type: 'push',
          channel: 'continuation',
          id: randomUUID(),
          payload: { text, threadId: target.threadId, sequence },
        });
        return true;
      }
      // R1 fallback: no live connection — write the durable mailbox.
      return fsContinuationDelivery.deliverContinuation(target, text, sequence);
    },
    deliverClose(target) {
      const conn = findRunner(target);
      if (conn) {
        conn.send({
          v: 1,
          type: 'push',
          channel: 'close',
          id: randomUUID(),
          payload: { threadId: target.threadId },
        });
        return;
      }
      // R1 fallback: no live connection — write the durable close signal.
      fsContinuationDelivery.deliverClose(target);
    },
  };
}
