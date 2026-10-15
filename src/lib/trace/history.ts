import type { Trace } from "./model";

/** Session-only undo/redo over whole trace records (D7, docs/sprints/trace-graph/08). */
export type History = { past: Trace[]; future: Trace[] };

export const HISTORY_CAP = 100;
export const emptyHistory = (): History => ({ past: [], future: [] });

/** Record the state before an edit; a new edit clears redo. */
export function push(history: History, before: Trace): History {
  return { past: [...history.past, before].slice(-HISTORY_CAP), future: [] };
}

export function undo(history: History, current: Trace): { history: History; trace: Trace } | null {
  const trace = history.past.at(-1);
  if (!trace) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, trace };
}

export function redo(history: History, current: Trace): { history: History; trace: Trace } | null {
  const [trace, ...future] = history.future;
  if (!trace) return null;
  return { history: { past: [...history.past, current].slice(-HISTORY_CAP), future }, trace };
}
