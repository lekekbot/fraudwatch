import { describe, expect, it } from "vitest";
import type { FraudWatchDB } from "./db";
import { deleteCase } from "./cases";
import { clearTransactionCache, getStorageSummary } from "./storage";
import { copyTrace, createTrace, deleteTrace, getTrace, listTraces, saveTrace } from "./traces";
import { removeInvalidItems, renameTrace } from "@/lib/trace/edit";
import type { Trace } from "@/lib/trace/model";
import { event, stepOf } from "@/lib/trace/testing";

function stubDb() {
  const rows = new Map<string, Trace>();
  const cases = new Set(["c1", "c2"]);
  const cacheCleared: string[] = [];
  const cache = (name: string) => ({ clear: async () => void cacheCleared.push(name) });
  const db = {
    cases: { get: async (id: string) => cases.has(id) ? { id } : undefined, delete: async (id: string) => void cases.delete(id), count: async () => cases.size },
    traces: {
      get: async (id: string) => rows.get(id),
      add: async (row: Trace) => { rows.set(row.id, structuredClone(row)); },
      put: async (row: Trace) => { rows.set(row.id, structuredClone(row)); },
      delete: async (id: string) => void rows.delete(id),
      count: async () => rows.size,
      where: () => ({ equals: (id: string) => ({ toArray: async () => [...rows.values()].filter((r) => r.caseId === id), delete: async () => { for (const row of rows.values()) if (row.caseId === id) rows.delete(row.id); } }) }),
    },
    ingestion_jobs: { delete: async () => {}, clear: async () => {} },
    address_labels: { where: () => ({ equals: () => ({ delete: async () => {} }) }) },
    raw_transactions: { count: async () => 0, clear: async () => void cacheCleared.push("raw") },
    wallet_transactions: { count: async () => 0, clear: async () => void cacheCleared.push("index") },
    coverage: { count: async () => 0, clear: async () => void cacheCleared.push("coverage") },
    transactions: cache("transactions"), wallet_states: cache("states"), token_metadata: cache("tokens"),
    transaction: async (_mode: string, ...tablesAndRun: unknown[]) => (tablesAndRun.at(-1) as () => Promise<unknown>)(),
  };
  return { db: db as unknown as FraudWatchDB, rows, cases, cacheCleared };
}

describe("trace database lifecycle", () => {
  it("creates, reads, lists by case, renames, and deletes", async () => {
    const { db } = stubDb();
    const a = await createTrace(db, { caseId: "c1", name: " First ", seed: { kind: "address", address: "A" } }, { id: "a" });
    await createTrace(db, { caseId: "c2", name: "Second", seed: { kind: "address", address: "B" } }, { id: "b" });
    expect(a.name).toBe("First");
    expect((await getTrace(db, "a", "c1"))).toMatchObject({ ok: true, trace: a });
    expect(await getTrace(db, "a", "c2")).toEqual({ ok: false, id: "a", reason: "missing" });
    expect((await listTraces(db, "c1")).map((item) => item.id)).toEqual(["a"]);
    await saveTrace(db, renameTrace(a, "Renamed"));
    expect((await getTrace(db, "a", "c1"))).toMatchObject({ ok: true, trace: { name: "Renamed" } });
    expect((await copyTrace(db, "a", "c1", { id: "copy" })).name).toBe("Copy of Renamed");
    await expect(copyTrace(db, "a", "c2", { id: "wrong" })).rejects.toThrow();
    await deleteTrace(db, "a");
    expect(await getTrace(db, "a", "c1")).toEqual({ ok: false, id: "a", reason: "missing" });
  });

  it("deletes only a case's traces and keeps traces when chain cache clears", async () => {
    const { db, rows, cacheCleared } = stubDb();
    await createTrace(db, { caseId: "c1", name: "First", seed: { kind: "address", address: "A" } }, { id: "a" });
    await createTrace(db, { caseId: "c2", name: "Second", seed: { kind: "address", address: "B" } }, { id: "b" });
    expect((await getStorageSummary(db)).traces).toBe(2);
    await clearTransactionCache(db);
    expect(rows.size).toBe(2);
    expect(cacheCleared).toContain("transactions");
    await deleteCase(db, "c1");
    expect([...rows.keys()]).toEqual(["b"]);
  });

  it("never overwrites future-version records", async () => {
    const { db, rows } = stubDb();
    const a = await createTrace(db, { caseId: "c1", name: "First", seed: { kind: "address", address: "A" } }, { id: "a" });
    rows.set("a", { ...a, schemaVersion: 99 });
    await expect(saveTrace(db, renameTrace(a, "Unsafe"))).rejects.toThrow("not overwritten");
    expect(rows.get("a")?.name).toBe("First");
  });

  it("serializes rapid edits to one trace", async () => {
    const { db, rows } = stubDb();
    const a = await createTrace(db, { caseId: "c1", name: "First", seed: { kind: "address", address: "A" } }, { id: "a" });
    await Promise.all([saveTrace(db, renameTrace(a, "One")), saveTrace(db, renameTrace(a, "Two"))]);
    expect(rows.get("a")?.name).toBe("Two");
  });

  it("keeps malformed steps for review until explicitly removed", async () => {
    const { db, rows } = stubDb();
    const a = await createTrace(db, { caseId: "c1", name: "First", seed: { kind: "address", address: "A" } }, { id: "a" });
    const good = stepOf(event("s", [{ assetId: "SOL", from: "A", to: "B", amount: "5" }]));
    if (good.kind !== "movement") throw new Error("Expected movement fixture.");
    rows.set("a", { ...a, steps: [{ ...good, ref: { ...good.ref, amount: "1.5" } }] });
    const loaded = await getTrace(db, "a", "c1");
    if (!loaded.ok) throw new Error("Expected recoverable trace.");
    expect(loaded.trace.invalidSteps).toHaveLength(1);
    await saveTrace(db, renameTrace(loaded.trace, "Reviewed"));
    expect((await getTrace(db, "a", "c1"))).toMatchObject({ ok: true, trace: { invalidSteps: [expect.any(Object)] } });
    await saveTrace(db, removeInvalidItems(loaded.trace));
    expect((await getTrace(db, "a", "c1"))).toMatchObject({ ok: true, trace: { steps: [] } });
    expect(rows.get("a")?.invalidSteps).toEqual([]);
  });
});
