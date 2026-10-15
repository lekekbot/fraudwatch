"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { WalletIcon, ChevronDownIcon, CopyIcon, DownloadIcon, FilePlus2Icon, ListIcon, PencilIcon, PlusIcon, Redo2Icon, SlidersHorizontalIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon, UploadIcon, WaypointsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocalQuery } from "@/hooks/use-local-db";
import { useTraces } from "@/hooks/use-traces";
import type { BehaviorObservation } from "@/lib/behavior/observations";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState } from "@/lib/state/reconstruct";
import { describeStorageError } from "@/lib/db/db";
import { getTrace } from "@/lib/db/traces";
import type { Names } from "@/lib/labels/labels";
import { buildCasePath } from "@/lib/routing/case-path";
import { isValidSolanaAddress } from "@/lib/solana/address";
import { formatBaseUnits } from "@/lib/solana/amount";
import { addAddress, addAnnotation, addSteps, removeAddress, removeAnnotations, removeInvalidItems, removeSteps, renameTrace, reorderAnnotation, setCanvasOptions, setDirection, setNodeStyle, setBranchHidden, setPositions, setScope, setServiceExpanded, updateAnnotation } from "@/lib/trace/edit";
import { hideBranches } from "@/lib/trace/branches";
import { parseTraceImport, type TraceImport } from "@/lib/trace/export";
import { emptyHistory, type History, push, redo, undo } from "@/lib/trace/history";
import { annotationBox } from "@/lib/trace/geometry";
import { autoPlace, TRACE_SPACING } from "@/lib/trace/layout";
import type { MovementRef, Trace, TraceSeed, TraceStep } from "@/lib/trace/model";
import type { MovementIndex } from "@/lib/trace/movements";
import { COLOR_KEYS, type Annotation, type ColorKey } from "@/lib/trace/presentation";
import { buildTraceView, type TraceEvidence, type TraceView as TraceViewModel } from "@/lib/trace/view";
import { assetLabel, type Assets } from "../asset-format";
import { PanelSection, SidePanel } from "../panel";
import { BranchPanel } from "./branch-panel";
import { CandidatePanel } from "./candidate-panel";
import { ExportDialog, ImportDialog } from "./export-dialog";
import { SeedDialog, type NewTraceConfig, type TraceStartRequest } from "./seed-dialog";
import { ScopeDialog } from "./scope-dialog";
import { TraceCanvas, type TraceSelection } from "./trace-canvas";
import { NodeTraceSection, TraceInspector } from "./trace-inspector";

/** What the Trace view keeps per trace while the case is open: selection and zoom survive switching views, never saved. */
export type TraceUiState = { selection?: TraceSelection; transform?: { x: number; y: number; k: number } };
export type TraceUiStore = { get: (id: string) => TraceUiState | undefined; set: (id: string, patch: TraceUiState) => void };

const NO_SELECTION: TraceSelection = { nodes: [], edges: [], annotations: [] };
const MAX_CHILDREN = 100;

/** Whether adding `refs` takes some node past MAX_CHILDREN distinct counterparties in that direction. */
function widens(steps: readonly TraceStep[], refs: readonly MovementRef[], direction: "forward" | "backward"): boolean {
  const children = new Map<string, Set<string>>();
  const count = (ref: MovementRef) => {
    const [node, child] = direction === "forward" ? [ref.from, ref.to] : [ref.to, ref.from];
    if (!node || !child) return;
    const set = children.get(node) ?? new Set();
    set.add(child);
    children.set(node, set);
  };
  steps.forEach((s) => { if (s.kind === "movement") count(s.ref); });
  const before = new Map([...children].map(([node, set]) => [node, set.size]));
  refs.forEach(count);
  return [...children].some(([node, set]) => set.size > MAX_CHILDREN && (before.get(node) ?? 0) <= MAX_CHILDREN);
}

