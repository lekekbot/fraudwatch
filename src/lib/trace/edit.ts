import { MAX_HOPS, type Trace, type TraceDirection, type TraceScope, type TraceStep } from "./model";
import { detachEnds, isColorKey, type Annotation, type NodeStyle, type Point } from "./presentation";
import { isValidAnnotation } from "./storage";

const stamp = (trace: Trace, change: Partial<Trace>, now = new Date()): Trace => ({ ...trace, ...change, updatedAt: now.toISOString() });
const validPoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

export function addSteps(trace: Trace, steps: readonly TraceStep[], now = new Date()): Trace {
  const keys = new Set(trace.steps.filter((s) => s.kind === "movement").map((s) => s.ref.key));
  const conversions = new Set(trace.steps.filter((s) => s.kind === "conversion").map((s) => `${s.signature}:${s.address}`));
  const ids = new Set(trace.steps.map((s) => s.id));
  const added: TraceStep[] = [];
  for (const step of steps) {
    if (ids.has(step.id) || (step.kind === "movement" && keys.has(step.ref.key)) || (step.kind === "conversion" && conversions.has(`${step.signature}:${step.address}`))) continue;
    ids.add(step.id);
    if (step.kind === "movement") keys.add(step.ref.key);
    else conversions.add(`${step.signature}:${step.address}`);
    added.push(step);
  }
  return added.length ? stamp(trace, { steps: [...trace.steps, ...added] }, now) : trace;
}

function activeNodes(trace: Trace): Set<string> {
  const seed = trace.seed;
  const nodes = new Set<string>(seed.kind === "address" ? [seed.address] : seed.kind === "movement" ? [seed.ref.from ?? seed.ref.to ?? ""] : []);
  for (const address of trace.addresses ?? []) nodes.add(address);
  for (const step of trace.steps) {
    if (step.kind === "conversion") nodes.add(step.address);
    else {
      if (step.ref.from) nodes.add(step.ref.from);
      if (step.ref.to) nodes.add(step.ref.to);
    }
  }
  return nodes;
}

/** Put an address on the trace as a node of its own. */
export function addAddress(trace: Trace, address: string, now = new Date()): Trace {
  if (!address.trim()) throw new Error("Enter an address.");
  if (trace.addresses?.includes(address)) return trace;
  return stamp(trace, { addresses: [...(trace.addresses ?? []), address] }, now);
}

/** Take a placed address off the trace. Its movements, if any, stay; so does the node they draw. */
export function removeAddress(trace: Trace, address: string, now = new Date()): Trace {
  if (!trace.addresses?.includes(address)) return trace;
  const remaining = { ...trace, addresses: trace.addresses.filter((a) => a !== address) };
  return activeNodes(remaining).has(address) ? stamp(trace, { addresses: remaining.addresses }, now) : removeSteps(stamp(remaining, {}, now), new Set(), now, [address]);
}

/** `alsoPrune` names nodes that went away for another reason (a removed placed address), so their presentation is tidied the same way. */
export function removeSteps(trace: Trace, stepIds: ReadonlySet<string>, now = new Date(), alsoPrune: readonly string[] = []): Trace {
  const steps = trace.steps.filter((s) => !stepIds.has(s.id));
  if (steps.length === trace.steps.length && !alsoPrune.length) return trace;
  const remaining = { ...trace, steps };
  const nodes = activeNodes(remaining);
  const removed = new Set(Object.keys(trace.presentation.positions).filter((id) => !nodes.has(id) && !id.startsWith("entity:")));
  const detached = detachEnds(trace.presentation, removed);
  const positions = Object.fromEntries(Object.entries(detached.positions).filter(([id]) => nodes.has(id) || id.startsWith("entity:")));
  const nodeStyles = Object.fromEntries(Object.entries(detached.nodeStyles).filter(([id]) => nodes.has(id) || id.startsWith("entity:")));
  const hiddenBranches = detached.hiddenBranches.filter((id) => nodes.has(id) || id.startsWith("entity:"));
  return stamp(trace, { steps, presentation: { ...detached, positions, nodeStyles, hiddenBranches } }, now);
}

export function setScope(trace: Trace, scope: TraceScope, now = new Date()): Trace {
  if (!Number.isInteger(scope.maxHops) || scope.maxHops < 1 || scope.maxHops > MAX_HOPS) throw new Error("Trace hop limit must be between 1 and 20.");
  return stamp(trace, { scope }, now);
}

export function setDirection(trace: Trace, direction: TraceDirection, now = new Date()): Trace { return stamp(trace, { direction }, now); }

export function renameTrace(trace: Trace, name: string, now = new Date()): Trace {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error("Trace name must be 1–80 characters.");
  return stamp(trace, { name: trimmed }, now);
}

