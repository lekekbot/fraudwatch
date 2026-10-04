import { describe, expect, it } from "vitest";
import { distinguishingParts, distinguishingShort, isDust, judgeLookalikes, lookalikeGroups, readsAlike } from "./lookalikes";

// A real case: a poisoning decoy and the account it imitates.
const DECOY = "7VyCUqfAqs88C4AxQKKZmpnPWgQxgNecFT2TfbLA9W5P";
const REAL = "7VyCtxiHj64bbDmTgfci9iUc2MveK9MgoWqvzuTq9W5P";
const OTHER = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";

describe("lookalikeGroups", () => {
  it("links addresses whose short forms match, and only those", () => {
    const groups = lookalikeGroups([DECOY, REAL, OTHER, REAL]);
    expect(groups.get(DECOY)).toEqual([REAL]);
    expect(groups.get(REAL)).toEqual([DECOY]);
    expect(groups.has(OTHER)).toBe(false);
  });

  it("also links near matches, like 2hGZ…E1An beside 2hGU…E1An", () => {
    const a = "2hGZkq8mR3vT5wX7yB9cD1eF2gH3jK4mN5pQ6rS7E1An";
    const b = "2hGUw4nP6sV8xZ2aC4dE6fG8hJ2kL4mN6pQ8rT2uE1An";
    expect(lookalikeGroups([a, b]).get(a)).toEqual([b]);
  });
});

describe("readsAlike", () => {
  const base = "2hGZkq8mR3vT5wX7yB9cD1eF2gH3jK4mN5pQ6rS7E1An";
  it("needs at least two matching at each end and six across both", () => {
    // 2 leading + 4 trailing = 6: alike.
    expect(readsAlike(base, "2hQ" + base.slice(3, -5) + "9E1An")).toBe(true);
    // 3 leading + 2 trailing = 5: not enough.
    expect(readsAlike(base, "2hGQ" + base.slice(4, -3) + "8An")).toBe(false);
    // 1 leading + 4 trailing: one end too short.
    expect(readsAlike(base, "2Q" + base.slice(2, -5) + "9E1An")).toBe(false);
    expect(readsAlike(base, base)).toBe(false);
  });
});

describe("distinguishingShort", () => {
  it("grows the short form just enough to tell twins apart", () => {
    expect(distinguishingShort(DECOY, [REAL])).toBe("7VyCU…9W5P");
    expect(distinguishingShort(REAL, [DECOY])).toBe("7VyCt…9W5P");
  });

  it("grows the end that needs fewer characters", () => {
    const a = "AAAAAAAAAAAAAAAAAAAAxyz1";
    const b = "AAAAAAAAAAAAAAAAAAAAqyz1";
    expect(distinguishingParts(a, [b])).toEqual({ head: 4, tail: 4 });
    const c = "ABCDEFGHIJKLMNOPQRSTwxyz";
    const d = "ABCDEFGHIJKLMNOPQRSTkxyz";
    expect(distinguishingParts(c, [d])).toEqual({ head: 4, tail: 4 });
    const e = "ABCD1234567890123456WXYZ";
    const f = "ABCD9234567890123456WXYZ";
    expect(distinguishingShort(e, [f])).toBe("ABCD1…WXYZ");
  });
});

describe("isDust", () => {
  it("treats under 0.01 SOL or under one token as dust", () => {
    expect(isDust("SOL", BigInt(1_178_000), 9)).toBe(true);
    expect(isDust("SOL", BigInt(-56_050_000), 9)).toBe(false);
    expect(isDust("USDC", BigInt(2_500), 6)).toBe(true);
    expect(isDust("USDC", BigInt(3_450_000), 6)).toBe(false);
  });
});

describe("judgeLookalikes", () => {
  const groups = lookalikeGroups([DECOY, REAL]);
  it("calls the dust-only member the decoy and its twin with real value the real one", () => {
    const verdicts = judgeLookalikes(groups, (a) => a === DECOY);
    expect(verdicts.get(DECOY)).toBe("decoy");
    expect(verdicts.get(REAL)).toBe("real");
  });

  it("stays unclear when both or neither move real value, or there's no data", () => {
    expect(judgeLookalikes(groups, () => true).get(DECOY)).toBe("unclear");
    expect(judgeLookalikes(groups, () => false).get(REAL)).toBe("unclear");
    expect(judgeLookalikes(groups, (a) => (a === DECOY ? true : null)).get(DECOY)).toBe("unclear");
  });
});
