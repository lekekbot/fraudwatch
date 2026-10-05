import { Fragment } from "react";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BehaviorObservation, BehaviorType } from "@/lib/behavior/observations";
import type { Names } from "@/lib/labels/labels";
import type { SemanticEvent } from "@/lib/semantic/events";
import { type Assets, assetLabel, formatUtc } from "../asset-format";
import { chainName, eventLabel } from "./event-card";
import { AddressButton, Section } from "./inspector-ui";

export const BEHAVIOR_LABEL: Record<BehaviorType, string> = {
  RAPID_FORWARDING: "Rapid forwarding",
  FUND_SPLIT: "Fund split",
  CONSOLIDATION: "Consolidation",
  REPEATED_COUNTERPARTY: "Repeated counterparty",
  CIRCULAR_MOVEMENT: "Circular movement",
  BRIDGE_MILESTONE: "Bridge",
  EXCHANGE_DEPOSIT: "Exchange deposit",
};

/** How long, in the largest unit that reads naturally. */
export function duration(seconds: number): string {
  if (seconds < 120) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

type Format = (amount: string, assetId: string) => string;

/** The pattern in one line, e.g. "100 SOL → 3 destinations within 74 seconds". */
export function observationSummary(o: BehaviorObservation, format: Format, assets: Assets, names: Names): string {
  const v = o.values;
  const amount = (key: string) => (o.assetId && typeof v[key] === "string" ? `${format(v[key] as string, o.assetId)} ${assetLabel(o.assetId, assets)}` : "");
  const within = typeof v.windowSeconds === "number" ? ` within ${duration(v.windowSeconds)}` : "";
  switch (o.type) {
    case "RAPID_FORWARDING":
      return `${amount("incomingAmount")} in, ${amount("outgoingAmount")} sent on (${v.coveragePercent}%)${within}`;
    case "FUND_SPLIT":
      return `${amount("totalAmount")} → ${v.branches} destinations${within}`;
    case "CONSOLIDATION":
      return `${v.sources} senders → ${amount("totalAmount")}${within}`;
    case "REPEATED_COUNTERPARTY":
      return `${v.interactions} transfers with ${names.of(String(v.counterparty), 4)} over ${duration(Number(v.spanSeconds))}`;
    case "CIRCULAR_MOVEMENT":
      return `${amount("firstAmount")} ${v.firstDirection === "out" ? "to" : "from"} ${names.of(String(v.counterparty), 4)}, ${v.returnPercent}% back${within}`;
    case "BRIDGE_MILESTONE":
      return `${amount("bridgedAmount")} ${v.direction === "out" ? "to" : "from"} ${chainName(String(v.chain))}${v.protocol ? ` via ${v.protocol}` : ""}`;
    case "EXCHANGE_DEPOSIT":
      return `${amount("depositedAmount")} to ${v.exchange}${Number(v.deposits) > 1 ? ` in ${v.deposits} deposits over ${duration(Number(v.spanSeconds))}` : ""}`;
  }
}

const VALUE_TEXT: Record<string, string> = {
  windowSeconds: "Time taken",
  spanSeconds: "Time span",
  incomingAmount: "Received",
  outgoingAmount: "Sent on",
  coveragePercent: "Share sent on",
  totalAmount: "Total",
  sourceAmount: "Received before",
  branches: "Recipients",
  sources: "Senders",
  counterparty: "With",
  interactions: "Transfers",
  sent: "Sent",
  received: "Received",
  firstDirection: "First",
  firstAmount: "First amount",
  returnedAmount: "Came back",
  returnPercent: "Share back",
  direction: "Direction",
  chain: "Other chain",
  bridgedAmount: "Amount",
  protocol: "Protocol",
  exchange: "Exchange",
  depositAddress: "Deposit address",
  depositedAmount: "Amount",
  deposits: "Deposits",
  depositAddresses: "Deposit addresses",
};

export function ObservationDetails({
  observation: o,
  events,
  format,
  assets,
  names,
  onSelectAddress,
  onSelectEvent,
  onClose,
  together = [],
  onSelectObservation,
}: {
  observation: BehaviorObservation;
  /** Semantic events by signature, to name each triggering event. */
  events: ReadonlyMap<string, SemanticEvent>;
  format: Format;
  assets: Assets;
  names: Names;
  onSelectAddress: (address: string) => void;
  onSelectEvent: (signature: string) => void;
  onClose: () => void;
  /** Other observations that start at the same moment. */
  together?: readonly BehaviorObservation[];
  onSelectObservation?: (id: string) => void;
}) {
  const value = (key: string, v: string | number) => {
    if (key.endsWith("Amount") && o.assetId && typeof v === "string") return `${format(v, o.assetId)} ${assetLabel(o.assetId, assets)}`;
    if (key.endsWith("Seconds") && typeof v === "number") return duration(v);
    if (key.endsWith("Percent")) return `${v}%`;
    if (key === "counterparty" || key === "depositAddress") return <AddressButton address={String(v)} names={names} onSelect={onSelectAddress} />;
    return String(v);
  };
  return (
    <section className="flex min-w-0 flex-col gap-4 p-3" aria-label="Behaviour observation">
      <div className="flex items-center justify-between gap-2">
        <Badge className="bg-[oklch(0.83_0.16_92)] text-black">◆ {BEHAVIOR_LABEL[o.type]}</Badge>
        <Button variant="ghost" size="icon-sm" aria-label="Close observation" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <Section title="What emerged">
        <p className="text-sm">{observationSummary(o, format, assets, names)}</p>
        <p className="text-xs text-muted-foreground">
          {formatUtc(o.start)}
          {o.end !== o.start ? ` → ${formatUtc(o.end)}` : ""} UTC · {names.of(o.wallet, 4)}
        </p>
        <p className="text-xs text-muted-foreground">A pattern across these events, read by a fixed rule. It describes behaviour; it isn&apos;t a verdict.</p>
      </Section>

      {together.length > 0 && (
        <Section title="Also starting here">
          <ul className="flex flex-col gap-1">
            {together.map((other) => (
              <li key={other.id}>
                <button type="button" className="text-left text-xs underline-offset-4 hover:underline" onClick={() => onSelectObservation?.(other.id)}>
                  ◆ {BEHAVIOR_LABEL[other.type]}: {observationSummary(other, format, assets, names)}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Rule">
        <p className="text-sm">{o.rule}</p>
        {Object.keys(o.thresholds).length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {Object.entries(o.thresholds).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Calculated">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {Object.entries(o.values).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{VALUE_TEXT[k] ?? k}</dt>
              <dd className="min-w-0 truncate tabular-nums">{value(k, v)}</dd>
            </Fragment>
          ))}
        </dl>
      </Section>

      <Section title={`Triggered by ${o.events.length} event${o.events.length === 1 ? "" : "s"}`}>
        <ul className="flex flex-col gap-1">
          {o.events.map((e) => {
            const event = events.get(e.signature);
            return (
              <li key={e.eventId}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(e.signature)}
                  className="flex w-full flex-col rounded-md px-2 py-1 text-left hover:bg-muted/50"
                  title="Show this event on the timeline"
                >
                  <span className="flex justify-between gap-2 text-xs">
                    <span className="font-medium">{event ? eventLabel(event, o.wallet) : "Event"}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{e.role}</span>
                  </span>
                  <span className="flex justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatUtc(e.time)}</span>
                    {e.amount && e.assetId && (
                      <span className="tabular-nums">
                        {format(e.amount, e.assetId)} {assetLabel(e.assetId, assets)}
                        {e.counterparty && !e.counterparty.startsWith("bridge:") ? ` · ${names.of(e.counterparty, 3)}` : ""}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    </section>
  );
}
