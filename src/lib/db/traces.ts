import type { FraudWatchDB } from "./db";
import { DEFAULT_MAX_HOPS, TRACE_SCHEMA_VERSION, type Trace, type TraceDirection, type TraceScope, type TraceSeed, type TraceStep } from "@/lib/trace/model";
import { emptyPresentation, type TracePresentation } from "@/lib/trace/presentation";
import { parseTrace, type LoadedTrace } from "@/lib/trace/storage";
import { analysisVersions } from "@/lib/semantic/versions";
import { duplicateTrace } from "@/lib/trace/edit";

export type TraceListItem = { id: string; name: string; steps: number; updatedAt: string; valid: boolean; reason?: "invalid" | "newer_version" };
export type NewTraceInput = { caseId: string; name: string; seed: TraceSeed; direction?: TraceDirection; scope?: TraceScope; steps?: TraceStep[]; presentation?: TracePresentation };

export async function listTraces(db: FraudWatchDB, caseId: string): Promise<TraceListItem[]> {
  const rows = await db.traces.where("caseId").equals(caseId).toArray();
  return rows.map((row): TraceListItem => {
    const loaded = parseTrace(row);
    return loaded.ok
      ? { id: loaded.trace.id, name: loaded.trace.name, steps: loaded.trace.steps.length, updatedAt: loaded.trace.updatedAt, valid: true }
      : { id: row.id, name: typeof row.name === "string" ? row.name : "Unreadable trace", steps: 0, updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "", valid: false, reason: loaded.reason === "newer_version" ? "newer_version" : "invalid" };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getTrace(db: FraudWatchDB, id: string, caseId?: string): Promise<LoadedTrace> {
  const row = await db.traces.get(id);
  if (!row) return { ok: false, id, reason: "missing" };
  if (caseId && row.caseId !== caseId) return { ok: false, id, reason: "missing" };
  return parseTrace(row);
}

const pending = new Map<string, Promise<void>>();

/** Serialise rapid writes to one trace; preserve damaged items unless explicitly removed. */
export function saveTrace(db: FraudWatchDB, trace: Trace, now = new Date()): Promise<void> {
  const previous = pending.get(trace.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const candidate = { ...trace, schemaVersion: TRACE_SCHEMA_VERSION, updatedAt: now.toISOString() };
    const parsed = parseTrace(candidate);
    if (!parsed.ok) throw new Error("This trace has invalid data and was not saved.");
    await db.transaction("rw", db.traces, async () => {
      const stored = await db.traces.get(trace.id);
      if (!stored) throw new Error("This trace no longer exists.");
      const prior = parseTrace(stored);
      if (!prior.ok) throw new Error("This trace was made by a newer version or is unreadable. It was not overwritten.");
      if (prior.trace.caseId !== trace.caseId) throw new Error("Trace belongs to another case.");
      await db.traces.put({ ...parsed.trace,
        invalidSteps: trace.invalidSteps !== undefined ? parsed.trace.invalidSteps ?? [] : [...(prior.trace.invalidSteps ?? []), ...(parsed.trace.invalidSteps ?? [])],
        invalidAnnotations: trace.invalidAnnotations !== undefined ? parsed.trace.invalidAnnotations ?? [] : [...(prior.trace.invalidAnnotations ?? []), ...(parsed.trace.invalidAnnotations ?? [])],
      });
    });
  });
  pending.set(trace.id, next);
  void next.finally(() => { if (pending.get(trace.id) === next) pending.delete(trace.id); }).catch(() => {});
  return next;
}

export async function createTrace(db: FraudWatchDB, input: NewTraceInput, deps: { id?: string; now?: Date } = {}): Promise<Trace> {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Trace name must be 1–80 characters.");
  const now = (deps.now ?? new Date()).toISOString();
  const versions = analysisVersions();
  const trace: Trace = {
    id: deps.id ?? crypto.randomUUID(), caseId: input.caseId, name, schemaVersion: TRACE_SCHEMA_VERSION,
    seed: input.seed, direction: input.direction ?? "forward", scope: input.scope ?? { assets: null, start: null, end: null, minAmount: null, maxHops: DEFAULT_MAX_HOPS },
    steps: input.steps ?? [], presentation: input.presentation ?? emptyPresentation(), analysisAtSave: { semantic: versions.semantic, registry: versions.registry },
    createdAt: now, updatedAt: now,
  };
  const parsed = parseTrace(trace);
  if (!parsed.ok || parsed.trace.invalidSteps?.length || parsed.trace.invalidAnnotations?.length) throw new Error("Trace seed or selected steps are invalid.");
  await db.transaction("rw", db.cases, db.traces, async () => {
    if (!(await db.cases.get(input.caseId))) throw new Error("That case no longer exists.");
    if (await db.traces.get(trace.id)) throw new Error("Trace id already exists.");
    await db.traces.add(trace);
  });
  return trace;
}

export async function deleteTrace(db: FraudWatchDB, id: string): Promise<void> { await db.traces.delete(id); }

export async function copyTrace(db: FraudWatchDB, id: string, caseId: string, deps: { id?: string; now?: Date } = {}): Promise<Trace> {
  return db.transaction("rw", db.traces, async () => {
    const source = await getTrace(db, id, caseId);
    if (!source.ok) throw new Error(source.reason === "newer_version" ? "This trace needs a newer FraudWatch." : "Trace is missing or unreadable.");
    const copy = duplicateTrace(source.trace, deps);
    if (await db.traces.get(copy.id)) throw new Error("Trace id already exists.");
    await db.traces.add(copy);
    return copy;
  });
}
