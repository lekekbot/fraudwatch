import { NATIVE_SOL } from "@/lib/assets/assets";
import type { ProtocolRegistry } from "@/lib/protocols/registry";
import { BUBBLEGUM_PROGRAM, type CnftMove, cnftMoves } from "@/lib/solana/bubblegum";
import type { CanonicalInstruction, CanonicalTransaction } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type EffectSummary, NO_NFTS, type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import {
  type EventCategory,
  type EventConfidence,
  eventId,
  type BridgeEnvelope,
  type EvidenceRef,
  type FlowRole,
  type Infrastructure,
  type NftDetail,
  type Participant,
  type ParticipantRole,
  type ProtocolRef,
  SEMANTIC_VERSION,
  type SemanticEvent,
  type SemanticFlow,
} from "./events";
import { balanceFlows, type Delta, deltas } from "./flows";
import { INTERPRETERS } from "./interpreters";
import { type ProtocolResolution, resolveProtocols } from "./resolver";


/** Facts about one transaction, worked out once and shared by every interpreter. */
export type TransactionContext = {
  tx: CanonicalTransaction;
  feePayer: string | null;
  signers: string[];
  /** The fee payer's reading of the transaction, as the existing UI shows it. */
  summary: EffectSummary;
  /**
   * The NFT parser's reading from the first side that has one: the fee payer,
   * else a wallet that received an NFT, else one that sent one (a mint or
   * transfer someone else paid for).
   */
  nft: { wallet: string; summary: EffectSummary } | null;
  /** The NFT-aware per-wallet reading of any wallet in the transaction, computed once per wallet. */
  summaryOf: (wallet: string) => EffectSummary;
  /** Outer instructions, then inner ones, each with the evidence that points at it. */
  instructions: { ix: CanonicalInstruction; ref: EvidenceRef }[];
  flows: SemanticFlow[];
  cnftMoves: CnftMove[];
  /** Assets whose senders and receivers balances can't pair. */
  ambiguousAssets: string[];
  /** Value deltas by owner, the fee payer's fee added back, token accounts' rent left out. */
  deltas: Delta[];
  resolution: ProtocolResolution;
  nfts: NftCatalog;
};

/**
 * One interpreter's reading. Flows default to the context's balance pairing;
 * participants always come from the flows and the category.
 */
export type Interpretation = {
  category: EventCategory;
  action: string;
  confidence: EventConfidence;
  protocol?: ProtocolRef | null;
  evidence?: EvidenceRef[];
  warnings?: string[];
  /** Replaces the context's flows when the interpreter knows what each movement is for. */
  flows?: SemanticFlow[];
  /** Addresses the interpreter found to be infrastructure, beyond what the resolver knows. */
  infrastructure?: Infrastructure[];
  /** Whose action it is, when not the fee payer (a relayer can pay for someone's swap). */
  actor?: string;
  nft?: NftDetail;
  bridge?: BridgeEnvelope;
};

/**
 * Reads one kind of activity. Returns null when the transaction isn't that
 * kind, so the next interpreter in priority order gets a turn.
 */
export type Interpreter = {
  id: string;
  interpret: (context: TransactionContext) => Interpretation | null;
};

