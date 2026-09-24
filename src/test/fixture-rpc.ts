import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { FixtureManifest, RecordedCall } from "../../fixtures/solana/synthetic/generate";

export type Fixture = {
  manifest: FixtureManifest & {
    expected: FixtureManifest["expected"] & {
      signaturesOnlyViaTokenAccount?: { signature: string; wallet: string; tokenAccount: string }[];
    };
  };
  rpc: RecordedCall[];
};

const FIXTURES = join(process.cwd(), "fixtures", "solana");

export function loadFixture(id: string): Fixture {
  const read = (file: string) => JSON.parse(readFileSync(join(FIXTURES, id, file), "utf8"));
  return { manifest: read("manifest.json"), rpc: read("rpc.json") };
}

export type ReplayLog = Array<{ method: string; params: unknown[] }>;

/**
 * A fetch that answers JSON-RPC requests from a fixture recording and fails on
 * anything unrecorded, so tests also pin the exact request params.
 *
 * Fixtures record token-account signature history only where it matters
 * (`signaturesOnlyViaTokenAccount`); other token accounts answer with an empty
 * history rather than failing.
 */
export function replayFetch(fixture: Fixture, log: ReplayLog = []): typeof fetch {
  const wallets = new Set(fixture.manifest.wallets.map((w) => w.address));
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    log.push({ method, params });
    const hit = fixture.rpc.find((c) => c.request.method === method && isDeepStrictEqual(c.request.params, params));
    let body: unknown;
    if (hit) body = { jsonrpc: "2.0", id: 1, ...hit.response };
    else if (method === "getSignaturesForAddress" && !wallets.has(params[0] as string)) body = { jsonrpc: "2.0", id: 1, result: [] };
    else throw new Error(`No recording for ${method} ${JSON.stringify(params).slice(0, 160)}`);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}
