import { EventEmitter } from "events";

/**
 * Tiny in-process event bus used to wake SSE streams early.
 * The SSE route also polls the database, so this is an optimization only —
 * on serverless (Vercel) correctness never depends on it.
 */
export interface BusMessage {
  type: "call:incoming" | "call:update" | "call:status";
  call_id: string;
  status?: string;
  seq?: number;
}

const globalForBus = globalThis as unknown as { nidaaBus?: EventEmitter };

export const bus = globalForBus.nidaaBus ?? new EventEmitter();
bus.setMaxListeners(100);
if (process.env.NODE_ENV !== "production") globalForBus.nidaaBus = bus;

export function broadcastEvent(msg: BusMessage) {
  bus.emit("event", msg);
}
