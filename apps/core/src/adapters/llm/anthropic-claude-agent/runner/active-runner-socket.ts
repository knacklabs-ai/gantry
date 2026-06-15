// ---------------------------------------------------------------------------
// Active runner socket accessor (Pillar 1, Phase 5.3d)
//
// One runner PROCESS drives exactly one active run, and that run opens at most
// one role-'runner' IpcSocketClient (in query-loop.ts runQuery) to RECEIVE
// continuation/close pushes. The permission callback runs in the SAME process
// and must REUSE that one connection to SEND its permission request frame
// (do not open a second runner connection — one runner connection per run is
// the contract the server's runHandle continuation matching depends on).
//
// runQuery sets the active client when it connects and clears it in finally;
// permission-callback.ts reads it. A module-level single active client is
// correct precisely because the runner is single-run.
// ---------------------------------------------------------------------------

/**
 * The slice of IpcSocketClient the permission callback depends on. Narrowed so a
 * test can inject a fake to exercise the socket request branch + fallback
 * without standing up a real socket.
 */
export interface RunnerSocketClientLike {
  readonly connected: boolean;
  request(
    channel: 'permission',
    signedPayload: Record<string, unknown>,
    opts?: { id?: string; timeoutMs?: number },
  ): Promise<Record<string, unknown>>;
}

let activeRunnerSocketClient: RunnerSocketClientLike | undefined;

/**
 * Publish the run's runner socket client so the permission callback can send its
 * request over the SAME connection. Called by runQuery once the client is
 * constructed (the connect is best-effort; the accessor still publishes so the
 * callback can observe `connected` and fall back to fs when not connected).
 */
export function setActiveRunnerSocketClient(
  client: RunnerSocketClientLike | undefined,
): void {
  activeRunnerSocketClient = client;
}

/**
 * The run's runner socket client, or undefined in fs mode / before connect /
 * after the run ends. The permission callback only uses it when `connected`.
 */
export function getActiveRunnerSocketClient():
  | RunnerSocketClientLike
  | undefined {
  return activeRunnerSocketClient;
}
