import { isIconKey } from "./icons";
import { MAX_HOPS, TRACE_SCHEMA_VERSION, movementKey, type MovementRef, type Trace, type TraceScope, type TraceSeed, type TraceStep } from "./model";
import { COLOR_KEYS, emptyPresentation, SIDES, type Annotation, type Point, type TracePresentation } from "./presentation";

export type LoadedTrace =
  | { ok: true; trace: Trace; migratedFrom?: number }
  | { ok: false; id: string; reason: "missing" | "invalid" | "newer_version"; raw?: unknown };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const nonempty = (value: unknown): value is string => string(value) && value.length > 0;
const amount = (value: unknown): value is string => string(value) && /^\d+$/.test(value);
const point = (value: unknown): value is Point => record(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
const color = (value: unknown): value is (typeof COLOR_KEYS)[number] => string(value) && (COLOR_KEYS as readonly string[]).includes(value);
const amounts = (value: unknown) => Array.isArray(value) && value.every((a) => record(a) && nonempty(a.assetId) && amount(a.amount));
const date = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));

function movementRef(value: unknown): value is MovementRef {
  return record(value) && nonempty(value.key) && nonempty(value.signature) && Number.isInteger(value.eventIndex) && (value.eventIndex as number) >= 0 &&
    nonempty(value.assetId) && (value.from === null || nonempty(value.from)) && (value.to === null || nonempty(value.to)) && amount(value.amount) &&
    (value.role === null || string(value.role)) && (value.time === null || (typeof value.time === "number" && Number.isFinite(value.time))) &&
    Number.isInteger(value.slot) && (value.slot as number) >= 0 && /^\d+$/.test(value.key.slice(value.key.lastIndexOf(":") + 1)) &&
    value.key === movementKey(value.signature, value.eventIndex as number, value as MovementRef, Number(value.key.slice(value.key.lastIndexOf(":") + 1)));
}

function step(value: unknown): value is TraceStep {
  if (!record(value) || !nonempty(value.id) || !date(value.addedAt) || (value.note !== undefined && !string(value.note))) return false;
  if (value.kind === "movement") return movementRef(value.ref) && (value.direction === "forward" || value.direction === "backward");
  return value.kind === "conversion" && nonempty(value.signature) && nonempty(value.address) && amounts(value.spent) && amounts(value.received);
}

function seed(value: unknown): value is TraceSeed {
  if (!record(value)) return false;
  if (value.kind === "address") return nonempty(value.address);
  if (value.kind === "transaction") return nonempty(value.signature);
  return value.kind === "movement" && movementRef(value.ref);
}

function scope(value: unknown): value is TraceScope {
  return record(value) && (value.assets === null || (Array.isArray(value.assets) && value.assets.every(nonempty))) &&
    (value.start === null || date(value.start)) && (value.end === null || date(value.end)) &&
    (value.minAmount === null || (record(value.minAmount) && nonempty(value.minAmount.assetId) && amount(value.minAmount.amount))) &&
    Number.isInteger(value.maxHops) && (value.maxHops as number) >= 1 && (value.maxHops as number) <= MAX_HOPS;
}

function end(value: unknown): boolean {
  return record(value) && (value.kind === "node" || value.kind === "annotation" ? nonempty(value.id) && (value.side === undefined || (SIDES as readonly unknown[]).includes(value.side)) : value.kind === "point" && point(value.at));
}

const optional = (value: unknown, allowed: readonly unknown[]) => value === undefined || allowed.includes(value);
/** Fields any annotation may have; all optional so older annotations stay valid. */
const common = (v: Record<string, unknown>) => (v.group === undefined || nonempty(v.group)) && (v.locked === undefined || typeof v.locked === "boolean");
const text = (v: Record<string, unknown>) => optional(v.fontSize, ["s", "m", "l"]) && optional(v.align, ["left", "center", "right"]);

export function isValidAnnotation(value: unknown): value is Annotation {
  if (!record(value) || !nonempty(value.id) || !common(value)) return false;
  if (value.kind === "note") return text(value) && optional(value.variant, ["text"]) && point(value.at) && typeof value.width === "number" && value.width > 0 && Number.isFinite(value.width) && (value.height === undefined || (typeof value.height === "number" && value.height > 0 && Number.isFinite(value.height))) && string(value.text) && value.text.length <= 2000 && color(value.color);
  if (value.kind === "shape") return text(value) && optional(value.strokeWidth, [1, 2, 4]) && point(value.at) && ["rect", "ellipse", "frame", "icon"].includes(String(value.shape)) && (value.shape !== "icon" || isIconKey(value.icon)) &&
    typeof value.width === "number" && value.width > 0 && Number.isFinite(value.width) && typeof value.height === "number" && value.height > 0 && Number.isFinite(value.height) &&
    string(value.label) && value.label.length <= 2000 && color(value.stroke) && (value.fill === "none" || color(value.fill));
  return value.kind === "connector" && optional(value.route, ["straight", "elbow"]) && optional(value.strokeWidth, [1, 2, 4]) &&
    (value.labelAt === undefined || (typeof value.labelAt === "number" && value.labelAt >= 0 && value.labelAt <= 1)) && end(value.from) && end(value.to) && string(value.label) && value.label.length <= 2000 &&
    ["none", "end", "both"].includes(String(value.arrow)) && color(value.color);
}

