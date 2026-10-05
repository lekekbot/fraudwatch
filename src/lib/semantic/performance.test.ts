import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observeWallet } from "@/lib/behavior/observations";
import { buildInteractionGraph } from "@/lib/graph/build";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { type CanonicalTransaction, canonicalize } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { summarizeEffect } from "@/lib/state/summarize";
import type { SemanticEvent } from "./events";
import { interpretTransaction } from "./interpret";
import { FEE, makeTx, read, SOL } from "./testing";

/**
 * The FraudWatch target scenarios, timed end to end for everything that runs
 * when a case opens: reconstruction, per-wallet summaries, semantic
 * interpretation, behaviour detection and the graph. Each scenario mixes
 * transfers between the case's wallets with real DeFi and NFT transactions.
 * Budgets are generous (several times what a laptop takes) so they catch
 * regressions without flaking.
 */
const SCENARIOS = [
  { wallets: 1, transactions: 1_000, budgetMs: 3_000 },
  { wallets: 5, transactions: 2_000, budgetMs: 5_000 },
  { wallets: 10, transactions: 5_000, budgetMs: 10_000 },
];

const recorded: CanonicalTransaction[] = ["defi", "basic"].flatMap((dir) =>
  readdirSync(join(process.cwd(), "fixtures/solana", dir)).map((f) => canonicalize(read<RawParsedTransaction>(`${dir}/${f}`))),
);

function scenario(walletCount: number, count: number) {
  const wallets = Array.from({ length: walletCount }, (_, i) => `Wallet${i}`);
  const txs: CanonicalTransaction[] = [];
  for (let i = 0; i < count; i++) {
    const slot = 1_000 + i;
    if (i % 5 === 4) {
      // A real transaction, renamed so every one is distinct.
      const base = recorded[i % recorded.length];
      txs.push({ ...base, signature: `${base.signature.slice(0, 40)}${i}`, slot });
      continue;
    }
    const from = wallets[i % walletCount];
    // Mostly outside counterparties, sometimes another case wallet (a shared transaction).
    const to = i % 7 === 0 && walletCount > 1 ? wallets[(i + 1) % walletCount] : `Counterparty${i % 97}`;
    const lamports = ((i % 50) + 1) * (SOL / 10);
    txs.push({ ...makeTx({ signature: `perf${i}`, native: { [from]: [10_000 * SOL, 10_000 * SOL - lamports - FEE], [to]: [SOL, SOL + lamports] } }), slot, timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() });
  }
  return { wallets, txs };
}

describe("performance at the target scenarios", () => {
  it.each(SCENARIOS)("$wallets wallet(s) / $transactions transactions stays within $budgetMs ms", ({ wallets: walletCount, transactions, budgetMs }) => {
    const { wallets, txs } = scenario(walletCount, transactions);
    const timings: Record<string, number> = {};
    const time = <T>(label: string, run: () => T): T => {
      const start = performance.now();
      const result = run();
      timings[label] = Math.round(performance.now() - start);
      return result;
    };

    const events = time("interpret", () => new Map<string, SemanticEvent>(txs.map((tx) => [tx.signature, interpretTransaction(tx)[0]])));
    const sides = time("reconstruct+summarize", () =>
      wallets.map((wallet) => {
        const mine = txs.filter((tx) => tx.nativeChanges.some((c) => c.account === wallet));
        const state = reconstructWalletState(wallet, mine, { historyComplete: true });
        const bySig = new Map(mine.map((t) => [t.signature, t]));
        return { wallet, effects: state.effects, summaries: state.effects.map((e) => summarizeEffect(e, bySig.get(e.signature))), events: state.effects.map((e) => events.get(e.signature)) };
      }),
    );
    const observations = time("behaviour", () =>
      sides.flatMap((side) => observeWallet(side.wallet, side.effects.map((e, i) => ({ event: side.events[i]!, time: Date.parse(e.timestamp!) })))),
    );
    const graph = time("graph", () => buildInteractionGraph(sides));
    const total = Object.values(timings).reduce((a, b) => a + b, 0);
    console.info(`${walletCount} wallet(s) / ${transactions} tx: ${JSON.stringify(timings)} total ${total} ms; ${observations.length} observations; ${graph.nodes.length} nodes`);

    expect(events.size).toBe(transactions);
    expect(total).toBeLessThan(budgetMs);
  });
});
