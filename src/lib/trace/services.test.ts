import { describe, expect, it } from "vitest";
import type { RegistryEntry } from "@/lib/protocols/registry";
import { buildMovementIndex, candidates } from "./movements";
import { stepOf, trace, transfer } from "./testing";
import { buildTraceView, type TraceEvidence } from "./view";

const service = (address: string, protocolId: string, category: RegistryEntry["category"] = "exchange"): RegistryEntry => ({ address, protocolId, protocolName: protocolId, category, role: "wallet", label: address });
const entries = new Map([["B1", service("B1", "binance")], ["B2", service("B2", "binance")], ["M", service("M", "magic_eden", "nft_marketplace")]]);
const evidence = (events: ReturnType<typeof transfer>[], mapped: string[] = [], labelled: string[] = []): TraceEvidence => ({
  events: new Map(events.map((event) => [event.signature, event])),
  coverage: () => null,
  addressState: (address) => mapped.includes(address) ? "MAPPED" : "OBSERVED",
  isCustodial: (address) => entries.get(address)?.category === "exchange",
  serviceOf: (address) => entries.get(address),
  hasUserLabel: (address) => labelled.includes(address),
});

describe("trace services", () => {
  it("folds by protocol with real via addresses and preserves steps on expansion", () => {
    const events = [transfer("s1", "A", "B1", 10, 1), transfer("s2", "A", "B2", 20, 2), transfer("s3", "B1", "B2", 3, 3)];
    const steps = events.map((event) => stepOf(event));
    const original = trace({ seed: { kind: "address", address: "A" }, steps });
    const collapsed = buildTraceView(original, evidence(events));
    expect(collapsed.nodes.find((node) => node.id === "entity:binance")).toMatchObject({ addresses: ["B1", "B2"], internalMovements: [steps[2].id] });
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0]).toMatchObject({ provenance: "service", totals: [{ assetId: "SOL", amount: "30" }], via: [{ stepId: steps[0].id, from: "A", to: "B1" }, { stepId: steps[1].id, from: "A", to: "B2" }] });
    const expanded = buildTraceView({ ...original, presentation: { ...original.presentation, expandedServices: ["binance"] } }, evidence(events));
    expect(expanded.nodes.map((node) => node.id).sort()).toEqual(["A", "B1", "B2"]);
    expect(original.steps).toEqual(steps);
  });

  it("keeps labelled and mapped service addresses separate", () => {
    const events = [transfer("s1", "A", "B1", 10, 1), transfer("s2", "A", "B2", 20, 2)];
    const steps = events.map((event) => stepOf(event));
    const saved = trace({ seed: { kind: "address", address: "A" }, steps });
    expect(buildTraceView(saved, evidence(events, ["B1"], ["B2"])).nodes.map((node) => node.id).sort()).toEqual(["A", "B1", "B2"]);
  });

  it("never merges different protocols or changes stored movement endpoints", () => {
    const events = [transfer("s1", "A", "B1", 10, 1), transfer("s2", "A", "M", 20, 2)];
    const saved = trace({ seed: { kind: "address", address: "A" }, steps: events.map((event) => stepOf(event)) });
    const view = buildTraceView(saved, evidence(events));
    expect(view.nodes.map((node) => node.id).sort()).toEqual(["A", "entity:binance", "entity:magic_eden"]);
    expect(view.edges.map((edge) => edge.via?.[0].to).sort()).toEqual(["B1", "M"]);
    expect(saved.steps.map((step) => step.kind === "movement" ? step.ref.to : null)).toEqual(["B1", "M"]);
  });

  it("stops forward custody candidates but permits backward deposits", () => {
    const event = transfer("s1", "A", "B1", 10, 1);
    const index = buildMovementIndex([event], () => 0);
    const base = { node: "B1", scope: { assets: null, start: null, end: null, minAmount: null, maxHops: 6 }, exclude: new Set<string>(), includeSupporting: false, hiddenReason: () => null, loaded: null, caseRange: { start: "2026-01-01", end: "2027-01-01" }, custodial: true };
    expect(candidates(index, { ...base, direction: "forward" }, { limit: 50 }).items).toEqual([]);
    expect(candidates(index, { ...base, direction: "backward" }, { limit: 50 }).items).toHaveLength(1);
  });
});
