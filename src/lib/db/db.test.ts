import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCase } from "@/lib/case/model";
import { FraudWatchDB } from "./db";
import { deleteCase, findDuplicateCases, getCase, listRecentCases, saveCase, touchCase } from "./cases";
import { getAddressLabels, saveAddressLabel } from "./address-labels";
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
    await saveRpcSettings(db, { url: " https://rpc.example.com/?api-key=k " });
    await saveRpcSettings(db, { url: "https://rpc2.example.com" });
    expect(await db.rpc_settings.count()).toBe(1);
    expect(await getRpcSettings(db)).toMatchObject({ url: "https://rpc2.example.com" });

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
    await v1.table("rpc_settings").put({ id: "default", url: "https://rpc.example.com", updatedAt: "x" });
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

describe("address labels", () => {
  it("saves per case, normalises, and survives reopening the database", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLET, range: RANGE });
    await saveCase(db, fwCase);
    await saveAddressLabel(db, { caseId: fwCase.id, address: OTHER, name: "  Scammer  ", tags: ["cex", "CEX", " "] });
    await saveAddressLabel(db, { caseId: "other-case", address: OTHER, name: "Elsewhere", tags: [] });

    const reopened = new FraudWatchDB(db.name);
    try {
      expect(await getAddressLabels(reopened, fwCase.id)).toEqual([{ caseId: fwCase.id, address: OTHER, name: "Scammer", tags: ["cex"] }]);
    } finally {
      reopened.close();
    }
  });

  it("removes a label whose fields are all cleared", async () => {
    await saveAddressLabel(db, { caseId: "c", address: OTHER, name: "x", tags: [] });
    await saveAddressLabel(db, { caseId: "c", address: OTHER, name: " ", note: "", tags: [] });
    expect(await getAddressLabels(db, "c")).toEqual([]);
  });

  it("deletes a case's labels with the case", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLET, range: RANGE });
    await saveCase(db, fwCase);
    await saveAddressLabel(db, { caseId: fwCase.id, address: OTHER, name: "x", tags: [] });
    await deleteCase(db, fwCase.id);
    expect(await getAddressLabels(db, fwCase.id)).toEqual([]);
  });

  it("moves Sprint 01 case labels and tags into the table on upgrade", async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const v3 = new Dexie(name);
    v3.version(3).stores({ cases: "id, updatedAt, primaryWallet", rpc_settings: "id" });
    const old = { ...createCase({ name: "old", primaryWallet: WALLET, range: RANGE }), labels: { [OTHER]: "Exchange" }, tags: { [OTHER]: ["cex"], [WALLET]: ["victim"] } };
    await v3.table("cases").put(old);
    v3.close();

    const upgraded = new FraudWatchDB(name);
    try {
      const stored = await getCase(upgraded, old.id);
      expect(stored).not.toHaveProperty("labels");
      expect(stored).not.toHaveProperty("tags");
      const labels = await getAddressLabels(upgraded, old.id);
      expect(labels).toEqual(
        expect.arrayContaining([
          { caseId: old.id, address: OTHER, name: "Exchange", tags: ["cex"] },
          { caseId: old.id, address: WALLET, name: "", tags: ["victim"] },
        ]),
      );
    } finally {
      await upgraded.delete();
    }
  });
});
