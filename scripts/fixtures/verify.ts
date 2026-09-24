/**
 * Verify the fixture set.
 *
 * Usage: node scripts/fixtures/verify.ts
 *
 * Checks, per scenario:
 * - every JSON file under fixtures/ parses;
 * - rpc.json has no duplicate (method, params) requests;
 * - replaying getSignaturesForAddress pagination (as the app would, honouring
 *   manifest.pagination cursors) reproduces expected.signaturesByWallet;
 * - every expected signature has a getTransaction recording, and
 *   transactionCount matches;
 * - synthetic generators are deterministic and match what is on disk;
 * - synthetic balances chain (post of tx N == pre of tx N+1 per account/asset)
 *   and lamports are conserved apart from the fee, which the fee payer pays.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type * as Generate from "../../fixtures/solana/synthetic/generate";
import type { FixtureManifest, RecordedCall } from "../../fixtures/solana/synthetic/generate";

const gen = (await import(
  new URL("../../fixtures/solana/synthetic/generate.ts", import.meta.url).href
)) as typeof Generate;

const ROOT = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "fixtures");
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  FAIL ${msg}`);
};

type Manifest = Omit<FixtureManifest, "source" | "rpc" | "generator"> & {
  source: string;
  expected: FixtureManifest["expected"] & {
    signaturesOnlyViaTokenAccount?: { signature: string; wallet: string; tokenAccount: string }[];
  };
  pagination?: Record<string, { firstBefore: string }>;
};
type SigInfo = { signature: string; blockTime: number | null };

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

function makeReplay(rpc: RecordedCall[]) {
  return (method: string, params: unknown[]) => {
    const hit = rpc.find((c) => c.request.method === method && isDeepStrictEqual(c.request.params, params));
    if (!hit) throw new Error(`no recording for ${method} ${JSON.stringify(params).slice(0, 120)}`);
    if ("error" in hit.response) throw new Error(`recorded error for ${method}`);
    return hit.response.result as unknown;
  };
}

function replaySignatures(replay: ReturnType<typeof makeReplay>, address: string, start: number, end: number, before?: string): string[] {
  const inRange: string[] = [];
  for (;;) {
    const opts: Record<string, unknown> = { limit: 1000, commitment: "finalized" };
    if (before) opts.before = before;
    const page = replay("getSignaturesForAddress", [address, opts]) as SigInfo[];
    for (const s of page) if (s.blockTime != null && s.blockTime >= start && s.blockTime <= end) inRange.push(s.signature);
    if (page.length < 1000) break;
    const last = page[page.length - 1];
    if (last.blockTime != null && last.blockTime < start) break;
    before = last.signature;
  }
  return inRange;
}

function checkScenario(id: string, manifest: Manifest, rpc: RecordedCall[]) {
  const keys = new Set<string>();
  for (const c of rpc) {
    const k = JSON.stringify([c.request.method, c.request.params]);
    if (keys.has(k)) fail(`${id}: duplicate recording ${k.slice(0, 100)}`);
    keys.add(k);
  }
  const replay = makeReplay(rpc);
  const start = Date.parse(manifest.range.start) / 1000;
  const end = Date.parse(manifest.range.end) / 1000;
  const viaTa = manifest.expected.signaturesOnlyViaTokenAccount ?? [];
  const cap = manifest.notes.some((n) => n.includes("safety cap hit"));
  for (const w of manifest.wallets) {
    try {
      let sigs = replaySignatures(replay, w.address, start, end, manifest.pagination?.[w.address]?.firstBefore);
      if (cap) sigs = sigs.slice(0, 300);
      for (const ta of new Set(viaTa.filter((v) => v.wallet === w.address).map((v) => v.tokenAccount))) {
        for (const s of replaySignatures(replay, ta, start, end)) if (!sigs.includes(s)) sigs.push(s);
      }
      if (!isDeepStrictEqual(sigs, manifest.expected.signaturesByWallet[w.address])) {
        fail(`${id}: replayed signatures for ${w.address} differ from expected`);
      }
    } catch (e) {
      fail(`${id}: ${(e as Error).message}`);
    }
    for (const program of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
      if (!keys.has(JSON.stringify(["getTokenAccountsByOwner", [w.address, { programId: program }, { encoding: "jsonParsed", commitment: "finalized" }]]))) {
        fail(`${id}: missing getTokenAccountsByOwner ${w.address} ${program}`);
      }
    }
  }
  const all = new Set(Object.values(manifest.expected.signaturesByWallet).flat());
  for (const s of all) {
    try {
      const tx = replay("getTransaction", [s, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
      if (!tx) fail(`${id}: getTransaction ${s} recorded as null`);
    } catch (e) {
      fail(`${id}: ${(e as Error).message}`);
    }
  }
  if (all.size !== manifest.expected.transactionCount) fail(`${id}: transactionCount ${manifest.expected.transactionCount} != ${all.size}`);
  for (const sh of manifest.expected.sharedSignatures) {
    for (const w of sh.wallets) {
      if (!manifest.expected.signaturesByWallet[w]?.includes(sh.signature)) fail(`${id}: shared ${sh.signature} not in ${w}`);
    }
  }
  console.log(`  ok ${id}: ${manifest.wallets.length} wallet(s), ${all.size} txs, ${rpc.length} calls`);
}

type Tx = {
  slot: number;
  meta: {
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: { accountIndex: number; uiTokenAmount: { amount: string } }[];
    postTokenBalances: { accountIndex: number; uiTokenAmount: { amount: string } }[];
  };
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
};

/** Balance chaining + fee accounting over ALL recorded synthetic transactions. */
function checkSyntheticBalances(id: string, rpc: RecordedCall[]) {
  const txs = rpc
    .filter((c) => c.request.method === "getTransaction")
    .map((c) => (c.response as { result: unknown }).result as Tx)
    .sort((a, b) => a.slot - b.slot);
  const lastLamports = new Map<string, number>();
  const lastToken = new Map<string, string>();
  let checked = 0;
  for (const tx of txs) {
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
    const { preBalances, postBalances, fee } = tx.meta;
    const delta = postBalances.reduce((a, b) => a + b, 0) - preBalances.reduce((a, b) => a + b, 0);
    if (delta !== -fee) fail(`${id}: lamports not conserved (delta ${delta}, fee ${fee}) at slot ${tx.slot}`);
    const payerDelta = postBalances[0] - preBalances[0];
    // In the synthetic scenarios the fee payer never receives value, so it must
    // lose at least the fee.
    if (!tx.transaction.message.accountKeys[0].signer || payerDelta > -fee) fail(`${id}: fee not paid by fee payer at slot ${tx.slot}`);
    keys.forEach((k, i) => {
      const prev = lastLamports.get(k);
      if (prev !== undefined && prev !== preBalances[i]) fail(`${id}: lamports chain broken for ${k} at slot ${tx.slot}`);
      lastLamports.set(k, postBalances[i]);
    });
    for (const b of tx.meta.preTokenBalances) {
      const k = keys[b.accountIndex];
      const prev = lastToken.get(k);
      if (prev !== undefined && prev !== b.uiTokenAmount.amount) fail(`${id}: token chain broken for ${k} at slot ${tx.slot}`);
    }
    for (const b of tx.meta.postTokenBalances) lastToken.set(keys[b.accountIndex], b.uiTokenAmount.amount);
    checked++;
  }
  console.log(`  ok ${id}: balance chain + fee accounting over ${checked} txs`);
}

