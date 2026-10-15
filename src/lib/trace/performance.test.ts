import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import type { SemanticEvent } from "@/lib/semantic/events";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { read } from "@/lib/semantic/testing";
import { canonicalize } from "@/lib/solana/canonical";
import { branchOf, focusPath, hideBranches } from "./branches";
import { autoPlace, tidyLayout } from "./layout";
import type { Trace, TraceScope } from "./model";
import { buildMovementIndex, candidates } from "./movements";
import type { Point } from "./presentation";
import { stepOf, trace, transfer } from "./testing";
import { buildTraceView, type TraceEvidence } from "./view";

/**
 * Trace stages at the reference scale (docs/sprints/trace-graph/10). Each
 * stage takes the fastest of a few runs, so a busy machine doesn't flake it,
 * and must stay within 3× its target. Fixtures are synthetic (labelled
 * below) plus the recorded DeFi and NFT transactions, interpreted once
 * outside the timings.
 */

const RUNS = 5;
function fastest<T>(run: () => T): { ms: number; result: T } {
  let ms = Infinity, result!: T;
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    result = run();
    ms = Math.min(ms, performance.now() - start);
  }
  return { ms, result };
}
const timings: Record<string, number> = {};
function stage<T>(label: string, targetMs: number, run: () => T): T {
  const { ms, result } = fastest(run);
  timings[label] = Math.round(ms * 10) / 10;
  console.info(`${label}: ${timings[label]} ms (target ${targetMs} ms)`);
  expect(ms).toBeLessThan(targetMs * 3);
  return result;
}

const recorded: SemanticEvent[] = ["defi", "basic", "nft"].flatMap((dir) => {
  try {
    return readdirSync(join(process.cwd(), "fixtures/solana", dir)).flatMap((f) => interpretTransaction(canonicalize(read<RawParsedTransaction>(`${dir}/${f}`))).slice(0, 1));
  } catch {
    return [];
  }
});

/** 10 mapped wallets, 5,000 transactions: transfers among them and to 97 outside counterparties (F8), every 5th a recorded real one. */
function caseEvents(walletCount = 10, count = 5_000): SemanticEvent[] {
  const wallets = Array.from({ length: walletCount }, (_, i) => `Wallet${i}`);
  return Array.from({ length: count }, (_, i) => {
    if (i % 5 === 4 && recorded.length) {
      const base = recorded[i % recorded.length];
      return { ...base, signature: `${base.signature.slice(0, 40)}${i}`, slot: 1_000 + i };
    }
    const from = wallets[i % walletCount];
    const to = i % 7 === 0 ? wallets[(i + 1) % walletCount] : `Counterparty${i % 97}`;
    return transfer(`perf${i}`, from, to, ((i % 50) + 1) * 1_000_000, 1_000 + i);
  });
}

const evidence = (events: readonly SemanticEvent[]): TraceEvidence => ({
  events: new Map(events.map((e) => [e.signature, e])),
  coverage: () => ({ complete: true, signatureCount: 1, transactionCount: 1, warnings: [] }),
  addressState: () => "MAPPED",
  isCustodial: () => false,
});
const scope: TraceScope = { assets: null, start: null, end: null, minAmount: null, maxHops: 20 };
const query = (node: string, s: TraceScope = scope) => ({
  node, direction: "forward" as const, scope: s, exclude: new Set<string>(), includeSupporting: false, hiddenReason: () => null,
  loaded: { complete: true, start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" }, caseRange: { start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" },
});

/** A trace of `[from, to]` transfers seeded at the first sender. */
function traceOf(moves: [string, string][]): { trace: Trace; evidence: TraceEvidence } {
  const events = moves.map(([from, to], i) => transfer(`t${i}`, from, to, 1_000 + i, i + 1));
  return { trace: trace({ seed: { kind: "address", address: moves[0][0] }, steps: events.map((e) => stepOf(e)) }), evidence: evidence(events) };
}

/** Synthetic: a tree of 300 nodes, each with up to 3 children (299 edges), plus 201 repeat steps on existing pairs = 500 steps. */
function tree500(): [string, string][] {
  const moves: [string, string][] = Array.from({ length: 299 }, (_, i) => [`N${Math.floor(i / 3)}`, `N${i + 1}`]);
  for (let i = 0; i < 201; i++) moves.push(moves[i % 299]);
  return moves;
}

