import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCase } from "@/lib/case/model";
import { FraudWatchDB } from "./db";
import { deleteCase, findDuplicateCases, getCase, listRecentCases, saveCase, touchCase } from "./cases";
import { clearRpcSettings, getRpcSettings, saveRpcSettings } from "./rpc-settings";

const WALLET = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const OTHER = "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi";
const RANGE = { start: "2026-06-01T00:00:00.000Z", end: "2026-06-12T00:00:00.000Z" };

let db: FraudWatchDB;

beforeEach(() => {
  db = new FraudWatchDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe("cases store", () => {
  it("saves and reopens a case", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLET, range: RANGE });
    await saveCase(db, fwCase);
    expect(await getCase(db, fwCase.id)).toEqual(fwCase);
  });

  it("lists recent cases newest first and touch moves a case to the top", async () => {
    const older = createCase({ name: "older", primaryWallet: WALLET, range: RANGE }, { now: new Date("2026-09-01") });
    const newer = createCase({ name: "newer", primaryWallet: OTHER, range: RANGE }, { now: new Date("2026-09-02") });
    await saveCase(db, older);
    await saveCase(db, newer);
    expect((await listRecentCases(db)).map((c) => c.name)).toEqual(["newer", "older"]);

    await touchCase(db, older.id, new Date("2026-09-03"));
    expect((await listRecentCases(db)).map((c) => c.name)).toEqual(["older", "newer"]);
  });

  it("finds duplicates by primary wallet and exact range", async () => {
    await saveCase(db, createCase({ name: "A", primaryWallet: WALLET, range: RANGE }));
    await saveCase(db, createCase({ name: "B", primaryWallet: WALLET, range: { ...RANGE, end: "2026-06-13T00:00:00.000Z" } }));
    await saveCase(db, createCase({ name: "C", primaryWallet: OTHER, range: RANGE }));
    expect((await findDuplicateCases(db, WALLET, RANGE)).map((c) => c.name)).toEqual(["A"]);
  });

  it("deletes a case", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLET, range: RANGE });
    await saveCase(db, fwCase);
    await deleteCase(db, fwCase.id);
    expect(await getCase(db, fwCase.id)).toBeUndefined();
  });
});

describe("rpc_settings store", () => {
  it("keeps a single local RPC setting, separate from cases", async () => {
    expect(await getRpcSettings(db)).toBeUndefined();
    await saveRpcSettings(db, { url: " https://rpc.example.com/?api-key=k ", providerType: "auto" });
    await saveRpcSettings(db, { url: "https://rpc2.example.com", providerType: "generic" });
    expect(await db.rpc_settings.count()).toBe(1);
    expect(await getRpcSettings(db)).toMatchObject({ url: "https://rpc2.example.com", providerType: "generic" });

    await saveCase(db, createCase({ name: "A", primaryWallet: WALLET, range: RANGE }));
    const [stored] = await db.cases.toArray();
    expect(JSON.stringify(stored)).not.toContain("rpc2.example.com");

    await clearRpcSettings(db);
    expect(await getRpcSettings(db)).toBeUndefined();
  });
});

describe("schema upgrade", () => {
  it("keeps Sprint 01 cases and RPC settings when upgrading to the transaction cache schema", async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ cases: "id, updatedAt, primaryWallet", rpc_settings: "id" });
    const fwCase = createCase({ name: "old", primaryWallet: WALLET, range: RANGE });
    await v1.table("cases").put(fwCase);
    await v1.table("rpc_settings").put({ id: "default", url: "https://rpc.example.com", providerType: "auto", updatedAt: "x" });
    v1.close();

    const upgraded = new FraudWatchDB(name);
    try {
      expect(await getCase(upgraded, fwCase.id)).toEqual(fwCase);
      expect((await getRpcSettings(upgraded))?.url).toBe("https://rpc.example.com");
      expect(await upgraded.transactions.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
});
