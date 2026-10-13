"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { datesFromRange, rangeFromDates } from "@/lib/case/range";
import { formatBaseUnits, parseUnits } from "@/lib/solana/amount";
import type { Trace, TraceDirection, TraceScope } from "@/lib/trace/model";
import { assetLabel, type Assets } from "../asset-format";

export function ScopeDialog({ trace, assets, caseRange, onClose, onSave }: {
  trace: Trace; assets: Assets; caseRange: { start: string; end: string };
  onClose: () => void; onSave: (scope: TraceScope, direction: TraceDirection) => void;
}) {
  const startDefault = trace.scope.start ?? caseRange.start;
  const endDefault = trace.scope.end ? new Date(Date.parse(trace.scope.end) + 1).toISOString() : caseRange.end;
  const [start, setStart] = useState(startDefault.slice(0, 10));
  const [end, setEnd] = useState(datesFromRange({ start: startDefault, end: endDefault }).endDate);
  const [direction, setDirection] = useState(trace.direction);
  const [selectedAssets, setSelectedAssets] = useState(trace.scope.assets ?? []);
  const [maxHops, setMaxHops] = useState(trace.scope.maxHops);
  const [minAsset, setMinAsset] = useState(trace.scope.minAmount?.assetId ?? "");
  const [minText, setMinText] = useState(trace.scope.minAmount ? formatBaseUnits(trace.scope.minAmount.amount, assets.get(trace.scope.minAmount.assetId)?.decimals ?? 0).replaceAll(",", "") : "");
  const range = rangeFromDates(start, end);
  const validRange = Boolean(range && range.start >= caseRange.start && range.end <= caseRange.end);
  const units = minText.trim() && minAsset ? parseUnits(minText, assets.get(minAsset)?.decimals ?? (minAsset === "SOL" ? 9 : 0)) : null;
  const validMin = !minText.trim() || Boolean(minAsset && units !== null);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>Trace scope</DialogTitle></DialogHeader>
    <label>Direction<select className="w-full rounded border bg-background p-2" value={direction} onChange={(e) => setDirection(e.target.value as TraceDirection)}><option value="forward">Forward</option><option value="backward">Backward</option><option value="both">Both</option></select></label>
    <fieldset className="max-h-28 overflow-auto rounded border p-2"><legend>Assets (none means any)</legend>{[...assets.keys()].map((id) => <label key={id} className="mr-3 inline-flex gap-1"><input type="checkbox" checked={selectedAssets.includes(id)} onChange={() => setSelectedAssets(selectedAssets.includes(id) ? selectedAssets.filter((a) => a !== id) : [...selectedAssets, id])} />{assetLabel(id, assets)}</label>)}</fieldset>
    <div className="grid grid-cols-2 gap-2"><label>From<input type="date" className="w-full rounded border bg-background p-2" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>To<input type="date" className="w-full rounded border bg-background p-2" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
    <div className="grid grid-cols-2 gap-2"><label>Minimum asset<select className="w-full rounded border bg-background p-2" value={minAsset} onChange={(e) => setMinAsset(e.target.value)}><option value="">None</option>{[...assets.keys()].map((id) => <option key={id} value={id}>{assetLabel(id, assets)}</option>)}</select></label><label>Minimum amount<input className="w-full rounded border bg-background p-2" value={minText} onChange={(e) => setMinText(e.target.value)} /></label></div>
    <label>Max hops<input type="number" min={1} max={20} className="w-full rounded border bg-background p-2" value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))} /></label>
    {!validRange && <p className="text-xs text-destructive">Dates must stay within case range.</p>}{!validMin && <p className="text-xs text-destructive">Enter a valid amount and asset.</p>}
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!validRange || !validMin || maxHops < 1 || maxHops > 20} onClick={() => { onSave({ assets: selectedAssets.length ? selectedAssets : null, start: range!.start, end: new Date(Date.parse(range!.end) - 1).toISOString(), minAmount: units && minAsset ? { assetId: minAsset, amount: units } : null, maxHops }, direction); onClose(); }}>Save scope</Button></DialogFooter>
  </DialogContent></Dialog>;
}