export function setPositions(trace: Trace, positions: Readonly<Record<string, Point>>, now = new Date()): Trace {
  if (Object.values(positions).some((p) => !validPoint(p))) throw new Error("Trace positions must be finite numbers.");
  return stamp(trace, { presentation: { ...trace.presentation, positions: { ...trace.presentation.positions, ...positions } } }, now);
}

export function setNodeStyle(trace: Trace, nodeId: string, style: NodeStyle | null, now = new Date()): Trace {
  if (style && ((style.note && style.note.length > 2000) || (style.color && !isColorKey(style.color)) || (style.size && !["s", "m", "l"].includes(style.size)))) throw new Error("Node style has invalid data.");
  const nodeStyles = { ...trace.presentation.nodeStyles };
  if (style) nodeStyles[nodeId] = style;
  else delete nodeStyles[nodeId];
  return stamp(trace, { presentation: { ...trace.presentation, nodeStyles } }, now);
}

export function addAnnotation(trace: Trace, annotation: Annotation, now = new Date()): Trace {
  if (trace.presentation.annotations.length >= 500) throw new Error("A trace can hold at most 500 annotations.");
  if (!isValidAnnotation(annotation)) throw new Error("Annotation has invalid data.");
  if (trace.presentation.annotations.some((a) => a.id === annotation.id)) throw new Error("Annotation id already exists.");
  return stamp(trace, { presentation: { ...trace.presentation, annotations: [...trace.presentation.annotations, annotation] } }, now);
}

export function updateAnnotation(trace: Trace, id: string, patch: Partial<Annotation>, now = new Date()): Trace {
  let found = false;
  const annotations = trace.presentation.annotations.map((a) => {
    if (a.id !== id) return a;
    found = true;
    if ((patch.kind && patch.kind !== a.kind) || (patch.id && patch.id !== id)) throw new Error("Annotation identity cannot change.");
    const updated = { ...a, ...patch };
    if (!isValidAnnotation(updated)) throw new Error("Annotation has invalid data.");
    return updated;
  });
  return found ? stamp(trace, { presentation: { ...trace.presentation, annotations } }, now) : trace;
}

export function removeAnnotations(trace: Trace, ids: ReadonlySet<string>, now = new Date()): Trace {
  const detached = detachEnds(trace.presentation, ids);
  const annotations = detached.annotations.filter((a) => !ids.has(a.id));
  return annotations.length === trace.presentation.annotations.length ? trace : stamp(trace, { presentation: { ...detached, annotations } }, now);
}

/** Draw order: to the very front or back, or one step forward or backward. */
export function reorderAnnotation(trace: Trace, id: string, edge: "front" | "back" | "forward" | "backward", now = new Date()): Trace {
  const list = trace.presentation.annotations, at = list.findIndex((a) => a.id === id);
  if (at < 0) return trace;
  const item = list[at], rest = list.filter((a) => a.id !== id);
  const to = edge === "front" ? rest.length : edge === "back" ? 0 : edge === "forward" ? Math.min(rest.length, at + 1) : Math.max(0, at - 1);
  if (to === at) return trace;
  return stamp(trace, { presentation: { ...trace.presentation, annotations: [...rest.slice(0, to), item, ...rest.slice(to)] } }, now);
}

export function setCanvasOptions(trace: Trace, options: Partial<Trace["presentation"]["canvas"]>, now = new Date()): Trace {
  return stamp(trace, { presentation: { ...trace.presentation, canvas: { ...trace.presentation.canvas, ...options } } }, now);
}

export function setServiceExpanded(trace: Trace, id: string, expanded: boolean, now = new Date()): Trace {
  const ids = new Set(trace.presentation.expandedServices);
  if (expanded) ids.add(id); else ids.delete(id);
  return stamp(trace, { presentation: { ...trace.presentation, expandedServices: [...ids] } }, now);
}

export function setBranchHidden(trace: Trace, id: string, hidden: boolean, now = new Date()): Trace {
  const ids = new Set(trace.presentation.hiddenBranches);
  if (hidden) ids.add(id); else ids.delete(id);
  return stamp(trace, { presentation: { ...trace.presentation, hiddenBranches: [...ids] } }, now);
}

export function duplicateTrace(trace: Trace, deps: { id?: string; now?: Date } = {}): Trace {
  const now = (deps.now ?? new Date()).toISOString();
  return { ...structuredClone(trace), id: deps.id ?? crypto.randomUUID(), name: `Copy of ${trace.name}`.slice(0, 80), createdAt: now, updatedAt: now };
}

/** User-confirmed removal after the raw damaged items have been reviewed or copied. */
export function removeInvalidItems(trace: Trace, now = new Date()): Trace {
  return stamp(trace, { invalidSteps: [], invalidAnnotations: [] }, now);
}
