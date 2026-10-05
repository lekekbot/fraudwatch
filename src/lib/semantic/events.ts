import { NATIVE_SOL } from "@/lib/assets/assets";
import { enrichTransaction, protocolsUsed, type ProtocolRegistry, type RegistryEntry, registry } from "@/lib/protocols/registry";
import { BUBBLEGUM_PROGRAM, cnftMoves } from "@/lib/solana/bubblegum";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type EffectSummary, NO_NFTS, type NftCatalog, summarizeEffect } from "@/lib/state/summarize";

/**
 * Bump when the event shape or interpretation changes. Events are computed on
 * read from canonical transactions and never stored, so nothing stale can be
 * reused yet; a store for them must check this (see `DERIVED_CACHES`).
 */
export const SEMANTIC_VERSION = 1;

/**
 * Broad kinds of meaningful action. `action` carries the finer meaning (BUY,
 * BORROW, an instruction name); add a category only when an action can't say it.
 */
export type EventCategory =
  | "TRANSFER"
  | "SWAP"
  | "NFT_TRADE"
  | "NFT_TRANSFER"
  | "NFT_MINT"
  | "BURN"
  | "STAKE"
  | "UNSTAKE"
  | "LENDING"
  | "BRIDGE"
  | "LIQUIDITY"
  | "ACCOUNT"
  | "APPROVAL"
  | "PROGRAM_INTERACTION"
  | "FAILED"
  | "UNKNOWN";

/** What a meaningful actor did in the event. SIGNER: sent the transaction and had no clearer role. */
export type ParticipantRole =
  | "SIGNER"
  | "SENDER"
  | "RECEIVER"
  | "BUYER"
  | "SELLER"
  | "TRADER"
  | "DEPOSITOR"
  | "WITHDRAWER"
  | "BORROWER"
  | "LENDER"
  | "FEE_RECIPIENT"
  | "ROYALTY_RECIPIENT";

/** Addresses the event went through rather than parties to it. Never shown as wallet counterparties. */
export type InfrastructureRole = "PROGRAM" | "MARKETPLACE" | "ROUTER" | "POOL" | "VAULT" | "ESCROW" | "BRIDGE" | "TOKEN_ACCOUNT" | "PDA";

export type Participant = { address: string; role: ParticipantRole };
export type Infrastructure = { address: string; role: InfrastructureRole; label: string | null };

/**
 * One asset movement inside the event. Amounts are integer strings in base
 * units. Token flows name owners, not token accounts. A side is null when
 * balances can't say who it was: several senders and several receivers of
 * one asset, a balance that appeared from nowhere (an account closing), or
 * value that left supply.
 */
export type SemanticFlow = {
  assetId: string;
  amount: string;
  from: string | null;
  to: string | null;
  /** balance: paired from pre/post balances. compressed_nft: a Bubblegum leaf event. */
  source: "balance" | "compressed_nft";
};

/**
 * Why the event reads the way it does. Everything points into the canonical
 * transaction (by account or instruction index) or at a lookup; the
 * transaction itself is never copied.
 */
export type EvidenceRef =
  | { kind: "TRANSACTION_STATUS"; success: boolean }
  | { kind: "BALANCE_DELTA"; account: string }
  | { kind: "TOKEN_DELTA"; account: string; mint: string }
  /** Index into `CanonicalTransaction.instructions` / `.innerInstructions`. */
  | { kind: "OUTER_INSTRUCTION"; index: number }
  | { kind: "INNER_INSTRUCTION"; index: number }
  | { kind: "KNOWN_ADDRESS"; address: string; protocolId: string; registryVersion: number }
  | { kind: "NFT_TRADE_PARSER" }
  /** On-chain or DAS metadata that said this asset is an NFT. */
  | { kind: "ASSET_METADATA"; assetId: string };

/**
 * high: read straight from balances or instructions (a transfer, a failure, an approval).
 * medium: a heuristic reading of the balances (a swap, an NFT trade, a program call).
 * low: nothing recognisable, or several senders and receivers of one asset that balances can't pair.
 */
export type EventConfidence = "high" | "medium" | "low";

export type ProtocolRef = { id: string; name: string; category: string };

export type SemanticEvent = {
  /** `solana:<signature>:event:<index>`; deterministic, see `eventId`. */
  id: string;
  version: number;
  signature: string;
  slot: number;
  timestamp: string | null;
  category: EventCategory;
  action: string;
  participants: Participant[];
  infrastructure: Infrastructure[];
  /** Every asset that moved, in flow order. */
  assets: string[];
  flows: SemanticFlow[];
  /** A non-exchange protocol from the registry. */
  protocol: ProtocolRef | null;
  /** A centralized service (exchange) from the registry. */
  service: ProtocolRef | null;
  confidence: EventConfidence;
  evidence: EvidenceRef[];
  /** The interpretation is read from the fee payer's side; their fee is not a flow. */
  metadata: { feePayer: string | null; feeLamports: string };
};

