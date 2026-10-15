import { analysisFingerprint, analysisVersions } from "@/lib/semantic/versions";
import { hideBranches } from "./branches";
import { TRACE_SCHEMA_VERSION, type BoundaryKind, type Trace, type TraceDirection, type TraceScope, type TraceSeed, type TraceStep } from "./model";
import type { TracePresentation } from "./presentation";
import { parseTrace } from "./storage";
import type { TraceEvidence, TraceView } from "./view";

/**
 * A trace as a file a reviewer can verify step by step, and the reverse
 * (docs/sprints/trace-graph/11). Every step is exported, hidden or stale,
 * with what's needed to find it on-chain. Never included: the RPC URL, raw
 * transactions, balances, other traces, hide rules or bookmarks.
 */

export const EXPORT_FORMAT = "fraudwatch-trace";
export const EXPORT_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const ATTRIBUTION = "Steps are observed movements in time order. They don't establish that the same funds moved between steps.";

export type StepStatus = "ok" | "stale" | "hidden_branch";
type ExportAmount = { assetId: string; amount: string; decimals: number | null };

export type ExportedStep =
  | {
      id: string; kind: "movement"; direction: "forward" | "backward"; signature: string; eventIndex: number; assetId: string;
      from: string | null; to: string | null; amount: string; decimals: number | null; role: string | null;
      time: string | null; slot: number; key: string; category: string | null; confidence: string | null; status: StepStatus; note?: string;
    }
  | { id: string; kind: "conversion"; signature: string; address: string; spent: ExportAmount[]; received: ExportAmount[]; status: StepStatus; note?: string };

export type TraceExport = {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  chain: "solana";
  analysis: ReturnType<typeof analysisVersions> & { fingerprint: string };
  case: { range: { start: string; end: string } };
  trace: { name: string; seed: TraceSeed; direction: TraceDirection; scope: TraceScope; steps: ExportedStep[] };
  disclosures: {
    attribution: string;
    hiddenBranches: string[];
    collapsedServices: { protocol: string; addresses: string[] }[];
    boundaries: { addresses: string[]; kind: BoundaryKind }[];
    staleSteps: string[];
    outOfScopeSteps: { step: string; reason: string }[];
    incompleteHistory: string[];
  };
  /** Public registry names for addresses in the trace. */
  attribution: Record<string, { source: "registry"; protocol: string; label: string; category: string; registryVersion: number }>;
  /** Only when the investigator opts in. Notes are never exported. */
  labels?: Record<string, { name: string; tags: string[] }>;
  canvas?: { note: string } & TracePresentation;
};

export type ExportOptions = {
  caseRange: { start: string; end: string };
  decimals: (assetId: string) => number | null;
  includeLabels: boolean;
  includeLayout: boolean;
  labelOf?: (address: string) => { name: string; tags: string[] } | undefined;
  now?: Date;
};

export function exportTrace(trace: Trace, view: TraceView, evidence: TraceEvidence, options: ExportOptions): TraceExport {
  const stale = new Set(view.issues.flatMap((i) => (i.kind === "stale" ? [i.stepId] : [])));
  const drawn = new Set(hideBranches(view, trace.presentation.hiddenBranches).view.edges.map((e) => e.id));
  const hidden = new Set(view.edges.filter((e) => !drawn.has(e.id)).flatMap((e) => e.steps));
  const status = (id: string): StepStatus => (stale.has(id) ? "stale" : hidden.has(id) ? "hidden_branch" : "ok");
  const amount = (a: { assetId: string; amount: string }): ExportAmount => ({ ...a, decimals: options.decimals(a.assetId) });

  const steps = trace.steps.map((step): ExportedStep => {
    const note = step.note ? { note: step.note } : {};
    if (step.kind === "conversion") {
      return { id: step.id, kind: "conversion", signature: step.signature, address: step.address, spent: step.spent.map(amount), received: step.received.map(amount), status: evidence.events.has(step.signature) ? "ok" : "stale", ...note };
    }
    const { ref } = step;
    const event = evidence.events.get(ref.signature);
    return {
      id: step.id, kind: "movement", direction: step.direction, signature: ref.signature, eventIndex: ref.eventIndex, assetId: ref.assetId,
      from: ref.from, to: ref.to, amount: ref.amount, decimals: options.decimals(ref.assetId), role: ref.role,
      time: ref.time === null ? null : new Date(ref.time).toISOString(), slot: ref.slot, key: ref.key,
      category: event?.category ?? null, confidence: event?.confidence ?? null, status: status(step.id), ...note,
    };
  });

  const addresses = new Set(view.nodes.flatMap((n) => n.addresses));
  const attribution: TraceExport["attribution"] = {};
  const registryVersion = analysisVersions().registry;
  for (const address of addresses) {
    const entry = evidence.serviceOf?.(address);
    if (entry) attribution[address] = { source: "registry", protocol: entry.protocolName, label: entry.label, category: entry.category, registryVersion };
  }
  const labels: Record<string, { name: string; tags: string[] }> = {};
  if (options.includeLabels && options.labelOf) for (const address of addresses) {
    const label = options.labelOf(address);
    if (label && (label.name || label.tags.length)) labels[address] = { name: label.name, tags: [...label.tags] };
  }

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    chain: "solana",
    analysis: { ...analysisVersions(), fingerprint: analysisFingerprint() },
    case: { range: { ...options.caseRange } },
    trace: { name: trace.name, seed: trace.seed, direction: trace.direction, scope: trace.scope, steps },
    disclosures: {
      attribution: ATTRIBUTION,
      hiddenBranches: [...trace.presentation.hiddenBranches],
      collapsedServices: view.nodes.flatMap((n) => (n.service ? [{ protocol: n.service.name, addresses: [...n.addresses] }] : [])),
      boundaries: view.nodes.flatMap((n) => n.boundaries.map((kind) => ({ addresses: [...n.addresses], kind }))),
      staleSteps: steps.filter((s) => s.status === "stale").map((s) => s.id),
      outOfScopeSteps: view.issues.flatMap((i) => (i.kind === "out_of_scope" ? [{ step: i.stepId, reason: i.reason }] : [])),
      incompleteHistory: [...addresses].filter((a) => evidence.coverage(a)?.complete === false).sort(),
    },
    attribution,
    ...(options.includeLabels ? { labels } : {}),
    ...(options.includeLayout ? { canvas: { note: "Investigator presentation, not evidence: positions, styles and annotations.", ...structuredClone(trace.presentation) } } : {}),
  };
}