export function buildContext(
  tx: CanonicalTransaction,
  options: { nfts?: NftCatalog; registry?: ProtocolRegistry } = {},
): TransactionContext {
  const nfts = options.nfts ?? NO_NFTS;
  const feePayer = tx.accounts[0]?.address ?? null;
  const summaries = new Map<string, EffectSummary>();
  const summarize = (wallet: string) => {
    let summary = summaries.get(wallet);
    if (!summary) {
      summary = summarizeEffect(reconstructWalletState(wallet, [tx], { historyComplete: true }).effects[0], tx, nfts);
      summaries.set(wallet, summary);
    }
    return summary;
  };
  const summary: EffectSummary = feePayer
    ? summarize(feePayer)
    : { kind: tx.success ? "PROGRAM" : "FAILED", outflows: [], inflows: [], counterparties: [], action: null, actor: null };
  const all = deltas(tx, feePayer);
  const balance = balanceFlows(all);
  const moves = cnftMoves(tx);
  const cnftFlows: SemanticFlow[] = moves.map((m) => ({ assetId: m.assetId, amount: "1", from: m.from, to: m.to, source: "compressed_nft" }));

  let nft: TransactionContext["nft"] = feePayer && summary.nft ? { wallet: feePayer, summary } : null;
  if (!nft && tx.success) {
    const nftTokens = tx.tokenChanges.filter((t) => t.owner && nfts.isNft(t.mint));
    const sides = [
      ...moves.map((m) => m.to),
      ...nftTokens.filter((t) => BigInt(t.delta) > 0n).map((t) => t.owner!),
      ...moves.map((m) => m.from),
      ...nftTokens.filter((t) => BigInt(t.delta) < 0n).map((t) => t.owner!),
    ];
    for (const wallet of new Set(sides.filter((w) => w !== null && w !== feePayer))) {
      const other = summarize(wallet!);
      if (other.nft) {
        nft = { wallet: wallet!, summary: other };
        break;
      }
    }
  }
  return {
    tx,
    feePayer,
    signers: tx.accounts.filter((a) => a.signer).map((a) => a.address),
    summary,
    nft,
    summaryOf: summarize,
    instructions: [
      ...tx.instructions.map((ix, index) => ({ ix, ref: { kind: "OUTER_INSTRUCTION", index } as const })),
      ...tx.innerInstructions.map((ix, index) => ({ ix, ref: { kind: "INNER_INSTRUCTION", index } as const })),
    ],
    flows: [...balance.flows, ...cnftFlows],
    cnftMoves: moves,
    ambiguousAssets: balance.ambiguousAssets,
    resolution: resolveProtocols(tx, options),
    nfts,
    deltas: all,
  };
}

function primaryRole(category: EventCategory, action: string, sent: boolean, received: boolean): ParticipantRole {
  if (category === "NFT_TRADE") return action === "BUY" ? "BUYER" : action === "SELL" ? "SELLER" : "TRADER";
  if (category === "SWAP") return "TRADER";
  if (category === "NFT_MINT") return "RECEIVER";
  if (category === "STAKE") return "DEPOSITOR";
  if (category === "UNSTAKE") return "WITHDRAWER";
  if (category === "LENDING") return action === "BORROW" || action === "REPAY" ? "BORROWER" : action === "WITHDRAW" || action === "REMOVE_COLLATERAL" ? "WITHDRAWER" : "DEPOSITOR";
  if (category === "BRIDGE") return action === "BRIDGE_IN" ? "RECEIVER" : "SENDER";
  if (sent) return "SENDER";
  if (received) return "RECEIVER";
  return "SIGNER";
}

const SUPPORTING = new Set<FlowRole | undefined>(["rent", "settlement"]);

