/**
 * Capture replayable JSON-RPC fixtures from Solana mainnet.
 *
 * Usage:
 *   node scripts/fixtures/capture.ts                 # all scenarios
 *   node scripts/fixtures/capture.ts swap a-to-b     # selected scenarios
 *
 * Env:
 *   FIXTURE_RPC_URL  override the RPC endpoint (written as "custom" in manifests)
 *
 * Output: fixtures/solana/<scenario-id>/{manifest.json,rpc.json}
 * See fixtures/README.md for the format and replay matching rule.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as ScenariosModule from "./scenarios";
import type { AddressDef, RangeDef, ScenarioDef } from "./scenarios";

// Node needs the explicit `.ts` extension, while the repo tsconfig forbids it in
// static imports; load at runtime and keep the static types.
const { SCENARIOS } = (await import(
  new URL("./scenarios.ts", import.meta.url).href
)) as typeof ScenariosModule;

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const RPC_URL = process.env.FIXTURE_RPC_URL || PUBLIC_RPC;
const RPC_LABEL = process.env.FIXTURE_RPC_URL ? "custom" : "public mainnet-beta";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const PAGE_LIMIT = 1000;
const MAX_IN_RANGE_PER_WALLET = 300;
const MIN_INTERVAL_MS = 250; // ~4 req/s
const MAX_RETRIES = 8;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_ROOT = join(REPO_ROOT, "fixtures", "solana");

// ---------------------------------------------------------------------------
// Minimal JSON-RPC shapes (only what the capture needs)

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type RpcError = { code: number; message: string; data?: Json };
type RpcResponse = { result: Json } | { error: RpcError };
type RecordedCall = { request: { method: string; params: Json[] }; response: RpcResponse };

type SignatureInfo = {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: Json;
  memo: string | null;
  confirmationStatus?: string;
};

type TokenBalance = { accountIndex: number; mint: string; owner?: string; programId?: string };
type AccountKey = { pubkey: string; signer: boolean; writable: boolean; source?: string };
type ParsedTx = {
  slot: number;
  blockTime: number | null;
  version?: "legacy" | number;
  meta: {
    err: Json;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
  transaction: { signatures: string[]; message: { accountKeys: AccountKey[] } };
};

// ---------------------------------------------------------------------------
// Throttled transport with retry

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawRpc(method: string, params: Json[]): Promise<RpcResponse> {
  let attempt = 0;
  for (;;) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let retryable = false;
    let detail = "";
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429 || res.status >= 500) {
        retryable = true;
        detail = `HTTP ${res.status}`;
      } else {
        const body = (await res.json()) as { result?: Json; error?: RpcError };
        if (body.error) {
          // -32429: rate limited; -32005: node behind. Everything else is recorded.
          if (body.error.code === -32429 || body.error.code === -32005) {
            retryable = true;
            detail = `RPC ${body.error.code} ${body.error.message}`;
          } else {
            return { error: body.error };
          }
        } else if ("result" in body) {
          return { result: body.result as Json };
        } else {
          throw new Error(`Malformed JSON-RPC response for ${method}`);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Malformed")) throw e;
      retryable = true;
      detail = e instanceof Error ? e.message : String(e);
    }
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`${method} failed after ${attempt + 1} attempts: ${detail}`);
    }
    const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
    console.warn(`  ${method}: ${detail}; retrying in ${backoff}ms`);
    await sleep(backoff);
    attempt++;
  }
}

/**
 * Records every unique (method, params) call in capture order. Identical calls
 * are served from memory and recorded once, so replay stays unambiguous.
 */
function createRecorder() {
  const calls: RecordedCall[] = [];
  const cache = new Map<string, RpcResponse>();
  async function call(method: string, params: Json[]): Promise<RpcResponse> {
    const key = JSON.stringify([method, params]);
    const hit = cache.get(key);
    if (hit) return hit;
    const response = await rawRpc(method, params);
    cache.set(key, response);
    calls.push({ request: { method, params }, response });
    return response;
  }
  return { calls, call };
}
type Recorder = ReturnType<typeof createRecorder>;

