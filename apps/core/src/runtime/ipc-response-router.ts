/**
 * IPC response router — module-level single-shot registry.
 *
 * When the future Unix-socket server is active it registers an IpcResponder for
 * each in-flight request identified by (folder, correlationId). The write
 * chokepoint (writeTaskIpcResponse) checks for a registered responder via
 * takeIpcResponder: if one is found the signed payload is delivered there and
 * the filesystem write is skipped; otherwise the file is written exactly as
 * before. With no responder registered the behaviour is byte-identical to the
 * pre-router code.
 */

export type IpcResponder = (signedResponse: Record<string, unknown>) => void;

function makeKey(folder: string, correlationId: string): string {
  return `${folder} ${correlationId}`;
}

const responders = new Map<string, IpcResponder>();

/**
 * Register a responder for (folder, correlationId). Overwrites any existing
 * entry for the same key.
 */
export function registerIpcResponder(
  folder: string,
  correlationId: string,
  responder: IpcResponder,
): void {
  responders.set(makeKey(folder, correlationId), responder);
}

/**
 * Returns AND removes the responder for (folder, correlationId) — single-shot.
 * Returns undefined if no responder is registered.
 */
export function takeIpcResponder(
  folder: string,
  correlationId: string,
): IpcResponder | undefined {
  const key = makeKey(folder, correlationId);
  const responder = responders.get(key);
  if (responder !== undefined) {
    responders.delete(key);
  }
  return responder;
}

/**
 * Returns true if a responder is registered for (folder, correlationId).
 * Does NOT consume the entry.
 */
export function hasIpcResponder(
  folder: string,
  correlationId: string,
): boolean {
  return responders.has(makeKey(folder, correlationId));
}

/**
 * Empties the registry. Called on shutdown and in tests between cases.
 */
export function clearIpcResponders(): void {
  responders.clear();
}
