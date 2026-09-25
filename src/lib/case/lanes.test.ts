import { describe, expect, it } from "vitest";
import { laneOrder, moveLane, toggleLaneHidden, visibleLanes } from "./lanes";
import { createCase } from "./model";
import { mapWallet } from "./wallet-range";

const A = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const B = "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi";
const C = "3WNqDSBxxZ7BtdyGYHdLHeZWBu2aXEomkX9YVAeZGy5a";
const RANGE = { start: "2026-06-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" };
const withThree = () =>
  mapWallet(mapWallet(createCase({ name: "c", primaryWallet: A, range: RANGE }), { address: B, rangeMode: "case" }), { address: C, rangeMode: "case" });

describe("laneOrder", () => {
  it("puts the primary first, then mapped wallets by first appearance", () => {
    expect(laneOrder(withThree(), new Map([[A, 5], [B, 30], [C, 10]]))).toEqual([A, C, B]);
  });

  it("follows a saved order and appends wallets it doesn't mention", () => {
    const c = { ...withThree(), laneOrder: [B, A] };
    expect(laneOrder(c, new Map([[C, 1]]))).toEqual([B, A, C]);
  });

  it("drops wallets that are no longer mapped from a saved order", () => {
    const c = { ...withThree(), laneOrder: ["gone", C] };
    expect(laneOrder(c, new Map())).toEqual([C, A, B]);
  });
});

describe("moveLane / toggleLaneHidden / visibleLanes", () => {
  it("moves a lane and saves the full order, ignoring moves past either end", () => {
    const c = withThree();
    const order = [A, B, C];
    expect(moveLane(c, order, C, -1).laneOrder).toEqual([A, C, B]);
    expect(moveLane(c, order, A, -1)).toBe(c);
  });

  it("hides and shows lanes; a focus set overrides hiding without changing it", () => {
    const hidden = toggleLaneHidden(withThree(), B).hiddenLanes!;
    expect(hidden).toEqual([B]);
    expect(toggleLaneHidden({ ...withThree(), hiddenLanes: hidden }, B).hiddenLanes).toEqual([]);
    expect(visibleLanes([A, B, C], hidden, new Set())).toEqual([A, C]);
    expect(visibleLanes([A, B, C], hidden, new Set([A, B]))).toEqual([A, B]);
  });
});