/** What an import would create: a new trace's content, before it gets an id. */
export type TraceImport = {
  name: string; seed: TraceSeed; direction: TraceDirection; scope: TraceScope; steps: TraceStep[]; presentation: TracePresentation;
  /** Steps or annotations in the file that couldn't be read; they aren't imported. */
  skipped: { steps: number; annotations: number };
  exportedAt: string;
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Untrusted file text → a validated trace to create, or why not. Never fetches. */
export function parseTraceImport(text: string): { ok: true; trace: TraceImport } | { ok: false; error: string } {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return { ok: false, error: "The file is larger than 5 MB." };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `The file isn't valid JSON (${err instanceof Error ? err.message : String(err)}).` };
  }
  if (!record(doc) || doc.format !== EXPORT_FORMAT) return { ok: false, error: "This isn't a FraudWatch trace export." };
  if (typeof doc.formatVersion !== "number" || doc.formatVersion > EXPORT_FORMAT_VERSION) return { ok: false, error: `This file was made by a newer FraudWatch (format version ${String(doc.formatVersion)}); this version reads up to ${EXPORT_FORMAT_VERSION}.` };
  const t = doc.trace;
  if (!record(t) || !Array.isArray(t.steps)) return { ok: false, error: "The file has no trace." };
  const rawSteps: unknown[] = t.steps;
  const exportedAt = typeof doc.exportedAt === "string" && Number.isFinite(Date.parse(doc.exportedAt)) ? doc.exportedAt : new Date().toISOString();
  const steps = rawSteps.map((raw) => {
    if (!record(raw)) return raw;
    const base = { id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(), addedAt: exportedAt, ...(typeof raw.note === "string" ? { note: raw.note } : {}) };
    if (raw.kind === "conversion") {
      const strip = (list: unknown) => (Array.isArray(list) ? list.map((a) => (record(a) ? { assetId: a.assetId, amount: a.amount } : a)) : list);
      return { ...base, kind: "conversion", signature: raw.signature, address: raw.address, spent: strip(raw.spent), received: strip(raw.received) };
    }
    const time = typeof raw.time === "string" ? Date.parse(raw.time) : null;
    return {
      ...base, kind: "movement", direction: raw.direction === "backward" ? "backward" : "forward",
      ref: { key: raw.key, signature: raw.signature, eventIndex: raw.eventIndex, assetId: raw.assetId, from: raw.from ?? null, to: raw.to ?? null, amount: raw.amount, role: raw.role ?? null, time: time !== null && Number.isFinite(time) ? time : null, slot: raw.slot },
    };
  });
  const canvas = record(doc.canvas) ? doc.canvas : {};
  // The storage parser is the one gate for trace records: it validates every field and sets aside what it can't read.
  const parsed = parseTrace({
    id: "import", caseId: "import", name: typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 80) : "Imported trace",
    schemaVersion: TRACE_SCHEMA_VERSION, seed: t.seed, direction: t.direction, scope: t.scope, steps, presentation: canvas,
    analysisAtSave: { semantic: 0, registry: 0 }, createdAt: exportedAt, updatedAt: exportedAt,
  });
  if (!parsed.ok) return { ok: false, error: "The trace's seed, direction or scope can't be read." };
  const p = parsed.trace;
  return { ok: true, trace: { name: p.name, seed: p.seed, direction: p.direction, scope: p.scope, steps: p.steps, presentation: p.presentation, skipped: { steps: p.invalidSteps?.length ?? 0, annotations: p.invalidAnnotations?.length ?? 0 }, exportedAt } };
}

/** `[a-z0-9-]` only, for file names. */
export const fileSlug = (name: string) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "trace";
