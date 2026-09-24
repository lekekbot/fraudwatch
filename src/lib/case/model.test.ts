import { describe, expect, it } from "vitest";
import { CASE_SCHEMA_VERSION, createCase, validateNewCaseInput } from "./model";

const WALLET = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";

describe("validateNewCaseInput", () => {
  it("accepts a valid case and defaults the name", () => {
    const result = validateNewCaseInput({ name: " ", primaryWallet: ` ${WALLET} `, startDate: "2026-06-01", endDate: "2026-09-16" });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Case dLm6…f5Vo",
        primaryWallet: WALLET,
        range: { start: "2026-06-01T00:00:00.000Z", end: "2026-09-17T00:00:00.000Z" },
      },
    });
  });

  it("reports every invalid field", () => {
    const result = validateNewCaseInput({ name: "x".repeat(200), primaryWallet: "0xabc", startDate: "", endDate: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["endDate", "name", "primaryWallet", "startDate"]);
  });

  it("requires start <= end", () => {
    const result = validateNewCaseInput({ name: "A", primaryWallet: WALLET, startDate: "2026-06-10", endDate: "2026-06-01" });
    expect(result).toMatchObject({ ok: false, errors: { endDate: expect.any(String) } });
  });
});

describe("createCase", () => {
  it("creates a versioned case with the primary wallet mapped", () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    const range = { start: "2026-06-01T00:00:00.000Z", end: "2026-09-17T00:00:00.000Z" };
    const fwCase = createCase({ name: "Grant trace", primaryWallet: WALLET, range }, { id: "case-1", now });
    expect(fwCase).toEqual({
      id: "case-1",
      version: CASE_SCHEMA_VERSION,
      name: "Grant trace",
      chain: "solana",
      primaryWallet: WALLET,
      range,
      mappedWallets: [{ address: WALLET, role: "primary", rangeMode: "case" }],
      labels: {},
      tags: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("never stores RPC settings on the case", () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLET, range: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-02T00:00:00.000Z" } });
    expect(JSON.stringify(fwCase).toLowerCase()).not.toMatch(/rpc|api-key|endpoint/);
  });
});