export function TraceView({ caseId, traceId, evidence, index, caseRange, loadedRange, hiddenReason, wallets, names, assets, observations, eventState, transactionOf, ui, renderAddressPanel, inspectorOpen, requestedSeed, onSeedHandled, onMapWallet, onOpenTransaction, onShowInGraph, loadStatus, loadError }: {
  caseId: string; traceId: string | null; evidence: TraceEvidence; index: MovementIndex | null;
  caseRange: { start: string; end: string };
  loadedRange: (address: string) => { start: string; end: string } | null;
  hiddenReason: (signature: string) => "manual" | "rule" | null;
  wallets: readonly string[]; names: Names; assets: Assets; observations: readonly BehaviorObservation[];
  eventState: WalletState | null; transactionOf: (signature: string) => CanonicalTransaction | undefined;
  ui: TraceUiStore; renderAddressPanel: (address: string) => React.ReactNode;
  /** The shell's inspector toggle: with nothing selected, show the trace overview. */
  inspectorOpen: boolean;
  onShowInGraph: (label: string, signatures: string[]) => void; requestedSeed: TraceStartRequest | null; onSeedHandled: () => void;
  onMapWallet: (address: string) => void;
  onOpenTransaction: (signature: string, from: string | null, to: string | null) => void;
  loadStatus: string;
  loadError: string | null;
}) {
  const traces = useTraces(caseId);
  const selected = useLocalQuery((db) => traceId ? getTrace(db, traceId, caseId) : Promise.resolve({ ok: false as const, id: "", reason: "missing" as const }), [traceId, caseId]);
  const loaded = selected.status === "ready" && selected.data.ok && selected.data.trace.caseId === caseId ? selected.data.trace : null;
  const latest = useRef<Trace | null>(null);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const [optimistic, setOptimistic] = useState<Trace | null>(null);
  const [newSeed, setNewSeed] = useState<TraceSeed | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [selection, setSelectionState] = useState<TraceSelection>(() => (traceId && ui.get(traceId)?.selection) || NO_SELECTION);
  const setSelection = (value: TraceSelection) => { setSelectionState(value); setAddressFocus(null); if (traceId) ui.set(traceId, { selection: value }); };
  /** An address picked from evidence (not a trace node) shown in the side panel. */
  const [addressFocus, setAddressFocus] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState<{ imported: TraceImport; found: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const canvasHandle = useRef<HTMLCanvasElement | null>(null);
  const setCanvas = useCallback((el: HTMLCanvasElement | null) => { canvasHandle.current = el; }, []);
  const [candidateDirection, setCandidateDirection] = useState<"forward" | "backward" | null>(null);
  useEffect(() => {
    if (loaded && latest.current?.id !== loaded.id) latest.current = loaded;
  }, [loaded]);
  const active = loaded && optimistic?.id === loaded.id ? optimistic : loaded;
  const historyRef = useRef<History>(emptyHistory());
  const [history, setHistoryState] = useState<History>(emptyHistory);
  /** Session-only undo (D7). Snapshots of another trace never apply here. */
  const historyFor = (id: string) => { const h = historyRef.current; return [...h.past, ...h.future].every((t) => t.id === id) ? h : emptyHistory(); };
  const setHistory = (h: History) => { historyRef.current = h; setHistoryState(h); };
  /** Set when an automatic placement couldn't be saved, so it isn't retried on every render. */
  const placementFailed = useRef(false);
  const write = (next: Trace, onFail?: () => void) => {
    latest.current = next;
    setOptimistic(next);
    pendingSave.current = traces.save(next).catch((err) => { onFail?.(); if (latest.current === next) { latest.current = loaded; setOptimistic(loaded); } toast.error(describeStorageError(err)); });
  };
  const persist = (update: (trace: Trace) => Trace, { record = true } = {}) => {
    const current = latest.current?.id === loaded?.id ? latest.current : loaded;
    if (!current) return;
    try {
      const next = update(current);
      if (next === current) return;
      if (record) setHistory(push(historyFor(current.id), current));
      write(next, record ? undefined : () => { placementFailed.current = true; });
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };
  const travel = (kind: "undo" | "redo") => {
    const current = latest.current?.id === loaded?.id ? latest.current : loaded;
    if (!current) return;
    const result = (kind === "undo" ? undo : redo)(historyFor(current.id), current);
    if (!result) return;
    setHistory(result.history);
    write(result.trace);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      travel(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const view = useMemo(() => active ? buildTraceView(active, evidence) : null, [active, evidence]);
  const missing = useMemo(() => active && view ? autoPlace({ view, spacing: TRACE_SPACING, positions: active.presentation.positions, obstacles: active.presentation.annotations.flatMap((a) => a.kind === "shape" ? [{ x: a.at.x, y: a.at.y, width: a.width, height: a.height }] : a.kind === "note" ? [{ x: a.at.x, y: a.at.y, width: a.width, height: 80 }] : []) }) : {}, [active, view]);
  useEffect(() => {
    if (!active || !Object.keys(missing).length || placementFailed.current) return;
    persist((trace) => setPositions(trace, missing), { record: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new saved trace removes missing positions
  }, [active, missing]);
  const shown = useMemo(() => view && active ? hideBranches(view, active.presentation.hiddenBranches) : null, [view, active]);
  const open = (id: string | null) => { latest.current = null; placementFailed.current = false; setHistory(emptyHistory()); setOptimistic(null); setSelectionState((id && ui.get(id)?.selection) || NO_SELECTION); setAddressFocus(null); window.history.pushState(null, "", buildCasePath(caseId, "trace", id)); };
  const readImport = async (file: File) => {
    const result = parseTraceImport(await file.text());
    if (!result.ok) { toast.error(result.error); return; }
    const found = result.trace.steps.filter((s) => evidence.events.has(s.kind === "movement" ? s.ref.signature : s.signature)).length;
    setImporting({ imported: result.trace, found });
  };
  const confirmImport = async () => {
    if (!importing) return;
    const { imported } = importing;
    const taken = new Set(traces.list.status === "ready" ? traces.list.data.map((t) => t.name) : []);
    let name = imported.name;
    for (let n = 1; taken.has(name); n++) name = `${imported.name.slice(0, 64)} (imported${n > 1 ? ` ${n}` : ""})`;
    const trace = await traces.create({ name, seed: imported.seed, direction: imported.direction, scope: imported.scope, steps: imported.steps, presentation: imported.presentation });
    setImporting(null);
    open(trace.id);
  };
  const importControls = <>
    <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readImport(file); }} />
    {importing && <ImportDialog imported={importing.imported} found={importing.found} onClose={() => setImporting(null)} onConfirm={confirmImport} />}
  </>;
  const closeNew = () => { setNewOpen(false); setNewSeed(null); onSeedHandled(); };
  const create = async (config: NewTraceConfig) => {
    const steps: TraceStep[] = config.refs.map((ref) => ({ id: crypto.randomUUID(), kind: "movement", ref, direction: config.direction === "backward" ? "backward" : "forward", addedAt: new Date().toISOString() }));
    const trace = await traces.create({ name: config.name, seed: config.seed, direction: config.direction, scope: config.scope, steps });
    closeNew(); open(trace.id);
  };
  const rename = () => { if (!loaded) return; const name = window.prompt("Trace name", loaded.name); if (name !== null) persist((trace) => renameTrace(trace, name)); };
  const duplicate = async () => { if (!active) return; try { await pendingSave.current; const copy = await traces.duplicate(active.id); open(copy.id); } catch (err) { toast.error(describeStorageError(err)); } };
  const remove = async () => { if (!active || !window.confirm(`Delete ${active.name} and its ${active.steps.length} steps? This cannot be undone.`)) return; try { await pendingSave.current; await traces.remove(active.id); open(null); } catch (err) { toast.error(describeStorageError(err)); } };
  const addMovements = (refs: MovementRef[], direction: "forward" | "backward") => {
    if (active && widens(active.steps, refs, direction) && !window.confirm(`This gives a node more than ${MAX_CHILDREN} direct ${direction === "forward" ? "recipients" : "senders"} in the trace. Add anyway?`)) return;
    const ids = refs.map(() => crypto.randomUUID());
    const steps: TraceStep[] = refs.map((ref, i) => ({ id: ids[i], kind: "movement", ref, direction, addedAt: new Date().toISOString() }));
    persist((trace) => addSteps(trace, steps));
    toast.success(`Added ${steps.length} movement${steps.length === 1 ? "" : "s"}`, { action: { label: "Undo", onClick: () => persist((trace) => removeSteps(trace, new Set(ids))) } });
  };
  const addConversion = (step: Extract<TraceStep, { kind: "conversion" }>, followAsset: boolean) => persist((trace) => {
    const next = addSteps(trace, [step]);
    if (!followAsset) return next;
    const accepted = new Set(next.scope.assets ?? []);
    step.received.forEach((amount) => accepted.add(amount.assetId));
    return setScope(next, { ...next.scope, assets: [...accepted] });
  });
  const startDialog = (seed: TraceSeed | null = null) => { setNewSeed(seed); setNewOpen(true); };
  const dialog = (requestedSeed || newOpen) && <SeedDialog key={JSON.stringify(requestedSeed ?? newSeed)} initialSeed={requestedSeed?.seed ?? newSeed} initialRefs={requestedSeed?.refs} wallets={wallets} names={names} index={index} assets={assets} caseRange={caseRange} onClose={closeNew} onCreate={create} />;
  if (!traceId) return <TraceList
    list={traces.list}
    onOpen={open}
    onStart={() => startDialog()}
    onImport={() => importRef.current?.click()}
    extra={<>{dialog}{importControls}</>}
  />;
  if (selected.status === "loading") return <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading trace…</p>;
  if (selected.status === "error") return <p className="flex flex-1 items-center justify-center text-sm text-destructive">{selected.error}</p>;
  if (!active || !view || !shown) {
    const result = selected.data;
    const missingOrOtherCase = result.ok || result.reason === "missing";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
        <p>{missingOrOtherCase ? "Trace not found in this case." : result.reason === "newer_version" ? "Made by a newer FraudWatch; read-only." : "Couldn't read this trace."}</p>
        <div className="flex gap-2">
          {!result.ok && result.raw !== undefined && <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result.raw, null, 2))}>Copy raw JSON</Button>}
          {!missingOrOtherCase && <Button variant="destructive" size="sm" onClick={() => { if (window.confirm("Delete this unreadable trace? This cannot be undone.")) void traces.remove(traceId).then(() => open(null)).catch((err) => toast.error(describeStorageError(err))); }}>Delete trace</Button>}
          <Button variant="outline" size="sm" onClick={() => open(null)}>Back to traces</Button>
        </div>
      </div>
    );
  }
  const presentation = { ...active.presentation, positions: { ...active.presentation.positions, ...missing } };
  const assetText = (assetId: string, amount: string) => `${formatBaseUnits(amount, assets.get(assetId)?.decimals ?? (assetId === "SOL" ? 9 : 0))} ${assetLabel(assetId, assets)}`;
  const node = view.nodes.find((item) => item.id === selection.nodes[0]);
  const edge = view.edges.find((item) => item.id === selection.edges[0]);
  const annotation = active.presentation.annotations.find((item) => item.id === selection.annotations[0]);
  const inspectorActions = {
    onRemove: (ids: Set<string>) => removeEdge(ids),
    onReplace: (stepId: string, ref: MovementRef) => persist((trace) => {
      const old = trace.steps.find((s) => s.id === stepId);
      return addSteps(removeSteps(trace, new Set([stepId])), [{ id: crypto.randomUUID(), kind: "movement", ref, direction: old?.kind === "movement" ? old.direction : "forward", addedAt: new Date().toISOString() }]);
    }),
    onAddLegs: (refs: MovementRef[]) => addMovements(refs, "forward"),
    onOpenInTimeline: onOpenTransaction,
    onShowInGraph,
    onStartMovement: (step: Extract<TraceStep, { kind: "movement" }>) => startDialog({ kind: "movement", ref: step.ref }),
    onSelectAddress: setAddressFocus,
  };
  /** A wallet put on the trace by hand: below everything drawn, in the seed's column, then selected so its movements are one click away. */
  const placeAddress = (address: string) => {
    // Below every node and drawn shape, so it never lands on top of the investigator's annotations.
    const positions = [...Object.values(presentation.positions), ...presentation.annotations.flatMap((a) => { const box = annotationBox(a); return box ? [{ x: box.x, y: box.y + box.height }] : []; })];
    const seedAt = shown.view.nodes.find((n) => n.isSeed && presentation.positions[n.id]) ? presentation.positions[shown.view.nodes.find((n) => n.isSeed && presentation.positions[n.id])!.id] : { x: 0, y: 0 };
    const at = { x: seedAt.x, y: positions.length ? Math.max(...positions.map((p) => p.y)) + TRACE_SPACING.row * 1.5 : 0 };
    persist((trace) => setPositions(addAddress(trace, address), { [address]: at }));
    setSelection({ nodes: [address], edges: [], annotations: [] });
  };
  const removeEdge = (ids: Set<string>) => { if (window.confirm(`Remove ${ids.size} movement${ids.size === 1 ? "" : "s"} from this trace?`)) { persist((trace) => removeSteps(trace, ids)); if (edge && ids.size === edge.steps.length) setSelection({ nodes: [], edges: [], annotations: [] }); } };
  const invalid = (active.invalidSteps?.length ?? 0) + (active.invalidAnnotations?.length ?? 0);
  const service = node && !node.service ? evidence.serviceOf?.(node.id) : undefined;

  let inspector: React.ReactNode;
  const many = selection.nodes.length + selection.annotations.length + selection.edges.length > 1;
  if (many && !addressFocus) {
    const parts = [[selection.nodes.length, "address", "addresses"], [selection.annotations.length, "annotation", "annotations"], [selection.edges.length, "line", "lines"]] as const;
    inspector = <PanelSection title="Selection">
      <p className="text-xs">{parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(" · ")}</p>
      <p className="text-xs text-muted-foreground">Drag to move them together; arrow keys nudge (Shift for 10). Use the toolbar above the selection for colour, duplicate, order and delete. Click one item to work on it alone.</p>
      {selection.nodes.length > 0 && <Button variant="outline" size="xs" className="self-start" onClick={() => onShowInGraph(`${selection.nodes.length} traced addresses`, [...new Set(view.edges.filter((e) => selection.nodes.includes(e.from) || selection.nodes.includes(e.to)).flatMap((e) => e.steps).flatMap((id) => { const step = active.steps.find((s) => s.id === id); return step?.kind === "movement" ? [step.ref.signature] : []; }))])}>Show their movements in Graph</Button>}
    </PanelSection>;
  } else if (addressFocus) {
    inspector = <>
      <div className="flex items-center justify-between border-b p-3">
        <span className="text-xs font-medium text-muted-foreground">Address from the evidence</span>
        <Button variant="ghost" size="xs" onClick={() => setAddressFocus(null)}>Back to selection</Button>
      </div>
      {renderAddressPanel(addressFocus)}
    </>;
  } else if (node && index) {
    const style = active.presentation.nodeStyles[node.id] ?? {};
    inspector = <>
      <PanelSection title="In this trace">
        <NodeTraceSection node={node} view={view} trace={active} names={names} evidence={evidence} assetName={(id) => assetLabel(id, assets)} onShowInGraph={onShowInGraph} onMapWallet={onMapWallet} onNewTrace={() => startDialog()} onOpenInTimeline={onOpenTransaction} />
        {node.service && <Button variant="outline" size="xs" className="self-start" onClick={() => persist((trace) => setServiceExpanded(trace, node.service!.id, true))}>Show {node.addresses.length} addresses separately</Button>}
        {service && active.presentation.expandedServices.includes(service.protocolId) && <Button variant="outline" size="xs" className="self-start" onClick={() => persist((trace) => setServiceExpanded(trace, service.protocolId, false))}>Group as {service.protocolName}</Button>}
        <Button variant="ghost" size="xs" className="self-start" onClick={() => startDialog({ kind: "address", address: node.addresses[0] })}>Start another trace here</Button>
        {node.placed && (view.edges.some((e) => e.from === node.id || e.to === node.id) || node.conversions.length
          ? <p className="text-xs text-muted-foreground">You placed this wallet on the trace. It stays while it has movements.</p>
          : <Button variant="outline" size="xs" className="self-start" onClick={() => { persist((trace) => removeAddress(trace, node.id)); setSelection(NO_SELECTION); }}>Remove from trace</Button>)}
      </PanelSection>
      <PanelSection title="Branch">
        <BranchPanel node={node} view={view} hidden={active.presentation.hiddenBranches.includes(node.id)} observations={observations} names={names} assetText={assetText} onHidden={(hidden) => persist((trace) => setBranchHidden(trace, node.id, hidden))} onOpenTransaction={onOpenTransaction} />
      </PanelSection>
      <PanelSection title="Add movements">
        <CandidatePanel key={`${node.id}:${candidateDirection ?? "default"}`} initialDirection={candidateDirection ?? undefined} node={node} trace={active} index={index} evidence={evidence} caseRange={caseRange} loadedRange={loadedRange} hiddenReason={hiddenReason} names={names} assets={assets} assetText={assetText} loadStatus={loadStatus} loadError={loadError} onAdd={addMovements} onAddConversion={addConversion} onMapWallet={onMapWallet} />
      </PanelSection>
      <PanelSection title="Style on the canvas" defaultCollapsed>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="grid gap-1 text-muted-foreground">Colour<select className={SELECT} value={style.color ?? "default"} onChange={(e) => persist((trace) => setNodeStyle(trace, node.id, { ...style, color: e.target.value as ColorKey }))}>{COLOR_KEYS.map((key) => <option key={key} value={key}>{key === "default" ? "Default" : key[0].toUpperCase() + key.slice(1)}</option>)}</select></label>
          <label className="grid gap-1 text-muted-foreground">Size<select className={SELECT} value={style.size ?? "m"} onChange={(e) => persist((trace) => setNodeStyle(trace, node.id, { ...style, size: e.target.value as "s" | "m" | "l" }))}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select></label>
        </div>
        <NoteField key={`${node.id}:${style.note ?? ""}`} label="Note (shown on hover)" value={style.note ?? ""} onCommit={(note) => persist((trace) => setNodeStyle(trace, node.id, { ...style, note }))} />
      </PanelSection>
      {!node.service && renderAddressPanel(node.id)}
    </>;
  } else if (edge) {
    inspector = <TraceInspector key={edge.id} edge={edge} trace={active} view={view} evidence={evidence} index={index} names={names} assets={assets} assetText={assetText} eventState={eventState} transactionOf={transactionOf} hiddenReason={hiddenReason} actions={inspectorActions} />;
  } else if (annotation) {
    const colour = annotation.kind === "shape" ? annotation.stroke : annotation.color;
    inspector = <PanelSection title="Annotation · drawn by you, not evidence">
      <NoteField key={`${annotation.id}:${annotation.kind === "note" ? annotation.text : annotation.label}`} label={annotation.kind === "note" ? "Text" : "Label"} value={annotation.kind === "note" ? annotation.text : annotation.label} onCommit={(text) => persist((trace) => updateAnnotation(trace, annotation.id, annotation.kind === "note" ? { text } : { label: text }))} />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="grid gap-1 text-muted-foreground">{annotation.kind === "shape" ? "Outline" : "Colour"}<select className={SELECT} value={colour} onChange={(e) => persist((trace) => updateAnnotation(trace, annotation.id, annotation.kind === "shape" ? { stroke: e.target.value as ColorKey } : { color: e.target.value as ColorKey }))}>{COLOR_KEYS.map((key) => <option key={key} value={key}>{key === "default" ? "Default" : key[0].toUpperCase() + key.slice(1)}</option>)}</select></label>
        {annotation.kind === "shape" && <label className="grid gap-1 text-muted-foreground">Fill<select className={SELECT} value={annotation.fill} onChange={(e) => persist((trace) => updateAnnotation(trace, annotation.id, { fill: e.target.value as ColorKey | "none" }))}><option value="none">None</option>{COLOR_KEYS.map((key) => <option key={key} value={key}>{key === "default" ? "Default" : key[0].toUpperCase() + key.slice(1)}</option>)}</select></label>}
        {annotation.kind === "connector" && <label className="grid gap-1 text-muted-foreground">Arrow<select className={SELECT} value={annotation.arrow} onChange={(e) => persist((trace) => updateAnnotation(trace, annotation.id, { arrow: e.target.value as "none" | "end" | "both" }))}><option value="none">None</option><option value="end">End</option><option value="both">Both ends</option></select></label>}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="xs" onClick={() => persist((trace) => reorderAnnotation(trace, annotation.id, "front"))}>Bring to front</Button>
        <Button variant="outline" size="xs" onClick={() => persist((trace) => reorderAnnotation(trace, annotation.id, "back"))}>Send to back</Button>
        <Button variant="destructive" size="xs" onClick={() => { persist((trace) => removeAnnotations(trace, new Set([annotation.id]))); setSelection(NO_SELECTION); }}>Delete</Button>
      </div>
    </PanelSection>;
  } else {
    inspector = <TraceOverview trace={active} view={view} shownNodes={shown.view.nodes.length} hiddenBranches={shown.counts.size} names={names} assetName={(id) => assetLabel(id, assets)} onScope={() => setScopeOpen(true)} onCopyJson={() => void navigator.clipboard.writeText(JSON.stringify(loaded, null, 2))} onRemoveInvalid={() => { if (window.confirm("Remove unreadable items from this trace? This cannot be undone.")) persist((trace) => removeInvalidItems(trace)); }} />;
  }
  const showInspector = inspectorOpen || Boolean(addressFocus || node || edge || annotation);

  return <>
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <TraceCanvas
        key={active.id}
        onCanvas={setCanvas}
        selection={selection}
        initialTransform={ui.get(active.id)?.transform}
        onTransform={(transform) => ui.set(active.id, { transform })}
        view={shown.view}
        hidden={shown}
        onBranchHidden={(id, hidden) => persist((trace) => setBranchHidden(trace, id, hidden))}
        presentation={presentation}
        steps={active.steps}
        names={names}
        stateOf={evidence.addressState}
        assetText={assetText}
        onSelection={setSelection}
        onCandidateDirection={(direction) => { if (active.direction === "both" || active.direction === direction) setCandidateDirection(direction); }}
        onStartAtNode={(address) => startDialog({ kind: "address", address })}
        onMapWallet={onMapWallet}
        onRemoveEvidence={removeEdge}
        onMove={(positions, patches, styles) => persist((trace) => {
          let next = Object.keys(positions).length ? setPositions(trace, positions) : trace;
          for (const item of patches ?? []) next = updateAnnotation(next, item.id, item.patch);
          for (const [id, style] of Object.entries(styles ?? {})) next = setNodeStyle(next, id, { ...next.presentation.nodeStyles[id], ...style });
          return next;
        })}
        onOptions={(options) => persist((trace) => setCanvasOptions(trace, options))}
        onAddAnnotation={(item: Annotation) => persist((trace) => addAnnotation(trace, item))}
        onUpdateAnnotation={(id: string, patch: Partial<Annotation>) => persist((trace) => updateAnnotation(trace, id, patch))}
        onRemoveAnnotations={(ids: Set<string>) => persist((trace) => removeAnnotations(trace, ids))}
        onAddAnnotations={(items) => persist((trace) => items.reduce((next, item) => addAnnotation(next, item), trace))}
        onReorder={(ids, edge) => persist((trace) => {
          // Keep the selection's own order: move the front-most first when going forward, the back-most first going back.
          const order = trace.presentation.annotations.map((a) => a.id).filter((id) => ids.includes(id));
          return (edge === "front" || edge === "backward" ? order : [...order].reverse()).reduce((next, id) => reorderAnnotation(next, id, edge), trace);
        })}
        onNodeStyles={(ids, style) => persist((trace) => ids.reduce((next, id) => setNodeStyle(next, id, { ...next.presentation.nodeStyles[id], ...style }), trace))}
        toolbarStart={<>
          <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={history.past.at(-1)?.id !== active.id} onClick={() => travel("undo")}><Undo2Icon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo (Shift+Ctrl/Cmd+Z)" disabled={history.future[0]?.id !== active.id} onClick={() => travel("redo")}><Redo2Icon /></Button>
        </>}
        toolbarEnd={<>
          <AddWallet wallets={wallets} onTrace={new Set(view.nodes.flatMap((n) => n.addresses))} names={names} onAdd={placeAddress} />
          <Button variant="ghost" size="sm" title="Direction, assets, dates, minimum amount and hop limit" onClick={() => setScopeOpen(true)}><SlidersHorizontalIcon />Scope</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Export" title="Export JSON or PNG" onClick={() => setExportOpen(true)}><DownloadIcon /></Button>
        </>}
        overlay={<div className="flex flex-col items-start gap-1.5">
          <TraceMenu name={active.name} onTraces={() => open(null)} onRename={rename} onDuplicate={() => void duplicate()} onNew={() => startDialog()} onImport={() => importRef.current?.click()} onExport={() => setExportOpen(true)} onDelete={() => void remove()} />
          {(view.issues.length > 0 || invalid > 0) && <button type="button" className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-popover/95 px-2.5 py-1 text-xs text-destructive shadow-sm backdrop-blur hover:bg-muted" onClick={() => { setSelection(NO_SELECTION); setAddressFocus(null); }} title="Show the issues in the inspector">
            <TriangleAlertIcon className="size-3.5" />{view.issues.length + invalid} issue{view.issues.length + invalid === 1 ? "" : "s"} to review
          </button>}
          {(shown.view.nodes.length > 300 || shown.view.edges.length > 600) && <p className="max-w-xs rounded-lg border bg-popover/95 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">{shown.view.nodes.length} nodes and {shown.view.edges.length} lines drawn. Hide branches you aren&apos;t working on (right-click a node) to keep it readable.</p>}
        </div>}
      />
    </div>
    {showInspector && <SidePanel side="right" label="Trace inspector">{inspector}</SidePanel>}
    {dialog}{importControls}
    {exportOpen && <ExportDialog trace={active} view={view} evidence={evidence} options={{ caseRange, decimals: (id) => assets.get(id)?.decimals ?? (id === "SOL" ? 9 : null), labelOf: (address) => { const label = names.label(address); return label && { name: label.name, tags: label.tags }; } }} canvas={() => canvasHandle.current} assetName={(id) => assetLabel(id, assets)} onClose={() => setExportOpen(false)} />}
    {scopeOpen && <ScopeDialog trace={active} assets={assets} caseRange={caseRange} onClose={() => setScopeOpen(false)} onSave={(scope, direction) => persist((trace) => setScope(setDirection(trace, direction), scope))} />}
  </>;
}

