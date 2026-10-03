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

/** One cross-lane arrow at screen x, possibly standing for several transactions. */
export type MergedConnector = { from: number; to: number; directed: boolean; x: number; count: number };

/**
 * Combines connectors that join the same lanes the same way and sit within
 * `gap` px of each other, so a zoomed-out stretch draws one arrow with a count
 * instead of a comb of lines. Zoomed in, they drift apart and split again.
 * A merged arrow sits midway across the connectors it stands for.
 */
export function mergeConnectors(links: readonly { x: number; from: number; to: number; directed: boolean }[], gap: number): MergedConnector[] {
  const byKey = new Map<string, { x: number; from: number; to: number; directed: boolean }[]>();
  for (const link of links) {
    const key = `${link.from}>${link.to}:${link.directed}`;
    const list = byKey.get(key);
    if (list) list.push(link);
    else byKey.set(key, [link]);
  }
  const out: MergedConnector[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.x - b.x);
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      // A run ends where the next connector is more than `gap` from the run's first.
      if (i < list.length && list[i].x - list[start].x <= gap) continue;
      const { from, to, directed } = list[start];
      out.push({ from, to, directed, x: (list[start].x + list[i - 1].x) / 2, count: i - start });
      start = i;
    }
  }
  return out;
}
