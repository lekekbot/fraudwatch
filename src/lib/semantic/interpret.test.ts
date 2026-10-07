import { describe, expect, it } from "vitest";
import { parseRegistry } from "@/lib/protocols/registry";
import { MEMO_PROGRAMS, STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/programs";
import { type Interpreter, interpretTransaction } from "./interpret";
import { resolveProtocols } from "./resolver";
import { FEE, ix, makeTx, only, SOL, token, USDC } from "./testing";

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMMUNITY_ONLY = "12CUDzb3oe8RBQ4tYGqsuPsCbsVE4KWfktXRihXf8Ggq";

/** A's SOL for USDC out of a pool owned by P, through `program`. */
const swapThrough = (program: string) =>
  makeTx({
    native: { A: [10 * SOL, 9 * SOL - FEE], P: [SOL, 2 * SOL] },
    tokens: [token("poolUsdc", "P", USDC, 1000, 800), token("ataA", "A", USDC, 0, 200)],
    instructions: [ix(program, null)],
  });

const always = (id: string): Interpreter => ({ id, interpret: () => ({ category: "PROGRAM_INTERACTION", action: id.toUpperCase(), confidence: "LOW" }) });
const throwing: Interpreter = {
  id: "broken",
  interpret: () => {
    throw new Error("decoder exploded");
  },
};

describe("resolveProtocols", () => {
  it("resolves verified protocols from the registry", () => {
    const r = resolveProtocols(swapThrough(JUPITER));
    expect(r.protocols).toEqual([{ id: "jupiter", name: "Jupiter", category: "dex_aggregator" }]);
    expect(r.infrastructure).toContainEqual({ address: JUPITER, role: "ROUTER", label: "Jupiter Aggregator v6" });
  });

  it("keeps unknown programs unknown", () => {
    const r = resolveProtocols(swapThrough("Prog1111"));
    expect(r.protocols).toEqual([]);
    expect(r.infrastructure).toContainEqual({ address: "Prog1111", role: "PROGRAM", label: null });
  });

  it("classifies pools, vaults, authorities and fee accounts as infrastructure, and exchange wallets as not", () => {
    const [POOL, VAULT, AUTH, FEES, HOT] = [
      "JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M",
      "2rbMgYvzAb3xDk6vXrzKkY3VwsmyDZsJTkvB3JJYsRzA",
      "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
      "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    ];
    const reg = parseRegistry({
      version: 1,
      protocols: {
        dex: {
          name: "Test DEX",
          category: "dex",
          addresses: {
            [POOL]: { role: "pool", label: "Pool" },
            [VAULT]: { role: "vault", label: "Vault" },
            [AUTH]: { role: "authority", label: "Authority" },
            [FEES]: { role: "fee_account", label: "Fees" },
          },
        },
        cex: { name: "Test Exchange", category: "exchange", addresses: { [HOT]: { role: "wallet", label: "Hot wallet" } } },
      },
    });
    const tx = makeTx({ native: { A: [SOL, SOL - FEE], [POOL]: [1, 1], [VAULT]: [1, 1], [AUTH]: [1, 1], [FEES]: [1, 1], [HOT]: [1, 1] }, tokens: [token("ataA", "A", USDC, 0, 0)] });
    const roles = Object.fromEntries(resolveProtocols(tx, { registry: reg }).infrastructure.map((i) => [i.address, i.role]));
    expect(roles).toEqual({ [POOL]: "POOL", [VAULT]: "VAULT", [AUTH]: "PDA", [FEES]: "FEE_ACCOUNT", ataA: "TOKEN_ACCOUNT" });
  });

  it("never verifies a community-labelled address", () => {
    const r = resolveProtocols(makeTx({ native: { A: [SOL, SOL - FEE] } }));
    expect(r.verified(COMMUNITY_ONLY)).toBeUndefined();
  });
});

describe("interpreter pipeline", () => {
  it("lets a known DEX swap beat the generic swap reading of the same balances", () => {
    const known = only(interpretTransaction(swapThrough(JUPITER)));
    expect([known.interpreter.id, known.category, known.confidence]).toEqual(["known-dex-swap", "SWAP", "MEDIUM"]);
    expect(known.protocol?.id).toBe("jupiter");

    const generic = only(interpretTransaction(swapThrough("Prog1111")));
    expect([generic.interpreter.id, generic.category, generic.confidence]).toEqual(["generic-swap", "SWAP", "LOW"]);
    expect(generic.protocol).toBeNull();
  });

  it("reads a stake withdrawal as UNSTAKE, not as the SOL receive its balances look like", () => {
    const tx = makeTx({
      native: { A: [SOL, 3 * SOL - FEE], StakeAcct: [2 * SOL, 0] },
      instructions: [ix(STAKE_PROGRAM, "withdraw", { stakeAccount: "StakeAcct", destination: "A", lamports: 2 * SOL })],
    });
    const e = only(interpretTransaction(tx));
    expect([e.interpreter.id, e.category, e.action, e.confidence]).toEqual(["native-stake", "UNSTAKE", "WITHDRAW", "HIGH"]);
    expect(e.participants).toContainEqual({ address: "A", role: "WITHDRAWER" });
    expect(e.evidence).toContainEqual({ kind: "OUTER_INSTRUCTION", index: 0 });
  });

  it("runs interpreters in priority order, first reading wins", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] } });
    expect(only(interpretTransaction(tx, { interpreters: [always("first"), always("second")] })).interpreter.id).toBe("first");
    expect(only(interpretTransaction(tx, { interpreters: [always("second"), always("first")] })).interpreter.id).toBe("second");
  });

  it("skips an interpreter that throws and records why", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] } });
    const e = only(interpretTransaction(tx, { interpreters: [throwing, always("next")] }));
    expect(e.interpreter.id).toBe("next");
    expect(e.warnings).toEqual(["Interpreter broken failed: decoder exploded"]);

    const none = only(interpretTransaction(tx, { interpreters: [throwing] }));
    expect([none.interpreter.id, none.category, none.confidence]).toEqual(["fallback", "UNKNOWN", "LOW"]);
  });

  it("still returns an inspectable event when the transaction can't be read", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] }, success: false });
    tx.nativeChanges[0].delta = "not a number";
    const e = only(interpretTransaction(tx));
    expect([e.interpreter.id, e.category, e.flows]).toEqual(["fallback", "FAILED", []]);
    expect(e.warnings[0]).toMatch(/^Couldn't read the transaction/);
  });

  it("reserves HIGH for decoded instructions that match the balances", () => {
    const plain = makeTx({ native: { A: [10 * SOL, 9 * SOL - FEE], B: [SOL, 2 * SOL] }, instructions: [ix(SYSTEM_PROGRAM, "transfer")] });
    expect(only(interpretTransaction(plain)).confidence).toBe("HIGH");
    // The same movement made by a program nobody knows is only a balance pattern.
    const viaProgram = makeTx({ native: { A: [10 * SOL, 9 * SOL - FEE], B: [SOL, 2 * SOL] }, instructions: [ix("Prog1111", null), ix(SYSTEM_PROGRAM, "transfer")] });
    expect(only(interpretTransaction(viaProgram))).toMatchObject({ category: "TRANSFER", confidence: "LOW" });
    const token2 = makeTx({ native: { A: [SOL, SOL - FEE] }, tokens: [token("ataA", "A", USDC, 5, 0), token("ataB", "B", USDC, 0, 5)], instructions: [ix(TOKEN_PROGRAM, "transfer")] });
    expect(only(interpretTransaction(token2)).confidence).toBe("HIGH");
  });

  it("falls back to UNKNOWN rather than inventing a meaning", () => {
    const e = only(interpretTransaction(makeTx({ native: { A: [SOL, SOL - FEE] }, instructions: [ix(MEMO_PROGRAMS[0], null)] })));
    expect([e.interpreter.id, e.category, e.confidence, e.protocol]).toEqual(["unknown", "UNKNOWN", "LOW", null]);
  });

  it("doesn't let a community label give a call meaning", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] }, instructions: [ix(COMMUNITY_ONLY, "deposit")] });
    const e = only(interpretTransaction(tx));
    expect([e.interpreter.id, e.category, e.action, e.confidence, e.protocol]).toEqual(["generic-program", "PROGRAM_INTERACTION", "DEPOSIT", "LOW", null]);
    expect(e.evidence.some((x) => x.kind === "KNOWN_ADDRESS")).toBe(false);
  });

  it("gives the same output for the same input", () => {
    const run = () => interpretTransaction(swapThrough(JUPITER), { interpreters: [throwing, always("x")] });
    expect(run()).toEqual(run());
    expect(interpretTransaction(swapThrough(JUPITER))).toEqual(interpretTransaction(swapThrough(JUPITER)));
  });
});
