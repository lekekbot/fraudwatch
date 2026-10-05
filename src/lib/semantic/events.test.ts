import { describe, expect, it } from "vitest";
import { NATIVE_SOL } from "@/lib/assets/assets";
import { parseRegistry } from "@/lib/protocols/registry";
import { MEMO_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/programs";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { eventId } from "./events";
import { interpretTransaction } from "./interpret";
import { FEE, ix, makeTx, only, roles, SOL, TENTH, token, USDC } from "./testing";

const solSend = makeTx({
  native: { A: [10 * SOL, 9 * SOL - FEE], B: [SOL, 2 * SOL] },
  instructions: [ix(SYSTEM_PROGRAM, "transfer", { source: "A", destination: "B", lamports: SOL })],
});

describe("interpretTransaction", () => {
  it("gives a transaction the same deterministic id every time", () => {
    const first = only(interpretTransaction(solSend));
    expect(first.id).toBe("solana:sig1:event:0");
    expect(first.id).toBe(eventId("sig1", 0));
    expect(interpretTransaction(solSend)).toEqual([first]);
  });

  it("reads a simple SOL send, with the fee left out of the flows", () => {
    const e = only(interpretTransaction(solSend));
    expect([e.category, e.action, e.confidence]).toEqual(["TRANSFER", "SEND", "HIGH"]);
    expect(e.flows).toEqual([{ assetId: NATIVE_SOL, amount: String(SOL), from: "A", to: "B", source: "balance" }]);
    expect(roles(e)).toEqual(["A:SENDER", "B:RECEIVER"]);
    expect(e.metadata).toEqual({ feePayer: "A", feeLamports: String(FEE) });
    expect(e.evidence).toEqual(
      expect.arrayContaining([
        { kind: "TRANSACTION_STATUS", success: true },
        { kind: "BALANCE_DELTA", account: "A" },
        { kind: "BALANCE_DELTA", account: "B" },
        { kind: "OUTER_INSTRUCTION", index: 0 },
      ]),
    );
  });

  it("reads a simple SOL receive signed by the receiver", () => {
    const tx = makeTx({ native: { B: [SOL, 2 * SOL - FEE], A: [10 * SOL, 9 * SOL] }, signers: ["A"], instructions: [ix(SYSTEM_PROGRAM, "transfer")] });
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action]).toEqual(["TRANSFER", "RECEIVE"]);
    expect(e.flows).toEqual([{ assetId: NATIVE_SOL, amount: String(SOL), from: "A", to: "B", source: "balance" }]);
    expect(roles(e)).toEqual(["A:SENDER", "B:RECEIVER"]);
  });

  it("reads an SPL transfer between owners, keeping token accounts as infrastructure", () => {
    const tx = makeTx({
      native: { A: [SOL, SOL - FEE] },
      tokens: [token("ataA", "A", USDC, 500, 200), token("ataB", "B", USDC, 0, 300)],
      instructions: [ix(TOKEN_PROGRAM, "transferChecked")],
    });
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action]).toEqual(["TRANSFER", "SEND"]);
    expect(e.flows).toEqual([{ assetId: USDC, amount: "300", from: "A", to: "B", source: "balance" }]);
    expect(e.assets).toEqual([USDC]);
    expect(roles(e)).toEqual(["A:SENDER", "B:RECEIVER"]);
    expect(e.infrastructure).toEqual(
      expect.arrayContaining([
        { address: TOKEN_PROGRAM, role: "PROGRAM", label: "Token Program" },
        { address: "ataA", role: "TOKEN_ACCOUNT", label: null },
        { address: "ataB", role: "TOKEN_ACCOUNT", label: null },
      ]),
    );
    expect(e.evidence).toEqual(expect.arrayContaining([{ kind: "TOKEN_DELTA", account: "ataA", mint: USDC }]));
  });

  it("reads a failed transaction as FAILED with no flows", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE], B: [SOL, SOL] }, success: false, instructions: [ix(SYSTEM_PROGRAM, "transfer")] });
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action, e.confidence]).toEqual(["FAILED", "FAILED", "HIGH"]);
    expect(e.flows).toEqual([]);
    expect(roles(e)).toEqual(["A:SIGNER"]);
    expect(e.evidence).toContainEqual({ kind: "TRANSACTION_STATUS", success: false });
  });

  it("reads a call that moved no value as a program interaction", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] }, instructions: [ix("Prog1111", "updateConfig")] });
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action, e.confidence]).toEqual(["PROGRAM_INTERACTION", "UPDATE_CONFIG", "LOW"]);
    expect(e.flows).toEqual([]);
    expect(roles(e)).toEqual(["A:SIGNER"]);
    expect(e.infrastructure).toEqual([{ address: "Prog1111", role: "PROGRAM", label: null }]);
  });

  it("keeps every asset movement of an NFT purchase as flows under one event", () => {
    const FEES = "2rbMgYvzAb3xDk6vXrzKkY3VwsmyDZsJTkvB3JJYsRzA"; // a registry fee account
    const nfts: NftCatalog = { isNft: (m) => m === "NFTX", royaltyRecipients: (m) => (m === "NFTX" ? ["Creator"] : []) };
    const tx = makeTx({
      native: { A: [50 * SOL, 8 * SOL - FEE], B: [SOL, 404 * TENTH], [FEES]: [SOL, 18 * TENTH], Creator: [SOL, 28 * TENTH] },
      tokens: [token("ataB", "B", "NFTX", 1, 0), token("ataA", "A", "NFTX", 0, 1)],
    });
    const e = only(interpretTransaction(tx, { nfts }));
    expect([e.category, e.action]).toEqual(["NFT_TRADE", "BUY"]);
    expect(e.flows).toEqual([
      { assetId: NATIVE_SOL, amount: String(394 * TENTH), from: "A", to: "B", source: "balance" },
      { assetId: NATIVE_SOL, amount: String(8 * TENTH), from: "A", to: FEES, source: "balance" },
      { assetId: NATIVE_SOL, amount: String(18 * TENTH), from: "A", to: "Creator", source: "balance" },
      { assetId: "NFTX", amount: "1", from: "B", to: "A", source: "balance" },
    ]);
    expect(roles(e)).toEqual(["A:BUYER", "B:SELLER", "Creator:ROYALTY_RECIPIENT", `${FEES}:FEE_RECIPIENT`].sort());
    expect(e.evidence).toEqual(expect.arrayContaining([{ kind: "NFT_TRADE_PARSER" }, { kind: "ASSET_METADATA", assetId: "NFTX" }]));
  });

  it("leaves a side unknown when balances can't pair senders with receivers", () => {
    const tx = makeTx({ native: { A: [10 * SOL, 8 * SOL - FEE], B: [10 * SOL, 7 * SOL], C: [0, 1 * SOL], D: [0, 4 * SOL] } });
    const e = only(interpretTransaction(tx));
    expect(e.flows.every((f) => (f.from === null) !== (f.to === null))).toBe(true);
    expect(e.flows).toHaveLength(4);
    expect(e.confidence).toBe("LOW");
  });

  it("separates routers and vaults from participants", () => {
    const ROUTER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    const VAULT = "JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M";
    const reg = parseRegistry({
      version: 7,
      protocols: {
        agg: { name: "Test Aggregator", category: "dex_aggregator", addresses: { [ROUTER]: { role: "program", label: "Test Router" } } },
        dex: { name: "Test DEX", category: "dex", addresses: { [VAULT]: { role: "vault", label: "Test Vault" } } },
      },
    });
    const tx = makeTx({
      native: { A: [10 * SOL, 9 * SOL - FEE], [VAULT]: [SOL, 2 * SOL] },
      tokens: [token("vaultUsdc", VAULT, USDC, 1000, 800), token("ataA", "A", USDC, 0, 200)],
      instructions: [ix(ROUTER, null)],
    });
    const e = only(interpretTransaction(tx, { registry: reg }));
    expect([e.category, e.action]).toEqual(["SWAP", "SWAP"]);
    expect(roles(e)).toEqual(["A:TRADER"]);
    expect(e.infrastructure).toEqual(
      expect.arrayContaining([
        { address: ROUTER, role: "ROUTER", label: "Test Router" },
        { address: VAULT, role: "VAULT", label: "Test Vault" },
      ]),
    );
    expect(e.flows.map((f) => [f.assetId, f.from, f.to])).toEqual([
      [NATIVE_SOL, "A", VAULT],
      [USDC, VAULT, "A"],
    ]);
    expect(e.protocol).toEqual({ id: "agg", name: "Test Aggregator", category: "dex_aggregator" });
    expect(e.evidence).toContainEqual({ kind: "KNOWN_ADDRESS", address: VAULT, protocolId: "dex", registryVersion: 7 });
  });

  it("reads a transaction with nothing recognisable as UNKNOWN", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] }, instructions: [ix(MEMO_PROGRAMS[0], null)] });
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action, e.confidence]).toEqual(["UNKNOWN", "UNKNOWN", "LOW"]);
  });

  it("agrees with the fee payer's existing transaction summary", () => {
    const expected = { SEND: "TRANSFER/SEND", RECEIVE: "TRANSFER/RECEIVE", FAILED: "FAILED/FAILED", PROGRAM: "PROGRAM_INTERACTION/UPDATE_CONFIG" } as const;
    const cases = [
      solSend,
      makeTx({ native: { B: [SOL, 2 * SOL - FEE], A: [10 * SOL, 9 * SOL] } }),
      makeTx({ native: { A: [SOL, SOL - FEE] }, success: false }),
      makeTx({ native: { A: [SOL, SOL - FEE] }, instructions: [ix("Prog1111", "updateConfig")] }),
    ];
    for (const tx of cases) {
      const payer = tx.accounts[0].address;
      const summary = summarizeEffect(reconstructWalletState(payer, [tx], { historyComplete: true }).effects[0], tx);
      const e = only(interpretTransaction(tx));
      expect(`${e.category}/${e.action}`).toBe(expected[summary.kind as keyof typeof expected]);
    }
  });
});