describe("trace performance at the reference scale", () => {
  it("builds the movement index for 10 wallets / 5,000 transactions", () => {
    expect(recorded.length).toBeGreaterThan(10);
    const events = caseEvents();
    const before = process.memoryUsage().heapUsed;
    const kept = buildMovementIndex(events, (sig) => Number(sig.replace(/\D/g, "").slice(-6)));
    console.info(`movement index heap (approximate): ${Math.round((process.memoryUsage().heapUsed - before) / 1024 / 1024)} MB for ${kept.bySignature.size} signatures`);
    const index = stage("buildMovementIndex 10w/5,000tx", 150, () => buildMovementIndex(events, (sig) => Number(sig.replace(/\D/g, "").slice(-6))));
    expect(index.outgoing.get("Wallet0")?.length).toBeGreaterThan(300);
  });

  it("pages candidates for an address with 5,000 movements, filters on (synthetic fan-out)", () => {
    const events = Array.from({ length: 5_000 }, (_, i) => transfer(`f${i}`, "Hub", `Out${i}`, 1_000 + i, i + 1));
    const index = buildMovementIndex(events, (sig) => Number(sig.slice(1)));
    const filtered = { ...scope, assets: ["SOL"], minAmount: { assetId: "SOL", amount: "2000" }, start: "2026-01-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" };
    const page = stage("candidates page (5,000, filters on)", 5, () => candidates(index, { ...query("Hub", filtered), counterpartySearch: "out4" }, { limit: 50 }));
    expect(page.items.length).toBe(50);
    expect(page.total).toBe(1_000);
  });

  it("builds the view for 500 steps (synthetic tree)", () => {
    const { trace: t, evidence: e } = traceOf(tree500());
    const view = stage("buildTraceView 500 steps", 20, () => buildTraceView(t, e));
    expect(view.nodes).toHaveLength(300);
  });

  it("places and tidies 300 nodes", () => {
    const { trace: t, evidence: e } = traceOf(tree500());
    const view = buildTraceView(t, e);
    const all = tidyLayout({ view, positions: {}, obstacles: [] });
    const missingOne: Record<string, Point> = { ...all };
    delete missingOne.N299;
    const placed = stage("autoPlace incremental (300 nodes, 1 new)", 5, () => autoPlace({ view, positions: missingOne, obstacles: [] }));
    expect(Object.keys(placed)).toEqual(["N299"]);
    stage("tidyLayout reset (300 nodes)", 50, () => tidyLayout({ view, positions: all, obstacles: [] }));
  });

  it("branches, hiding and focus on 300 nodes", () => {
    const { trace: t, evidence: e } = traceOf(tree500());
    const view = buildTraceView(t, e);
    stage("branchOf (300 nodes)", 5, () => branchOf(view, "N1", "forward"));
    stage("hideBranches (300 nodes, 3 hidden)", 10, () => hideBranches(view, ["N1", "N2", "N3"]));
    stage("focusPath (300 nodes)", 5, () => focusPath(view, "N299"));
  });

  it("stays fast on the synthetic shapes: fan-out 2,000, fan-in 2,000, ring of 50, repeated pair of 1,000", () => {
    const shapes: Record<string, [string, string][]> = {
      "fan-out 1→2,000": Array.from({ length: 2_000 }, (_, i) => ["Hub", `Out${i}`]),
      "fan-in 2,000→1": [["Seed", "Sink"], ...Array.from({ length: 2_000 }, (_, i): [string, string] => [`In${i}`, "Sink"])],
      "ring of 50": Array.from({ length: 50 }, (_, i) => [`R${i}`, `R${(i + 1) % 50}`]),
      "repeated pair 1,000": Array.from({ length: 1_000 }, () => ["A", "B"]),
    };
    for (const [name, moves] of Object.entries(shapes)) {
      const { trace: t, evidence: e } = traceOf(moves);
      const view = stage(`buildTraceView ${name}`, 40, () => buildTraceView(t, e));
      stage(`autoPlace ${name}`, 50, () => autoPlace({ view, positions: {}, obstacles: [] }));
      stage(`tidyLayout ${name}`, 50, () => tidyLayout({ view, positions: {}, obstacles: [] }));
    }
  });

  it("prints the measured numbers", () => {
    console.info(`trace stages: ${JSON.stringify(timings)}`);
  });
});
