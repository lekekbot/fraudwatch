import { toggled } from "@/lib/timeline/filter";
import type { FraudWatchCase } from "./model";

/**
 * Lane order: the user's saved order first, then any other mapped wallets in
 * default order (primary, then by first appearance). `firstSeen` is each
 * wallet's earliest loaded activity, in ms.
 */
export function laneOrder(
  c: Pick<FraudWatchCase, "primaryWallet" | "mappedWallets" | "laneOrder">,
  firstSeen: ReadonlyMap<string, number>,
): string[] {
  const mapped = c.mappedWallets.map((w) => w.address);
  const byDefault = [...mapped].sort((a, b) => {
    if (a === c.primaryWallet) return -1;
    if (b === c.primaryWallet) return 1;
    return (firstSeen.get(a) ?? Infinity) - (firstSeen.get(b) ?? Infinity) || mapped.indexOf(a) - mapped.indexOf(b);
  });
  const saved = (c.laneOrder ?? []).filter((w) => mapped.includes(w));
  return [...saved, ...byDefault.filter((w) => !saved.includes(w))];
}

/** Moves a lane one step up (-1) or down (+1), saving the full order. */
export function moveLane(c: FraudWatchCase, order: string[], wallet: string, direction: -1 | 1, now = new Date()): FraudWatchCase {
  const i = order.indexOf(wallet);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= order.length) return c;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...c, laneOrder: next, updatedAt: now.toISOString() };
}

export function toggleLaneHidden(c: FraudWatchCase, wallet: string, now = new Date()): FraudWatchCase {
  return { ...c, hiddenLanes: [...toggled(new Set(c.hiddenLanes ?? []), wallet)], updatedAt: now.toISOString() };
}

/** Lanes to draw: in order, minus hidden ones; with a focus set, only those. */
export function visibleLanes(order: string[], hidden: readonly string[], focus: ReadonlySet<string>): string[] {
  return order.filter((w) => (focus.size > 0 ? focus.has(w) : !hidden.includes(w)));
}
