"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATTRIBUTION, exportTrace, type ExportOptions, fileSlug, type TraceExport, type TraceImport } from "@/lib/trace/export";
import type { Trace } from "@/lib/trace/model";
import type { TraceEvidence, TraceView } from "@/lib/trace/view";
import { readPalette } from "../canvas";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const day = (iso: string) => iso.slice(0, 10);

/** The canvas as shown, at its device resolution, with the disclosures drawn underneath. */
function snapshot(canvas: HTMLCanvasElement, doc: TraceExport, assetName: (id: string) => string): Promise<Blob | null> {
  const scale = canvas.width / Math.max(1, canvas.clientWidth);
  const { scope, direction, name } = doc.trace;
  const d = doc.disclosures;
  const lines = [
    `${name} · FraudWatch trace snapshot · exported ${doc.exportedAt.replace("T", " ").slice(0, 16)} UTC`,
    `Scope: ${direction}; ${scope.assets ? scope.assets.map(assetName).join(", ") : "any asset"}; ${scope.start ? day(scope.start) : "case start"} to ${scope.end ? day(scope.end) : "case end"}; up to ${scope.maxHops} hops`,
    ATTRIBUTION,
    `Hidden branches: ${d.hiddenBranches.length} · Collapsed services: ${d.collapsedServices.length} · Boundaries: ${d.boundaries.length} · Stale steps: ${d.staleSteps.length} · Out of scope: ${d.outOfScopeSteps.length} · Incomplete history: ${d.incompleteHistory.length}`,
    "Solid lines are observed movements; dashed lines and notes are the investigator's annotations. A picture isn't a complete record: see the JSON export.",
  ];
  const line = 18 * scale, pad = 12 * scale;
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height + pad * 2 + line * lines.length;
  const ctx = out.getContext("2d")!;
  const palette = readPalette(canvas, { bg: "--background", fg: "--foreground", border: "--border" });
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = palette.border;
  ctx.fillRect(0, canvas.height, out.width, Math.max(1, scale));
  ctx.fillStyle = palette.fg;
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.textBaseline = "top";
  lines.forEach((text, i) => ctx.fillText(text, pad, canvas.height + pad + i * line, out.width - pad * 2));
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

export function ExportDialog({ trace, view, evidence, options, canvas, assetName, onClose }: {
  trace: Trace; view: TraceView; evidence: TraceEvidence;
  options: Omit<ExportOptions, "includeLabels" | "includeLayout" | "now">;
  canvas: () => HTMLCanvasElement | null;
  assetName: (id: string) => string;
  onClose: () => void;
}) {
  const [includeLabels, setIncludeLabels] = useState(false);
  const [includeLayout, setIncludeLayout] = useState(true);
  const build = () => exportTrace(trace, view, evidence, { ...options, includeLabels, includeLayout });
  const base = `fraudwatch-trace-${fileSlug(trace.name)}-${new Date().toISOString().slice(0, 10)}`;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-lg">
    <DialogHeader>
      <DialogTitle>Export trace</DialogTitle>
      <DialogDescription>The JSON holds every step (hidden and stale ones included) with its signature, movement and exact amount, so a reviewer can check each one on-chain, plus what&apos;s hidden, collapsed or unknown. It never includes your RPC endpoint, raw transactions, balances or other traces.</DialogDescription>
    </DialogHeader>
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-center gap-2.5"><Checkbox checked={includeLayout} onCheckedChange={(v) => setIncludeLayout(v === true)} />Include the diagram (positions, styles, notes and connectors, marked as your presentation)</label>
      <label className="flex items-center gap-2.5"><Checkbox checked={includeLabels} onCheckedChange={(v) => setIncludeLabels(v === true)} />Include my labels (names and tags; notes are never exported)</label>
    </div>
    <p className="text-xs text-muted-foreground">The PNG is the canvas as currently shown (use Fit first to include everything), with the scope and disclosures underneath. A picture isn&apos;t a complete record; share the JSON with it.</p>
    <DialogFooter>
      <Button variant="outline" onClick={() => {
        const el = canvas();
        if (!el) return;
        void snapshot(el, build(), assetName).then((blob) => { if (blob) download(blob, `${base}.png`); });
      }}>Download PNG</Button>
      <Button onClick={() => { download(new Blob([JSON.stringify(build(), null, 2)], { type: "application/json" }), `${base}.json`); onClose(); }}>Download JSON</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

export function ImportDialog({ imported, found, onClose, onConfirm }: {
  imported: TraceImport; found: number; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = imported.steps.length;
  const annotations = imported.presentation.annotations.length;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-lg">
    <DialogHeader>
      <DialogTitle>Import trace</DialogTitle>
      <DialogDescription>Creates a new trace in this case. Nothing is fetched: steps are checked against the transactions already loaded here.</DialogDescription>
    </DialogHeader>
    <div className="space-y-1 text-sm">
      <p><strong>{imported.name}</strong> · exported {imported.exportedAt.slice(0, 10)}</p>
      <p>{found} of {total} step{total === 1 ? "" : "s"} found in this case&apos;s loaded data{total > found ? `; ${total - found} will show as not loaded` : ""}.</p>
      {annotations > 0 && <p>Includes the diagram with {annotations} annotation{annotations === 1 ? "" : "s"}.</p>}
      {(imported.skipped.steps > 0 || imported.skipped.annotations > 0) && <p className="text-destructive">{imported.skipped.steps} step{imported.skipped.steps === 1 ? "" : "s"} and {imported.skipped.annotations} annotation{imported.skipped.annotations === 1 ? "" : "s"} in the file couldn&apos;t be read and won&apos;t be imported.</p>}
      {error && <p className="text-destructive">{error}</p>}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={busy} onClick={() => { setBusy(true); setError(null); onConfirm().catch((err) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }); }}>Import as new trace</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
