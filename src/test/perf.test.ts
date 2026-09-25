import { writeFileSync } from "node:fs";
import { scaleUtc } from "d3-scale";
import { describe, expect, it } from "vitest";
import { generateHighActivity } from "../../fixtures/solana/synthetic/generate";
import { enrichTransaction, protocolsUsed } from "@/lib/protocols/registry";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { type CanonicalTransaction, canonicalize, PARSER_VERSION } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { summarizeEffect } from "@/lib/state/summarize";
import { EMPTY_FILTER, involvedAddresses, passesFilter } from "@/lib/timeline/filter";
import { mergeLaneEvents } from "@/lib/timeline/lanes";
import { chooseBucket, groupEvents, mergeOverlapping, placeCards, splitByBucket } from "@/lib/timeline/layout";

/**
 * Timing for the Sprint 09 performance targets. Skipped in normal runs:
 *   PERF=1 pnpm vitest run src/test/perf.test.ts
 * With PERF_SEED=<path>, also writes the 10-wallet case as an IndexedDB seed
 * for measuring the real app in a browser.
 */
const RUN = Boolean(process.env.PERF);

const TARGETS = [
  { wallets: 1, transactions: 1000 },
  { wallets: 5, transactions: 2000 },
  { wallets: 10, transactions: 5000 },
];

function syntheticCase(wallets: number, total: number) {
  const perWallet = Math.round(total / wallets);
  const fixtures = Array.from({ length: wallets }, (_, i) => generateHighActivity({ seed: `perf-${wallets}-${i}`, transactionCount: perWallet }));
  const transactions = new Map<string, CanonicalTransaction>();
  const byWallet: { wallet: string; signatures: string[] }[] = [];
  for (const f of fixtures) {
    const wallet = f.manifest.wallets[0].address;
    const wanted = new Set(f.manifest.expected.signaturesByWallet[wallet]);
    for (const call of f.rpc) {
      if (call.request.method !== "getTransaction" || !wanted.has(call.request.params[0] as string)) continue;
      const raw = (call.response as { result: RawParsedTransaction }).result;
      transactions.set(raw.transaction.signatures[0], canonicalize(raw));
    }
    byWallet.push({ wallet, signatures: [...wanted] });
  }
  const range = { start: Date.parse(fixtures[0].manifest.range.start), end: Date.parse(fixtures[0].manifest.range.end) };
  return { transactions, byWallet, range, fixtures };
}

const time = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const out = fn();
  return [out, performance.now() - t0];
};

/** What one canvas frame computes before painting: per-lane clusters, buckets and card slots. */
function frameLayout(laneTimes: number[][], range: { start: number; end: number }, zoom: number, width = 1200) {
  const span = (range.end - range.start) / zoom;
  const mid = (range.start + range.end) / 2;
  const scale = scaleUtc().domain([mid - span / 2, mid + span / 2]).range([28, width - 28]);
  const DAY = 86_400_000;
  const bucket = chooseBucket((scale(range.start + DAY) - scale(range.start)) / DAY, 84);
  let groups = 0;
  for (const times of laneTimes) {
    const xs = times.map((t) => scale(t));
    const g = mergeOverlapping(
      splitByBucket(groupEvents(xs, 12), xs, (k) => +bucket.interval.floor(new Date(times[k]))),
      (x) => (x.count > 1 ? 70 : 14),
      6,
    );
    placeCards(g, 150, 8, laneTimes.length > 1 ? 1 : 2);
    groups += g.length;
  }
  return groups;
}

describe.skipIf(!RUN)("performance targets", () => {
  for (const target of TARGETS) {
    it(`${target.wallets} wallet(s) / ${target.transactions} transactions`, () => {
      const [data, build] = time(() => syntheticCase(target.wallets, target.transactions));
      const [states, reconstruct] = time(() =>
        data.byWallet.map((w) =>
          reconstructWalletState(w.wallet, w.signatures.map((s) => data.transactions.get(s)!).filter(Boolean), { historyComplete: true }),
        ),
      );
      const [summaries, summarize] = time(() => states.map((s) => s.effects.map((e) => summarizeEffect(e, data.transactions.get(e.signature)))));
      const [rows, filterables] = time(() =>
        states.map((s, w) =>
          s.effects.map((e, i) => ({
            signature: e.signature,
            time: e.timestamp ? Date.parse(e.timestamp) : data.range.start,
            summary: summaries[w][i],
            protocols: protocolsUsed(enrichTransaction(data.transactions.get(e.signature)!)).map((p) => p.id),
            addresses: involvedAddresses(summaries[w][i]),
          })),
        ),
      );
      const active = { ...EMPTY_FILTER, direction: "out" as const, hiddenKinds: new Set(["PROGRAM" as const]) };
      const [, filterMs] = time(() => rows.map((r) => r.filter((row) => passesFilter(row, active))));
      const [events, merge] = time(() => mergeLaneEvents(rows.map((r) => r.map((row) => ({ signature: row.signature, time: row.time })))));
      const laneTimes = rows.map((r) => r.map((row) => row.time).sort((a, b) => a - b));
      const frames = [1, 8, 64, 512].map((zoom) => {
        // Median of several frames, as panning would repeat them.
        const samples = Array.from({ length: 7 }, () => time(() => frameLayout(laneTimes, data.range, zoom))[1]).sort((a, b) => a - b);
        return { zoom, ms: +samples[3].toFixed(2), groups: frameLayout(laneTimes, data.range, zoom) };
      });
      const total = rows.reduce((n, r) => n + r.length, 0);
      console.log(
        JSON.stringify({
          target: `${target.wallets}w/${target.transactions}tx`,
          effects: total,
          events: events.length,
          ms: {
            generateAndParse: +build.toFixed(0),
            reconstruct: +reconstruct.toFixed(1),
            summarize: +summarize.toFixed(1),
            filterables: +filterables.toFixed(1),
            filterPass: +filterMs.toFixed(2),
            mergeLanes: +merge.toFixed(2),
          },
          frames,
        }),
      );
      expect(total).toBeGreaterThanOrEqual(target.transactions * 0.95);

      if (process.env.PERF_SEED && target.wallets === 10) {
        const iso = (ms: number) => new Date(ms).toISOString();
        const seed = {
          range: { start: iso(data.range.start), end: iso(data.range.end + 1000) },
          wallets: data.byWallet.map((w) => w.wallet),
          // Stored without `raw`, like the transaction cache.
          transactions: [...data.transactions.values()].map((tx) => ({ ...tx, raw: undefined, key: `solana:${tx.signature}`, parserVersion: PARSER_VERSION })),
          walletTransactions: data.byWallet.flatMap((w) =>
            w.signatures.map((signature) => ({ wallet: w.wallet, signature, blockTime: Math.floor(Date.parse(data.transactions.get(signature)!.timestamp!) / 1000) })),
          ),
        };
        writeFileSync(process.env.PERF_SEED, JSON.stringify(seed));
      }
    }, 120_000);
  }
});
