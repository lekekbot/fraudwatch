import type { EventCategory } from "@/lib/semantic/events";

/**
 * Multi-wallet timeline events: a transaction several mapped wallets share is
 * one event at one time, with an entry per lane.
 */

/** Which way value moved for one wallet in a transaction. */
export type Flow = "out" | "in" | "none";

export type LaneEvent<E> = { signature: string; time: number; entries: (E & { lane: number })[] };

/** Merges each lane's events into one chronological list; ties break by signature so the order is stable. */
export function mergeLaneEvents<E extends { signature: string; time: number }>(lanes: E[][]): LaneEvent<Omit<E, "signature" | "time">>[] {
  const bySignature = new Map<string, LaneEvent<Omit<E, "signature" | "time">>>();
  lanes.forEach((events, lane) => {
    for (const { signature, time, ...rest } of events) {
      let event = bySignature.get(signature);
      if (!event) {
        event = { signature, time, entries: [] };
        bySignature.set(signature, event);
      }
      event.entries.push({ ...(rest as Omit<E, "signature" | "time">), lane });
    }
  });
  return [...bySignature.values()].sort((a, b) => a.time - b.time || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
}

/**
 * Connectors for a shared transaction: from each lane that lost value to each
 * that gained it. When the direction isn't clear (swaps, program calls),
 * adjacent lanes are joined without an arrow.
 */
export function connectors(entries: { lane: number; flow: Flow }[]): { from: number; to: number; directed: boolean }[] {
  if (entries.length < 2) return [];
  const outs = entries.filter((e) => e.flow === "out");
  const ins = entries.filter((e) => e.flow === "in");
  if (outs.length > 0 && ins.length > 0) return outs.flatMap((o) => ins.map((i) => ({ from: o.lane, to: i.lane, directed: true })));
  const lanes = [...new Set(entries.map((e) => e.lane))].sort((a, b) => a - b);
  return lanes.slice(1).map((lane, i) => ({ from: lanes[i], to: lane, directed: false }));
}

/** One cross-lane trunk at screen x, possibly standing for several transactions. */
export type Trunk = {
  x: number;
  /** Every lane a merged transaction touches, top to bottom. */
  lanes: number[];
  /** Transactions behind it. */
  count: number;
  /** Lanes that received value, and which way it came: +1 down the lanes, -1 up. Each lane and way once. */
  arrivals: { lane: number; direction: 1 | -1 }[];
};

/**
 * Combines the connectors of transactions within `gap` px of each other into
 * one vertical trunk across all the lanes they touch, so a zoomed-out stretch
 * draws one line with a count instead of a comb. Zoomed in, they drift apart
 * and split again. A trunk sits midway across the transactions it stands for.
 */
export function mergeConnectors(links: readonly { x: number; connectors: readonly { from: number; to: number; directed: boolean }[] }[], gap: number): Trunk[] {
  const list = links.filter((l) => l.connectors.length > 0).sort((a, b) => a.x - b.x);
  const out: Trunk[] = [];
  let start = 0;
  for (let i = 1; i <= list.length; i++) {
    // A run ends where the next transaction is more than `gap` from the run's first.
    if (i < list.length && list[i].x - list[start].x <= gap) continue;
    const run = list.slice(start, i);
    const all = run.flatMap((l) => l.connectors);
    const arrivals = new Map<string, { lane: number; direction: 1 | -1 }>();
    for (const c of all) {
      if (!c.directed || c.to === c.from) continue;
      const direction = c.to > c.from ? 1 : -1;
      arrivals.set(`${c.to}:${direction}`, { lane: c.to, direction });
    }
    out.push({
      x: (list[start].x + list[i - 1].x) / 2,
      lanes: [...new Set(all.flatMap((c) => [c.from, c.to]))].sort((a, b) => a - b),
      count: run.length,
      arrivals: [...arrivals.values()].sort((a, b) => a.lane - b.lane || a.direction - b.direction),
    });
    start = i;
  }
  return out;
}

/**
 * Leaves out whole transactions whose semantic event is in `hidden` (a view setting, not a filter): a
 * transaction on several lanes goes from all of them at once, and order is kept. Counts what was left out,
 * by category, so the view can say so. With nothing hidden the same array comes back, so memos keep.
 */
export function withoutCategories<E extends { signature: string }>(
  events: readonly E[],
  categoryOf: (signature: string) => EventCategory | undefined,
  hidden: ReadonlySet<EventCategory>,
): { shown: readonly E[]; counts: Map<EventCategory, number> } {
  const counts = new Map<EventCategory, number>();
  if (hidden.size === 0) return { shown: events, counts };
  const shown = events.filter((event) => {
    const category = categoryOf(event.signature);
    if (category === undefined || !hidden.has(category)) return true;
    counts.set(category, (counts.get(category) ?? 0) + 1);
    return false;
  });
  return { shown, counts };
}
