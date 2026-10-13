import { shortenAddress } from "@/lib/solana/address";
import type { FlowRole, SemanticEvent, SemanticFlow } from "./events";

/**
 * Kinds of support behind a reading, never conflated:
 * fact: read straight from the chain (status, balance changes, on-chain metadata, returned data).
 * verified: an address the protocol registry verifies.
 * derived: a deterministic reading of facts (a decoded instruction, the NFT parser's roles).
 * heuristic: a pattern FraudWatch infers, or a gap in what it could check.
 * user_label / community_label: names from the case or a third-party list; shown, never used to interpret.
 */
export type EvidenceCategory = "fact" | "verified" | "derived" | "heuristic" | "user_label" | "community_label";

/** met: holds. missing: something that would strengthen the reading isn't there. */
export type Statement = { category: EvidenceCategory; status: "met" | "missing"; text: string };

export type ExplainOptions = {
  /** Display name for an address. */
  name: (address: string) => string;
  /** "1.5 SOL" for base units of an asset. */
  amount: (amount: string, assetId: string) => string;
  asset: (assetId: string) => string;
  /** A name from the user's labels or the community list, if the address has one. */
  labelOf?: (address: string) => { source: "user" | "community"; text: string } | undefined;
  /** Behaviour observations this event is part of, already summarised. */
  observations?: readonly string[];
};

const SUPPORTING = new Set<FlowRole | undefined>(["royalty", "marketplace_fee", "rent", "unidentified", "settlement"]);
const MAX_FLOWS = 6;

const PATTERN: Partial<Record<SemanticEvent["category"], string>> = {
  SWAP: "The wallet gave up one asset and received another; no swap instruction was decoded.",
  TRANSFER: "Value moved between wallets, but other programs ran too, so a plain transfer isn't certain.",
  NFT_TRADE: "An NFT changed hands alongside a payment; the marketplace's instruction wasn't decoded.",
  PROGRAM_INTERACTION: "A program was called; what it did isn't decoded.",
  STAKE: "A stake instruction ran inside another program's call.",
};

/** Why FraudWatch reads an event the way it does, as checkable statements in fixed categories. */
export function explainEvent(event: SemanticEvent, o: ExplainOptions): Statement[] {
  const out: Statement[] = [];
  const add = (category: EvidenceCategory, status: Statement["status"], text: string) => out.push({ category, status, text });
  const decodedReading = event.confidence === "HIGH" && event.category !== "FAILED" && event.category !== "UNKNOWN";

  // Derived: the reading itself, and whether an instruction backs it.
  add("derived", "met", `Read as ${event.category} · ${event.action} by the ${event.interpreter.id} interpreter.`);
  if (decodedReading) add("derived", "met", "A known program's instruction was decoded and matches the balance changes.");
  else if (event.category === "UNKNOWN") add("derived", "missing", "Nothing recognisable: no interpreter could read this transaction.");
  else if (event.category !== "FAILED") add("derived", "missing", "No instruction was decoded: the reading rests on balance changes.");

  // Facts: what the chain itself says.
  add("fact", "met", event.category === "FAILED" ? "The transaction failed; only the network fee was charged." : "The transaction succeeded.");
  const flowText = (f: SemanticFlow) => {
    const amount = o.amount(f.amount, f.assetId);
    if (f.from && f.to) return `${o.name(f.from)} → ${o.name(f.to)}: ${amount}`;
    if (f.from) return `${o.name(f.from)} gave up ${amount}`;
    return `${o.name(f.to!)} received ${amount}`;
  };
  const main = event.flows.filter((f) => !SUPPORTING.has(f.role));
  for (const f of main.slice(0, MAX_FLOWS)) add("fact", "met", `${f.source === "compressed_nft" ? "Bubblegum leaf event" : f.source === "core_nft" ? "Metaplex Core transfer" : "Balance change"}: ${flowText(f)}.`);
  if (main.length > MAX_FLOWS) add("fact", "met", `And ${main.length - MAX_FLOWS} more balance changes.`);
  for (const e of event.evidence) {
    if (e.kind === "ASSET_METADATA") add("fact", "met", `On-chain metadata says ${o.asset(e.assetId)} is an NFT.`);
    if (e.kind === "RETURN_DATA") add("fact", "met", `${o.name(e.programId)} returned data (kept as an identifier).`);
  }

  // Verified attribution: the registry, and nothing else.
  if (event.protocol) add("verified", "met", `${event.protocol.name} is a protocol the registry verifies (${event.protocol.category.replaceAll("_", " ")}).`);
  else if (event.category !== "FAILED" && event.category !== "TRANSFER") add("verified", "missing", "No protocol the registry verifies performed this action.");
  if (event.service) add("verified", "met", `${event.service.name}, a centralized service the registry verifies, took part.`);
  for (const f of event.flows.filter((x) => x.role === "marketplace_fee" && x.to)) {
    add("verified", "met", `Marketplace fee of ${o.amount(f.amount, f.assetId)} went to ${o.name(f.to!)}, a registry fee account.`);
  }

  // Derived from metadata: roles the NFT parser assigned.
  for (const f of event.flows.filter((x) => x.role === "royalty" && x.to)) {
    add("derived", "met", `Royalty of ${o.amount(f.amount, f.assetId)} to ${o.name(f.to!)}, a creator in the NFT's metadata.`);
  }
  if (event.nft?.buyer && event.nft.seller) add("derived", "met", `The NFT parser names ${o.name(event.nft.buyer)} as buyer and ${o.name(event.nft.seller)} as seller.`);

  // Heuristics and gaps.
  const unidentified = event.flows.filter((f) => f.role === "unidentified");
  if (unidentified.length > 0) add("heuristic", "missing", `${unidentified.length} payment${unidentified.length === 1 ? "" : "s"} to recipients FraudWatch can't identify (often marketplace fees).`);
  if (!decodedReading && PATTERN[event.category]) add("heuristic", "met", PATTERN[event.category]!);
  const settlement = event.flows.filter((f) => f.role === "settlement").length;
  if (settlement > 0) add("heuristic", "met", `${settlement} routing or settlement movement${settlement === 1 ? "" : "s"} (pools, escrows, account closures) kept as evidence, not relationships.`);
  for (const observation of o.observations ?? []) add("heuristic", "met", `Part of a behaviour observation: ${observation}.`);

  // Labels: shown with their source, never used to interpret.
  const people = [...new Set([...event.participants.map((p) => p.address), ...event.infrastructure.map((i) => i.address)])];
  for (const address of people) {
    const label = o.labelOf?.(address);
    if (label?.source === "user") add("user_label", "met", `You labelled ${o.name(address)} "${label.text}". Not used to interpret.`);
    if (label?.source === "community") add("community_label", "met", `Community labels call ${shortenAddress(address)} "${label.text}" (unverified). Not used to interpret.`);
  }
  return out;
}
