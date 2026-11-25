/**
 * Best-effort, in-process per-call state for the voice relay.
 *
 * Fish may land consecutive turns on different serverless instances, so this
 * is advisory only — the DB `spoken` flag (claimAgentUpdates) stays the source
 * of truth for "who speaks which update". This module exists for one thing:
 * make the relay SOUND human — no repeated hold lines, no dead "no reply yet"
 * line right after a reply was already spoken.
 */
export interface RelayState {
  /** When an agent_update was last claimed and spoken aloud (ms epoch). */
  lastReplyAt: number;
  /** seq of that last spoken update (lets an in-flight wait loop detect that
   *  the browser's marker turn won the race and already delivered the reply). */
  lastSpokenSeq: number;
  /** When the last hold line was said; resets whenever a reply is spoken. */
  lastHoldAt: number;
  /** Consecutive hold lines — used to ROTATE the wording, never repeat. */
  holds: number;
  /** When the "agent not connected" line was last said. */
  lastNoAgentAt: number;
}

const g = globalThis as unknown as { nidaaRelayStates?: Map<string, RelayState> };
const states = g.nidaaRelayStates ?? new Map<string, RelayState>();
g.nidaaRelayStates = states;

export function relayState(callId: string): RelayState {
  let s = states.get(callId);
  if (!s) {
    s = { lastReplyAt: 0, lastSpokenSeq: 0, lastHoldAt: 0, holds: 0, lastNoAgentAt: 0 };
    states.set(callId, s);
  }
  return s;
}

/** A reply was claimed and is being spoken right now — reset the hold cadence. */
export function noteReplySpoken(callId: string, seqs: number[]): void {
  const s = relayState(callId);
  s.lastReplyAt = Date.now();
  for (const seq of seqs) if (seq > s.lastSpokenSeq) s.lastSpokenSeq = seq;
  s.holds = 0;
}

/** Drop the per-call state when the call ends (keeps the map small). */
export function forgetRelayState(callId: string): void {
  states.delete(callId);
}

export function happenedWithin(ts: number, ms: number): boolean {
  return ts > 0 && Date.now() - ts < ms;
}
