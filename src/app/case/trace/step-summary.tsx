"use client";

import { Button } from "@/components/ui/button";
import type { Names } from "@/lib/labels/labels";
import type { Trace, TraceStep } from "@/lib/trace/model";
import type { TraceEdge, TraceEvidence } from "@/lib/trace/view";

export function StepSummary({ edge, trace, evidence, names, assetText, onRemove, onOpenTransaction, onStartMovement }: {
  edge: TraceEdge; trace: Trace; evidence: TraceEvidence; names: Names;
  assetText: (assetId: string, amount: string) => string;
  onRemove: (ids: Set<string>) => void;
  onOpenTransaction: (signature: string, from: string | null, to: string | null) => void;
  onStartMovement: (step: Extract<TraceStep, { kind: "movement" }>) => void;
}) {
  const steps = edge.steps.map((id) => trace.steps.find((step) => step.id === id)).filter((step): step is Extract<TraceStep, { kind: "movement" }> => step?.kind === "movement");
  return <aside className="w-full space-y-2 overflow-auto rounded border p-3 text-xs lg:w-80" aria-label="Observed movements">
    <h3 className="font-semibold">Observed movements</h3>
    {steps.map((step) => {
      const ref = step.ref;
      const time = ref.time === null ? "Time unknown" : new Date(ref.time).toLocaleString();
      const confidence = evidence.events.get(ref.signature)?.confidence ?? "Evidence unavailable";
      const fromService = ref.from ? evidence.serviceOf?.(ref.from) : null;
      const toService = ref.to ? evidence.serviceOf?.(ref.to) : null;
      return <div key={step.id} className="space-y-1 rounded border p-2">
        <p className="break-all font-medium">{ref.signature}</p>
        <p>{time} · {assetText(ref.assetId, ref.amount)} · {confidence}</p>
        <p className="break-all">From {ref.from ? names.of(ref.from) : "unknown"}: {ref.from ?? "unknown"}</p>
        <p className="break-all">To {ref.to ? names.of(ref.to) : "unknown"}: {ref.to ?? "unknown"}</p>
        {(fromService || toService) && <p>Via {fromService ? `${fromService.protocolName} (${fromService.label})` : ""}{fromService && toService ? "; " : ""}{toService ? `${toService.protocolName} (${toService.label})` : ""}</p>}
        {ref.role && <p>Role: {ref.role.replaceAll("_", " ")}</p>}
        <div className="flex flex-wrap gap-1"><Button variant="outline" size="xs" onClick={() => onOpenTransaction(ref.signature, ref.from, ref.to)}>Open transaction</Button><Button variant="outline" size="xs" onClick={() => onStartMovement(step)}>Start trace here</Button><Button variant="destructive" size="xs" onClick={() => onRemove(new Set([step.id]))}>Remove</Button></div>
      </div>;
    })}
    {steps.length > 1 && <Button variant="destructive" size="xs" onClick={() => onRemove(new Set(steps.map((step) => step.id)))}>Remove all {steps.length} movements</Button>}
  </aside>;
}
