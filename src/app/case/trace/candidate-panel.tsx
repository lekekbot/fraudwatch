"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Names } from "@/lib/labels/labels";
import { parseUnits } from "@/lib/solana/amount";
import { candidates, type Candidate, type MovementIndex } from "@/lib/trace/movements";
import type { MovementRef, Trace, TraceStep } from "@/lib/trace/model";
import type { TraceEvidence, TraceNode } from "@/lib/trace/view";
import { assetLabel, type Assets } from "../asset-format";

export function CandidatePanel({ node, trace, index, evidence, caseRange, loadedRange, hiddenReason, names, assets, assetText, loadStatus, loadError, initialDirection, onAdd, onAddConversion, onMapWallet }: {
  node: TraceNode; trace: Trace; index: MovementIndex; evidence: TraceEvidence;
  caseRange: { start: string; end: string };
  loadedRange: (address: string) => { start: string; end: string } | null;
  hiddenReason: (signature: string) => "manual" | "rule" | null;
  names: Names; assets: Assets; assetText: (assetId: string, amount: string) => string;
  loadStatus: string;
  loadError: string | null;
  initialDirection?: "forward" | "backward";
  onAdd: (refs: MovementRef[], direction: "forward" | "backward") => void;
  onAddConversion: (step: Extract<TraceStep, { kind: "conversion" }>, followAsset: boolean) => void;
  onMapWallet: (address: string) => void;
}) {
  const [address, setAddress] = useState(node.addresses[0]);
  const [direction, setDirection] = useState<"forward" | "backward">(initialDirection ?? (trace.direction === "backward" ? "backward" : "forward"));
  const [asset, setAsset] = useState("");
  const [minimum, setMinimum] = useState("");
  const [search, setSearch] = useState("");
  const [supporting, setSupporting] = useState(false);
  const [allTimes, setAllTimes] = useState(false);
  const [limit, setLimit] = useState(50);
  const [picked, setPicked] = useState<string[]>([]);
  const [followAsset, setFollowAsset] = useState(false);
  const existing = new Set(trace.steps.filter((step) => step.kind === "movement").map((step) => step.ref.key));
  const relevant = trace.steps.filter((step): step is Extract<TraceStep, { kind: "movement" }> => step.kind === "movement" && (direction === "forward" ? step.ref.to === address : step.ref.from === address));
  const orders = relevant.flatMap((step) => index.bySignature.get(step.ref.signature)?.filter((item) => item.ref.key === step.ref.key).map((item) => item.order) ?? []);
  const anchor = orders.length ? (direction === "forward" ? Math.max(...orders) : Math.min(...orders)) : undefined;
  const range = loadedRange(address);
  const coverage = evidence.coverage(address);
  const minimumUnits = minimum.trim() && asset ? parseUnits(minimum, assets.get(asset)?.decimals ?? (asset === "SOL" ? 9 : 0)) : null;
  const scoped = { ...trace.scope, assets: asset ? [asset] : trace.scope.assets, minAmount: minimumUnits && asset ? { assetId: asset, amount: minimumUnits } : trace.scope.minAmount };
  const page = candidates(index, {
    node: address, direction, custodial: evidence.isCustodial(address),
    ...(allTimes ? {} : direction === "forward" ? { after: anchor } : { before: anchor }),
    scope: scoped, exclude: new Set(), includeSupporting: supporting, counterpartySearch: search.trim(), hiddenReason,
    loaded: range && coverage ? { complete: coverage.complete, ...range } : null, caseRange,
  }, { limit });
  const rows = page.items;
  const toggle = (key: string) => setPicked(picked.includes(key) ? picked.filter((id) => id !== key) : [...picked, key]);
  const add = () => {
    const refs = rows.filter((item) => picked.includes(item.ref.key) && !existing.has(item.ref.key)).map((item) => item.ref);
    if (!refs.length) return;
    if (Math.abs(node.depth ?? 0) + 1 > trace.scope.maxHops) { window.alert(`Hop limit is ${trace.scope.maxHops}. Raise it in Scope before adding.`); return; }
    if (refs.length > 25 && !window.confirm(`Add ${refs.length} movements to this trace?`)) return;
    onAdd(refs, direction); setPicked([]);
  };
  const conversions = index.conversions.get(address) ?? [];
  const boundaries = index.boundaries.get(address) ?? [];
  return <aside className="flex w-full min-w-64 flex-col gap-2 overflow-auto rounded border p-3 text-xs lg:w-80" aria-label="Trace candidates">
    <h3 className="font-semibold">Movements for {node.service?.name ?? names.of(address)}</h3>
    {node.service && node.addresses.length > 1 && <label>Service address<select className="w-full rounded border bg-background p-1" value={address} onChange={(e) => { setAddress(e.target.value); setPicked([]); }} >{node.addresses.map((id) => <option key={id} value={id}>{names.of(id)} · {id.slice(0, 8)}…</option>)}</select></label>}
    <div className="flex gap-1"><Button size="xs" disabled={trace.direction === "backward"} variant={direction === "forward" ? "secondary" : "outline"} onClick={() => { setDirection("forward"); setPicked([]); }}>Next</Button><Button size="xs" disabled={trace.direction === "forward"} variant={direction === "backward" ? "secondary" : "outline"} onClick={() => { setDirection("backward"); setPicked([]); }}>Earlier</Button></div>
    <p>{page.completeness === "complete" ? "Complete loaded history" : page.completeness === "outside_range" ? "Outside loaded range" : "Partial history: only observed movements are known"}{loadStatus === "running" ? " · Loading, results may change" : ""}</p>
    {loadError && <p className="text-destructive">History load failed: {loadError}. Existing trace steps are unchanged.</p>}
    {evidence.isCustodial(address) && direction === "forward" && <p className="text-destructive">Custodial service. Deposits are pooled; later withdrawals cannot be linked to this deposit on-chain.</p>}
    {evidence.addressState(address) === "OBSERVED" && !evidence.isCustodial(address) && <Button variant="outline" size="xs" onClick={() => onMapWallet(address)}>Map {names.of(address)} to load history</Button>}
    <label>Asset<select className="w-full rounded border bg-background p-1" value={asset} onChange={(e) => { setAsset(e.target.value); setPicked([]); }}><option value="">Trace scope</option>{[...assets.keys()].map((id) => <option key={id} value={id}>{assetLabel(id, assets)}</option>)}</select></label>
    <label>Minimum amount<input className="w-full rounded border bg-background p-1" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="Amount in selected asset" /></label>
    {minimum.trim() && minimumUnits === null && <p className="text-destructive">Choose an asset and enter a valid amount.</p>}
    <label>Counterparty address<input className="w-full rounded border bg-background p-1" value={search} onChange={(e) => { setSearch(e.target.value); setPicked([]); }} /></label>
    <label className="flex gap-1"><input type="checkbox" checked={supporting} onChange={(e) => setSupporting(e.target.checked)} /> Include fees, royalties and rent</label>
    <label className="flex gap-1"><input type="checkbox" checked={allTimes} onChange={(e) => setAllTimes(e.target.checked)} /> Include {direction === "forward" ? "earlier" : "later"} movements</label>
    <p>{Math.min(limit, page.total)} of {page.total} movements</p>
    <div className="space-y-2">{rows.map((item: Candidate, i) => { const other = (direction === "forward" ? item.ref.to : item.ref.from)!; const service = evidence.serviceOf?.(other); const added = existing.has(item.ref.key); return <label key={item.ref.key} className="block rounded border p-2"><span className="flex gap-1"><input type="checkbox" checked={added || picked.includes(item.ref.key)} disabled={added} onChange={() => toggle(item.ref.key)} />{i === 0 || rows[i - 1].ref.signature !== item.ref.signature ? <strong>{item.ref.signature.slice(0, 10)}… · {item.groupSize} leg{item.groupSize === 1 ? "" : "s"}</strong> : null}</span><span className="block pl-5" title={other}>{direction === "forward" ? "to" : "from"} {service ? `${service.protocolName} (${service.category === "exchange" ? "custodial" : service.category})` : names.of(other)} · {assetText(item.ref.assetId, item.ref.amount)}{added ? " · already added" : ""}{item.weight === "supporting" ? ` · ${item.ref.role}` : ""}{item.hidden ? ` · hidden (${item.hidden})` : ""}{item.ref.time === null ? " · time unknown" : ""}</span></label>; })}</div>
    {page.nextCursor !== null && <Button variant="outline" size="xs" onClick={() => setLimit(limit + 50)}>Show 50 more</Button>}
    <Button size="sm" disabled={!picked.length || Boolean(minimum.trim() && minimumUnits === null)} onClick={add}>Add {picked.length} movement{picked.length === 1 ? "" : "s"}</Button>
    {conversions.length > 0 && <section className="space-y-1 border-t pt-2"><h4 className="font-semibold">Conversions</h4>{conversions.map((item) => { const added = trace.steps.some((step) => step.kind === "conversion" && step.signature === item.signature && step.address === address); return <div key={`${item.signature}:${item.address}`} className="rounded border p-2"><p>{item.spent.map((a) => assetText(a.assetId, a.amount)).join(" + ")} to {item.received.map((a) => assetText(a.assetId, a.amount)).join(" + ")}</p><label><input type="checkbox" checked={followAsset} onChange={(e) => setFollowAsset(e.target.checked)} /> Follow received asset</label><Button variant="outline" size="xs" disabled={added} onClick={() => onAddConversion({ kind: "conversion", id: crypto.randomUUID(), signature: item.signature, address, spent: item.spent, received: item.received, addedAt: new Date().toISOString() }, followAsset)}>{added ? "Added" : "Add conversion"}</Button></div>; })}</section>}
    {boundaries.length > 0 && <section className="border-t pt-2"><h4 className="font-semibold">Boundaries</h4>{boundaries.map((item, i) => <p key={`${item.signature}:${i}`}>{item.boundary.replaceAll("_", " ")} · {item.signature.slice(0, 10)}…</p>)}</section>}
  </aside>;
}
