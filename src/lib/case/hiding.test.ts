import { describe, expect, it } from "vitest";
import { NATIVE_SOL } from "@/lib/assets/assets";
import type { EffectKind } from "@/lib/state/summarize";
import type { FilterableTx } from "@/lib/timeline/filter";
import { deleteRule, hiddenBy, hideTransactions, revertHiding, ruleFrom, ruleMatches, saveRule, unhideTransactions } from "./hiding";
import { createCase, type HideRule } from "./model";

const A = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const SPAM = "SpamMint11111111111111111111111111111111111";
const base = () => createCase({ name: "c", primaryWallet: A, range: { start: "2026-06-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" } });

const tx = (signature: string, opts: { kind?: EffectKind; inflows?: [string, string][]; outflows?: [string, string][]; addresses?: string[]; protocols?: string[] } = {}): FilterableTx => ({
  signature,
  time: 0,
  summary: {
    kind: opts.kind ?? "RECEIVE",
    inflows: (opts.inflows ?? []).map(([assetId, delta]) => ({ assetId, delta })),
    outflows: (opts.outflows ?? []).map(([assetId, delta]) => ({ assetId, delta })),
    counterparties: [],
    action: null,
    actor: null,
  },
  protocols: opts.protocols ?? [],
  addresses: opts.addresses ?? [],
});
const rule = (r: Partial<HideRule>): HideRule => ({ id: "r", name: "Rule", enabled: true, ...r });

describe("ruleMatches", () => {
  it("matches nothing without conditions", () => {
    expect(ruleMatches(rule({}), tx("a"))).toBe(false);
  });

  it("requires every condition and any value within one", () => {
    const r = rule({ kinds: ["SEND", "RECEIVE"], counterparties: ["X"] });
    expect(ruleMatches(r, tx("a", { kind: "RECEIVE", addresses: ["X"] }))).toBe(true);
    expect(ruleMatches(r, tx("a", { kind: "RECEIVE", addresses: ["Y"] }))).toBe(false);
    expect(ruleMatches(r, tx("a", { kind: "SWAP", addresses: ["X"] }))).toBe(false);
  });

  it("hides spam only when every moved asset is listed", () => {
    const r = rule({ onlyAssets: [SPAM] });
    expect(ruleMatches(r, tx("a", { inflows: [[SPAM, "5"]] }))).toBe(true);
    expect(ruleMatches(r, tx("a", { inflows: [[SPAM, "5"], [NATIVE_SOL, "1"]] }))).toBe(false);
    expect(ruleMatches(r, tx("a"))).toBe(false);
  });

  it("compares the moved amount, either direction, and needs the asset to move", () => {
    const amount = (op: "lt" | "gt" | "eq" | "ne") => rule({ amount: { assetId: NATIVE_SOL, op, value: "1000" } });
    const moved = (delta: string) => tx("a", delta.startsWith("-") ? { outflows: [[NATIVE_SOL, delta]] } : { inflows: [[NATIVE_SOL, delta]] });
    expect(ruleMatches(amount("lt"), moved("999"))).toBe(true);
    expect(ruleMatches(amount("lt"), moved("-1000"))).toBe(false);
    expect(ruleMatches(amount("gt"), moved("-1001"))).toBe(true);
    expect(ruleMatches(amount("gt"), moved("1000"))).toBe(false);
    expect(ruleMatches(amount("eq"), moved("-1000"))).toBe(true);
    expect(ruleMatches(amount("ne"), moved("1000"))).toBe(false);
    expect(ruleMatches(amount("ne"), moved("5"))).toBe(true);
    expect(ruleMatches(amount("ne"), tx("a", { inflows: [[SPAM, "1"]] }))).toBe(false);
  });

  it("matches tags and protocols", () => {
    expect(ruleMatches(rule({ tags: ["exchange"] }), tx("a", { addresses: ["X"] }), (a) => (a === "X" ? ["exchange"] : []))).toBe(true);
    expect(ruleMatches(rule({ protocols: ["jupiter"] }), tx("a", { protocols: ["jupiter"] }))).toBe(true);
  });
});

describe("hiddenBy", () => {
  const dust = rule({ amount: { assetId: NATIVE_SOL, op: "lt", value: "1000" } });
  const small = tx("small", { inflows: [[NATIVE_SOL, "1"]] });

  it("reports a manual hide, then the first enabled matching rule", () => {
    expect(hiddenBy({ hiddenSignatures: ["small"], hideRules: [dust] }, small)).toBe("manual");
    expect(hiddenBy({ hideRules: [{ ...dust, enabled: false }] }, small)).toBeNull();
    expect(hiddenBy({ hideRules: [dust] }, small)).toBe(dust);
  });

  it("lets an exception beat a rule", () => {
    expect(hiddenBy({ hideRules: [dust], shownSignatures: ["small"] }, small)).toBeNull();
  });
});

describe("hide and unhide", () => {
  it("are idempotent and leave other fields alone", () => {
    const c = hideTransactions(hideTransactions(base(), ["a", "b"]), ["b"]);
    expect(c.hiddenSignatures).toEqual(["a", "b"]);
    expect(c.primaryWallet).toBe(A);
    expect(unhideTransactions(unhideTransactions(c, ["a"]), ["a"]).hiddenSignatures).toEqual(["b"]);
  });

  it("keeps a rule-matched transaction visible as an exception, and drops it on re-hide", () => {
    const shown = unhideTransactions(base(), ["a", "b"], ["a"]);
    expect(shown.shownSignatures).toEqual(["a"]);
    expect(hideTransactions(shown, ["a"]).shownSignatures).toEqual([]);
  });
});

describe("rules", () => {
  it("adds, replaces by id, and deletes", () => {
    const c = saveRule(saveRule(base(), rule({ id: "1", name: "Dust" })), rule({ id: "1", name: "Tiny" }));
    expect(c.hideRules?.map((r) => r.name)).toEqual(["Tiny"]);
    expect(deleteRule(c, "1").hideRules).toEqual([]);
  });
});

describe("revertHiding", () => {
  it("undoes exactly one batch and keeps later changes", () => {
    const before = hideTransactions(base(), ["kept"]);
    const after = hideTransactions(unhideTransactions(before, ["x"], ["x"]), ["a", "b"]);
    const later = hideTransactions(after, ["c"]);
    const undone = revertHiding(later, before, after);
    expect(undone.hiddenSignatures).toEqual(["kept", "c"]);
    expect(undone.shownSignatures).toEqual([]);
  });
});

describe("ruleFrom", () => {
  it("takes the hidden types and the filter's protocols, tags and address", () => {
    const r = ruleFrom([tx("a", { kind: "PROGRAM" }), tx("b", { kind: "PROGRAM" })], { protocols: new Set(["jupiter"]), tags: new Set(), address: "X" }, "id", "Rule 1");
    expect(r).toEqual({ id: "id", name: "Rule 1", enabled: true, kinds: ["PROGRAM"], protocols: ["jupiter"], counterparties: ["X"] });
  });

  it("leaves types out when the hide spanned many", () => {
    const many = (["SEND", "RECEIVE", "SWAP", "BURN"] as const).map((kind, i) => tx(String(i), { kind }));
    expect(ruleFrom(many, { protocols: new Set(), tags: new Set(), address: null }, "id", "R").kinds).toBeUndefined();
  });
});
