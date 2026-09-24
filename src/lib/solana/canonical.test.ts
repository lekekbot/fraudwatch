import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { loadFixture } from "@/test/fixture-rpc";
import { CanonicalizeError, canonicalize } from "./canonical";

function recordedTransaction(fixtureId: string, signaturePrefix: string): RawParsedTransaction {
  const call = loadFixture(fixtureId).rpc.find(
    (c) => c.request.method === "getTransaction" && String(c.request.params[0]).startsWith(signaturePrefix),
  )!;
  return (call.response as { result: RawParsedTransaction }).result;
}

describe("canonicalize", () => {
  it("normalizes a recorded Token-2022 transfer", () => {
    const tx = canonicalize(recordedTransaction("token-account-only", "qcF4"));
    expect(tx.signature).toMatch(/^qcF4/);
    expect(tx.slot).toBe(425_744_652);
    expect(tx.timestamp).toBe(new Date(1_781_173_453_000).toISOString());
    expect(tx.success).toBe(true);
    expect(tx.feeLamports).toBe("110000");
    expect(tx.accounts).toHaveLength(7);
    expect(tx.instructions).toHaveLength(3);
    expect(tx.tokenChanges).toEqual([
      {
        account: "8Sgs9eE4H5Lmqae6eRWnNjvv9DmgU5V9rwXZ6R6FKtuP",
        owner: "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo",
        mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
        programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        decimals: 6,
        pre: "3000000000",
        post: "5000000000",
        delta: "2000000000",
      },
      expect.objectContaining({ owner: "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi", delta: "-2000000000" }),
    ]);
  });

  it("keeps lamport balances exact and conserves value minus the fee", () => {
    const tx = canonicalize(recordedTransaction("token-account-only", "qcF4"));
    const total = tx.nativeChanges.reduce((sum, c) => sum + BigInt(c.delta), BigInt(0));
    expect(total).toBe(-BigInt(tx.feeLamports));
  });

  it("marks lookup-table accounts and attributes inner instructions to their outer instruction", () => {
    const tx = canonicalize(recordedTransaction("a-to-b-to-c", "4C2F"));
    expect(tx.innerInstructions.length).toBeGreaterThan(0);
    expect(tx.innerInstructions.every((ix) => ix.outerIndex !== null)).toBe(true);
    expect(tx.innerInstructions.some((ix) => ix.type === "createAccount" && ix.program === "system")).toBe(true);
  });

  it("treats a token account created or closed in the transaction as a zero balance on the missing side", () => {
    const raw: RawParsedTransaction = {
      slot: 1,
      blockTime: null,
      meta: {
        err: { InstructionError: [0, "Custom"] },
        fee: 5000,
        preBalances: [10_000, 0],
        postBalances: [5_000, 0],
        preTokenBalances: [],
        postTokenBalances: [{ accountIndex: 1, mint: "M", owner: "O", uiTokenAmount: { amount: "7", decimals: 0 } }],
      },
      transaction: {
        signatures: ["sig"],
        message: {
          accountKeys: [
            { pubkey: "A", signer: true, writable: true, source: "lookupTable" },
            { pubkey: "T", signer: false, writable: true },
          ],
          instructions: [],
        },
      },
    };
    const tx = canonicalize(raw);
    expect(tx.success).toBe(false);
    expect(tx.timestamp).toBeNull();
    expect(tx.accounts[0].source).toBe("lookupTable");
    expect(tx.accounts[1].source).toBe("transaction");
    expect(tx.tokenChanges[0]).toMatchObject({ account: "T", pre: "0", post: "7", delta: "7", programId: null });
  });

  it("rejects transactions without status metadata", () => {
    const raw = { ...recordedTransaction("swap", ""), meta: null };
    expect(() => canonicalize(raw)).toThrow(CanonicalizeError);
  });
});