const SELECT = "h-7 w-full rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A text field saved when it loses focus (or on Cmd/Ctrl+Enter), so one edit is one undo step. */
function NoteField({ label, value, onCommit }: { label: string; value: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  const commit = () => { if (text !== value) onCommit(text.slice(0, 2000)); };
  return <label className="grid gap-1 text-xs text-muted-foreground">{label}
    <textarea className="min-h-16 rounded-md border bg-background p-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.blur(); }} />
  </label>;
}

/** The trace's name as a menu: everything about the trace as a whole. */
function TraceMenu({ name, onTraces, onRename, onDuplicate, onNew, onImport, onExport, onDelete }: Record<"onTraces" | "onRename" | "onDuplicate" | "onNew" | "onImport" | "onExport" | "onDelete", () => void> & { name: string }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, icon: React.ReactNode, run: () => void, destructive = false) => <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground ${destructive ? "text-destructive [&_svg]:text-destructive" : ""}`} onClick={() => { setOpen(false); run(); }}>{icon}{label}</button>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="flex max-w-72 items-center gap-1.5 rounded-xl border bg-popover/95 px-3 py-1.5 text-sm font-medium shadow-lg backdrop-blur hover:bg-muted">
      <WaypointsIcon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{name}</span><ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </PopoverTrigger>
    <PopoverContent align="start" className="w-56 p-1">
      {item("All traces", <ListIcon />, onTraces)}
      {item("New trace", <FilePlus2Icon />, onNew)}
      <div className="my-1 h-px bg-border" />
      {item("Rename", <PencilIcon />, onRename)}
      {item("Duplicate", <CopyIcon />, onDuplicate)}
      {item("Export…", <DownloadIcon />, onExport)}
      {item("Import a trace…", <UploadIcon />, onImport)}
      <div className="my-1 h-px bg-border" />
      {item("Delete trace", <Trash2Icon />, onDelete, true)}
    </PopoverContent>
  </Popover>;
}

/** With nothing selected: the trace as a whole, and anything that needs review. */
function TraceOverview({ trace, view, shownNodes, hiddenBranches, names, assetName, onScope, onCopyJson, onRemoveInvalid }: {
  trace: Trace; view: TraceViewModel; shownNodes: number; hiddenBranches: number; names: Names; assetName: (id: string) => string;
  onScope: () => void; onCopyJson: () => void; onRemoveInvalid: () => void;
}) {
  const { seed, scope, direction } = trace;
  const seedText = seed.kind === "address" ? names.of(seed.address) : seed.kind === "transaction" ? `transaction ${seed.signature.slice(0, 8)}…` : `a movement in ${seed.ref.signature.slice(0, 8)}…`;
  const issues = { stale: view.issues.filter((i) => i.kind === "stale").length, scope: view.issues.filter((i) => i.kind === "out_of_scope").length, ignored: view.issues.filter((i) => i.kind === "ignored").length };
  const invalid = (trace.invalidSteps?.length ?? 0) + (trace.invalidAnnotations?.length ?? 0);
  return <>
    <PanelSection title="Trace">
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Starts from</dt><dd className="truncate">{seedText}</dd>
        <dt className="text-muted-foreground">Direction</dt><dd className="capitalize">{direction}</dd>
        <dt className="text-muted-foreground">Assets</dt><dd className="truncate">{scope.assets ? scope.assets.map(assetName).join(", ") : "Any"}</dd>
        <dt className="text-muted-foreground">Dates</dt><dd>{scope.start ? scope.start.slice(0, 10) : "Case start"} → {scope.end ? scope.end.slice(0, 10) : "case end"}</dd>
        <dt className="text-muted-foreground">Hop limit</dt><dd>{scope.maxHops}</dd>
        <dt className="text-muted-foreground">On canvas</dt><dd>{shownNodes} address{shownNodes === 1 ? "" : "es"} · {trace.steps.length} step{trace.steps.length === 1 ? "" : "s"}{hiddenBranches ? ` · ${hiddenBranches} hidden branch${hiddenBranches === 1 ? "" : "es"}` : ""}</dd>
      </dl>
      <Button variant="outline" size="xs" className="self-start" onClick={onScope}><SlidersHorizontalIcon />Edit scope</Button>
    </PanelSection>
    {(issues.stale + issues.scope + issues.ignored + invalid) > 0 && <PanelSection title="To review">
      {issues.stale > 0 && <p className="text-xs"><span className="text-destructive">{issues.stale} stale step{issues.stale === 1 ? "" : "s"}</span>: the loaded transaction no longer has the saved movement, or isn&apos;t loaded. Drawn red; select one to see replacements.</p>}
      {issues.scope > 0 && <p className="text-xs">{issues.scope} step{issues.scope === 1 ? "" : "s"} outside the trace&apos;s scope (asset, dates, minimum or hop limit). Kept and drawn.</p>}
      {issues.ignored > 0 && <p className="text-xs">{issues.ignored} step{issues.ignored === 1 ? "" : "s"} can&apos;t be drawn (an unknown side or a self-transfer). Kept in the trace.</p>}
      {invalid > 0 && <>
        <p className="text-xs text-destructive">{trace.invalidSteps?.length ?? 0} unreadable step{trace.invalidSteps?.length === 1 ? "" : "s"} and {trace.invalidAnnotations?.length ?? 0} unreadable annotation{trace.invalidAnnotations?.length === 1 ? "" : "s"} were kept aside.</p>
        <div className="flex gap-1"><Button variant="outline" size="xs" onClick={onCopyJson}>Copy trace JSON</Button><Button variant="destructive" size="xs" onClick={onRemoveInvalid}>Remove unreadable items</Button></div>
      </>}
    </PanelSection>}
    <PanelSection title="How to read it">
      <p className="text-xs text-muted-foreground">Each line is an observed movement you added, in time order. Lines don&apos;t show that the same funds moved. Select a node to add its next or earlier movements; select a line to see its evidence.</p>
    </PanelSection>
  </>;
}

/** The case's saved traces. */
function TraceList({ list, onOpen, onStart, onImport, extra }: {
  list: ReturnType<typeof useTraces>["list"]; onOpen: (id: string) => void; onStart: () => void; onImport: () => void; extra: React.ReactNode;
}) {
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><WaypointsIcon className="size-5 text-muted-foreground" />Traces</h2>
          <p className="max-w-lg text-sm text-muted-foreground">Saved diagrams of movements you pick, step by step. Lines show observed transfers, not proof that the same funds continued.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onImport}><UploadIcon />Import</Button>
          <Button size="sm" onClick={onStart}><PlusIcon />Start a trace</Button>
        </div>
      </header>
      {list.status === "loading" && <p className="text-sm text-muted-foreground">Loading saved traces…</p>}
      {list.status === "error" && <p className="text-sm text-destructive">{list.error}</p>}
      {list.status === "ready" && (list.data.length ? <ul className="grid gap-2 sm:grid-cols-2">
        {list.data.map((item) => <li key={item.id}>
          <button type="button" className="flex w-full flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40" onClick={() => onOpen(item.id)}>
            <span className="truncate font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">{item.valid ? `${item.steps} step${item.steps === 1 ? "" : "s"}${item.updatedAt ? ` · edited ${new Date(item.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}` : item.reason === "newer_version" ? "Made by a newer FraudWatch; read-only" : "Couldn't read this trace"}</span>
          </button>
        </li>)}
      </ul> : <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
        <WaypointsIcon className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">No traces in this case yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">Start from a wallet, a transaction or one movement, then add the movements you want to follow.</p>
        <Button size="sm" onClick={onStart}><PlusIcon />Start a trace</Button>
      </div>)}
    </div>
    {extra}
  </section>;
}

