import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { type CanonicalInstruction, type CanonicalTransaction, canonicalize } from "@/lib/solana/canonical";
import { ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/programs";
import { loadFixture } from "@/test/fixture-rpc";
import { reconstructWalletState } from "./reconstruct";
import { classifyInstructions, describeAction, summarizeEffect } from "./summarize";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function summaries(fixtureId: string, walletIndex: number) {
  const fixture = loadFixture(fixtureId);
  const wallet = fixture.manifest.wallets[walletIndex].address;
  const wanted = new Set(fixture.manifest.expected.signaturesByWallet[wallet]);
  const txs = fixture.rpc
    .filter((c) => c.request.method === "getTransaction" && wanted.has(c.request.params[0] as string))
    .map((c) => canonicalize((c.response as { result: RawParsedTransaction }).result));
  const byId = new Map(txs.map((t) => [t.signature, t]));
  const state = reconstructWalletState(wallet, txs, { historyComplete: true });
  return { fixture, wallet, rows: state.effects.map((e) => ({ e, s: summarizeEffect(e, byId.get(e.signature)) })) };
}

describe("summarizeEffect", () => {
  it("reads A → B → C from the intermediary's side: receive, dust, send to C", () => {
    const { fixture, rows } = summaries("a-to-b-to-c", 1);
    const [a, , c] = fixture.manifest.wallets.map((w) => w.address);
    expect(rows.map((r) => r.s.kind)).toEqual(["RECEIVE", "RECEIVE", "SEND"]);
    expect(rows[0].s.inflows).toEqual([{ assetId: USDC, delta: "200000000" }]);
    expect(rows[0].s.counterparties[0]).toMatchObject({ address: a, assetId: USDC, delta: "-200000000" });
    // The forward's biggest counterparty is C; the relayer's 0.18 USDC fee comes second.
    expect(rows[2].s.counterparties.map((cp) => cp.address)[0]).toBe(c);
  });

  it("doesn't count the fee as a SOL transfer", () => {
    const { rows } = summaries("a-to-b-to-c", 0);
    const send = rows.find((r) => r.e.signature.startsWith("4C2F"))!;
    expect(send.s.kind).toBe("SEND");
    expect(send.s.outflows.map((o) => o.assetId)).toContain(USDC);
  });

  it("recognises a swap as one asset out and another in", () => {
    const { rows } = summaries("swap", 0);
    expect(rows.some((r) => r.s.kind === "SWAP")).toBe(true);
    const swap = rows.find((r) => r.s.kind === "SWAP")!;
    expect(new Set([...swap.s.outflows, ...swap.s.inflows].map((c) => c.assetId)).size).toBeGreaterThanOrEqual(2);
  });
});

const ix = (programId: string, type: string | null = null, program: string | null = null): CanonicalInstruction => ({
  programId,
  program,
  type,
  info: null,
  accounts: [],
  data: null,
  outerIndex: null,
  stackHeight: null,
});

const tx = (instructions: CanonicalInstruction[], inner: CanonicalInstruction[] = []): CanonicalTransaction => ({
  signature: "sig",
  slot: 1,
  transactionIndex: null,
  timestamp: null,
  success: true,
  feeLamports: "5000",
  accounts: [{ address: "Payer", signer: true, writable: true, source: "transaction" }],
  nativeChanges: [],
  tokenChanges: [],
  instructions,
  innerInstructions: inner,
  raw: null,
});

const BUDGET = ix(COMPUTE_BUDGET_PROGRAM);
const UNKNOWN = "HobbakUnknownProgram1111111111111111111111";

describe("classifyInstructions", () => {
  it("never falls back to a catch-all: an unknown program is a PROGRAM call naming it", () => {
    const r = classifyInstructions(tx([BUDGET, ix(UNKNOWN)]));
    expect(r.kind).toBe("PROGRAM");
    expect(r.action?.programId).toBe(UNKNOWN);
    expect(describeAction(r.action)).toBe("Hobb…1111");
  });

  it("looks past account setup to the program that was called", () => {
    const r = classifyInstructions(tx([BUDGET, ix(ASSOCIATED_TOKEN_PROGRAM, "create"), ix(UNKNOWN)]));
    expect(r).toMatchObject({ kind: "PROGRAM", action: { programId: UNKNOWN } });
  });

  it("types pure setup as ACCOUNT", () => {
    const r = classifyInstructions(
      tx([ix(ASSOCIATED_TOKEN_PROGRAM, "createIdempotent", "spl-associated-token-account"), ix(SYSTEM_PROGRAM, "createAccount", "system")]),
    );
    expect(r.kind).toBe("ACCOUNT");
    expect(describeAction(r.action)).toBe("spl-associated-token-account · createIdempotent");
  });

  it("flags token approvals anywhere in the transaction, even inner", () => {
    const r = classifyInstructions(tx([ix(UNKNOWN)], [ix(TOKEN_PROGRAM, "approve", "spl-token")]));
    expect(r.kind).toBe("APPROVAL");
    expect(describeAction(r.action)).toBe("spl-token · approve");
  });

  it("types stake program activity as STAKE", () => {
    expect(classifyInstructions(tx([ix(SYSTEM_PROGRAM, "createAccountWithSeed"), ix(STAKE_PROGRAM, "delegate", "stake")])).kind).toBe("STAKE");
  });
});

describe("summarizeEffect actor", () => {
  const effect = { wallet: "W", signature: "sig", slot: 1, timestamp: null, success: true, assetChanges: [], feeLamports: "0" };

  it("names the fee payer when someone else sent the transaction", () => {
    expect(summarizeEffect(effect, tx([ix(UNKNOWN)]))).toMatchObject({ kind: "PROGRAM", actor: "Payer" });
  });

  it("leaves actor empty when the wallet paid", () => {
    expect(summarizeEffect({ ...effect, wallet: "Payer" }, tx([ix(UNKNOWN)])).actor).toBeNull();
  });
});

describe("summarizeEffect token operations", () => {
  it("classifies a wallet's parsed SPL burn instead of treating it as a send", () => {
    const wallet = "Burner";
    const mint = "BurnedMint";
    const account = "BurnerTokenAccount";
    const burnTx: CanonicalTransaction = {
      ...tx([]),
      accounts: [{ address: wallet, signer: true, writable: true, source: "transaction" }],
      tokenChanges: [{ account, owner: wallet, mint, programId: TOKEN_PROGRAM, decimals: 0, pre: "1", post: "0", delta: "-1" }],
      innerInstructions: [
        {
          ...ix(TOKEN_PROGRAM, "burnChecked", "spl-token"),
          info: { account, mint, authority: wallet, tokenAmount: { amount: "1", decimals: 0 } },
        },
      ],
    };
    const effect = {
      wallet,
      signature: "sig",
      slot: 1,
      timestamp: null,
      success: true,
      assetChanges: [{ assetId: mint, delta: "-1" }],
      feeLamports: "0",
    };

    expect(summarizeEffect(effect, burnTx)).toMatchObject({
      kind: "BURN",
      action: { programId: TOKEN_PROGRAM, instruction: "burnChecked" },
      outflows: [{ assetId: mint, delta: "-1" }],
    });

    expect(summarizeEffect(effect, { ...burnTx, innerInstructions: [] })).toMatchObject({ kind: "SEND" });
  });

  it("leaves a burn's SOL out of what it sent: it paid rent and a relayer, not a counterparty", () => {
    const wallet = "Burner";
    const account = "BurnerUsdc";
    const bridgeTx: CanonicalTransaction = {
      ...tx([]),
      accounts: [{ address: wallet, signer: true, writable: true, source: "transaction" }],
      nativeChanges: [
        { account: wallet, pre: "10000000", post: "4376281", delta: "-5623719" },
        { account: "MessageAccount", pre: "0", post: "3869760", delta: "3869760" },
        { account: "Relayer", pre: "1", post: "1735775", delta: "1735774" },
      ],
      tokenChanges: [{ account, owner: wallet, mint: "USDC", programId: TOKEN_PROGRAM, decimals: 6, pre: "520000000", post: "0", delta: "-520000000" }],
      innerInstructions: [{ ...ix(TOKEN_PROGRAM, "burn", "spl-token"), info: { account, mint: "USDC", authority: wallet, amount: "520000000" } }],
    };
    const effect = {
      wallet,
      signature: "sig",
      slot: 1,
      timestamp: null,
      success: true,
      assetChanges: [
        { assetId: "SOL", delta: "-5623719" },
        { assetId: "USDC", delta: "-520000000" },
      ],
      feeLamports: "18185",
    };
    const summary = summarizeEffect(effect, bridgeTx);
    expect(summary.kind).toBe("BURN");
    expect(summary.outflows).toEqual([{ assetId: "USDC", delta: "-520000000" }]);
    expect(summary.counterparties).toEqual([]);
  });
});
