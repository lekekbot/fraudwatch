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