// 1. Parse all JSON
console.log("JSON parse");
const files = walkJson(ROOT);
for (const f of files) {
  try {
    JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    fail(`${f}: ${(e as Error).message}`);
  }
}
console.log(`  ok ${files.length} JSON files`);

// 2. On-disk scenarios
console.log("Scenarios on disk");
const solanaDir = join(ROOT, "solana");
for (const id of readdirSync(solanaDir).sort()) {
  const dir = join(solanaDir, id);
  if (!statSync(dir).isDirectory() || id === "synthetic") continue;
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
  if (manifest.id !== id) fail(`${id}: manifest id ${manifest.id}`);
  let rpc: RecordedCall[];
  try {
    rpc = JSON.parse(readFileSync(join(dir, "rpc.json"), "utf8")) as RecordedCall[];
  } catch {
    if (id === "high-activity") continue; // generated in step 3
    fail(`${id}: rpc.json missing`);
    continue;
  }
  checkScenario(id, manifest, rpc);
}

// 3. Synthetic determinism + consistency
console.log("Synthetic generators");
const loopA = gen.generateLoopCDA();
const loopB = gen.generateLoopCDA();
if (JSON.stringify(loopA) !== JSON.stringify(loopB)) fail("loop-c-d-a: generator not deterministic");
const loopDisk = {
  manifest: JSON.parse(readFileSync(join(solanaDir, "loop-c-d-a", "manifest.json"), "utf8")),
  rpc: JSON.parse(readFileSync(join(solanaDir, "loop-c-d-a", "rpc.json"), "utf8")),
};
if (!isDeepStrictEqual(JSON.parse(JSON.stringify(loopA)), loopDisk)) fail("loop-c-d-a: on-disk files differ from generator output (re-run generate-synthetic)");
checkSyntheticBalances("loop-c-d-a", loopA.rpc);

const highA = gen.generateHighActivity();
const highB = gen.generateHighActivity();
if (JSON.stringify(highA) !== JSON.stringify(highB)) fail("high-activity: generator not deterministic");
const highDisk = JSON.parse(readFileSync(join(solanaDir, "high-activity", "manifest.json"), "utf8"));
if (!isDeepStrictEqual(JSON.parse(JSON.stringify(highA.manifest)), highDisk)) fail("high-activity: on-disk manifest differs from generator output");
checkScenario("high-activity (generated)", highA.manifest as Manifest, highA.rpc);
checkSyntheticBalances("high-activity", highA.rpc);
const pages = highA.rpc.filter((c) => c.request.method === "getSignaturesForAddress").length;
if (pages < 2) fail(`high-activity: expected >= 2 signature pages, got ${pages}`);
if (JSON.stringify(gen.generateHighActivity({ seed: "other" }).manifest.expected) === JSON.stringify(highA.manifest.expected)) {
  fail("high-activity: seed has no effect");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall fixture checks passed");
process.exit(failures ? 1 : 0);
