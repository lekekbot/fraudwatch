import { getBase58Decoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { NATIVE_SOL } from "@/lib/assets/assets";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { interpretTransaction } from "./interpret";
import { projectEvent } from "./projection";
import { FEE, ix, makeTx, only, read, reconciles, roles, SOL, token, USDC } from "./testing";

const load = (name: string) => canonicalize(read<RawParsedTransaction>(`defi/${name}.json`));
const event = (name: string) => {
  const tx = load(name);
  return { tx, e: only(interpretTransaction(tx)) };
};
const main = (e: ReturnType<typeof event>["e"]) => e.flows.filter((f) => f.role !== "settlement").map((f) => [f.role, f.assetId, f.amount, f.from, f.to]);

/** Real USDC; the synthetic tests use `USDC`, a made-up mint. */
const REAL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

describe("Jupiter swaps", () => {
  it("reads a two-pool route as one swap for the trader, with the pools as evidence", () => {
    const { tx, e } = event("jupiter-multi-hop");
    const trader = "CKuBTzPwzrCisqQMQfAjNn6jKcfny8ny4rJVN3cxLjcf";
    expect([e.category, e.action, e.interpreter.id, e.confidence, e.protocol?.id]).toEqual(["SWAP", "SWAP", "jupiter-swap", "HIGH", "jupiter"]);
    expect(main(e)).toEqual([
      ["spent", "Hg5Ja55T5wESq4vyFoiVCMeHXtGyVA69X2UHq8hgpump", "5511307225", trader, null],
      ["received", REAL_USDC, "50290869", null, trader],
    ]);
    // Only the trader is a party: pool vaults and their authorities stay in settlement flows.
    expect(roles(e)).toEqual([`${trader}:TRADER`]);
    expect(e.flows.filter((f) => f.role === "settlement").length).toBeGreaterThan(0);
    expect(e.infrastructure.filter((i) => i.role === "ROUTER").map((i) => i.address)).toEqual([JUPITER]);
    reconciles(e, tx);
  });

  it("names the wallet that authorised the route, not the relayer that paid for it", () => {
    const { e } = event("jupiter-route-relayed");
    const trader = "xx8qyVi3tH7A25Soyez2bAiSSC2qFJ7CKDKxE6Ws4FB";
    expect([e.category, e.confidence]).toEqual(["SWAP", "HIGH"]);
    expect(e.participants).toEqual([
      { address: trader, role: "TRADER" },
      { address: e.metadata.feePayer, role: "SIGNER" },
    ]);
    expect(projectEvent(e, trader)!.action).toBe("SWAP");
  });
});

describe("generic and specific swap readings", () => {
  it("reads a swap through a router the registry knows, without a decoder, as MEDIUM", () => {
    const { tx, e } = event("okx-swap");
    expect([e.category, e.interpreter.id, e.confidence, e.protocol?.id]).toEqual(["SWAP", "known-dex-swap", "MEDIUM", "okx"]);
    expect(main(e).map(([role]) => role)).toEqual(["spent", "received"]);
    reconciles(e, tx);
  });

  it("gives the same balances HIGH with a decoded Jupiter route, MEDIUM with a known DEX, LOW with neither", () => {
    const route = getBase58Decoder().decode(new Uint8Array([229, 23, 203, 151, 122, 227, 173, 42]));
    const swap = (instruction: ReturnType<typeof ix>) =>
      makeTx({
        native: { A: [10 * SOL, 9 * SOL - FEE], P: [SOL, 2 * SOL] },
        tokens: [token("poolUsdc", "P", USDC, 1000, 800), token("ataA", "A", USDC, 0, 200)],
        instructions: [instruction],
      });
    const decodedRoute = { ...ix(JUPITER, null), data: route, accounts: ["TokenProgram", "A"] };
    const raydium = ix("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", null);
    const confidence = (instruction: ReturnType<typeof ix>) => only(interpretTransaction(swap(instruction))).confidence;
    expect([confidence(decodedRoute), confidence(raydium), confidence(ix("Unknown1111", null))]).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });
});

describe("liquid staking", () => {
  it("reads a Marinade deposit as one stake: SOL in, mSOL out", () => {
    const { tx, e } = event("marinade-deposit");
    expect([e.category, e.action, e.confidence, e.protocol?.id]).toEqual(["STAKE", "LIQUID_STAKE", "HIGH", "marinade"]);
    expect(main(e).map(([role, asset]) => [role, asset])).toEqual([
      ["spent", NATIVE_SOL],
      ["received", MSOL],
    ]);
    expect(e.participants).toEqual([{ address: "8R4crYWNvunksmeM1MprWXgooexQSYZhR1gNUjhePqDZ", role: "DEPOSITOR" }]);
    reconciles(e, tx);
  });

  it("reads a Marinade liquid unstake as UNSTAKE, not a send and a receive", () => {
    const { e } = event("marinade-liquid-unstake");
    expect([e.category, e.action, e.confidence]).toEqual(["UNSTAKE", "LIQUID_UNSTAKE", "HIGH"]);
    expect(main(e).map(([role, asset]) => [role, asset])).toEqual([
      ["spent", MSOL],
      ["received", NATIVE_SOL],
    ]);
  });
});

describe("Kamino lending", () => {
  it("reads a supply of USDC as DEPOSIT", () => {
    const { tx, e } = event("kamino-deposit");
    expect([e.category, e.action, e.confidence, e.protocol?.id]).toEqual(["LENDING", "DEPOSIT", "HIGH", "kamino"]);
    expect(main(e)).toContainEqual(["spent", REAL_USDC, "100000000", "4BmXkYKKYZ4QiQrpv7jcQiAatkPhg3g9DfwbifoaZtf7", null]);
    reconciles(e, tx);
  });

  it("reads a repayment as REPAY by the borrower", () => {
    const { e } = event("kamino-repay");
    expect([e.category, e.action, e.confidence]).toEqual(["LENDING", "REPAY", "HIGH"]);
    expect(e.participants.map((p) => p.role)).toEqual(["BORROWER"]);
  });

  it("names several lending actions in one transaction together and stays MEDIUM", () => {
    const { e } = event("kamino-deposit-and-borrow");
    expect([e.category, e.action, e.confidence]).toEqual(["LENDING", "BORROW+DEPOSIT", "MEDIUM"]);
    expect(e.warnings[0]).toBe("Several lending actions in one transaction: BORROW, DEPOSIT.");
  });

  it("leaves Kamino called from inside another program to the generic readers", () => {
    const { e } = event("kamino-via-other-program");
    expect(e.interpreter.id).not.toBe("kamino-lending");
    expect(e.category).not.toBe("LENDING");
  });
});

describe("CCTP bridge envelopes", () => {
  it("keeps a v1 burn's destination, recipient, nonce and message account", () => {
    const { e } = event("cctp-v1-burn");
    expect([e.category, e.action, e.confidence, e.protocol?.id]).toEqual(["BRIDGE", "BRIDGE_OUT", "HIGH", "cctp"]);
    expect(e.bridge).toEqual({
      direction: "OUT",
      sourceChain: "solana",
      destinationChain: "ethereum",
      asset: { assetId: REAL_USDC, amount: "1005000000" },
      remoteAddress: "0x6f622e099480c8af6793c1a5321ace9f556a0b8b",
      identifiers: { protocol: "cctp-v1", destinationDomain: "0", messageAccount: "GZWZTs7Q15i9u7LQZqLsqJBu6E6DwHunGMHBMewfjcPi", nonce: "748815" },
    });
    expect(e.evidence).toContainEqual({ kind: "RETURN_DATA", programId: "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3" });
    expect(main(e)).toEqual([["spent", REAL_USDC, "1005000000", "DC7QfCakeJWTL3MsNLjawnn2NmBq5ZqXUdXwfQG4EXm8", null]]);
  });

  it("reads a v2 burn to Base", () => {
    const { e } = event("cctp-v2-burn");
    expect(e.bridge).toMatchObject({ direction: "OUT", destinationChain: "base", identifiers: { protocol: "cctp-v2", destinationDomain: "6", messageAccount: "GsECa7a59oX3U6P4yofkGVLRzHb45CjzUdCYRup7J85G" } });
  });

  it("reads a v2 mint as a bridge in from Ethereum, keeping the message nonce", () => {
    const { e } = event("cctp-v2-receive");
    expect([e.category, e.action, e.confidence]).toEqual(["BRIDGE", "BRIDGE_IN", "HIGH"]);
    expect(e.bridge).toMatchObject({
      direction: "IN",
      sourceChain: "ethereum",
      destinationChain: "solana",
      asset: { amount: "46743024179" },
      remoteAddress: "0xbf825ea5ce9d2aa69ad6ca16fb4e339c00674fe6",
      identifiers: { sourceDomain: "0", nonce: "421cb797ee77f5b43d66b21066f6ad410ed56acd96ebda6d5882fd095b0f6784" },
    });
    expect(e.participants.map((p) => p.role)).toEqual(["RECEIVER"]);
  });
});

describe("unsupported protocols", () => {
  it("still reads a bridge program the code can't decode as plain activity, never a bridge", () => {
    const WORMHOLE_TOKEN_BRIDGE = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb";
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] }, tokens: [token("ataA", "A", USDC, 500, 0), token("custody", "Custody", USDC, 0, 500)], instructions: [ix(WORMHOLE_TOKEN_BRIDGE, null)] });
    const e = only(interpretTransaction(tx));
    expect([e.category, e.confidence, e.bridge]).toEqual(["TRANSFER", "LOW", null]);
  });
});
