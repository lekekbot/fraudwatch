import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { NATIVE_SOL } from "@/lib/assets/assets";
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

export const read = <T>(path: string): T => JSON.parse(readFileSync(join(process.cwd(), "fixtures/solana", path), "utf8")) as T;

/** Every balance flow, netted per address and asset, matches the observed balance changes (payer's fee added back). */
export function reconciles(e: SemanticEvent, tx: CanonicalTransaction) {
  const net = new Map<string, bigint>();
  const add = (key: string, v: bigint) => net.set(key, (net.get(key) ?? BigInt(0)) + v);
  for (const f of e.flows.filter((f) => f.source === "balance")) {
    if (f.from) add(`${f.assetId}|${f.from}`, -BigInt(f.amount));
    if (f.to) add(`${f.assetId}|${f.to}`, BigInt(f.amount));
  }
  const tokenAccounts = new Set(tx.tokenChanges.map((t) => t.account));
  const observed = new Map<string, bigint>();
  const obs = (key: string, v: bigint) => observed.set(key, (observed.get(key) ?? BigInt(0)) + v);
  for (const n of tx.nativeChanges) if (!tokenAccounts.has(n.account)) obs(`${NATIVE_SOL}|${n.account}`, BigInt(n.delta) + (n.account === tx.accounts[0].address ? BigInt(tx.feeLamports) : BigInt(0)));
  for (const t of tx.tokenChanges) obs(`${t.mint}|${t.owner ?? t.account}`, BigInt(t.delta));
  const nonzero = (m: Map<string, bigint>) => new Map([...m].filter(([, v]) => v !== BigInt(0)));
  expect(nonzero(net)).toEqual(nonzero(observed));
}
