import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import type { Names } from "@/lib/labels/labels";
import type { EventConfidence, EvidenceRef, FlowRole, ParticipantRole, SemanticEvent, SemanticFlow } from "@/lib/semantic/events";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState } from "@/lib/state/reconstruct";
import { type Assets, assetLabel, formatAssetAmount, nftLabel } from "../asset-format";
import { chainName, eventLabel } from "./event-card";
import { AddressButton, Section } from "./inspector-ui";

const ROLE_TEXT: Record<ParticipantRole, string> = {
  SIGNER: "Signer",
  SENDER: "Sender",
  RECEIVER: "Receiver",
  BUYER: "Buyer",
  SELLER: "Seller",
  TRADER: "Trader",
  DEPOSITOR: "Depositor",
  WITHDRAWER: "Withdrawer",
  BORROWER: "Borrower",
  LENDER: "Lender",
  FEE_RECIPIENT: "Fee recipient",
  ROYALTY_RECIPIENT: "Royalty recipient",
};

const FLOW_TEXT: Record<FlowRole, string> = {
  spent: "Spent",
  received: "Received",
  payment: "Payment",
  royalty: "Royalty",
  marketplace_fee: "Marketplace fee",
  rent: "Rent (new account)",
  unidentified: "Unidentified (often a fee)",
  nft: "NFT",
  settlement: "Settlement",
};

const CONFIDENCE_TEXT: Record<EventConfidence, string> = {
  HIGH: "A known program's decoded instruction, matching the balance changes.",
  MEDIUM: "A strong balance pattern alongside a known protocol, without a decoded instruction.",
  LOW: "A balance pattern or program call with nothing definitive behind it.",
};

const SUPPORTING = new Set<FlowRole | undefined>(["royalty", "marketplace_fee", "rent", "unidentified"]);

type Props = { event: SemanticEvent; state: WalletState; assets: Assets; names: Names; onSelectAddress: (address: string) => void };

/** The event in one sentence, with names for whoever FraudWatch knows. */
function sentence({ event, state, assets, names }: Omit<Props, "onSelectAddress">): string {
  const who = (address: string | null | undefined) => (address ? names.of(address, 4) : "someone");
  const amount = (f: { amount: string; assetId: string } | null | undefined) => (f ? `${formatAssetAmount(f.amount, f.assetId, state, assets)} ${assetLabel(f.assetId, assets)}` : "");
  const flow = (role: FlowRole) => event.flows.find((f) => f.role === role);
  const via = event.protocol ? ` via ${event.protocol.name}` : "";
  const actor = event.participants[0]?.address ?? event.metadata.feePayer;
  const nft = event.nft ? nftLabel(event.nft.assets, assets) : "";
  switch (event.category) {
    case "TRANSFER": {
      const f = event.flows.find((x) => x.from && x.to);
      return f ? `${who(f.from)} sent ${amount(f)} to ${who(f.to)}.` : `${who(actor)} moved value.`;
    }
    case "NFT_TRADE":
      if (event.action === "SWAP") return `${who(actor)} swapped NFTs (${nft})${via}.`;
      return `${who(event.nft?.buyer)} bought ${nft} from ${who(event.nft?.seller)}${event.nft?.price ? ` for ${amount(event.nft.price)}` : ""}${via}.`;
    case "NFT_MINT":
      return `${who(actor)} minted ${nft}${event.nft?.price ? ` for ${amount(event.nft.price)}` : ""}${via}.`;
    case "NFT_TRANSFER": {
      const f = flow("nft");
      return `${who(f?.from)} sent ${nft} to ${who(f?.to)}.`;
    }
    case "SWAP":
      return `${who(actor)} swapped ${amount(flow("spent")) || "assets"} for ${amount(flow("received")) || "assets"}${via}.`;
    case "STAKE":
    case "UNSTAKE":
      return `${who(actor)} ${event.category === "STAKE" ? "staked" : "unstaked"} ${amount(flow("spent")) || "assets"}${flow("received") ? ` for ${amount(flow("received"))}` : ""}${via}.`;
    case "LENDING":
      return `${who(actor)}: ${eventLabel(event).toLowerCase()} ${amount(flow("spent") ?? flow("received"))}${event.protocol ? ` on ${event.protocol.name}` : ""}.`;
    case "BRIDGE":
      return event.bridge
        ? `${who(actor)} bridged ${amount(event.bridge.asset)} from ${chainName(event.bridge.sourceChain)} to ${chainName(event.bridge.destinationChain)}${via}.`
        : `${who(actor)} used a bridge${via}.`;
    case "FAILED":
      return "The transaction failed; only the network fee was charged.";
    case "UNKNOWN":
      return "FraudWatch couldn't tell what this transaction did. Its balance changes and instructions are below.";
    default:
      return `${who(actor)}: ${eventLabel(event).toLowerCase()} (${event.action.toLowerCase().replaceAll("_", " ")})${via}.`;
  }
}