function participantsOf(
  ctx: TransactionContext,
  category: EventCategory,
  action: string,
  allFlows: SemanticFlow[],
  infrastructure: Set<string>,
  detail: NftDetail | undefined,
  actor: string | undefined,
): Participant[] {
  const { feePayer } = ctx;
  const nftCategory = category === "NFT_TRADE" || category === "NFT_TRANSFER" || category === "NFT_MINT";
  // The side the reading was taken from; the fee payer unless the interpreter names someone else.
  const primary = actor ?? feePayer;
  // Rent and settlement movements are evidence, not relationships.
  const flows = allFlows.filter((f) => !SUPPORTING.has(f.role));
  const out: Participant[] = [];
  const add = (address: string | null, role: ParticipantRole) => {
    if (!address || infrastructure.has(address) || out.some((p) => p.address === address && p.role === role)) return;
    out.push({ address, role });
  };
  const roled = new Set<string>();
  if (primary) {
    add(primary, primaryRole(category, action, flows.some((f) => f.from === primary), flows.some((f) => f.to === primary)));
    roled.add(primary);
  }
  const nft = nftCategory ? ctx.nft?.summary.nft : undefined;
  if (nft) {
    // The other side: seller of a buy, buyer of a sale, payee of a mint, the other end of a transfer.
    const partyRole: ParticipantRole =
      action === "BUY" ? "SELLER" : action === "SELL" ? "BUYER" : category === "NFT_TRADE" ? "TRADER" : action === "RECEIVE" ? "SENDER" : "RECEIVER";
    for (const [address, role] of [
      [detail?.buyer, "BUYER"],
      [detail?.seller, "SELLER"],
    ] as const) {
      if (!address) continue;
      add(address, role);
      roled.add(address);
    }
    if (nft.party && !infrastructure.has(nft.party) && !roled.has(nft.party)) add(nft.party, partyRole);
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
  if (feePayer && !out.some((p) => p.address === feePayer)) add(feePayer, "SIGNER");
  return out;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const FALLBACK = { id: "fallback" };

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
    interpreters?: readonly Interpreter[];
  } = {},
): SemanticEvent[] {
  const base = { id: eventId(tx.signature, 0), version: SEMANTIC_VERSION, signature: tx.signature, slot: tx.slot, timestamp: tx.timestamp };
  const metadata = { feePayer: tx.accounts[0]?.address ?? null, feeLamports: tx.feeLamports };

  let ctx: TransactionContext;
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
        trace: [],
        warnings: [`Couldn't read the transaction: ${message(error)}`],
        nft: null,
        bridge: null,
        metadata,
      },
    ];
  }

  const warnings: string[] = [];
  let chosen: { interpreter: { id: string }; reading: Interpretation } = {
    interpreter: FALLBACK,
    reading: { category: "UNKNOWN", action: "UNKNOWN", confidence: "LOW" },
  };
  const trace: SemanticEvent["trace"] = [];
  for (const interpreter of options.interpreters ?? INTERPRETERS) {
    let reading: Interpretation | null;
    try {
      reading = interpreter.interpret(ctx);
    } catch (error) {
      warnings.push(`Interpreter ${interpreter.id} failed: ${message(error)}`);
      trace.push({ id: interpreter.id, outcome: "failed" });
      continue;
    }
    trace.push({ id: interpreter.id, outcome: reading ? "matched" : "no_match" });
    if (!reading) continue;
    chosen = { interpreter: { id: interpreter.id }, reading };
    break;
  }
  const { reading } = chosen;
  warnings.push(...(reading.warnings ?? []));
  if (!reading.flows) for (const assetId of ctx.ambiguousAssets) warnings.push(`Balances can't pair the senders and receivers of ${assetId}.`);

  const evidence: EvidenceRef[] = [{ kind: "TRANSACTION_STATUS", success: tx.success }];
  for (const d of ctx.deltas) evidence.push(d.assetId === NATIVE_SOL ? { kind: "BALANCE_DELTA", account: d.account } : { kind: "TOKEN_DELTA", account: d.account, mint: d.assetId });
  if (ctx.flows.some((f) => f.source === "compressed_nft")) evidence.push(...ctx.instructions.filter((i) => i.ix.programId === BUBBLEGUM_PROGRAM).map((i) => i.ref));
  for (const m of ctx.resolution.matches) evidence.push({ kind: "KNOWN_ADDRESS", address: m.address, protocolId: m.protocolId, registryVersion: ctx.resolution.registryVersion });
  evidence.push(...(reading.evidence ?? []));
  const seen = new Set<string>();
  const flows = reading.flows ?? ctx.flows;
  const infrastructure = [...ctx.resolution.infrastructure];
  for (const extra of reading.infrastructure ?? []) if (!infrastructure.some((i) => i.address === extra.address)) infrastructure.push(extra);

  return [
    {
      ...base,
      category: reading.category,
      action: reading.action,
      participants: participantsOf(ctx, reading.category, reading.action, flows, new Set(infrastructure.map((i) => i.address)), reading.nft, reading.actor),
      infrastructure,
      assets: [...new Set(flows.map((f) => f.assetId))],
      flows,
      protocol: reading.protocol ?? null,
      service: ctx.resolution.protocols.find((p) => p.category === "exchange") ?? null,
      confidence: reading.confidence,
      evidence: evidence.filter((e) => {
        const key = JSON.stringify(e);
        return !seen.has(key) && seen.add(key);
      }),
      interpreter: chosen.interpreter,
      trace,
      warnings,
      nft: reading.nft ?? null,
      bridge: reading.bridge ?? null,
      metadata,
    },
  ];
}
