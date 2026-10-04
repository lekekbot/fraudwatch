import { describe, expect, it } from "vitest";
import { registry } from "@/lib/protocols/registry";
import { createNames, displayName, isEmptyLabel, normalizeLabel } from "./labels";

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ADDRESS = "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi";

describe("normalizeLabel", () => {
  it("trims, drops an empty note and de-duplicates tags case-insensitively", () => {
    expect(normalizeLabel({ caseId: "c", address: ADDRESS, name: " A ", note: "  ", tags: ["Mixer", "mixer", "", " cex "] })).toEqual({
      caseId: "c",
      address: ADDRESS,
      name: "A",
      tags: ["Mixer", "cex"],
    });
    expect(isEmptyLabel(normalizeLabel({ caseId: "c", address: ADDRESS, name: " ", tags: [" "] }))).toBe(true);
  });
});

describe("displayName", () => {
  it("prefers the user's label, then the registry, then the shortened address", () => {
    const entry = registry.lookup(JUPITER);
    expect(displayName(JUPITER, { caseId: "c", address: JUPITER, name: "Router", tags: [] }, entry)).toEqual({ text: "Router", source: "label" });
    expect(displayName(JUPITER, undefined, entry)).toEqual({ text: "Jupiter Aggregator v6", source: "registry" });
    // A label with only tags doesn't hide the registry name.
    expect(displayName(JUPITER, { caseId: "c", address: JUPITER, name: "", tags: ["x"] }, entry).source).toBe("registry");
    expect(displayName(ADDRESS, undefined, undefined)).toEqual({ text: "4VWK…ZVCi", source: "address" });
    // Unverified sources come after the registry: the community list, then the owner's own .sol name.
    expect(displayName(ADDRESS, undefined, undefined, 4, { community: "Some Vault", sns: "kai.sol" })).toEqual({ text: "Some Vault", source: "community" });
    expect(displayName(ADDRESS, undefined, undefined, 4, { sns: "kai.sol" })).toEqual({ text: "kai.sol", source: "sns" });
    expect(displayName(JUPITER, undefined, entry, 4, { sns: "kai.sol" }).source).toBe("registry");
  });
});

describe("createNames", () => {
  it("only reports a known name when there is a label or registry entry", () => {
    const names = createNames(new Map([[ADDRESS, { caseId: "c", address: ADDRESS, name: "Victim", tags: [] }]]), registry);
    expect(names.of(ADDRESS)).toBe("Victim");
    expect(names.known(JUPITER)).toBe("Jupiter Aggregator v6");
    expect(names.known("3WNqDSBxxZ7BtdyGYHdLHeZWBu2aXEomkX9YVAeZGy5a")).toBeUndefined();
    expect(names.of("3WNqDSBxxZ7BtdyGYHdLHeZWBu2aXEomkX9YVAeZGy5a", 3)).toBe("3WN…y5a");
  });
});