/** Put any wallet on the trace: one of the case's, or a pasted address. */
function AddWallet({ wallets, onTrace, names, onAdd }: { wallets: readonly string[]; onTrace: ReadonlySet<string>; names: Names; onAdd: (address: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const address = text.trim();
  const problem = !address ? null : !isValidSolanaAddress(address) ? "Not a Solana address." : onTrace.has(address) ? "Already on this trace." : null;
  const add = (value: string) => { onAdd(value); setText(""); setOpen(false); };
  const others = wallets.filter((w) => !onTrace.has(w));
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-muted [&_svg]:size-4" title="Put a wallet on the trace">
      <WalletIcon />Add wallet
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 space-y-3 p-3">
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (address && !problem) add(address); }}>
        <label className="grid gap-1 text-xs text-muted-foreground">Wallet address
          <input autoFocus className={SELECT} placeholder="Paste a Solana address" spellCheck={false} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {problem && <p className="text-xs text-destructive">{problem}</p>}
        <Button type="submit" size="sm" className="w-full" disabled={!address || Boolean(problem)}>Add to trace</Button>
      </form>
      {others.length > 0 && <div className="space-y-1 border-t pt-2">
        <p className="text-xs text-muted-foreground">Case wallets</p>
        {others.map((w) => <button key={w} type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => add(w)}>
          <span className="truncate">{names.of(w)}</span><span className="font-mono text-xs text-muted-foreground">{w.slice(0, 4)}…{w.slice(-4)}</span>
        </button>)}
      </div>}
      <p className="text-xs text-muted-foreground">It joins the trace unconnected. Select it to add its movements; only those link it to the rest.</p>
    </PopoverContent>
  </Popover>;
}
