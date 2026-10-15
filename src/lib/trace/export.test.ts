import { describe, expect, it } from "vitest";
import type { RegistryEntry } from "@/lib/protocols/registry";
import type { SemanticEvent } from "@/lib/semantic/events";
import { setBranchHidden, setPositions, addAnnotation } from "./edit";
import { exportTrace, type ExportOptions, fileSlug, MAX_IMPORT_BYTES, parseTraceImport } from "./export";
import { event, stepOf, trace, transfer } from "./testing";
import { buildTraceView, type TraceEvidence } from "./view";

const RPC_URL = "https://secret-rpc.example.com/?api-key=SHOULD-NOT-LEAK";
const sale = event("sale", [
  { assetId: "USDC", from: "Buyer", to: "Seller", amount: "1000" },
  { assetId: "NFT1", from: "Seller", to: "Buyer", amount: "1", role: "nft" },
], { category: "NFT_TRADE" });
const ab = transfer("s1", "A", "Buyer", 50, 1);
const bc = transfer("s3", "Buyer", "C", 5, 3);
const gone = transfer("missing", "Seller", "Exchange", 7, 9);
const loaded: SemanticEvent[] = [ab, sale, bc];

const binance = { protocolId: "binance", protocolName: "Binance", label: "Hot wallet 1", category: "exchange" } as RegistryEntry;
const evidence: TraceEvidence = {
  events: new Map(loaded.map((e) => [e.signature, e])),
  coverage: (a) => (a === "A" ? { complete: false, signatureCount: 1, transactionCount: 1, warnings: [] } : null),
  addressState: (a) => (a === "A" ? "PRIMARY" : "OBSERVED"),
  isCustodial: (a) => a === "Exchange",
  serviceOf: (a) => (a === "Exchange" ? binance : undefined),
};
const options = (o: Partial<ExportOptions> = {}): ExportOptions => ({
  caseRange: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
  decimals: (id) => (id === "USDC" ? 6 : id === "SOL" ? 9 : 0),
  includeLabels: false, includeLayout: true,
  labelOf: (a) => (a === "Seller" ? { name: "Scammer", tags: ["suspect"] } : undefined),
  now: new Date("2026-03-01T00:00:00.000Z"), ...o,
});

function build() {
  let t = trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab), stepOf(sale, 0), stepOf(sale, 1), stepOf(bc), stepOf(gone)] });
  t = setBranchHidden(t, "Buyer", true);
  t = setPositions(t, { A: { x: 0, y: 0 }, Buyer: { x: 240, y: 0 } });
  t = addAnnotation(t, { id: "n1", kind: "note", at: { x: 10, y: 10 }, width: 120, text: "claim", color: "yellow" });
  return { trace: t, view: buildTraceView(t, evidence) };
}

describe("trace export", () => {
  it("exports every step with what's needed to find it on-chain, and each disclosure", () => {
    const { trace: t, view } = build();
    const doc = exportTrace(t, view, evidence, options());
    expect(doc.trace.steps).toHaveLength(5);
    const [first, pay, , downstream] = doc.trace.steps;
    expect(first).toMatchObject({ kind: "movement", signature: "s1", eventIndex: 0, amount: "50", decimals: 9, category: "TRANSFER", status: "ok" });
    expect(pay).toMatchObject({ signature: "sale", category: "NFT_TRADE", decimals: 6, status: "ok" });
    expect(downstream).toMatchObject({ signature: "s3", status: "hidden_branch" });
    expect(first.kind === "movement" && first.key).toBe(t.steps[0].kind === "movement" && t.steps[0].ref.key);
    const d = doc.disclosures;
    expect(d.attribution).toMatch(/don't establish that the same funds moved/);
    expect(d.hiddenBranches).toEqual(["Buyer"]);
    expect(d.staleSteps).toEqual([t.steps[4].id]);
    expect(d.boundaries).toContainEqual({ addresses: ["Exchange"], kind: "custodial" });
    expect(d.incompleteHistory).toEqual(["A"]);
    expect(doc.attribution.Exchange).toMatchObject({ source: "registry", protocol: "Binance" });
    expect(doc.canvas?.note).toMatch(/not evidence/);
  });

  it("lists collapsed services", () => {
    const t = trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(transfer("x", "A", "Exchange", 5))] });
    const ev = { ...evidence, events: new Map([["x", transfer("x", "A", "Exchange", 5)]]) };
    const doc = exportTrace(t, buildTraceView(t, ev), ev, options());
    expect(doc.disclosures.collapsedServices).toEqual([{ protocol: "Binance", addresses: ["Exchange"] }]);
  });

  it("includes labels only when opted in, never notes, and never the RPC URL", () => {
    const { trace: t, view } = build();
    const without = JSON.stringify(exportTrace(t, view, evidence, options()));
    expect(without).not.toContain("Scammer");
    const withLabels = exportTrace(t, view, evidence, options({ includeLabels: true }));
    expect(withLabels.labels).toEqual({ Seller: { name: "Scammer", tags: ["suspect"] } });
    expect(JSON.stringify(withLabels)).not.toContain(RPC_URL);
    expect(exportTrace(t, view, evidence, options({ includeLayout: false })).canvas).toBeUndefined();
  });

  it("round-trips to an equal trace, apart from id, name and dates", () => {
    const { trace: t, view } = build();
    const result = parseTraceImport(JSON.stringify(exportTrace(t, view, evidence, options())));
    if (!result.ok) throw new Error(result.error);
    const back = result.trace;
    expect(back.steps).toEqual(t.steps.map((s) => ({ ...s, addedAt: "2026-03-01T00:00:00.000Z" })));
    expect([back.seed, back.direction, back.scope, back.presentation]).toEqual([t.seed, t.direction, t.scope, t.presentation]);
    expect(back.skipped).toEqual({ steps: 0, annotations: 0 });
  });

  it("rejects future versions, oversized files, bad JSON and other files; sets aside unreadable steps", () => {
    const { trace: t, view } = build();
    const doc = exportTrace(t, view, evidence, options());
    expect(parseTraceImport(JSON.stringify({ ...doc, formatVersion: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining("format version 2") });
    expect(parseTraceImport(" ".repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining("5 MB") });
    expect(parseTraceImport("{nope")).toMatchObject({ ok: false });
    expect(parseTraceImport(JSON.stringify({ format: "other" }))).toMatchObject({ ok: false });
    const tampered = { ...doc, trace: { ...doc.trace, steps: [...doc.trace.steps, { ...doc.trace.steps[0], id: "bad", amount: "999" }] } };
    const result = parseTraceImport(JSON.stringify(tampered));
    expect(result.ok && result.trace.skipped.steps).toBe(1);
  });

  it("sanitises file names", () => {
    expect(fileSlug("Hack proceeds — 東京 #2!")).toBe("hack-proceeds-2");
    expect(fileSlug("東京")).toBe("trace");
  });
});