export const eventId = (signature: string, index: number) => `solana:${signature}:event:${index}`;

const ZERO = BigInt(0);

const UNSTAKE_INSTRUCTIONS = new Set(["deactivate", "withdraw", "deactivateDelinquent"]);

/** transferChecked → TRANSFER_CHECKED. */
const actionName = (instruction: string | null | undefined) =>
  instruction ? instruction.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase() : "CALL";

function categorize(summary: EffectSummary): { category: EventCategory; action: string } {
  const instruction = summary.action?.instruction;
  switch (summary.kind) {
    case "SEND":
      return { category: "TRANSFER", action: "SEND" };
    case "RECEIVE":
      return { category: "TRANSFER", action: "RECEIVE" };
    case "NFT_BUY":
      return { category: "NFT_TRADE", action: "BUY" };
    case "NFT_SELL":
      return { category: "NFT_TRADE", action: "SELL" };
    case "NFT_SWAP":
      return { category: "NFT_TRADE", action: "SWAP" };
    case "NFT_MINT":
      return { category: "NFT_MINT", action: "MINT" };
    case "NFT_TRANSFER":
      return { category: "NFT_TRANSFER", action: summary.nft?.received.length ? "RECEIVE" : "SEND" };
    case "STAKE":
      return UNSTAKE_INSTRUCTIONS.has(instruction ?? "")
        ? { category: "UNSTAKE", action: actionName(instruction) }
        : { category: "STAKE", action: actionName(instruction) };
    case "PROGRAM":
      // No instruction worth naming (only compute budget or memo, or nothing parsed).
      return summary.action ? { category: "PROGRAM_INTERACTION", action: actionName(instruction) } : { category: "UNKNOWN", action: "UNKNOWN" };
    case "SWAP":
      return { category: "SWAP", action: "SWAP" };
    case "BURN":
      return { category: "BURN", action: actionName(instruction) };
    case "APPROVAL":
      return { category: "APPROVAL", action: actionName(instruction) };
    case "ACCOUNT":
      return { category: "ACCOUNT", action: actionName(instruction) };
    case "FAILED":
      return { category: "FAILED", action: "FAILED" };
  }
}

type Delta = { address: string; account: string; assetId: string; delta: bigint };

/** Value deltas by owner (wallet for SOL), with the payer's fee added back. Token accounts' rent lamports are left out. */
function deltas(tx: CanonicalTransaction, feePayer: string | null): Delta[] {
  const tokenAccounts = new Set(tx.tokenChanges.map((t) => t.account));
  const out: Delta[] = [];
  for (const n of tx.nativeChanges) {
    if (tokenAccounts.has(n.account)) continue;
    const delta = BigInt(n.delta) + (n.account === feePayer ? BigInt(tx.feeLamports) : ZERO);
    if (delta !== ZERO) out.push({ address: n.account, account: n.account, assetId: NATIVE_SOL, delta });
  }
  for (const t of tx.tokenChanges) {
    const delta = BigInt(t.delta);
    if (delta !== ZERO) out.push({ address: t.owner ?? t.account, account: t.account, assetId: t.mint, delta });
  }
  return out;
}

/**
 * Pair senders with receivers per asset. Exact with one sender (or one
 * receiver) whose amount covers the other side; otherwise each side is kept
 * with the other left unknown rather than guessed.
 */
