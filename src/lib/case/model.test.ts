import { describe, expect, it } from "vitest";
import { completeRange, createCase, validateNewCaseInput } from "./model";

const WALLET = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";

describe("validateNewCaseInput", () => {
  it("accepts a valid case and defaults the name", () => {
    const result = validateNewCaseInput({ name: " ", primaryWallet: ` ${WALLET} `, startDate: "2026-06-01", endDate: "2026-09-16" });
    expect(result).toEqual({
      ok: true,
      value: { name: "Case dLm6…f5Vo", primaryWallet: WALLET, dates: { startDate: "2026-06-01", endDate: "2026-09-16" } },
    });
  });

  it("allows empty dates, to be filled from the wallet's activity", () => {
    const result = validateNewCaseInput({ name: "A", primaryWallet: WALLET, startDate: "", endDate: "" });
    expect(result).toMatchObject({ ok: true, value: { dates: { startDate: null, endDate: null } } });
  });

  it("reports every invalid field", () => {
    const result = validateNewCaseInput({ name: "x".repeat(200), primaryWallet: "0xabc", startDate: "2026-02-31", endDate: "nope" });
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
  it("creates a case with the primary wallet mapped", () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    const range = { start: "2026-06-01T00:00:00.000Z", end: "2026-09-17T00:00:00.000Z" };
    const fwCase = createCase({ name: "Grant trace", primaryWallet: WALLET, range }, { id: "case-1", now });
    expect(fwCase).toEqual({
      id: "case-1",
      name: "Grant trace",
      primaryWallet: WALLET,
      range,
      mappedWallets: [{ address: WALLET, rangeMode: "case" }],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("never stores RPC settings on the case", () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLET, range: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-02T00:00:00.000Z" } });
    expect(JSON.stringify(fwCase).toLowerCase()).not.toMatch(/rpc|api-key|endpoint/);
  });
});

describe("completeRange", () => {
  const activity = { first: "2025-01-15T08:00:00.000Z", last: "2026-09-20T23:59:00.000Z", truncated: false };

  it("uses the given dates as they are", () => {
    expect(completeRange({ startDate: "2026-06-01", endDate: "2026-06-30" }, null)).toEqual({
      ok: true,
      range: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" },
    });
  });

  it("fills empty dates with the days of the first and last transactions, end inclusive", () => {
    expect(completeRange({ startDate: null, endDate: null }, activity)).toEqual({
      ok: true,
      range: { start: "2025-01-15T00:00:00.000Z", end: "2026-09-21T00:00:00.000Z" },
    });
    expect(completeRange({ startDate: "2026-01-01", endDate: null }, activity)).toMatchObject({
      range: { start: "2026-01-01T00:00:00.000Z", end: "2026-09-21T00:00:00.000Z" },
    });
  });

  it("blames the date the user entered when it falls outside the wallet's activity", () => {
    expect(completeRange({ startDate: "2026-09-22", endDate: null }, activity)).toMatchObject({
      ok: false,
      errors: { startDate: expect.stringContaining("2026-09-20") },
    });
    expect(completeRange({ startDate: null, endDate: "2024-12-31" }, activity)).toMatchObject({
      ok: false,
      errors: { endDate: expect.stringContaining("2025-01-15") },
    });
  });

  it("asks for dates when the wallet has no transactions or too many to scan", () => {
    expect(completeRange({ startDate: null, endDate: null }, { first: null, last: null, truncated: false })).toMatchObject({
      ok: false,
      errors: { startDate: expect.stringMatching(/No transactions/), endDate: expect.stringMatching(/No transactions/) },
    });
    expect(completeRange({ startDate: null, endDate: "2026-09-01" }, { ...activity, first: null, truncated: true })).toMatchObject({
      ok: false,
      errors: { startDate: expect.stringMatching(/too many transactions/) },
    });
  });
});
