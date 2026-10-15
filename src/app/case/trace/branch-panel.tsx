"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { BehaviorObservation } from "@/lib/behavior/observations";
import type { Names } from "@/lib/labels/labels";
import { branchDirection, branchOf, summarizeBranch } from "@/lib/trace/branches";
import type { TraceNode, TraceView } from "@/lib/trace/view";
import { formatUtc } from "../asset-format";
import { BEHAVIOR_LABEL } from "../timeline/observation-details";

const boundaryText = (kind: string) => kind.replaceAll("_", " ");

/** A node's downstream branch and the behaviour observations involving its addresses. */
export function BranchPanel({ node, view, hidden, observations, names, assetText, onHidden, onOpenTransaction }: {
  node: TraceNode; view: TraceView; hidden: boolean; observations: readonly BehaviorObservation[]; names: Names;
  assetText: (assetId: string, amount: string) => string;
  onHidden: (hidden: boolean) => void;
  onOpenTransaction: (signature: string, from: string | null, to: string | null) => void;
}) {
  const direction = branchDirection(node);
  const summary = useMemo(() => direction ? summarizeBranch(view, branchOf(view, node.id, direction)) : null, [direction, view, node.id]);
  const involved = observations.filter((o) => node.addresses.includes(o.wallet) || o.events.some((e) => e.counterparty && node.addresses.includes(e.counterparty)));
  return <section className="space-y-2 rounded border p-2 text-xs" aria-label="Branch">
    {summary ? <>
      <p><strong>{direction === "forward" ? "Downstream" : "Upstream"} branch</strong> · {summary.steps} step{summary.steps === 1 ? "" : "s"} · {summary.nodes} node{summary.nodes === 1 ? "" : "s"}</p>
      {summary.totals.length > 0 && <p>Added movements total: {summary.totals.map((t) => assetText(t.assetId, t.amount)).join(", ")}</p>}
      {summary.firstTime !== null && <p>{formatUtc(summary.firstTime)} → {formatUtc(summary.lastTime)} UTC</p>}
      {summary.boundaries.length > 0 && <p>Stops: {summary.boundaries.map(boundaryText).join(", ")}</p>}
      {summary.returnsTo.length > 0 && <p>Returns to {summary.returnsTo.map((id) => names.of(id)).join(", ")}</p>}
      <Button variant="outline" size="xs" disabled={!summary.steps && !hidden} onClick={() => onHidden(!hidden)}>{hidden ? "Show branch" : "Hide branch"}</Button>
    </> : <p className="text-muted-foreground">{node.isSeed ? "The seed is the root of the trace; its branch can't be hidden." : "Not connected to the seed."}</p>}
    {involved.length > 0 && <div className="space-y-1">
      <p className="font-medium">Observations involving this wallet</p>
      {involved.slice(0, 20).map((o) => <div key={o.id} className="flex items-center justify-between gap-2">
        <span>{BEHAVIOR_LABEL[o.type]} · {names.of(o.wallet)}</span>
        <Button variant="outline" size="xs" onClick={() => onOpenTransaction(o.events[0].signature, o.wallet, null)}>Open in Timeline</Button>
      </div>)}
      {involved.length > 20 && <p className="text-muted-foreground">{involved.length - 20} more in the Timeline.</p>}
    </div>}
  </section>;
}
