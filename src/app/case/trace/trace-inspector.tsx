"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Names } from "@/lib/labels/labels";
import { formatBaseUnits } from "@/lib/solana/amount";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState } from "@/lib/state/reconstruct";
import { boundaryExplanation, otherLegs, replacementCandidates } from "@/lib/trace/inspect";
import type { MovementRef, Trace, TraceStep } from "@/lib/trace/model";
import type { MovementIndex } from "@/lib/trace/movements";
import type { TraceEdge, TraceEvidence, TraceView } from "@/lib/trace/view";
import { type Assets, formatUtc } from "../asset-format";
import { EventEvidence, EventSummary } from "../timeline/event-details";
import { AddressButton, Section } from "../timeline/inspector-ui";

type MovementStep = Extract<TraceStep, { kind: "movement" }>;

export type InspectorActions = {
  onRemove: (ids: Set<string>) => void;
  /** Remove one step and add another in one edit (one undo entry). */
  onReplace: (stepId: string, ref: MovementRef) => void;
  onAddLegs: (refs: MovementRef[]) => void;
  onOpenInTimeline: (signature: string, from: string | null, to: string | null) => void;
  onShowInGraph: (label: string, signatures: string[]) => void;
  onStartMovement: (step: MovementStep) => void;
  onSelectAddress: (address: string) => void;
};

/** The evidence behind a selected edge: one step in full, or a bundled edge's steps as a table. */
export function TraceInspector({ edge, trace, view, evidence, index, names, assets, assetText, eventState, transactionOf, hiddenReason, actions }: {
  edge: TraceEdge; trace: Trace; view: TraceView; evidence: TraceEvidence; index: MovementIndex | null; names: Names; assets: Assets;
  assetText: (assetId: string, amount: string) => string;
  /** A loaded wallet state, for asset decimals in the event reading; null until states are reconstructed. */
  eventState: WalletState | null;
  transactionOf: (signature: string) => CanonicalTransaction | undefined;
  hiddenReason: (signature: string) => "manual" | "rule" | null;
  actions: InspectorActions;
}) {
  const steps = edge.steps.map((id) => trace.steps.find((step) => step.id === id)).filter((step): step is MovementStep => step?.kind === "movement");
  const [picked, setPicked] = useState<string | null>(null);
  const shown = steps.length === 1 ? steps[0] : steps.find((s) => s.id === picked);
  const signatures = [...new Set(steps.map((s) => s.ref.signature))];
  const label = `${names.of(edge.from, 4)} → ${names.of(edge.to, 4)}`;
  return <div className="space-y-4 p-3 text-xs">
    {steps.length > 1 && <Section title={`${steps.length} observed movements · ${label}`}>
      <table className="w-full text-left">
        <thead className="text-muted-foreground"><tr><th className="font-normal">Time (UTC)</th><th className="font-normal">Signature</th><th className="text-right font-normal">Amount</th></tr></thead>
        <tbody>{steps.map((s) => <tr key={s.id} className={`cursor-pointer hover:bg-accent ${s.id === picked ? "bg-accent" : ""}`} onClick={() => setPicked(s.id === picked ? null : s.id)} aria-selected={s.id === picked}>
          <td>{s.ref.time === null ? "unknown" : formatUtc(s.ref.time)}</td><td className="font-mono">{s.ref.signature.slice(0, 8)}…</td><td className="text-right">{assetText(s.ref.assetId, s.ref.amount)}</td>
        </tr>)}</tbody>
      </table>
      <p>Total of added movements: {edge.totals.map((t) => assetText(t.assetId, t.amount)).join(", ")}</p>
      {edge.firstTime !== null && <p>{formatUtc(edge.firstTime)} → {formatUtc(edge.lastTime)} UTC</p>}
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="xs" onClick={() => actions.onShowInGraph(`the traced movements ${label}`, signatures)}>Show in Graph</Button>
        <Button variant="destructive" size="xs" onClick={() => actions.onRemove(new Set(steps.map((s) => s.id)))}>Remove all {steps.length}</Button>
      </div>
    </Section>}
    {shown && <StepDetail key={shown.id} step={shown} trace={trace} view={view} evidence={evidence} index={index} names={names} assets={assets} assetText={assetText} eventState={eventState} transactionOf={transactionOf} hiddenReason={hiddenReason} actions={actions} />}
    {steps.length > 1 && !shown && <p className="text-muted-foreground">Select a row to see its evidence.</p>}
  </div>;
}

