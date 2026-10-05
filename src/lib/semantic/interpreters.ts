import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAMS,
  STAKE_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAMS,
} from "@/lib/solana/programs";
import { cctpBridge, jupiterSwap, kaminoLending, marinadeStake } from "./defi";
import type { Interpreter } from "./interpret";
import { readNft } from "./nft";
import { actionName, actorFlows, kindIs, knownProgram, protocolOf, refsWhere, summaryRef } from "./reading";

const failed: Interpreter = {
  id: "failed",
  version: 1,
  interpret: (ctx) => (ctx.tx.success ? null : { category: "FAILED", action: "FAILED", confidence: "HIGH" }),
};

/** An NFT changing hands for value through a marketplace program the registry verifies. */
const marketplaceNftTrade: Interpreter = {
  id: "marketplace-nft-trade",
  version: 1,
  interpret: (ctx) => {
    const kind = ctx.nft?.summary.kind;
    const market = kind === "NFT_BUY" || kind === "NFT_SELL" || kind === "NFT_SWAP" ? knownProgram(ctx, ["nft_marketplace"]) : null;
    const reading = market && readNft(ctx);
    if (!market || !reading) return null;
    // The marketplace's instructions aren't decoded yet: a balance pattern alongside a known program.
    return {
      ...reading,
      confidence: "MEDIUM",
      protocol: market.protocol,
      evidence: [...refsWhere(ctx, (ix) => ix.programId === market.programId), ...(reading.evidence ?? [])],
    };
  },
};

/** One asset out, another in, through a DEX or aggregator program the registry verifies. */
const knownDexSwap: Interpreter = {
  id: "known-dex-swap",
  version: 1,
  interpret: (ctx) => {
    const dex = kindIs(ctx, "SWAP") ? knownProgram(ctx, ["dex_aggregator", "dex"]) : null;
    if (!dex || !ctx.feePayer) return null;
    const { flows, warnings } = actorFlows(ctx, ctx.feePayer);
    return { category: "SWAP", action: "SWAP", confidence: "MEDIUM", protocol: dex.protocol, evidence: refsWhere(ctx, (ix) => ix.programId === dex.programId), flows, warnings };
  },
};

const UNSTAKE = new Set(["deactivate", "deactivateDelinquent", "withdraw"]);

/** A top-level call to the native stake program; the RPC decodes its instructions. */
const nativeStake: Interpreter = {
  id: "native-stake",
  version: 1,
  interpret: (ctx) => {
    // Only top-level calls: a protocol invoking the stake program inside its own instruction is that protocol's action.
    const calls = ctx.tx.instructions.filter((ix) => ix.programId === STAKE_PROGRAM);
    const last = calls.at(-1);
    if (!last) {
      if (!kindIs(ctx, "STAKE")) return null;
      // No value moved and a stake instruction ran inside another program's call.
      return { category: "STAKE", action: actionName(ctx.summary.action?.instruction), confidence: "LOW", evidence: summaryRef(ctx) };
    }
    const decoded = calls.every((ix) => ix.type !== null);
    return {
      category: UNSTAKE.has(last.type ?? "") ? "UNSTAKE" : "STAKE",
      action: actionName(last.type),
      confidence: decoded ? "HIGH" : "MEDIUM",
      evidence: refsWhere(ctx, (ix) => ix.programId === STAKE_PROGRAM),
    };
  },
};

/** Burns, approvals and token account setup: decoded SPL token, system and ATA instructions. */
const tokenInstruction: Interpreter = {
  id: "token-instruction",
  version: 1,
  interpret: (ctx) => {
    const kind = ctx.summary.kind;
    if (kind !== "BURN" && kind !== "APPROVAL" && kind !== "ACCOUNT") return null;
    return { category: kind, action: actionName(ctx.summary.action?.instruction), confidence: "HIGH", evidence: summaryRef(ctx) };
  },
};

/** NFTs moving with no verified marketplace: a trade is read from balances alone. */
const genericNft: Interpreter = {
  id: "generic-nft",
  version: 1,
  interpret: (ctx) => {
    const reading = readNft(ctx);
    if (!reading) return null;
    return { ...reading, confidence: reading.category === "NFT_TRADE" ? "LOW" : "MEDIUM" };
  },
};

const genericSwap: Interpreter = {
  id: "generic-swap",
  version: 1,
  interpret: (ctx) => {
    if (!kindIs(ctx, "SWAP") || !ctx.feePayer) return null;
    return { category: "SWAP", action: "SWAP", confidence: "LOW", ...actorFlows(ctx, ctx.feePayer) };
  },
};

/** Programs a plain transfer is made of; anything else at the top level may be doing more than a transfer. */
const TRANSFER_PROGRAMS = new Set<string>([SYSTEM_PROGRAM, ...TOKEN_PROGRAMS, ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, ...MEMO_PROGRAMS]);
const TRANSFERS = new Set(["transfer", "transferChecked", "transferWithSeed"]);

const genericTransfer: Interpreter = {
  id: "generic-transfer",
  version: 1,
  interpret: (ctx) => {
    if (!kindIs(ctx, "SEND", "RECEIVE")) return null;
    const transfers = refsWhere(ctx, (ix) => TRANSFER_PROGRAMS.has(ix.programId) && TRANSFERS.has(ix.type ?? ""));
    const plain = transfers.length > 0 && ctx.tx.instructions.every((ix) => TRANSFER_PROGRAMS.has(ix.programId));
    return { category: "TRANSFER", action: ctx.summary.kind, confidence: plain ? "HIGH" : "LOW", evidence: transfers };
  },
};

/** A call that moved none of the fee payer's value, named after its main instruction. */
const genericProgram: Interpreter = {
  id: "generic-program",
  version: 1,
  interpret: (ctx) => {
    const action = ctx.summary.action;
    if (!kindIs(ctx, "PROGRAM") || !action) return null;
    return { category: "PROGRAM_INTERACTION", action: actionName(action.instruction), confidence: "LOW", protocol: protocolOf(ctx, action.programId), evidence: summaryRef(ctx) };
  },
};

const unknown: Interpreter = {
  id: "unknown",
  version: 1,
  interpret: () => ({ category: "UNKNOWN", action: "UNKNOWN", confidence: "LOW" }),
};

/** Priority order: the first interpreter with a reading wins, so specific ones come before generic ones. */
export const INTERPRETERS: readonly Interpreter[] = [
  failed,
  marketplaceNftTrade,
  cctpBridge,
  kaminoLending,
  marinadeStake,
  jupiterSwap,
  knownDexSwap,
  nativeStake,
  tokenInstruction,
  genericNft,
  genericSwap,
  genericTransfer,
  genericProgram,
  unknown,
];
