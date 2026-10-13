import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { only, read } from "@/lib/semantic/testing";
import { canonicalize } from "@/lib/solana/canonical";
import { eventIndexOf, keyedFlows, movementKey } from "./model";
import { event } from "./testing";

describe("movement keys", () => {
  it("are the same every time a recorded transaction is read", () => {
    const tx = canonicalize(read<RawParsedTransaction>("basic/sol-transfer.json"));
    const keys = () => keyedFlows(only(interpretTransaction(tx))).map((k) => k.ref.key);
    expect(keys().length).toBeGreaterThan(0);
    expect(keys()).toEqual(keys());
    expect(keys()[0]).toMatch(new RegExp(`^solana:${tx.signature}:event:0:mv:SOL:`));
  });

  it("tell identical movements in one event apart by occurrence", () => {
    const flow = { assetId: "SOL", from: "A", to: "B", amount: "10" };
    const [a, b] = keyedFlows(event("s", [flow, flow])).map((k) => k.ref.key);
    expect([a.endsWith(":0"), b.endsWith(":1"), a === b]).toEqual([true, true, false]);
  });

  it("encode an unknown side as _", () => {
    expect(movementKey("s", 0, { assetId: "SOL", from: null, to: "B", amount: "1" }, 0)).toBe("solana:s:event:0:mv:SOL:_:B:1:0");
  });

  it("ignore a refined role but change with the amount", () => {
    const base = { assetId: "SOL", from: "A", to: "B", amount: "10" };
    const key = (f: Parameters<typeof event>[1][number]) => keyedFlows(event("s", [f]))[0].ref.key;
    expect(key({ ...base, role: "unidentified" })).toBe(key({ ...base, role: "marketplace_fee" }));
    expect(key({ ...base, amount: "11" })).not.toBe(key(base));
  });

  it("carry the event's slot, time and index", () => {
    const [{ ref }] = keyedFlows(event("s", [{ assetId: "SOL", from: "A", to: "B", amount: "1" }], { slot: 42, time: "2026-03-03T14:02:00.000Z" }));
    expect([ref.slot, ref.time, ref.eventIndex, ref.role]).toEqual([42, Date.parse("2026-03-03T14:02:00.000Z"), 0, null]);
    expect(keyedFlows(event("s", [{ assetId: "SOL", from: "A", to: "B", amount: "1" }], { time: null }))[0].ref.time).toBeNull();
    expect(eventIndexOf({ id: "solana:s:event:3" })).toBe(3);
  });
});
