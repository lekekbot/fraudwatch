"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocalQuery } from "@/hooks/use-local-db";
import { useTraces } from "@/hooks/use-traces";
import { describeStorageError } from "@/lib/db/db";
import { getTrace } from "@/lib/db/traces";
import type { Names } from "@/lib/labels/labels";
import { buildCasePath } from "@/lib/routing/case-path";
import { formatBaseUnits } from "@/lib/solana/amount";
import { autoPlace } from "@/lib/trace/layout";
import { removeInvalidItems, setCanvasOptions, setPositions } from "@/lib/trace/edit";
import type { Trace } from "@/lib/trace/model";
import { buildTraceView, type TraceEvidence } from "@/lib/trace/view";
import { assetLabel, type Assets } from "../asset-format";
import { TraceCanvas } from "./trace-canvas";

export function TraceView({ caseId, traceId, evidence, names, assets }: {
  caseId: string; traceId: string | null; evidence: TraceEvidence; names: Names; assets: Assets;
}) {
  const traces = useTraces(caseId);
  const selected = useLocalQuery((db) => traceId ? getTrace(db, traceId, caseId) : Promise.resolve({ ok: false as const, id: "", reason: "missing" as const }), [traceId, caseId]);
  const loaded = selected.status === "ready" && selected.data.ok && selected.data.trace.caseId === caseId ? selected.data.trace : null;
  const latest = useRef<Trace | null>(null);
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (loaded && (latest.current?.id !== loaded.id || loaded.updatedAt > latest.current.updatedAt)) latest.current = loaded;
  }, [loaded]);
  const persist = (update: (trace: Trace) => Trace) => {
    const current = latest.current ?? loaded;
    if (!current) return;
    const next = update(current);
    latest.current = next;
    void traces.save(next).catch((err) => { latest.current = loaded; forceRender((n) => n + 1); toast.error(describeStorageError(err)); });
  };
  const view = useMemo(() => loaded ? buildTraceView(loaded, evidence) : null, [loaded, evidence]);
  const missing = useMemo(() => loaded && view ? autoPlace({ view, positions: loaded.presentation.positions, obstacles: loaded.presentation.annotations.flatMap((a) => a.kind === "shape" ? [{ x: a.at.x, y: a.at.y, width: a.width, height: a.height }] : a.kind === "note" ? [{ x: a.at.x, y: a.at.y, width: a.width, height: 80 }] : []) }) : {}, [loaded, view]);
  useEffect(() => {
    if (!loaded || !Object.keys(missing).length) return;
    persist((trace) => setPositions(trace, missing));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new saved trace removes missing positions
  }, [loaded, missing]);
  const open = (id: string | null) => window.history.pushState(null, "", buildCasePath(caseId, "trace", id));

  if (!traceId) return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-6">
      <h2 className="text-base font-semibold">Trace Graph</h2>
      {traces.list.status === "loading" && <p className="text-sm text-muted-foreground">Loading saved traces…</p>}
      {traces.list.status === "error" && <p className="text-sm text-destructive">{traces.list.error}</p>}
      {traces.list.status === "ready" && (traces.list.data.length ? <ul className="max-w-xl space-y-2">{traces.list.data.map((item) => <li key={item.id}><button type="button" className="w-full rounded-md border p-3 text-left hover:bg-accent" onClick={() => open(item.id)}><span className="font-medium">{item.name}</span><span className="ml-2 text-xs text-muted-foreground">{item.valid ? `${item.steps} steps` : item.reason === "newer_version" ? "Made by a newer FraudWatch; read-only" : "Couldn't read this trace"}</span></button></li>)}</ul> : <p className="text-sm text-muted-foreground">No traces saved for this case. Guided trace creation comes in Sprint 06.</p>)}
    </section>
  );
  if (selected.status === "loading") return <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading trace…</p>;
  if (selected.status === "error") return <p className="flex flex-1 items-center justify-center text-sm text-destructive">{selected.error}</p>;
  if (!loaded || !view) {
    const result = selected.data;
    const missingOrOtherCase = result.ok || result.reason === "missing";
    return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm"><p>{missingOrOtherCase ? "Trace not found in this case." : result.reason === "newer_version" ? "Made by a newer FraudWatch; read-only." : "Couldn't read this trace."}</p>{!result.ok && result.raw !== undefined && <button type="button" className="rounded border px-3 py-1" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result.raw, null, 2))}>Copy raw JSON</button>}{!missingOrOtherCase && <button type="button" className="rounded border border-destructive px-3 py-1 text-destructive" onClick={() => { if (window.confirm("Delete this unreadable trace? This cannot be undone.")) void traces.remove(traceId).then(() => open(null)).catch((err) => toast.error(describeStorageError(err))); }}>Delete trace</button>}<button type="button" className="rounded border px-3 py-1" onClick={() => open(null)}>Back to traces</button></div>;
  }
  const presentation = { ...loaded.presentation, positions: { ...loaded.presentation.positions, ...missing } };
  const assetText = (assetId: string, amount: string) => `${formatBaseUnits(amount, assets.get(assetId)?.decimals ?? (assetId === "SOL" ? 9 : 0))} ${assetLabel(assetId, assets)}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-3 text-sm"><button type="button" className="rounded border px-2 py-1 hover:bg-accent" onClick={() => open(null)}>Traces</button><strong className="truncate">{loaded.name}</strong><span className="text-xs text-muted-foreground">{view.nodes.length} nodes · {view.edges.length} observed edges</span></div>
      {(loaded.invalidSteps?.length || loaded.invalidAnnotations?.length || view.issues.length) ? <p className="text-xs text-destructive">{loaded.invalidSteps?.length ?? 0} unreadable steps · {loaded.invalidAnnotations?.length ?? 0} unreadable annotations · {view.issues.length} evidence issues. Review before relying on this trace.</p> : null}
      {(loaded.invalidSteps?.length || loaded.invalidAnnotations?.length) ? <div className="flex gap-2 text-xs"><button type="button" className="rounded border px-2 py-1" onClick={() => void navigator.clipboard.writeText(JSON.stringify(loaded, null, 2))}>Copy trace JSON</button><button type="button" className="rounded border border-destructive px-2 py-1 text-destructive" onClick={() => { if (window.confirm("Remove unreadable items from this trace? This cannot be undone.")) persist((trace) => removeInvalidItems(trace)); }}>Remove unreadable items</button></div> : null}
      <TraceCanvas view={view} presentation={presentation} steps={loaded.steps} names={names} stateOf={evidence.addressState} assetText={assetText} assetName={(id) => assetLabel(id, assets)} onMove={(positions) => persist((trace) => setPositions(trace, positions))} onOptions={(options) => persist((trace) => setCanvasOptions(trace, options))} />
    </div>
  );
}