function presentation(value: unknown, pins: unknown): { clean: TracePresentation; invalid: unknown[] } {
  const raw = record(value) ? value : {};
  const clean = emptyPresentation();
  const positions = record(raw.positions) ? raw.positions : record(pins) ? pins : {};
  for (const [id, at] of Object.entries(positions)) if (point(at)) clean.positions[id] = at;
  if (record(raw.nodeStyles)) for (const [id, style] of Object.entries(raw.nodeStyles)) {
    if (!record(style)) continue;
    clean.nodeStyles[id] = {
      ...(color(style.color) ? { color: style.color } : { color: "default" as const }),
      ...(["s", "m", "l"].includes(String(style.size)) ? { size: style.size as "s" | "m" | "l" } : {}),
      ...(string(style.note) ? { note: style.note.slice(0, 2000) } : {}),
      ...(style.locked === true ? { locked: true } : {}),
      ...(nonempty(style.group) ? { group: style.group } : {}),
    };
  }
  const rawAnnotations = Array.isArray(raw.annotations) ? raw.annotations : [];
  const invalid = rawAnnotations.filter((a, i) => i >= 500 || !isValidAnnotation(a));
  clean.annotations = rawAnnotations.filter((a, i): a is Annotation => i < 500 && isValidAnnotation(a));
  clean.expandedServices = Array.isArray(raw.expandedServices) ? raw.expandedServices.filter(nonempty) : [];
  clean.hiddenBranches = Array.isArray(raw.hiddenBranches) ? raw.hiddenBranches.filter(nonempty) : [];
  if (record(raw.canvas)) clean.canvas = { grid: raw.canvas.grid === true, snap: raw.canvas.snap === true };
  return { clean, invalid };
}

/** Untrusted IndexedDB record. Preserve damaged items for review; never throw or delete them. */
export function parseTrace(raw: unknown): LoadedTrace {
  const id = record(raw) && string(raw.id) ? raw.id : "";
  if (raw === undefined) return { ok: false, id, reason: "missing" };
  if (!record(raw)) return { ok: false, id, reason: "invalid", raw };
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > TRACE_SCHEMA_VERSION) return { ok: false, id, reason: "newer_version", raw };
  if (raw.schemaVersion !== 0 && raw.schemaVersion !== TRACE_SCHEMA_VERSION) return { ok: false, id, reason: "invalid", raw };
  if (!nonempty(raw.id) || !nonempty(raw.caseId) || !nonempty(raw.name) || raw.name.trim().length > 80 || !seed(raw.seed) ||
    !["forward", "backward", "both"].includes(String(raw.direction)) || !scope(raw.scope) || !Array.isArray(raw.steps) ||
    !record(raw.analysisAtSave) || !Number.isInteger(raw.analysisAtSave.semantic) || !Number.isInteger(raw.analysisAtSave.registry) ||
    !date(raw.createdAt) || !date(raw.updatedAt)) return { ok: false, id, reason: "invalid", raw };

  const { clean, invalid } = presentation(raw.presentation, raw.pins);
  const validSteps = raw.steps.filter(step);
  const invalidSteps = [...(Array.isArray(raw.invalidSteps) ? raw.invalidSteps : []), ...raw.steps.filter((s) => !step(s))];
  const invalidAnnotations = [...(Array.isArray(raw.invalidAnnotations) ? raw.invalidAnnotations : []), ...invalid];
  const addresses = Array.isArray(raw.addresses) ? [...new Set(raw.addresses.filter(nonempty))] : [];
  const trace: Trace = {
    id: raw.id, caseId: raw.caseId, name: raw.name.trim(), schemaVersion: TRACE_SCHEMA_VERSION,
    seed: raw.seed, direction: raw.direction as Trace["direction"], scope: raw.scope, steps: validSteps,
    presentation: clean, analysisAtSave: raw.analysisAtSave as Trace["analysisAtSave"], createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    ...(addresses.length ? { addresses } : {}),
    ...(invalidSteps.length ? { invalidSteps } : {}), ...(invalidAnnotations.length ? { invalidAnnotations } : {}),
  };
  return { ok: true, trace, ...(raw.schemaVersion === 0 ? { migratedFrom: 0 } : {}) };
}
