import { NATIVE_SOL } from "@/lib/assets/assets";
import type { AddressLabel } from "@/lib/labels/labels";
import type { ProtocolRegistry } from "@/lib/protocols/registry";
import { BUBBLEGUM_PROGRAM, cnftMoves } from "@/lib/solana/bubblegum";
import type { CanonicalInstruction, CanonicalTransaction } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type EffectSummary, NO_NFTS, type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import {
  type EventCategory,
  type EventConfidence,
  eventId,
  type EvidenceRef,
  type Participant,
  type ParticipantRole,
  type ProtocolRef,
  SEMANTIC_VERSION,
  type SemanticEvent,
  type SemanticFlow,
} from "./events";
import { INTERPRETERS } from "./interpreters";
import { type ProtocolResolution, resolveProtocols } from "./resolver";

type Delta = { address: string; account: string; assetId: string; delta: bigint };

/** Facts about one transaction, worked out once and shared by every interpreter. */
export type TransactionContext = {
  tx: CanonicalTransaction;
  feePayer: string | null;
  signers: string[];
  /** The fee payer's reading of the transaction, as the existing UI shows it. */
  summary: EffectSummary;
  /** Outer instructions, then inner ones, each with the evidence that points at it. */
  instructions: { ix: CanonicalInstruction; ref: EvidenceRef }[];
  flows: SemanticFlow[];
  /** Assets whose senders and receivers balances can't pair. */
  ambiguousAssets: string[];
  resolution: ProtocolResolution;
  nfts: NftCatalog;
};

/** One interpreter's reading. Flows, participants and infrastructure come from the context. */
export type Interpretation = {
  category: EventCategory;
  action: string;
  confidence: EventConfidence;
  protocol?: ProtocolRef | null;
  evidence?: EvidenceRef[];
  warnings?: string[];
};

/**
 * Reads one kind of activity. Returns null when the transaction isn't that
 * kind, so the next interpreter in priority order gets a turn.
 */
export type Interpreter = {
  id: string;
  version: number;
  interpret: (context: TransactionContext) => Interpretation | null;
};

const ZERO = BigInt(0);

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
function balanceFlows(all: Delta[]): { flows: SemanticFlow[]; ambiguousAssets: string[] } {
  const byAddress = new Map<string, bigint>();
  const assets: string[] = [];
  for (const d of all) {
    const key = `${d.assetId}|${d.address}`;
    if (!assets.includes(d.assetId)) assets.push(d.assetId);
    byAddress.set(key, (byAddress.get(key) ?? ZERO) + d.delta);
  }
  const flows: SemanticFlow[] = [];
  const ambiguousAssets: string[] = [];
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
      if (senders.length > 0 && receivers.length > 0) ambiguousAssets.push(assetId);
      flows.push(...senders.map((s) => flow(s.amount, s.address, null)), ...receivers.map((r) => flow(r.amount, null, r.address)));
    }
  }
  return { flows, ambiguousAssets };
}

