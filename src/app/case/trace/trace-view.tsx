"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocalQuery } from "@/hooks/use-local-db";
import { useTraces } from "@/hooks/use-traces";
import type { BehaviorObservation } from "@/lib/behavior/observations";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState } from "@/lib/state/reconstruct";
import { describeStorageError } from "@/lib/db/db";
import { getTrace } from "@/lib/db/traces";
import type { Names } from "@/lib/labels/labels";
import { buildCasePath } from "@/lib/routing/case-path";
import { formatBaseUnits } from "@/lib/solana/amount";
import { addAnnotation, addSteps, removeAnnotations, removeInvalidItems, removeSteps, renameTrace, reorderAnnotation, setCanvasOptions, setDirection, setNodeStyle, setBranchHidden, setPositions, setScope, setServiceExpanded, updateAnnotation } from "@/lib/trace/edit";
import { hideBranches } from "@/lib/trace/branches";
import { emptyHistory, type History, push, redo, undo } from "@/lib/trace/history";
import { autoPlace } from "@/lib/trace/layout";
import type { MovementRef, Trace, TraceSeed, TraceStep } from "@/lib/trace/model";
import type { MovementIndex } from "@/lib/trace/movements";
import type { Annotation, NodeStyle } from "@/lib/trace/presentation";
import { buildTraceView, type TraceEvidence } from "@/lib/trace/view";
import { assetLabel, type Assets } from "../asset-format";
import { BranchPanel } from "./branch-panel";
import { CandidatePanel } from "./candidate-panel";
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

