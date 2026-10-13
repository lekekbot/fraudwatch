"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isValidSolanaAddress } from "@/lib/solana/address";
import { datesFromRange, rangeFromDates } from "@/lib/case/range";
import { parseUnits } from "@/lib/solana/amount";
import type { TraceDirection, TraceScope, TraceSeed, MovementRef } from "@/lib/trace/model";
import type { MovementIndex } from "@/lib/trace/movements";
import { assetLabel, type Assets } from "../asset-format";

export type NewTraceConfig = { name: string; seed: TraceSeed; direction: TraceDirection; scope: TraceScope; refs: MovementRef[] };
export type TraceStartRequest = { seed: TraceSeed; refs?: MovementRef[] };

export function SeedDialog({ initialSeed, initialRefs = [], index, assets, caseRange, onClose, onCreate }: {
  initialSeed: TraceSeed | null;
  initialRefs?: MovementRef[];
  index: MovementIndex | null;
  assets: Assets;
  caseRange: { start: string; end: string };
  onClose: () => void;
  onCreate: (config: NewTraceConfig) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [seedKind, setSeedKind] = useState<TraceSeed["kind"]>(initialSeed?.kind ?? "address");
  const [seedText, setSeedText] = useState(initialSeed?.kind === "address" ? initialSeed.address : initialSeed?.kind === "transaction" ? initialSeed.signature : initialSeed?.kind === "movement" ? initialSeed.ref.signature : "");
  const [direction, setDirection] = useState<TraceDirection>("forward");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [start, setStart] = useState(caseRange.start.slice(0, 10));
  const [end, setEnd] = useState(datesFromRange(caseRange).endDate);
  const [maxHops, setMaxHops] = useState(6);
  const [minAsset, setMinAsset] = useState("");
  const [minText, setMinText] = useState("");
  const [picked, setPicked] = useState<string[] | null>(initialSeed?.kind === "movement" ? [initialSeed.ref.key] : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = seedText.trim();
  const movements = seedKind !== "address" ? index?.bySignature.get(trimmed) ?? [] : [];
  const options = seedKind !== "address" ? movements.map((item) => item.ref) : initialRefs;
  const selected = picked ?? (seedKind === "transaction" ? movements.filter((m) => m.weight === "primary").map((m) => m.ref.key) : initialRefs.map((ref) => ref.key));
  const toggle = (key: string) => setPicked(seedKind === "movement" ? [key] : selected.includes(key) ? selected.filter((id) => id !== key) : [...selected, key]);
  const validSeed = seedKind === "address" ? isValidSolanaAddress(trimmed) : movements.length > 0 && selected.length > 0;
  const range = rangeFromDates(start, end);
  const validRange = Boolean(range && range.start >= caseRange.start && range.end <= caseRange.end);
  const decimals = minAsset ? assets.get(minAsset)?.decimals ?? (minAsset === "SOL" ? 9 : 0) : 0;
  const minAmount = minText.trim() && minAsset ? parseUnits(minText, decimals) : null;
  const validMinimum = !minText.trim() || (minAsset && minAmount !== null);
  const submit = async () => {
    if (!validSeed || !validRange || !validMinimum || !name.trim() || maxHops < 1 || maxHops > 20) return;
    setBusy(true); setError(null);
    try {
      await onCreate({
        name: name.trim(),
        seed: seedKind === "address" ? { kind: "address", address: trimmed } : seedKind === "transaction" ? { kind: "transaction", signature: trimmed } : { kind: "movement", ref: options.find((ref) => ref.key === selected[0])! },
        direction,
        scope: { assets: selectedAssets.length ? selectedAssets : null, start: range!.start, end: new Date(Date.parse(range!.end) - 1).toISOString(), minAmount: minAmount && minAsset ? { assetId: minAsset, amount: minAmount } : null, maxHops },
        refs: options.filter((ref) => selected.includes(ref.key)),
      });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>Start a trace</DialogTitle><DialogDescription>Choose evidence to start from. Movements are added only when you select them.</DialogDescription></DialogHeader>
    <label className="grid gap-1">Name<input className="rounded border bg-background p-2" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
    <div className="flex gap-2">{(["address", "transaction", "movement"] as const).map((kind) => <label key={kind}><input type="radio" checked={seedKind === kind} onChange={() => { setSeedKind(kind); setSeedText(""); setPicked(null); }} /> {kind[0].toUpperCase() + kind.slice(1)}</label>)}</div>
    <label className="grid gap-1">{seedKind === "address" ? "Wallet address" : "Loaded signature"}<input className="rounded border bg-background p-2" value={seedText} onChange={(e) => { setSeedText(e.target.value); setPicked(null); }} /></label>
    {seedKind !== "address" && <div className="max-h-36 space-y-1 overflow-auto rounded border p-2 text-xs">{movements.length ? movements.map((m) => <label key={m.ref.key} className="flex gap-2"><input type={seedKind === "movement" ? "radio" : "checkbox"} name={seedKind === "movement" ? "trace-movement" : undefined} checked={selected.includes(m.ref.key)} onChange={() => toggle(m.ref.key)} /><span>{m.weight}: {m.ref.from ?? "?"} to {m.ref.to ?? "?"} · {m.ref.amount} base units · {assetLabel(m.ref.assetId, assets)}</span></label>) : <p>Signature has no traceable movements in loaded case data.</p>}</div>}
    {seedKind === "address" && initialRefs.length > 0 && <fieldset className="max-h-36 space-y-1 overflow-auto rounded border p-2 text-xs"><legend>Movements from selected graph connection</legend>{initialRefs.map((ref) => <label key={ref.key} className="flex gap-2"><input type="checkbox" checked={selected.includes(ref.key)} onChange={() => toggle(ref.key)} />{ref.from} to {ref.to} · {ref.amount} base units · {assetLabel(ref.assetId, assets)}</label>)}</fieldset>}
    <label className="grid gap-1">Direction<select className="rounded border bg-background p-2" value={direction} onChange={(e) => setDirection(e.target.value as TraceDirection)}><option value="forward">Forward</option><option value="backward">Backward</option><option value="both">Both</option></select></label>
    <fieldset className="max-h-28 overflow-auto rounded border p-2"><legend>Assets (none means any)</legend>{[...assets.keys()].map((id) => <label key={id} className="mr-3 inline-flex gap-1"><input type="checkbox" checked={selectedAssets.includes(id)} onChange={() => setSelectedAssets(selectedAssets.includes(id) ? selectedAssets.filter((a) => a !== id) : [...selectedAssets, id])} />{assetLabel(id, assets)}</label>)}</fieldset>
    <div className="grid grid-cols-2 gap-2"><label className="grid gap-1">From<input type="date" className="rounded border bg-background p-2" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="grid gap-1">To<input type="date" className="rounded border bg-background p-2" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
    <div className="grid grid-cols-2 gap-2"><label className="grid gap-1">Minimum asset<select className="rounded border bg-background p-2" value={minAsset} onChange={(e) => setMinAsset(e.target.value)}><option value="">None</option>{[...assets.keys()].map((id) => <option key={id} value={id}>{assetLabel(id, assets)}</option>)}</select></label><label className="grid gap-1">Minimum amount<input className="rounded border bg-background p-2" value={minText} onChange={(e) => setMinText(e.target.value)} /></label></div>
    <label className="grid gap-1">Max hops<input type="number" min={1} max={20} className="rounded border bg-background p-2" value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))} /></label>
    {!validRange && <p className="text-xs text-destructive">Dates must stay within case range.</p>}{error && <p className="text-xs text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !validSeed || !validRange || !validMinimum || !name.trim() || maxHops < 1 || maxHops > 20} onClick={() => void submit()}>Create trace</Button></DialogFooter>
  </DialogContent></Dialog>;
}