function balanceFlows(all: Delta[]): { flows: SemanticFlow[]; ambiguous: boolean } {
  const byAddress = new Map<string, bigint>();
  const assets: string[] = [];
  for (const d of all) {
    const key = `${d.assetId}|${d.address}`;
    if (!assets.includes(d.assetId)) assets.push(d.assetId);
    byAddress.set(key, (byAddress.get(key) ?? ZERO) + d.delta);
  }
  const flows: SemanticFlow[] = [];
  let ambiguous = false;
  for (const assetId of assets) {
    const net = [...byAddress].filter(([key, v]) => key.startsWith(`${assetId}|`) && v !== ZERO).map(([key, v]) => ({ address: key.slice(assetId.length + 1), v }));
    const senders = net.filter((n) => n.v < ZERO).map((n) => ({ address: n.address, amount: -n.v }));
    const receivers = net.filter((n) => n.v > ZERO).map((n) => ({ address: n.address, amount: n.v }));
    const sum = (xs: { amount: bigint }[]) => xs.reduce((s, x) => s + x.amount, ZERO);
    const flow = (amount: bigint, from: string | null, to: string | null): SemanticFlow => ({ assetId, amount: amount.toString(), from, to, source: "balance" });
    if (senders.length === 1 && receivers.length > 0 && sum(receivers) <= senders[0].amount) {
      flows.push(...receivers.map((r) => flow(r.amount, senders[0].address, r.address)));
      const rest = senders[0].amount - sum(receivers);
      if (rest > ZERO) flows.push(flow(rest, senders[0].address, null));
    } else if (receivers.length === 1 && senders.length > 0 && sum(senders) <= receivers[0].amount) {
      flows.push(...senders.map((s) => flow(s.amount, s.address, receivers[0].address)));
      const rest = receivers[0].amount - sum(senders);
      if (rest > ZERO) flows.push(flow(rest, null, receivers[0].address));
    } else {
      ambiguous ||= senders.length > 0 && receivers.length > 0;
      flows.push(...senders.map((s) => flow(s.amount, s.address, null)), ...receivers.map((r) => flow(r.amount, null, r.address)));
    }
  }
  return { flows, ambiguous };
}

function infrastructureRole(entry: RegistryEntry): InfrastructureRole | null {
  switch (entry.role) {
    case "program":
      return entry.category === "nft_marketplace" ? "MARKETPLACE" : entry.category === "dex_aggregator" ? "ROUTER" : entry.category === "bridge" ? "BRIDGE" : "PROGRAM";
    case "pool":
    case "market":
      return "POOL";
    case "vault":
      return "VAULT";
    case "authority":
      return "PDA";
    // Fee accounts and wallets (exchange hot wallets) receive value: they're participants.
    default:
      return null;
  }
}

function infrastructureOf(tx: CanonicalTransaction, matches: RegistryEntry[]): Infrastructure[] {
  const found = new Map<string, Infrastructure>();
  const known = new Map(matches.map((m) => [m.address, m]));
  for (const ix of [...tx.instructions, ...tx.innerInstructions]) {
    if (found.has(ix.programId)) continue;
    const entry = known.get(ix.programId);
    found.set(ix.programId, { address: ix.programId, role: (entry && infrastructureRole(entry)) ?? "PROGRAM", label: entry?.label ?? ix.program });
  }
  for (const m of matches) {
    const role = infrastructureRole(m);
    if (role && !found.has(m.address)) found.set(m.address, { address: m.address, role, label: m.label });
  }
  for (const t of tx.tokenChanges) {
    if (!found.has(t.account)) found.set(t.account, { address: t.account, role: "TOKEN_ACCOUNT", label: null });
  }
  return [...found.values()];
}

function primaryRole(category: EventCategory, action: string, sent: boolean, received: boolean): ParticipantRole {
  if (category === "NFT_TRADE") return action === "BUY" ? "BUYER" : action === "SELL" ? "SELLER" : "TRADER";
  if (category === "SWAP") return "TRADER";
  if (category === "STAKE") return "DEPOSITOR";
  if (category === "UNSTAKE") return "WITHDRAWER";
  if (sent) return "SENDER";
  if (received) return "RECEIVER";
  return "SIGNER";
}

function participantsOf(
  feePayer: string | null,
  category: EventCategory,
  action: string,
  summary: EffectSummary,
  flows: SemanticFlow[],
  infrastructure: Set<string>,
): Participant[] {
  const out: Participant[] = [];
  const add = (address: string | null, role: ParticipantRole) => {
    if (!address || infrastructure.has(address) || out.some((p) => p.address === address && p.role === role)) return;
    out.push({ address, role });
  };
  const roled = new Set<string>();
  if (feePayer) {
    add(feePayer, primaryRole(category, action, flows.some((f) => f.from === feePayer), flows.some((f) => f.to === feePayer)));
    roled.add(feePayer);
  }
  const nft = summary.nft;
  if (nft) {
    // The other side: seller of a buy, buyer of a sale, payee of a mint, the other end of a transfer.
    const partyRole: ParticipantRole =
      action === "BUY" ? "SELLER" : action === "SELL" ? "BUYER" : category === "NFT_TRADE" ? "TRADER" : action === "RECEIVE" ? "SENDER" : "RECEIVER";
    if (nft.party) add(nft.party, partyRole);
    for (const o of nft.others) {
      if (o.role === "royalty") add(o.address, "ROYALTY_RECIPIENT");
      else if (o.role === "marketplace_fee") add(o.address, "FEE_RECIPIENT");
      // Rent goes to an account created here: not known to be a party, not known to be infrastructure.
      roled.add(o.address);
    }
    if (nft.party) roled.add(nft.party);
  }
  for (const f of flows) {
    if (f.from && !roled.has(f.from)) add(f.from, "SENDER");
    if (f.to && !roled.has(f.to)) add(f.to, "RECEIVER");
  }
  return out;
}

