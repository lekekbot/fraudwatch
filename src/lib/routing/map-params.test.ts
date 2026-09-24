import { describe, expect, it } from "vitest";
import { MAP_PARAM_KEYS, buildMapSearch, parseMapParams } from "./map-params";

const WALLET = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";

describe("parseMapParams", () => {
  it("parses wallet and unix range", () => {
    const result = parseMapParams(new URLSearchParams(`wallet=${WALLET}&from=1780272000&to=1781136000`));
    expect(result).toEqual({
      ok: true,
      value: { wallet: WALLET, range: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-11T00:00:00.000Z" } },
    });
  });

  it("rejects bad wallet, bad timestamps, and inverted ranges", () => {
    expect(parseMapParams(new URLSearchParams("from=1&to=2")).ok).toBe(false);
    expect(parseMapParams(new URLSearchParams("wallet=nope&from=1&to=2")).ok).toBe(false);
    expect(parseMapParams(new URLSearchParams(`wallet=${WALLET}&from=abc&to=2`)).ok).toBe(false);
    expect(parseMapParams(new URLSearchParams(`wallet=${WALLET}&from=1780272000000&to=2`)).ok).toBe(false);
    expect(parseMapParams(new URLSearchParams(`wallet=${WALLET}&from=10&to=5`)).ok).toBe(false);
  });

  it("keeps the valid parts when something else is wrong", () => {
    const result = parseMapParams(new URLSearchParams(`wallet=${WALLET}&from=10&to=5`));
    expect(result).toMatchObject({ ok: false, partial: { wallet: WALLET } });
  });
});

describe("buildMapSearch", () => {
  it("only ever emits wallet/from/to", () => {
    const search = buildMapSearch({ wallet: WALLET, range: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-11T00:00:00.000Z" } });
    expect([...new URLSearchParams(search).keys()]).toEqual([...MAP_PARAM_KEYS]);
    expect(parseMapParams(new URLSearchParams(search)).ok).toBe(true);
  });
});