function unwrap<T>(res: RpcResponse, what: string): T {
  if ("error" in res) throw new Error(`${what}: RPC error ${res.error.code} ${res.error.message}`);
  return res.result as unknown as T;
}

// ---------------------------------------------------------------------------
// Canonical request params (must match what the app sends)

const txParams = (sig: string): Json[] => [
  sig,
  { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
];
const sigParams = (address: string, before?: string): Json[] => [
  address,
  before
    ? { limit: PAGE_LIMIT, commitment: "finalized", before }
    : { limit: PAGE_LIMIT, commitment: "finalized" },
];
const tokenAccountsParams = (owner: string, programId: string): Json[] => [
  owner,
  { programId },
  { encoding: "jsonParsed", commitment: "finalized" },
];

async function getTx(rec: Recorder, sig: string): Promise<ParsedTx | null> {
  return unwrap<ParsedTx | null>(await rec.call("getTransaction", txParams(sig)), `getTransaction ${sig}`);
}

// ---------------------------------------------------------------------------
// Helpers

const iso = (unix: number) => new Date(unix * 1000).toISOString();

function tokenAccountsOwnedBy(tx: ParsedTx, owner: string): string[] {
  const keys = tx.transaction.message.accountKeys;
  const out = new Set<string>();
  for (const b of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    if (b.owner === owner && keys[b.accountIndex]) out.add(keys[b.accountIndex].pubkey);
  }
  return [...out];
}

async function resolveAddress(rec: Recorder, def: AddressDef): Promise<{ address: string; note?: string }> {
  if (typeof def === "string") return { address: def };
  const tx = await getTx(rec, def.resolveFromTx);
  if (!tx) throw new Error(`Cannot resolve ${def.prefix}…${def.suffix}: tx ${def.resolveFromTx} not found`);
  const candidates = new Set<string>();
  for (const k of tx.transaction.message.accountKeys) candidates.add(k.pubkey);
  for (const b of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    if (b.owner) candidates.add(b.owner);
  }
  const matches = [...candidates].filter((a) => a.startsWith(def.prefix) && a.endsWith(def.suffix));
  if (matches.length !== 1) {
    throw new Error(`Resolving ${def.prefix}…${def.suffix}: expected 1 match, got ${matches.length}`);
  }
  return {
    address: matches[0],
    note: `Address ${def.prefix}…${def.suffix} resolved to ${matches[0]} from the account keys of ${def.resolveFromTx}.`,
  };
}

async function resolveRange(rec: Recorder, def: RangeDef): Promise<{ start: number; end: number; anchorSlot?: number }> {
  if ("start" in def) {
    return { start: Date.parse(def.start) / 1000, end: Date.parse(def.end) / 1000 };
  }
  const tx = await getTx(rec, def.anchorSignature);
  if (!tx || tx.blockTime == null) throw new Error(`Anchor ${def.anchorSignature} missing or has no blockTime`);
  return {
    start: tx.blockTime - def.beforeMinutes * 60,
    end: tx.blockTime + def.afterMinutes * 60,
    anchorSlot: tx.slot,
  };
}

/**
 * Find a signature involving `address` with blockTime strictly after `end`, by
 * scanning blocks forward from an estimated slot. These getBlock/getBlocks
 * calls are NOT recorded (the app never makes them).
 */
async function findCursorByBlockScan(address: string, end: number, refSlot: number, refTime: number): Promise<string> {
  let slot = refSlot + Math.max(0, Math.ceil((end - refTime) / 0.4));
  // Nudge forward until the block time is past `end`.
  for (let i = 0; i < 20; i++) {
    const bt = await rawRpc("getBlockTime", [slot]);
    if ("result" in bt && typeof bt.result === "number" && bt.result > end) break;
    slot += 50;
  }
  for (let window = 0; window < 10; window++) {
    const slots = unwrap<number[]>(await rawRpc("getBlocks", [slot, slot + 99]), "getBlocks");
    for (const s of slots) {
      const blk = await rawRpc("getBlock", [
        s,
        { transactionDetails: "accounts", maxSupportedTransactionVersion: 0, rewards: false, encoding: "json" },
      ]);
      if ("error" in blk || !blk.result) continue;
      const block = blk.result as unknown as {
        blockTime: number | null;
        transactions: { transaction: { signatures: string[]; accountKeys: { pubkey: string }[] } }[];
      };
      if (block.blockTime == null || block.blockTime <= end) continue;
      const hit = block.transactions.find((t) => t.transaction.accountKeys.some((k) => k.pubkey === address));
      if (hit) {
        console.log(`  block-scan cursor for ${address}: slot ${s} (${iso(block.blockTime)})`);
        return hit.transaction.signatures[0];
      }
    }
    slot += 100;
  }
  throw new Error(`block-scan: no transaction for ${address} found after ${iso(end)}`);
}

type PageWalk = { all: SignatureInfo[]; pages: number; exhausted: boolean };

/** Paginate getSignaturesForAddress until older than `start` or exhausted. */
async function walkSignatures(rec: Recorder, address: string, start: number, firstBefore?: string): Promise<PageWalk> {
  const all: SignatureInfo[] = [];
  let before = firstBefore;
  let pages = 0;
  for (;;) {
    const page = unwrap<SignatureInfo[]>(
      await rec.call("getSignaturesForAddress", sigParams(address, before)),
      `getSignaturesForAddress ${address}`,
    );
    pages++;
    all.push(...page);
    if (page.length < PAGE_LIMIT) return { all, pages, exhausted: true };
    const last = page[page.length - 1];
    if (last.blockTime != null && last.blockTime < start) return { all, pages, exhausted: false };
    before = last.signature;
    if (pages % 10 === 0) console.log(`  ${address}: ${pages} pages, at ${last.blockTime ? iso(last.blockTime) : "?"}`);
  }
}

// ---------------------------------------------------------------------------
// Scenario capture

type ManifestWallet = { address: string; role: string; label: string };

async function captureScenario(def: ScenarioDef) {
  console.log(`\n== ${def.id}`);
  const rec = createRecorder();
  const notes: string[] = [...def.notes];

  const range = await resolveRange(rec, def.range);

  const byKey = new Map<string, string>();
  const wallets: ManifestWallet[] = [];
  for (const w of def.wallets) {
    const { address, note } = await resolveAddress(rec, w.address);
    if (note) notes.push(note);
    byKey.set(w.key, address);
    wallets.push({ address, role: w.role, label: w.label });
  }

  const inRange = (s: SignatureInfo) => s.blockTime != null && s.blockTime >= range.start && s.blockTime <= range.end;

  const walletSigs = new Map<string, string[]>(); // address -> in-range sigs (newest first)
  const viaTokenAccount: { signature: string; wallet: string; tokenAccount: string }[] = [];
  const pagination: Record<string, { firstBefore: string; reason: string }> = {};
  const sigOrder: string[] = []; // unique in-range signatures in discovery order
  const sigSeen = new Set<string>();
  const addSig = (sig: string) => {
    if (!sigSeen.has(sig)) {
      sigSeen.add(sig);
      sigOrder.push(sig);
    }
  };

  const collectInRange = (address: string, walk: PageWalk, label: string): string[] => {
    const nullTime = walk.all.filter((s) => s.blockTime == null);
    if (nullTime.length) notes.push(`${label}: ${nullTime.length} signature(s) with null blockTime were excluded from the in-range set.`);
    let sigs = walk.all.filter(inRange).map((s) => s.signature);
    if (sigs.length > MAX_IN_RANGE_PER_WALLET) {
      notes.push(`${label}: safety cap hit — ${sigs.length} in-range signatures, kept the newest ${MAX_IN_RANGE_PER_WALLET}.`);
      sigs = sigs.slice(0, MAX_IN_RANGE_PER_WALLET);
    }
    const failed = walk.all.filter((s) => inRange(s) && s.err != null).length;
    console.log(`  ${label} ${address}: ${walk.pages} page(s), ${walk.all.length} sigs, ${sigs.length} in range${failed ? ` (${failed} failed)` : ""}`);
    return sigs;
  };

  // 1. Signatures per wallet
  for (const w of def.wallets) {
    const address = byKey.get(w.key)!;
    let firstBefore: string | undefined;
    if (w.startCursor === "block-scan") {
      if (range.anchorSlot == null || !("anchorSignature" in def.range)) {
        throw new Error(`${def.id}: block-scan needs an anchored range`);
      }
      const anchorTx = await getTx(rec, def.range.anchorSignature);
      firstBefore = await findCursorByBlockScan(address, range.end, range.anchorSlot, anchorTx!.blockTime!);
      pagination[address] = {
        firstBefore,
        reason:
          "Wallet is too busy to page back from the tip (~1000 signatures per 2 hours). The first recorded page starts at `before: firstBefore`, a signature of this wallet found just after range.end by block scan.",
      };
      notes.push(
        `${w.label} (${address}) is extremely busy: paging getSignaturesForAddress from the tip back to the range would take on the order of 1,000+ pages. The recording starts at a cursor just after range.end (see manifest.pagination); replay of this wallet requires starting with the same \`before\` cursor.`,
      );
    }
    const walk = await walkSignatures(rec, address, range.start, firstBefore);
    if (walk.exhausted && walk.all.length && walk.all[walk.all.length - 1].blockTime! > range.start) {
      notes.push(`${w.label}: history exhausted before range.start (oldest signature ${iso(walk.all[walk.all.length - 1].blockTime!)}).`);
    }
    const sigs = collectInRange(address, walk, w.label);
    walletSigs.set(address, sigs);
    sigs.forEach(addSig);
  }

  // 2. Transactions for every in-range signature
  const txs = new Map<string, ParsedTx | null>();
  const fetchAll = async () => {
    for (const sig of sigOrder) {
      if (!txs.has(sig)) txs.set(sig, await getTx(rec, sig));
    }
  };
  await fetchAll();

  // 3. Token-account coverage: txs that touch a wallet's token account (or are
  //    known to involve the wallet) but are absent from the wallet's own
  //    signature list.
  const scannedTokenAccounts = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const candidates: { sig: string; address: string; label: string }[] = [];
    for (const kt of def.knownTransactions) {
      if (!txs.has(kt.signature)) txs.set(kt.signature, await getTx(rec, kt.signature));
      for (const key of kt.wallets) {
        const address = byKey.get(key)!;
        candidates.push({ sig: kt.signature, address, label: def.wallets.find((w) => w.key === key)!.label });
      }
    }
    for (const [sig, tx] of txs) {
      if (!tx) continue;
      for (const w of def.wallets) {
        const address = byKey.get(w.key)!;
        if (tokenAccountsOwnedBy(tx, address).length) candidates.push({ sig, address, label: w.label });
      }
    }
    let added = 0;
    for (const c of candidates) {
      if (walletSigs.get(c.address)!.includes(c.sig)) continue;
      const tx = txs.get(c.sig);
      if (!tx) {
        notes.push(`Known transaction ${c.sig} was not returned by getTransaction.`);
        continue;
      }
      const tokenAccounts = tokenAccountsOwnedBy(tx, c.address);
      if (!tokenAccounts.length) {
        notes.push(`${c.sig} involves ${c.label} (${c.address}) but is missing from its signatures and touches no token account it owns.`);
        continue;
      }
      for (const ta of tokenAccounts) {
        if (scannedTokenAccounts.has(ta)) continue;
        scannedTokenAccounts.add(ta);
        const walk = await walkSignatures(rec, ta, range.start);
        const sigs = collectInRange(ta, walk, `${c.label} token account`);
        const list = walletSigs.get(c.address)!;
        for (const s of sigs) {
          if (list.includes(s)) continue;
          list.push(s);
          viaTokenAccount.push({ signature: s, wallet: c.address, tokenAccount: ta });
          addSig(s);
          added++;
        }
      }
      if (!walletSigs.get(c.address)!.includes(c.sig)) {
        notes.push(`${c.sig} (involving ${c.label}) is out of range or unreachable via ${c.label}'s token accounts.`);
      }
    }
    await fetchAll();
    if (!added) break;
  }
  for (const v of viaTokenAccount) {
    const label = wallets.find((w) => w.address === v.wallet)!.label;
    notes.push(
      `${v.signature} is NOT returned by getSignaturesForAddress(${label} ${v.wallet}); it is only reachable via the wallet's token account ${v.tokenAccount}.`,
    );
  }

  // 4. Token accounts per wallet
  for (const w of wallets) {
    for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const res = await rec.call("getTokenAccountsByOwner", tokenAccountsParams(w.address, program));
      if ("result" in res) {
        const value = (res.result as { value?: unknown[] }).value ?? [];
        console.log(`  token accounts ${w.label} ${program.slice(0, 8)}: ${value.length}`);
      }
    }
  }

  // 5. Observations worth surfacing
  const inRangeTxs = sigOrder.map((s) => txs.get(s)).filter((t): t is ParsedTx => !!t);
  const v0 = inRangeTxs.filter((t) => t.version === 0);
  const withLut = inRangeTxs.filter((t) => t.transaction.message.accountKeys.some((k) => k.source === "lookupTable"));
  const failed = inRangeTxs.filter((t) => t.meta?.err != null);
  const noTime = inRangeTxs.filter((t) => t.blockTime == null);
  const missing = sigOrder.filter((s) => !txs.get(s));
  if (v0.length) notes.push(`${v0.length} of ${inRangeTxs.length} transactions are version 0${withLut.length ? `; ${withLut.length} load accounts from address lookup tables (accountKeys entries with source "lookupTable")` : ""}.`);
  if (failed.length) notes.push(`${failed.length} in-range transaction(s) failed (meta.err != null).`);
  if (noTime.length) notes.push(`${noTime.length} transaction(s) returned null blockTime.`);
  if (missing.length) notes.push(`getTransaction returned null for: ${missing.join(", ")}.`);

  // 6. Expected
  const signaturesByWallet: Record<string, string[]> = {};
  for (const w of wallets) signaturesByWallet[w.address] = walletSigs.get(w.address)!;
  const sharedSignatures: { signature: string; wallets: string[] }[] = [];
  for (const sig of sigOrder) {
    const who = wallets.filter((w) => signaturesByWallet[w.address].includes(sig)).map((w) => w.address);
    if (who.length >= 2) sharedSignatures.push({ signature: sig, wallets: who });
  }
  for (const kt of def.knownTransactions) {
    if (kt.wallets.length >= 2 && !sharedSignatures.some((s) => s.signature === kt.signature)) {
      notes.push(`Expected shared transaction ${kt.signature} (${kt.description}) did not appear in all of: ${kt.wallets.join(", ")}.`);
    }
  }

  const manifest = {
    id: def.id,
    title: def.title,
    description: def.description,
    source: "mainnet-capture",
    capturedAt: new Date().toISOString(),
    rpc: RPC_LABEL,
    wallets,
    range: { start: iso(range.start), end: iso(range.end) },
    expected: {
      signaturesByWallet,
      sharedSignatures,
      transactionCount: sigOrder.length,
      ...(viaTokenAccount.length ? { signaturesOnlyViaTokenAccount: viaTokenAccount } : {}),
    },
    ...(Object.keys(pagination).length ? { pagination } : {}),
    knownTransactions: def.knownTransactions.map((k) => ({
      signature: k.signature,
      wallets: k.wallets.map((key) => byKey.get(key)!),
      description: k.description,
    })),
    notes,
  };

  const dir = join(OUT_ROOT, def.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(dir, "rpc.json"), JSON.stringify(rec.calls, null, 2) + "\n");
  console.log(`  wrote ${dir} (${rec.calls.length} calls, ${sigOrder.length} txs)`);
}

const wanted = process.argv.slice(2);
const selected = wanted.length ? SCENARIOS.filter((s) => wanted.includes(s.id)) : SCENARIOS;
if (wanted.length && selected.length !== wanted.length) {
  console.error(`Unknown scenario(s). Available: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
console.log(`RPC: ${RPC_LABEL}`);
for (const s of selected) await captureScenario(s);
