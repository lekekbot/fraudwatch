import type { RawInstruction, RawParsedTransaction, RawTokenBalance } from "@/lib/rpc/generic-adapter";

/**
 * Bump when `canonicalize` output changes. Cached canonical transactions from an
 * older version are re-derived from the stored raw response, not refetched.
 */
export const PARSER_VERSION = 1;

/**
 * Provider-independent transaction shape. Amounts are integer strings in base
 * units (lamports / raw token amount) so no precision is lost.
 */
export type CanonicalTransaction = {
  signature: string;
  slot: number;
  timestamp: string | null;
  success: boolean;

  feeLamports: string;

  accounts: CanonicalAccount[];
  nativeChanges: NativeBalanceChange[];
  tokenChanges: TokenBalanceChange[];

  instructions: CanonicalInstruction[];
  innerInstructions: CanonicalInstruction[];

  raw: unknown;
};

export type CanonicalAccount = {
  address: string;
  signer: boolean;
  writable: boolean;
  /** v0 transactions can load accounts from address lookup tables. */
  source: "transaction" | "lookupTable";
};

export type NativeBalanceChange = {
  account: string;
  pre: string;
  post: string;
  delta: string;
};

export type TokenBalanceChange = {
  /** The token account, not its owner. */
  account: string;
  owner: string | null;
  mint: string;
  programId: string | null;
  decimals: number;
  pre: string;
  post: string;
  delta: string;
};

export type CanonicalInstruction = {
  programId: string;
  program: string | null;
  /** jsonParsed instruction type, e.g. "transferChecked", when the RPC could parse it. */
  type: string | null;
  info: unknown;
  accounts: string[];
  data: string | null;
  /** For inner instructions: index of the outer instruction that invoked it. */
  outerIndex: number | null;
  stackHeight: number | null;
};

export class CanonicalizeError extends Error {}

function delta(pre: bigint, post: bigint): string {
  return (post - pre).toString();
}

function canonicalInstruction(ix: RawInstruction, outerIndex: number | null): CanonicalInstruction {
  const parsed = ix.parsed as { type?: unknown; info?: unknown } | string | undefined;
  const structured = typeof parsed === "object" && parsed !== null;
  return {
    programId: ix.programId,
    program: ix.program ?? null,
    type: structured && typeof parsed.type === "string" ? parsed.type : null,
    info: structured ? (parsed.info ?? null) : (parsed ?? null),
    accounts: ix.accounts ?? [],
    data: ix.data ?? null,
    outerIndex,
    stackHeight: ix.stackHeight ?? null,
  };
}

function tokenChanges(
  accounts: CanonicalAccount[],
  pre: RawTokenBalance[],
  post: RawTokenBalance[],
): TokenBalanceChange[] {
  const byIndex = new Map<number, { pre?: RawTokenBalance; post?: RawTokenBalance }>();
  for (const b of pre) byIndex.set(b.accountIndex, { ...byIndex.get(b.accountIndex), pre: b });
  for (const b of post) byIndex.set(b.accountIndex, { ...byIndex.get(b.accountIndex), post: b });

  const changes: TokenBalanceChange[] = [];
  for (const [index, { pre: before, post: after }] of [...byIndex].sort(([a], [b]) => a - b)) {
    const ref = (after ?? before)!;
    // A missing side means the token account was created or closed in this transaction.
    const preAmount = BigInt(before?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(after?.uiTokenAmount.amount ?? "0");
    changes.push({
      account: accounts[index]?.address ?? `#${index}`,
      owner: ref.owner ?? before?.owner ?? null,
      mint: ref.mint,
      programId: ref.programId ?? null,
      decimals: ref.uiTokenAmount.decimals,
      pre: preAmount.toString(),
      post: postAmount.toString(),
      delta: delta(preAmount, postAmount),
    });
  }
  return changes;
}

export function canonicalize(raw: RawParsedTransaction): CanonicalTransaction {
  const signature = raw.transaction?.signatures?.[0];
  if (!signature) throw new CanonicalizeError("Transaction has no signature.");
  const meta = raw.meta;
  if (!meta) throw new CanonicalizeError(`Transaction ${signature} has no status metadata.`);

  const accounts: CanonicalAccount[] = raw.transaction.message.accountKeys.map((k) => ({
    address: k.pubkey,
    signer: k.signer,
    writable: k.writable,
    source: k.source === "lookupTable" ? "lookupTable" : "transaction",
  }));

  const nativeChanges: NativeBalanceChange[] = accounts.map((a, i) => {
    const pre = BigInt(meta.preBalances[i] ?? 0);
    const post = BigInt(meta.postBalances[i] ?? 0);
    return { account: a.address, pre: pre.toString(), post: post.toString(), delta: delta(pre, post) };
  });

  const innerInstructions = (meta.innerInstructions ?? [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .flatMap((group) => group.instructions.map((ix) => canonicalInstruction(ix, group.index)));

  return {
    signature,
    slot: raw.slot,
    timestamp: raw.blockTime == null ? null : new Date(raw.blockTime * 1000).toISOString(),
    success: meta.err == null,
    feeLamports: String(meta.fee),
    accounts,
    nativeChanges,
    tokenChanges: tokenChanges(accounts, meta.preTokenBalances ?? [], meta.postTokenBalances ?? []),
    instructions: raw.transaction.message.instructions.map((ix) => canonicalInstruction(ix, null)),
    innerInstructions,
    raw,
  };
}