function evidenceOf(
  tx: CanonicalTransaction,
  summary: EffectSummary,
  category: EventCategory,
  all: Delta[],
  matches: RegistryEntry[],
  registryVersion: number,
  nfts: NftCatalog,
  hasCnftFlows: boolean,
): EvidenceRef[] {
  const evidence: EvidenceRef[] = [{ kind: "TRANSACTION_STATUS", success: tx.success }];
  for (const d of all) evidence.push(d.assetId === NATIVE_SOL ? { kind: "BALANCE_DELTA", account: d.account } : { kind: "TOKEN_DELTA", account: d.account, mint: d.assetId });
  const instruction = (pick: (ix: CanonicalTransaction["instructions"][number]) => boolean) => {
    const outer = tx.instructions.findIndex(pick);
    if (outer >= 0) return evidence.push({ kind: "OUTER_INSTRUCTION", index: outer });
    const inner = tx.innerInstructions.findIndex(pick);
    if (inner >= 0) evidence.push({ kind: "INNER_INSTRUCTION", index: inner });
  };
  const action = summary.action;
  if (action) instruction((ix) => ix.programId === action.programId && ix.type === action.instruction);
  if (hasCnftFlows) instruction((ix) => ix.programId === BUBBLEGUM_PROGRAM);
  for (const m of matches) evidence.push({ kind: "KNOWN_ADDRESS", address: m.address, protocolId: m.protocolId, registryVersion });
  if (category === "NFT_TRADE" || category === "NFT_TRANSFER" || category === "NFT_MINT") {
    evidence.push({ kind: "NFT_TRADE_PARSER" });
    for (const assetId of [...new Set(all.map((d) => d.assetId))]) if (nfts.isNft(assetId)) evidence.push({ kind: "ASSET_METADATA", assetId });
  }
  return evidence;
}

const HIGH = new Set<EventCategory>(["TRANSFER", "FAILED", "APPROVAL", "ACCOUNT"]);

/**
 * The meaningful action(s) in one canonical transaction. Category and action
 * reuse the per-wallet summary, read from the fee payer's side (the wallet
 * that sent it); flows, participants and infrastructure come from the whole
 * transaction, so every wallet in it sees the same event. One event per
 * transaction for now; the array and the index in `id` leave room for more.
 */
export function interpretTransaction(tx: CanonicalTransaction, nfts: NftCatalog = NO_NFTS, reg: ProtocolRegistry = registry): SemanticEvent[] {
  const feePayer = tx.accounts[0]?.address ?? null;
  const summary: EffectSummary = feePayer
    ? summarizeEffect(reconstructWalletState(feePayer, [tx], { historyComplete: true }).effects[0], tx, nfts)
    : { kind: tx.success ? "PROGRAM" : "FAILED", outflows: [], inflows: [], counterparties: [], action: null, actor: null };
  const { category, action } = categorize(summary);

  const all = deltas(tx, feePayer);
  const cnftFlows: SemanticFlow[] = cnftMoves(tx).map((m) => ({ assetId: m.assetId, amount: "1", from: m.from, to: m.to, source: "compressed_nft" }));
  const balance = balanceFlows(all);
  const flows = [...balance.flows, ...cnftFlows];

  const enrichment = enrichTransaction(tx, reg);
  const infrastructure = infrastructureOf(tx, enrichment.matches);
  const participants = participantsOf(feePayer, category, action, summary, flows, new Set(infrastructure.map((i) => i.address)));
  const used = protocolsUsed(enrichment);

  return [
    {
      id: eventId(tx.signature, 0),
      version: SEMANTIC_VERSION,
      signature: tx.signature,
      slot: tx.slot,
      timestamp: tx.timestamp,
      category,
      action,
      participants,
      infrastructure,
      assets: [...new Set(flows.map((f) => f.assetId))],
      flows,
      protocol: used.find((p) => p.category !== "exchange") ?? null,
      service: used.find((p) => p.category === "exchange") ?? null,
      confidence: category === "UNKNOWN" || balance.ambiguous ? "low" : HIGH.has(category) ? "high" : "medium",
      evidence: evidenceOf(tx, summary, category, all, enrichment.matches, enrichment.protocolRegistryVersion, nfts, cnftFlows.length > 0),
      metadata: { feePayer, feeLamports: tx.feeLamports },
    },
  ];
}
