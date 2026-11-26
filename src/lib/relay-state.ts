/**
 * Best-effort, in-process per-call state for the voice-relay router.
 *
 * Fish may land consecutive turns on different serverless instances, so this
 * is advisory only — the DB `spoken` flag (claimAgentUpdates) stays the source
 * of truth for "who speaks which update". This module exists so an in-flight
 * grace-wait loop can notice that the browser's marker turn just delivered
 * the reply, and go silent instead of stacking speech on top of it.
 */
export interface RelayState {
  /** When an agent_update was last claimed and spoken aloud (ms epoch). */
  lastReplyAt: number;
  /** seq of that last spoken update. */
  lastSpokenSeq: number;
}

const g = globalThis as unknown as { nidaaRelayStates?: Map<string, RelayState> };
const states = g.nidaaRelayStates ?? new Map<string, RelayState>();
g.nidaaRelayStates = states;

export function relayState(callId: string): RelayState {
  let s = states.get(callId);
  if (!s) {
    s = { lastReplyAt: 0, lastSpokenSeq: 0 };
    states.set(callId, s);
  }
  return s;
}

/** A reply was claimed and is being spoken right now. */
export function noteReplySpoken(callId: string, seqs: number[]): void {
  const s = relayState(callId);
  s.lastReplyAt = Date.now();
  for (const seq of seqs) if (seq > s.lastSpokenSeq) s.lastSpokenSeq = seq;
}

/** Drop the per-call state when the call ends (keeps the map small). */
export function forgetRelayState(callId: string): void {
  states.delete(callId);
}

export function happenedWithin(ts: number, ms: number): boolean {
  return ts > 0 && Date.now() - ts < ms;
}