function FlowRow({ flow, state, assets, names, onSelectAddress }: { flow: SemanticFlow } & Omit<Props, "event">) {
  const side = (address: string | null) =>
    address ? <AddressButton address={address} names={names} onSelect={onSelectAddress} /> : <span className="text-xs text-muted-foreground">—</span>;
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1">
        {side(flow.from)}
        <span className="text-xs text-muted-foreground">→</span>
        {side(flow.to)}
      </span>
      <span className="flex justify-between gap-2 text-xs">
        <span className="text-[10px] text-muted-foreground uppercase">{flow.role ? FLOW_TEXT[flow.role] : "Transfer"}</span>
        <span className="tabular-nums whitespace-nowrap">
          {formatAssetAmount(flow.amount, flow.assetId, state, assets)} {assetLabel(flow.assetId, assets)}
        </span>
      </span>
    </li>
  );
}

/** Level 2: what happened, who took part, what moved. */
export function EventSummary(props: Props) {
  const { event, names, onSelectAddress } = props;
  const main = event.flows.filter((f) => f.role !== "settlement" && !SUPPORTING.has(f.role));
  const supporting = event.flows.filter((f) => SUPPORTING.has(f.role));
  return (
    <Section title="What happened">
      <p className="text-sm">{sentence(props)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {event.participants.map((p) => (
          <Fragment key={`${p.address}:${p.role}`}>
            <dt className="text-muted-foreground">{ROLE_TEXT[p.role]}</dt>
            <dd className="min-w-0">
              <AddressButton address={p.address} names={names} onSelect={onSelectAddress} />
            </dd>
          </Fragment>
        ))}
        {(event.protocol || event.service) && (
          <>
            <dt className="text-muted-foreground">{event.protocol ? "Protocol" : "Service"}</dt>
            <dd>{(event.protocol ?? event.service)!.name}</dd>
          </>
        )}
        {event.bridge && (
          <>
            <dt className="text-muted-foreground">Route</dt>
            <dd>
              {chainName(event.bridge.sourceChain)} → {chainName(event.bridge.destinationChain)}
            </dd>
            {event.bridge.remoteAddress && (
              <>
                <dt className="text-muted-foreground">{event.bridge.direction === "OUT" ? "Recipient" : "Sender"}</dt>
                <dd className="truncate font-mono text-xs" title={event.bridge.remoteAddress}>
                  {event.bridge.remoteAddress}
                </dd>
              </>
            )}
          </>
        )}
        <dt className="text-muted-foreground">Confidence</dt>
        <dd title={CONFIDENCE_TEXT[event.confidence]}>
          <Badge variant={event.confidence === "LOW" ? "outline" : "secondary"}>{event.confidence.toLowerCase()}</Badge>
        </dd>
      </dl>
      {main.length > 0 && (
        <ul className="flex flex-col gap-1.5 pt-1">
          {main.map((f, i) => (
            <FlowRow key={i} flow={f} {...props} />
          ))}
        </ul>
      )}
      {supporting.length > 0 && (
        <>
          <p className="pt-1 text-xs text-muted-foreground">Supporting payments</p>
          <ul className="flex flex-col gap-1.5">
            {supporting.map((f, i) => (
              <FlowRow key={i} flow={f} {...props} />
            ))}
          </ul>
        </>
      )}
      {event.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {event.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function evidenceText(ref: EvidenceRef, tx: CanonicalTransaction | undefined, assets: Assets, names: Names): string {
  const ix = (i: CanonicalTransaction["instructions"][number] | undefined): string =>
    i ? `${names.known(i.programId) ?? i.program ?? names.of(i.programId, 4)}${i.type ? ` · ${i.type}` : ""}` : "not loaded";
  switch (ref.kind) {
    case "TRANSACTION_STATUS":
      return `Transaction status: ${ref.success ? "success" : "failed"}`;
    case "BALANCE_DELTA":
      return `SOL balance change of ${names.of(ref.account, 4)}`;
    case "TOKEN_DELTA":
      return `${assetLabel(ref.mint, assets)} balance change in token account ${names.of(ref.account, 4)}`;
    case "OUTER_INSTRUCTION":
      return `Instruction ${ref.index + 1}: ${ix(tx?.instructions[ref.index])}`;
    case "INNER_INSTRUCTION": {
      const inner = tx?.innerInstructions[ref.index];
      return `Inner instruction${inner?.outerIndex != null ? ` of ${inner.outerIndex + 1}` : ""}: ${ix(inner)}`;
    }
    case "KNOWN_ADDRESS":
      return `${names.of(ref.address, 4)} is in the protocol registry (${ref.protocolId}, v${ref.registryVersion})`;
    case "NFT_TRADE_PARSER":
      return "Read by the NFT trade parser";
    case "ASSET_METADATA":
      return `On-chain metadata says ${assetLabel(ref.assetId, assets)} is an NFT`;
    case "RETURN_DATA":
      return `Data returned by ${names.of(ref.programId, 4)}`;
  }
}

/** Level 3: why FraudWatch reads it this way. */
export function EventEvidence({ event, tx, assets, names, state, onSelectAddress }: Props & { tx: CanonicalTransaction | undefined }) {
  const settlement = event.flows.filter((f) => f.role === "settlement");
  return (
    <Section title="Why FraudWatch reads it this way">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Reading</dt>
        <dd className="font-mono text-xs">
          {event.category} · {event.action}
        </dd>
        <dt className="text-muted-foreground">Interpreter</dt>
        <dd className="font-mono text-xs">
          {event.interpreter.id} v{event.interpreter.version}
        </dd>
        <dt className="text-muted-foreground">Confidence</dt>
        <dd className="text-xs">
          {event.confidence.toLowerCase()}: {CONFIDENCE_TEXT[event.confidence]}
        </dd>
        <dt className="text-muted-foreground">Event</dt>
        <dd className="truncate font-mono text-xs" title={event.id}>
          {event.id}
        </dd>
      </dl>
      <details className="rounded-md border">
        <summary className="cursor-pointer px-2 py-1.5 text-xs">Evidence ({event.evidence.length})</summary>
        <ul className="flex flex-col gap-1 border-t p-2 text-xs">
          {event.evidence.map((ref, i) => (
            <li key={i}>{evidenceText(ref, tx, assets, names)}</li>
          ))}
        </ul>
      </details>
      {settlement.length > 0 && (
        <details className="rounded-md border">
          <summary className="cursor-pointer px-2 py-1.5 text-xs">Routing and settlement ({settlement.length})</summary>
          <ul className="flex flex-col gap-1.5 border-t p-2">
            {settlement.map((f, i) => (
              <FlowRow key={i} flow={f} state={state} assets={assets} names={names} onSelectAddress={onSelectAddress} />
            ))}
          </ul>
        </details>
      )}
      {event.infrastructure.length > 0 && (
        <details className="rounded-md border">
          <summary className="cursor-pointer px-2 py-1.5 text-xs">Infrastructure ({event.infrastructure.length})</summary>
          <ul className="flex flex-col gap-1 border-t p-2">
            {event.infrastructure.map((i) => (
              <li key={i.address} className="flex items-center justify-between gap-2">
                <AddressButton address={i.address} names={names} onSelect={onSelectAddress} />
                <span className="text-[10px] text-muted-foreground uppercase">{i.role.replaceAll("_", " ").toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {event.bridge && Object.keys(event.bridge.identifiers).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {Object.entries(event.bridge.identifiers).map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="truncate font-mono" title={value}>
                {value}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Section>
  );
}
