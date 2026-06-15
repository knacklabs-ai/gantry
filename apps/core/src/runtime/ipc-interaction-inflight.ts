// Shared interaction in-flight accounting (permission + user-question).
//
// Both the fs watcher (runtime/ipc.ts) and the socket server's user_question
// dispatcher draw on this ONE set so the global cap and the per-request
// duplicate guard are honoured regardless of which transport the request
// arrived on. Promoting it out of runtime/ipc.ts (where it used to be a private
// module-level Set) keeps a request that is already in flight via the fs path
// from being processed a second time over the socket, and vice-versa.

/** Max concurrent in-flight interaction (permission + user-question) requests. */
export const MAX_IN_FLIGHT_INTERACTION_IPC = 100;

const inFlightInteractionIpc = new Set<string>();

/**
 * Disposition of an attempt to admit an interaction request:
 *  - { ok: true }                  → admitted; the caller owns the key and MUST
 *                                    release it when the handler settles.
 *  - { ok: false, reason: 'cap' }  → the global cap is reached.
 *  - { ok: false, reason: 'duplicate' } → this exact key is already in flight.
 */
export type InteractionAdmission =
  | { ok: true }
  | { ok: false; reason: 'cap' | 'duplicate' };

/**
 * Try to admit an interaction request under both the global cap and the
 * per-key duplicate guard. Mirrors the watcher's original ordering: cap first,
 * then duplicate. On success the key is added to the set; the caller releases
 * it via releaseInteractionInFlight when the handler finishes.
 */
export function tryAdmitInteractionInFlight(key: string): InteractionAdmission {
  if (inFlightInteractionIpc.size >= MAX_IN_FLIGHT_INTERACTION_IPC) {
    return { ok: false, reason: 'cap' };
  }
  if (inFlightInteractionIpc.has(key)) {
    return { ok: false, reason: 'duplicate' };
  }
  inFlightInteractionIpc.add(key);
  return { ok: true };
}

export function releaseInteractionInFlight(key: string): void {
  inFlightInteractionIpc.delete(key);
}

export function interactionInFlightCount(): number {
  return inFlightInteractionIpc.size;
}

export function clearInteractionInFlight(): void {
  inFlightInteractionIpc.clear();
}
