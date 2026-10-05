import { describe, expect, it } from "vitest";
import { INTERPRETERS } from "@/lib/semantic/interpreters";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { FEE, makeTx, SOL } from "@/lib/semantic/testing";
import { analysisFingerprint, analysisVersions } from "@/lib/semantic/versions";
import { PARSER_VERSION } from "@/lib/solana/canonical";
import { RECONSTRUCTION_VERSION } from "@/lib/state/reconstruct";
import type { FraudWatchDB, WalletStateRecord } from "./db";
import { DERIVED_CACHES, invalidateStaleDerivedCaches } from "./derived";
import { getWalletState } from "./wallet-states";

/** Just the tables these caches touch, in memory. */
function stubDb() {
  const meta = new Map<string, unknown>();
  const states = new Map<string, WalletStateRecord>();
  const cleared: string[] = [];
  const db = {
    meta: { get: async (key: string) => (meta.has(key) ? { key, value: meta.get(key) } : undefined), put: async (r: { key: string; value: unknown }) => void meta.set(r.key, r.value) },
    transactions: { clear: async () => void cleared.push("transactions") },
    wallet_states: {
      get: async (key: string) => states.get(key),
      put: async (r: WalletStateRecord) => void states.set(r.key, r),
      clear: async () => {
        cleared.push("wallet_states");
        states.clear();
      },
    },
  };
  return { db: db as unknown as FraudWatchDB, meta, states, cleared };
}

describe("derived cache invalidation", () => {
  it("records versions on first run without clearing anything", async () => {
    const { db, meta, cleared } = stubDb();
    expect(await invalidateStaleDerivedCaches(db)).toEqual([]);
    expect([meta.get("derived:parser"), meta.get("derived:reconstruction"), cleared]).toEqual([PARSER_VERSION, RECONSTRUCTION_VERSION, []]);
  });

  it("clears exactly the caches whose code version changed", async () => {
    const { db, meta, cleared } = stubDb();
    meta.set("derived:parser", PARSER_VERSION);
    meta.set("derived:reconstruction", RECONSTRUCTION_VERSION - 1);
    expect(await invalidateStaleDerivedCaches(db)).toEqual(["reconstruction"]);
    expect(cleared).toEqual(["wallet_states"]);
    expect(meta.get("derived:reconstruction")).toBe(RECONSTRUCTION_VERSION);
  });

  it("never reuses a wallet state built by other code or from other transactions", async () => {
    const { db, states } = stubDb();
    const range = { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" };
    const txs = [makeTx({ signature: "s1", native: { A: [10 * SOL, 9 * SOL - FEE], B: [SOL, 2 * SOL] } })];
    await getWalletState(db, "A", range, txs, true);
    const [key] = [...states.keys()];
    // A record from an older reconstruction is rebuilt, not trusted.
    states.set(key, { ...states.get(key)!, reconstructionVersion: RECONSTRUCTION_VERSION - 1, state: { ...states.get(key)!.state, effects: [] } });
    expect((await getWalletState(db, "A", range, txs, true)).effects).toHaveLength(1);
    // As is one built from a different set of transactions.
    states.set(key, { ...states.get(key)!, sourceSignatures: ["other"], state: { ...states.get(key)!.state, effects: [] } });
    expect((await getWalletState(db, "A", range, txs, true)).effects).toHaveLength(1);
  });

  it("stores nothing semantic: events and observations are recomputed on read, so they can't go stale", () => {
    expect(DERIVED_CACHES.map((c) => c.name)).toEqual(["parser", "reconstruction"]);
    const tx = makeTx({ native: { A: [10 * SOL, 9 * SOL - FEE], B: [SOL, 2 * SOL] } });
    expect(interpretTransaction(tx)).toEqual(interpretTransaction(tx));
  });
});

describe("analysis versions", () => {
  it("covers every stage and every interpreter, with unique ids and positive versions", () => {
    const v = analysisVersions();
    expect(Object.keys(v)).toEqual(["parser", "reconstruction", "semantic", "interpreters", "registry", "behavior"]);
    expect(new Set(INTERPRETERS.map((i) => i.id)).size).toBe(INTERPRETERS.length);
    expect(INTERPRETERS.every((i) => Number.isInteger(i.version) && i.version > 0)).toBe(true);
    for (const i of INTERPRETERS) expect(analysisFingerprint()).toContain(`${i.id}@${i.version}`);
  });

  it("stamps every event with the model version and the interpreters it tried", () => {
    const [event] = interpretTransaction(makeTx({ native: { A: [SOL, SOL - FEE] }, success: false }));
    expect(event.version).toBe(analysisVersions().semantic);
    expect(event.trace).toEqual([{ id: "failed", version: 1, outcome: "matched" }]);
  });
});