function StepDetail({ step, trace, view, evidence, index, names, assets, assetText, eventState, transactionOf, hiddenReason, actions }: {
  step: MovementStep; trace: Trace; view: TraceView; evidence: TraceEvidence; index: MovementIndex | null; names: Names; assets: Assets;
  assetText: (assetId: string, amount: string) => string; eventState: WalletState | null;
  transactionOf: (signature: string) => CanonicalTransaction | undefined;
  hiddenReason: (signature: string) => "manual" | "rule" | null; actions: InspectorActions;
}) {
  const { ref } = step;
  const event = evidence.events.get(ref.signature);
  const stale = view.issues.find((i) => i.kind === "stale" && i.stepId === step.id);
  const hidden = hiddenReason(ref.signature);
  const inTrace = new Set(trace.steps.flatMap((s) => (s.kind === "movement" ? [s.ref.key] : [])));
  const legs = index ? otherLegs(index, ref.signature, ref.key, inTrace) : [];
  const replacements = stale && index ? replacementCandidates(index, step) : [];
  const party = (address: string | null, side: string) => <p className="flex min-w-0 items-center gap-1">{side}{" "}{address ? <><AddressButton address={address} names={names} onSelect={actions.onSelectAddress} /><span className="text-muted-foreground">· {evidence.addressState(address).toLowerCase()}</span></> : "unknown"}</p>;
  return <div className="space-y-3">
    <Section title="Observed movement">
      <p className="flex items-start gap-1"><span className="break-all font-mono">{ref.signature}</span><Button variant="ghost" size="xs" onClick={() => void navigator.clipboard.writeText(ref.signature)}>Copy</Button><a href={`https://solscan.io/tx/${ref.signature}`} target="_blank" rel="noreferrer noopener" aria-label="Open in explorer" title="Open in explorer (Solscan)" className={buttonVariants({ variant: "ghost", size: "icon-xs" })}><ExternalLinkIcon /></a></p>
      <p>{ref.time === null ? "Time unknown" : `${formatUtc(ref.time)} UTC`} · slot {ref.slot.toLocaleString()}</p>
      <p className="font-medium">{assetText(ref.assetId, ref.amount)}</p>
      {party(ref.from, "From")}
      {party(ref.to, "To")}
      {ref.role && <p>Role: {ref.role.replaceAll("_", " ")}</p>}
      {event && <p>{event.category} · {event.action} · {event.confidence.toLowerCase()} confidence</p>}
      {event?.warnings.map((w) => <p key={w} className="text-destructive">{w}</p>)}
      {event && <p className="text-muted-foreground">Network fee {formatBaseUnits(event.metadata.feeLamports, 9)} SOL{event.metadata.feePayer ? ` paid by ${names.of(event.metadata.feePayer, 4)}` : ""} (context, not part of the movement)</p>}
      {hidden && <p className="text-muted-foreground">Hidden in this case ({hidden === "manual" ? "by you" : "by a hide rule"}); the Timeline won&apos;t show it until it&apos;s unhidden.</p>}
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="xs" disabled={!event} title={event ? undefined : "This transaction isn't loaded"} onClick={() => actions.onOpenInTimeline(ref.signature, ref.from, ref.to)}>Open in Timeline</Button>
        <Button variant="outline" size="xs" disabled={!event} title={event ? undefined : "This transaction isn't loaded"} onClick={() => actions.onShowInGraph(`the wallets in ${ref.signature.slice(0, 8)}…`, [ref.signature])}>Show in Graph</Button>
        <Button variant="outline" size="xs" onClick={() => actions.onStartMovement(step)}>Start trace here</Button>
        <Button variant="destructive" size="xs" onClick={() => actions.onRemove(new Set([step.id]))}>Remove</Button>
      </div>
    </Section>
    {stale?.kind === "stale" && <Section title="Stale step">
      <p className="text-destructive">{stale.reason === "transaction_not_loaded" ? "This transaction isn't in the loaded case data." : "The current reading of this transaction no longer has this movement."} Drawn from the saved reference: {ref.from ?? "?"} → {ref.to ?? "?"}, {ref.amount} base units of {ref.assetId}.</p>
      {replacements.map((r) => <div key={r.key} className="flex items-center justify-between gap-2"><span>{names.of(r.from ?? "", 4)} → {names.of(r.to ?? "", 4)} · {assetText(r.assetId, r.amount)}</span><Button variant="outline" size="xs" onClick={() => actions.onReplace(step.id, r)}>Replace with this</Button></div>)}
    </Section>}
    {legs.length > 0 && <Section title="This transaction also moved">
      {legs.map((leg) => <div key={leg.ref.key} className="flex items-center justify-between gap-2">
        <span>{names.of(leg.ref.from ?? "", 4)} → {names.of(leg.ref.to ?? "", 4)} · {assetText(leg.ref.assetId, leg.ref.amount)}{leg.ref.role && leg.weight === "supporting" ? ` · ${leg.ref.role.replaceAll("_", " ")}` : ""}</span>
        {leg.inTrace ? <span className="text-muted-foreground">in trace</span> : <Button variant="outline" size="xs" onClick={() => actions.onAddLegs([leg.ref])}>Add</Button>}
      </div>)}
    </Section>}
    {event && eventState && <>
      <EventSummary event={event} state={eventState} assets={assets} names={names} onSelectAddress={actions.onSelectAddress} />
      <EventEvidence event={event} tx={transactionOf(ref.signature)} state={eventState} assets={assets} names={names} onSelectAddress={actions.onSelectAddress} />
    </>}
  </div>;
}