export function buildContext(
  tx: CanonicalTransaction,
  options: { nfts?: NftCatalog; registry?: ProtocolRegistry; labels?: ReadonlyMap<string, AddressLabel> } = {},
): TransactionContext & { deltas: Delta[] } {
  const nfts = options.nfts ?? NO_NFTS;
  const feePayer = tx.accounts[0]?.address ?? null;
  const summary: EffectSummary = feePayer
    ? summarizeEffect(reconstructWalletState(feePayer, [tx], { historyComplete: true }).effects[0], tx, nfts)
    : { kind: tx.success ? "PROGRAM" : "FAILED", outflows: [], inflows: [], counterparties: [], action: null, actor: null };
  const all = deltas(tx, feePayer);
  const balance = balanceFlows(all);
  const cnftFlows: SemanticFlow[] = cnftMoves(tx).map((m) => ({ assetId: m.assetId, amount: "1", from: m.from, to: m.to, source: "compressed_nft" }));
  return {
    tx,
    feePayer,
    signers: tx.accounts.filter((a) => a.signer).map((a) => a.address),
    summary,
    instructions: [
      ...tx.instructions.map((ix, index) => ({ ix, ref: { kind: "OUTER_INSTRUCTION", index } as const })),
      ...tx.innerInstructions.map((ix, index) => ({ ix, ref: { kind: "INNER_INSTRUCTION", index } as const })),
    ],
    flows: [...balance.flows, ...cnftFlows],
    ambiguousAssets: balance.ambiguousAssets,
    resolution: resolveProtocols(tx, options),
    nfts,
    deltas: all,
  };
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

function participantsOf(ctx: TransactionContext, category: EventCategory, action: string): Participant[] {
  const { feePayer, flows } = ctx;
  const infrastructure = new Set(ctx.resolution.infrastructure.map((i) => i.address));
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
  const nft = category === "NFT_TRADE" || category === "NFT_TRANSFER" || category === "NFT_MINT" ? ctx.summary.nft : undefined;
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

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const FALLBACK = { id: "fallback", version: SEMANTIC_VERSION };

/**
 * The meaningful action(s) in one canonical transaction. Interpreters run in
 * priority order (specific before generic) and the first reading wins; one
 * that throws is skipped with a warning. Every wallet in the transaction sees
 * the same event. One event per transaction for now; the array and the index
 * in `id` leave room for more.
 */
export function interpretTransaction(
  tx: CanonicalTransaction,
  options: {
    nfts?: NftCatalog;
    registry?: ProtocolRegistry;
    /** The case's own labels: recorded as attribution, never used to interpret. */
    labels?: ReadonlyMap<string, AddressLabel>;
    interpreters?: readonly Interpreter[];
  } = {},
): SemanticEvent[] {
  const base = { id: eventId(tx.signature, 0), version: SEMANTIC_VERSION, signature: tx.signature, slot: tx.slot, timestamp: tx.timestamp };
  const metadata = { feePayer: tx.accounts[0]?.address ?? null, feeLamports: tx.feeLamports };

  let ctx: ReturnType<typeof buildContext>;
  try {
    ctx = buildContext(tx, options);
  } catch (error) {
    // Still inspectable: the canonical transaction is there, just not read.
    return [
      {
        ...base,
        ...(tx.success ? { category: "UNKNOWN", action: "UNKNOWN" } : { category: "FAILED", action: "FAILED" }),
        participants: [],
        infrastructure: [],
        assets: [],
        flows: [],
        protocol: null,
        service: null,
        confidence: tx.success ? "LOW" : "HIGH",
        evidence: [{ kind: "TRANSACTION_STATUS", success: tx.success }],
        interpreter: FALLBACK,
        warnings: [`Couldn't read the transaction: ${message(error)}`],
        metadata,
      },
    ];
  }

  const warnings: string[] = [];
  let chosen: { interpreter: { id: string; version: number }; reading: Interpretation } = {
    interpreter: FALLBACK,
    reading: { category: "UNKNOWN", action: "UNKNOWN", confidence: "LOW" },
  };
  for (const interpreter of options.interpreters ?? INTERPRETERS) {
    let reading: Interpretation | null;
    try {
      reading = interpreter.interpret(ctx);
    } catch (error) {
      warnings.push(`Interpreter ${interpreter.id} failed: ${message(error)}`);
      continue;
    }
    if (!reading) continue;
    chosen = { interpreter: { id: interpreter.id, version: interpreter.version }, reading };
    break;
  }
  const { reading } = chosen;
  warnings.push(...(reading.warnings ?? []));
  for (const assetId of ctx.ambiguousAssets) warnings.push(`Balances can't pair the senders and receivers of ${assetId}.`);

  const evidence: EvidenceRef[] = [{ kind: "TRANSACTION_STATUS", success: tx.success }];
  for (const d of ctx.deltas) evidence.push(d.assetId === NATIVE_SOL ? { kind: "BALANCE_DELTA", account: d.account } : { kind: "TOKEN_DELTA", account: d.account, mint: d.assetId });
  if (ctx.flows.some((f) => f.source === "compressed_nft")) evidence.push(...ctx.instructions.filter((i) => i.ix.programId === BUBBLEGUM_PROGRAM).map((i) => i.ref));
  for (const m of ctx.resolution.matches) evidence.push({ kind: "KNOWN_ADDRESS", address: m.address, protocolId: m.protocolId, registryVersion: ctx.resolution.registryVersion });
  evidence.push(...(reading.evidence ?? []));
  const seen = new Set<string>();

  return [
    {
      ...base,
      category: reading.category,
      action: reading.action,
      participants: participantsOf(ctx, reading.category, reading.action),
      infrastructure: ctx.resolution.infrastructure,
      assets: [...new Set(ctx.flows.map((f) => f.assetId))],
      flows: ctx.flows,
      protocol: reading.protocol ?? null,
      service: ctx.resolution.protocols.find((p) => p.category === "exchange") ?? null,
      confidence: reading.confidence,
      evidence: evidence.filter((e) => {
        const key = JSON.stringify(e);
        return !seen.has(key) && seen.add(key);
      }),
      interpreter: chosen.interpreter,
      warnings,
      metadata,
    },
  ];
}