export function TraceView({ caseId, traceId, evidence, index, caseRange, loadedRange, hiddenReason, wallets, names, assets, observations, eventState, transactionOf, ui, renderAddressPanel, requestedSeed, onSeedHandled, onMapWallet, onOpenTransaction, onShowInGraph, loadStatus, loadError }: {
  caseId: string; traceId: string | null; evidence: TraceEvidence; index: MovementIndex | null;
  caseRange: { start: string; end: string };
  loadedRange: (address: string) => { start: string; end: string } | null;
  hiddenReason: (signature: string) => "manual" | "rule" | null;
  wallets: readonly string[]; names: Names; assets: Assets; observations: readonly BehaviorObservation[];
  eventState: WalletState | null; transactionOf: (signature: string) => CanonicalTransaction | undefined;
  ui: TraceUiStore; renderAddressPanel: (address: string) => React.ReactNode;
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
  const missing = useMemo(() => active && view ? autoPlace({ view, positions: active.presentation.positions, obstacles: active.presentation.annotations.flatMap((a) => a.kind === "shape" ? [{ x: a.at.x, y: a.at.y, width: a.width, height: a.height }] : a.kind === "note" ? [{ x: a.at.x, y: a.at.y, width: a.width, height: 80 }] : []) }) : {}, [active, view]);
  useEffect(() => {
    if (!active || !Object.keys(missing).length || placementFailed.current) return;
    persist((trace) => setPositions(trace, missing), { record: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new saved trace removes missing positions
  }, [active, missing]);
  const shown = useMemo(() => view && active ? hideBranches(view, active.presentation.hiddenBranches) : null, [view, active]);
  const open = (id: string | null) => { latest.current = null; placementFailed.current = false; setHistory(emptyHistory()); setOptimistic(null); setSelectionState((id && ui.get(id)?.selection) || NO_SELECTION); setAddressFocus(null); window.history.pushState(null, "", buildCasePath(caseId, "trace", id)); };
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
  if (!traceId) return <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-6">
    <h2 className="text-base font-semibold">Trace Graph</h2><p className="max-w-xl text-sm text-muted-foreground">Build a saved diagram from movements you select. Lines show observed transfers, not proof that the same funds continued.</p>
    <Button className="self-start" onClick={() => startDialog()}>Start a trace</Button>
    {traces.list.status === "loading" && <p className="text-sm">Loading saved traces…</p>}
    {traces.list.status === "error" && <p className="text-sm text-destructive">{traces.list.error}</p>}
    {traces.list.status === "ready" && (traces.list.data.length ? <ul className="max-w-xl space-y-2">{traces.list.data.map((item) => <li key={item.id}><button type="button" className="w-full rounded-md border p-3 text-left hover:bg-accent" onClick={() => open(item.id)}><span className="font-medium">{item.name}</span><span className="ml-2 text-xs text-muted-foreground">{item.valid ? `${item.steps} steps` : item.reason === "newer_version" ? "Made by a newer FraudWatch; read-only" : "Couldn't read this trace"}</span></button></li>)}</ul> : <p className="text-sm text-muted-foreground">No traces saved for this case.</p>)}
    {dialog}
  </section>;
  if (selected.status === "loading") return <p className="flex flex-1 items-center justify-center text-sm">Loading trace…</p>;
  if (selected.status === "error") return <p className="flex flex-1 items-center justify-center text-sm text-destructive">{selected.error}</p>;
  if (!active || !view || !shown) {
    const result = selected.data;
    const missingOrOtherCase = result.ok || result.reason === "missing";
    return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm"><p>{missingOrOtherCase ? "Trace not found in this case." : result.reason === "newer_version" ? "Made by a newer FraudWatch; read-only." : "Couldn't read this trace."}</p>{!result.ok && result.raw !== undefined && <Button variant="outline" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result.raw, null, 2))}>Copy raw JSON</Button>}{!missingOrOtherCase && <Button variant="destructive" onClick={() => { if (window.confirm("Delete this unreadable trace? This cannot be undone.")) void traces.remove(traceId).then(() => open(null)).catch((err) => toast.error(describeStorageError(err))); }}>Delete trace</Button>}<Button variant="outline" onClick={() => open(null)}>Back to traces</Button></div>;
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
  const removeEdge = (ids: Set<string>) => { if (window.confirm(`Remove ${ids.size} movement${ids.size === 1 ? "" : "s"} from this trace?`)) { persist((trace) => removeSteps(trace, ids)); if (edge && ids.size === edge.steps.length) setSelection({ nodes: [], edges: [], annotations: [] }); } };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
    <div className="flex flex-wrap items-center gap-2 text-sm"><Button variant="outline" size="xs" onClick={() => open(null)}>Traces</Button><strong className="truncate">{active.name}</strong><span className="text-xs text-muted-foreground">{shown.view.nodes.length} nodes · {shown.view.edges.length} observed edges{shown.counts.size ? ` · ${shown.counts.size} branch${shown.counts.size === 1 ? "" : "es"} hidden` : ""}</span><Button variant="outline" size="xs" disabled={history.past.at(-1)?.id !== active.id} onClick={() => travel("undo")} title="Undo (Ctrl/Cmd+Z)">Undo</Button><Button variant="outline" size="xs" disabled={history.future[0]?.id !== active.id} onClick={() => travel("redo")} title="Redo (Shift+Ctrl/Cmd+Z)">Redo</Button><Button variant="outline" size="xs" onClick={() => setScopeOpen(true)}>Scope</Button><Button variant="outline" size="xs" onClick={() => startDialog()}>New</Button><Button variant="outline" size="xs" onClick={rename}>Rename</Button><Button variant="outline" size="xs" onClick={() => void duplicate()}>Duplicate</Button><Button variant="destructive" size="xs" onClick={() => void remove()}>Delete</Button></div>
    {(active.invalidSteps?.length || active.invalidAnnotations?.length || view.issues.length) ? <p className="text-xs text-destructive">{active.invalidSteps?.length ?? 0} unreadable steps · {active.invalidAnnotations?.length ?? 0} unreadable annotations · {view.issues.length} evidence issues. Review before relying on this trace.</p> : null}
    {(active.invalidSteps?.length || active.invalidAnnotations?.length) ? <div className="flex gap-2 text-xs"><Button variant="outline" size="xs" onClick={() => void navigator.clipboard.writeText(JSON.stringify(loaded, null, 2))}>Copy trace JSON</Button><Button variant="destructive" size="xs" onClick={() => { if (window.confirm("Remove unreadable items from this trace? This cannot be undone.")) persist((trace) => removeInvalidItems(trace)); }}>Remove unreadable items</Button></div> : null}
    {(shown.view.nodes.length > 300 || shown.view.edges.length > 600) && <p className="text-xs text-muted-foreground">This trace draws {shown.view.nodes.length} nodes and {shown.view.edges.length} edges. Hide branches you aren&apos;t working on to keep it readable (right-click a node, or use Hide branch in its panel).</p>}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:flex-row"><TraceCanvas key={active.id} initialSelection={selection} initialTransform={ui.get(active.id)?.transform} onTransform={(transform) => ui.set(active.id, { transform })} view={shown.view} hidden={shown} onBranchHidden={(id, hidden) => persist((trace) => setBranchHidden(trace, id, hidden))} presentation={presentation} steps={active.steps} names={names} stateOf={evidence.addressState} assetText={assetText} assetName={(id) => assetLabel(id, assets)} onSelection={setSelection} onCandidateDirection={(direction) => { if (active.direction === "both" || active.direction === direction) setCandidateDirection(direction); }} onStartAtNode={(address) => startDialog({ kind: "address", address })} onMapWallet={onMapWallet} onRemoveEvidence={removeEdge} onMove={(positions, patches) => persist((trace) => { let next = Object.keys(positions).length ? setPositions(trace, positions) : trace; for (const item of patches ?? []) next = updateAnnotation(next, item.id, item.patch); return next; })} onOptions={(options) => persist((trace) => setCanvasOptions(trace, options))} onAddAnnotation={(item: Annotation) => persist((trace) => addAnnotation(trace, item))} onUpdateAnnotation={(id: string, patch: Partial<Annotation>) => persist((trace) => updateAnnotation(trace, id, patch))} onRemoveAnnotations={(ids: Set<string>) => persist((trace) => removeAnnotations(trace, ids))} onReorderAnnotation={(id: string, order: "front" | "back") => persist((trace) => reorderAnnotation(trace, id, order))} onNodeStyle={(id: string, style: NodeStyle) => persist((trace) => setNodeStyle(trace, id, style))} />
      {addressFocus ? <aside className="w-full space-y-2 overflow-auto rounded border p-3 text-xs lg:w-96"><Button variant="outline" size="xs" onClick={() => setAddressFocus(null)}>Back to selection</Button>{renderAddressPanel(addressFocus)}</aside> : node && index ? <div className="flex w-full flex-col gap-2 overflow-auto lg:w-96 [&>*]:shrink-0"><section className="rounded border p-2 text-xs"><NodeTraceSection node={node} view={view} trace={active} names={names} evidence={evidence} assetName={(id) => assetLabel(id, assets)} onShowInGraph={onShowInGraph} onMapWallet={onMapWallet} onNewTrace={() => startDialog()} onOpenInTimeline={onOpenTransaction} /></section>{node.service && <section className="rounded border p-2 text-xs"><strong>{node.service.name}</strong> · {node.service.category} · {node.addresses.length} address{node.addresses.length === 1 ? "" : "es"}<Button variant="outline" size="xs" className="ml-2" onClick={() => persist((trace) => setServiceExpanded(trace, node.service!.id, true))}>Show addresses separately</Button></section>}{!node.service && evidence.serviceOf?.(node.id) && active.presentation.expandedServices.includes(evidence.serviceOf(node.id)!.protocolId) && <Button variant="outline" size="xs" onClick={() => persist((trace) => setServiceExpanded(trace, evidence.serviceOf!(node.id)!.protocolId, false))}>Group as {evidence.serviceOf(node.id)!.protocolName}</Button>}<BranchPanel node={node} view={view} hidden={active.presentation.hiddenBranches.includes(node.id)} observations={observations} names={names} assetText={assetText} onHidden={(hidden) => persist((trace) => setBranchHidden(trace, node.id, hidden))} onOpenTransaction={onOpenTransaction} /><CandidatePanel key={`${node.id}:${candidateDirection ?? "default"}`} initialDirection={candidateDirection ?? undefined} node={node} trace={active} index={index} evidence={evidence} caseRange={caseRange} loadedRange={loadedRange} hiddenReason={hiddenReason} names={names} assets={assets} assetText={assetText} loadStatus={loadStatus} loadError={loadError} onAdd={addMovements} onAddConversion={addConversion} onMapWallet={onMapWallet} /><Button variant="outline" size="xs" onClick={() => startDialog({ kind: "address", address: node.addresses[0] })}>Start another trace here</Button>{!node.service && <div className="rounded border p-2">{renderAddressPanel(node.id)}</div>}</div> : edge ? <TraceInspector key={edge.id} edge={edge} trace={active} view={view} evidence={evidence} index={index} names={names} assets={assets} assetText={assetText} eventState={eventState} transactionOf={transactionOf} hiddenReason={hiddenReason} actions={inspectorActions} /> : annotation ? <aside className="w-full space-y-2 rounded border p-3 text-xs lg:w-80"><strong>Annotation · drawn by you</strong><p>{annotation.kind === "note" ? annotation.text : annotation.label}</p><Button variant="outline" size="xs" onClick={() => persist((trace) => reorderAnnotation(trace, annotation.id, "front"))}>Bring to front</Button><Button variant="destructive" size="xs" onClick={() => persist((trace) => removeAnnotations(trace, new Set([annotation.id])))}>Delete annotation</Button></aside> : null}
    </div>{dialog}{scopeOpen && <ScopeDialog trace={active} assets={assets} caseRange={caseRange} onClose={() => setScopeOpen(false)} onSave={(scope, direction) => persist((trace) => setScope(setDirection(trace, direction), scope))} />}
  </div>;
}