/** The trace's view of a node: where it sits, what it sent and received in the trace, and why the trace stops there. */
export function NodeTraceSection({ node, view, trace, names, assetName, evidence, onShowInGraph, onMapWallet, onNewTrace, onOpenInTimeline }: {
  node: TraceView["nodes"][number]; view: TraceView; trace: Trace; names: Names; evidence: TraceEvidence;
  assetName: (assetId: string) => string;
  onShowInGraph: (label: string, signatures: string[]) => void;
  onMapWallet: (address: string) => void;
  onNewTrace: () => void;
  onOpenInTimeline: (signature: string, from: string | null, to: string | null) => void;
}) {
  const incoming = view.edges.filter((e) => e.to === node.id).flatMap((e) => e.steps);
  const outgoing = view.edges.filter((e) => e.from === node.id).flatMap((e) => e.steps);
  const stepById = new Map(trace.steps.map((s) => [s.id, s]));
  const signatures = [...new Set([...incoming, ...outgoing, ...node.conversions].map((id) => stepById.get(id)).flatMap((s) => (s ? [s.kind === "movement" ? s.ref.signature : s.signature] : [])))];
  const name = node.service?.name ?? names.of(node.id, 4);
  return <div className="flex flex-col gap-2 text-xs">
    <p>{node.isSeed ? "Seed" : node.depth === null ? "Not connected to the seed" : `${Math.abs(node.depth)} hop${Math.abs(node.depth) === 1 ? "" : "s"} ${node.depth < 0 ? "back" : "forward"}`} · {incoming.length} in · {outgoing.length} out</p>
    {node.service && <div className="space-y-0.5">
      <p>{node.service.name} · {node.service.category}. Real addresses in this trace:</p>
      {node.addresses.map((address) => <p key={address} className="break-all font-mono">{address}{evidence.serviceOf?.(address)?.label ? ` · ${evidence.serviceOf(address)!.label}` : ""}</p>)}
    </div>}
    {node.boundaries.map((kind) => {
      const { meaning, fix } = boundaryExplanation(kind);
      return <div key={kind} className="space-y-1 rounded-lg bg-muted/50 p-2">
        <p><strong>{kind.replaceAll("_", " ")}</strong>: {meaning}</p>
        {fix === "map_wallet" && !node.service && <Button variant="outline" size="xs" onClick={() => onMapWallet(node.id)}>Map wallet</Button>}
        {fix === "start_from_withdrawal" && <Button variant="outline" size="xs" onClick={onNewTrace}>Start a new trace</Button>}
      </div>;
    })}
    {node.conversions.map((id) => {
      const step = stepById.get(id);
      return step?.kind === "conversion" && <div key={id} className="flex items-center justify-between gap-2">
        <span>Converted {step.spent.map((a) => assetName(a.assetId)).join(" + ")} → {step.received.map((a) => assetName(a.assetId)).join(" + ")}</span>
        <Button variant="outline" size="xs" onClick={() => onOpenInTimeline(step.signature, step.address, null)}>Open in Timeline</Button>
      </div>;
    })}
    {signatures.length > 0 && <Button variant="outline" size="xs" className="self-start" onClick={() => onShowInGraph(`the traced movements of ${name}`, signatures)}>Show in Graph ({signatures.length} transaction{signatures.length === 1 ? "" : "s"})</Button>}
  </div>;
}
