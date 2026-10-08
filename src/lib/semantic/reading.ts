import type { ProtocolCategory } from "@/lib/protocols/registry";
import type { CanonicalInstruction } from "@/lib/solana/canonical";
import type { EffectKind } from "@/lib/state/summarize";
import type { EvidenceRef, ProtocolRef, SemanticFlow, StakeDetail } from "./events";
import { withSettlement } from "./flows";
import type { TransactionContext } from "./interpret";

/** Helpers interpreters share for reading a transaction context. */

/** transferChecked → TRANSFER_CHECKED. */
export const actionName = (instruction: string | null | undefined) =>
  instruction ? instruction.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase() : "CALL";

export const kindIs = (ctx: TransactionContext, ...kinds: EffectKind[]) => kinds.includes(ctx.summary.kind);

export const refsWhere = (ctx: TransactionContext, pick: (ix: CanonicalInstruction) => boolean): EvidenceRef[] =>
  ctx.instructions.filter((i) => pick(i.ix)).map((i) => i.ref);

/** The instruction the summary was typed from. */
export const summaryRef = (ctx: TransactionContext): EvidenceRef[] => {
  const action = ctx.summary.action;
  const found = action && ctx.instructions.find((i) => i.ix.programId === action.programId && i.ix.type === action.instruction);
  return found ? [found.ref] : [];
};

/** The verified protocol behind a program, unless it's core Solana. */
export function protocolOf(ctx: TransactionContext, programId: string): ProtocolRef | null {
  const entry = ctx.resolution.verified(programId);
  return entry && entry.role === "program" && entry.category !== "core" ? { id: entry.protocolId, name: entry.protocolName, category: entry.category } : null;
}

/** The first invoked program the registry verifies as one of `categories`. */
export function knownProgram(ctx: TransactionContext, categories: ProtocolCategory[]): { programId: string; protocol: ProtocolRef } | null {
  for (const { ix } of ctx.instructions) {
    const protocol = protocolOf(ctx, ix.programId);
    if (protocol && categories.includes(protocol.category as ProtocolCategory)) return { programId: ix.programId, protocol };
  }
  return null;
}

/**
 * What one wallet gave up and got back, as spent and received flows (the
 * other side left null), plus settlement flows for everything else that
 * moved: routing through pools and vaults, rent, protocol accounts. Only the
 * actor's own movements make a relationship; the route stays evidence.
 */
export function actorFlows(ctx: TransactionContext, actor: string): { flows: SemanticFlow[]; warnings: string[] } {
  const summary = ctx.summaryOf(actor);
  const amount = (delta: string) => (delta.startsWith("-") ? delta.slice(1) : delta);
  return withSettlement(ctx.deltas, [
    ...summary.outflows.map((c): SemanticFlow => ({ assetId: c.assetId, amount: amount(c.delta), from: actor, to: null, source: "balance", role: "spent" })),
    ...summary.inflows.map((c): SemanticFlow => ({ assetId: c.assetId, amount: c.delta, from: null, to: actor, source: "balance", role: "received" })),
  ]);
}

/** Whether a wallet's balances moved at all in the transaction. */
export const moved = (ctx: TransactionContext, wallet: string) => {
  const s = ctx.summaryOf(wallet);
  return s.outflows.length > 0 || s.inflows.length > 0;
};

/** Whether a wallet gave up (spentAny) or got (receivedAny) any asset, or `assetId`, in the transaction. */
export const spentAny = (ctx: TransactionContext, wallet: string, assetId?: string) => ctx.summaryOf(wallet).outflows.some((c) => !assetId || c.assetId === assetId);
export const receivedAny = (ctx: TransactionContext, wallet: string, assetId?: string) => ctx.summaryOf(wallet).inflows.some((c) => !assetId || c.assetId === assetId);

/** A stake account and the lamports it held after the transaction. */
export function stakeAccount(ctx: TransactionContext, account: string | null | undefined, newOwner: string | null = null): StakeDetail | undefined {
  const held = account ? ctx.tx.nativeChanges.find((c) => c.account === account)?.post : undefined;
  return account && held ? { account, lamports: held, newOwner } : undefined;
}
