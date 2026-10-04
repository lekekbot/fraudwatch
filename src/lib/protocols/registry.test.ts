import { describe, expect, it } from "vitest";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import { enrichTransaction, parseRegistry, protocolsUsed, registry, RegistryError } from "./registry";

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SNS = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";
const COINBASE = "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS";
const COINBASE_HOT_WALLET = "D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf";
const KRAKEN_HOT_WALLET = "6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF";
const BISONFI = "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi";
const UNKNOWN = "HobbakUnknownProgram1111111111111111111111";

const minimal = (addresses: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  version: 1,
  protocols: { jupiter: { name: "Jupiter", category: "dex_aggregator", addresses, ...extra } },
});

const tx = (programs: string[], accounts: string[] = []): CanonicalTransaction => ({
  signature: "sig",
  slot: 1,
  transactionIndex: null,
  timestamp: null,
  success: true,
  feeLamports: "0",
  accounts: accounts.map((address) => ({ address, signer: false, writable: false, source: "transaction" })),
  nativeChanges: [],
  tokenChanges: [],
  instructions: programs.map((programId) => ({
    programId,
    program: null,
    type: null,
    info: null,
    accounts: [],
    data: null,
    outerIndex: null,
    stackHeight: null,
  })),
  innerInstructions: [],
  raw: null,
});

describe("bundled registry", () => {
  it("parses, and identifies configured addresses", () => {
    expect(registry.version).toBeGreaterThanOrEqual(1);
    expect(registry.size).toBeGreaterThan(190);
    expect(registry.lookup(JUPITER)).toMatchObject({ protocolId: "jupiter", category: "dex_aggregator", role: "program" });
    expect(registry.lookup(SNS)).toMatchObject({ protocolId: "sns", category: "name_service", role: "program", label: "SNS Name Service" });
    expect(registry.lookup(COINBASE)).toMatchObject({ protocolId: "coinbase", category: "exchange", role: "wallet", label: "Coinbase 1" });
    expect(registry.lookup(COINBASE_HOT_WALLET)).toMatchObject({ protocolId: "coinbase", protocolName: "Coinbase", role: "wallet" });
    expect(registry.lookup(KRAKEN_HOT_WALLET)).toMatchObject({ protocolId: "kraken", protocolName: "Kraken", role: "wallet" });
    expect(registry.lookup("11111111111111111111111111111111")).toMatchObject({ category: "core", label: "System Program" });
    expect(registry.protocols.get("jupiter")).toEqual({ name: "Jupiter", category: "dex_aggregator" });
  });

  it("leaves unknown addresses unknown", () => {
    expect(registry.lookup(UNKNOWN)).toBeUndefined();
  });
});

describe("parseRegistry", () => {
  it("accepts a minimal registry", () => {
    const reg = parseRegistry(minimal({ [JUPITER]: { role: "program", label: "Jupiter" } }));
    expect(reg.lookup(JUPITER)?.label).toBe("Jupiter");
  });

  it.each([
    ["a bad version", { version: 0, protocols: {} }, /version/],
    ["an invalid address", minimal({ notAnAddress: { role: "program", label: "x" } }), /not a valid Solana address/],
    ["an unknown role", minimal({ [JUPITER]: { role: "wizard", label: "x" } }), /role/],
    ["an unknown category", minimal({ [JUPITER]: { role: "program", label: "x" } }, { category: "casino" }), /category/],
    ["an empty label", minimal({ [JUPITER]: { role: "program", label: "" } }), /label/],
  ])("rejects %s", (_, json, message) => {
    expect(() => parseRegistry(json)).toThrow(RegistryError);
    expect(() => parseRegistry(json)).toThrow(message);
  });

  it("rejects an address listed under two protocols", () => {
    const json = {
      version: 1,
      protocols: {
        a: { name: "A", category: "dex", addresses: { [JUPITER]: { role: "program", label: "A" } } },
        b: { name: "B", category: "dex", addresses: { [JUPITER]: { role: "program", label: "B" } } },
      },
    };
    expect(() => parseRegistry(json)).toThrow(/already listed under a/);
  });
});

describe("enrichTransaction", () => {
  it("records the registry version, matched protocols and unknown programs", () => {
    const e = enrichTransaction(tx(["ComputeBudget111111111111111111111111111111", JUPITER, UNKNOWN]));
    expect(e.protocolRegistryVersion).toBe(registry.version);
    expect(e.matches.map((m) => m.address)).toEqual(["ComputeBudget111111111111111111111111111111", JUPITER]);
    expect(e.unknownPrograms).toEqual([UNKNOWN]);
    // Core programs are identified but aren't "protocols used".
    expect(protocolsUsed(e)).toEqual([{ id: "jupiter", name: "Jupiter", category: "dex_aggregator" }]);
  });

  it("matches protocol accounts that appear only as accounts", () => {
    const e = enrichTransaction(tx([UNKNOWN], [JUPITER]));
    expect(e.matches.map((m) => m.protocolId)).toEqual(["jupiter"]);
  });

  it("matches service wallets that appear as accounts", () => {
    const e = enrichTransaction(tx([UNKNOWN], [COINBASE]));
    expect(protocolsUsed(e)).toEqual([{ id: "coinbase", name: "Coinbase", category: "exchange" }]);
  });

  it("matches a centralized vault exposed only as a token account owner", () => {
    const transaction = tx([UNKNOWN]);
    transaction.tokenChanges = [
      { account: "token-account", owner: KRAKEN_HOT_WALLET, mint: "mint", programId: null, decimals: 6, pre: "0", post: "1", delta: "1" },
    ];
    expect(protocolsUsed(enrichTransaction(transaction))).toEqual([{ id: "kraken", name: "Kraken", category: "exchange" }]);
  });

  it("labels popular programs from the Solscan leaderboard", () => {
    const e = enrichTransaction(tx([BISONFI]));
    expect(e.matches[0]).toMatchObject({ protocolId: "bisonfi", label: "BisonFi", category: "dex" });
    expect(protocolsUsed(e)).toEqual([{ id: "bisonfi", name: "BisonFi", category: "dex" }]);
  });
});
