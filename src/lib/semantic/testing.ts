import { expect } from "vitest";
import type { CanonicalInstruction, CanonicalTransaction, TokenBalanceChange } from "@/lib/solana/canonical";
import { TOKEN_PROGRAM } from "@/lib/solana/programs";
import type { SemanticEvent } from "./events";

/** Builders for small canonical transactions in tests. */
export const SOL = 1_000_000_000;
export const TENTH = SOL / 10;
export const FEE = 5000;
export const USDC = "EPjFWdd5AufqSSqeM2qFxEaxx5Fe8M6M6V5WUfGjDtJ";

export const ix = (programId: string, type: string | null, info: unknown = {}): CanonicalInstruction => ({
  programId,
  program: null,
  type,
  info,
  accounts: [],
  data: null,
  outerIndex: null,
  stackHeight: null,
});

export const token = (account: string, owner: string, mint: string, pre: number, post: number): TokenBalanceChange => ({
  account,
  owner,
  mint,
  programId: TOKEN_PROGRAM,
  decimals: 6,
  pre: String(pre),
  post: String(post),
  delta: String(post - pre),
});

/** `native` lists [pre, post] lamports per account; the first entry is the fee payer. */
export function makeTx(o: {
  native: Record<string, [number, number]>;
  tokens?: TokenBalanceChange[];
  instructions?: CanonicalInstruction[];
  signers?: string[];
  success?: boolean;
  signature?: string;
}): CanonicalTransaction {
  const addresses = [...Object.keys(o.native), ...(o.tokens ?? []).map((t) => t.account)];
  const payer = addresses[0];
  return {
    signature: o.signature ?? "sig1",
    slot: 100,
    transactionIndex: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    success: o.success ?? true,
    feeLamports: String(FEE),
    accounts: addresses.map((address) => ({ address, signer: address === payer || (o.signers ?? []).includes(address), writable: true, source: "transaction" })),
    nativeChanges: addresses.map((account) => {
      const [pre, post] = o.native[account] ?? [2_039_280, 2_039_280];
      return { account, pre: String(pre), post: String(post), delta: String(post - pre) };
    }),
    tokenChanges: o.tokens ?? [],
    instructions: o.instructions ?? [],
    innerInstructions: [],
    raw: null,
  };
}

export const only = (events: SemanticEvent[]) => {
  expect(events).toHaveLength(1);
  return events[0];
};
export const roles = (e: SemanticEvent) => e.participants.map((p) => `${p.address}:${p.role}`).sort();
