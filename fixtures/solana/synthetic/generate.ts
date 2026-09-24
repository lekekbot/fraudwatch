/**
 * Deterministic synthetic Solana fixtures.
 *
 * Every export here is a pure function of its inputs: a seeded PRNG drives all
 * choices, addresses are base58(sha256(seed)), signatures are
 * base58(sha512(seed)), and timestamps derive from fixed ISO constants — no
 * Math.random, no Date.now.
 *
 * The output has the same shape as the mainnet captures under
 * fixtures/solana/<id>/ — `{ manifest, rpc }`, where `rpc` is the ordered list
 * of `{ request, response }` JSON-RPC recordings (see fixtures/README.md).
 *
 * Simplifications versus mainnet (documented so tests don't over-trust them):
 * - Associated token account addresses are base58(sha256(...)) of a seed, not
 *   real PDA derivations.
 * - All token accounts exist before the scenario starts; incoming SPL transfers
 *   carry an `createIdempotent` instruction (as most wallets send), which puts
 *   the recipient wallet address into accountKeys, so getSignaturesForAddress on
 *   the wallet sees it. (The real-world "token-account-only" case is covered by
 *   the mainnet fixture of that name.)
 * - All transactions are legacy (no address lookup tables).
 */
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Encoding / identity helpers

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

/** 32-byte address: base58(sha256(seed)). */
export function syntheticAddress(seed: string): string {
  return base58Encode(createHash("sha256").update(seed).digest());
}

/** 64-byte signature: base58(sha512(seed)). */
export function syntheticSignature(seed: string): string {
  return base58Encode(createHash("sha512").update(seed).digest());
}

/** mulberry32 seeded from sha256(seed). Returns floats in [0, 1). */
export function createRng(seed: string): () => number {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Constants

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Fake second mint and fake swap program (not real mainnet accounts). */
export const FAKE_MINT = syntheticAddress("synthetic:mint:FAKE");
export const FAKE_SWAP_PROGRAM = syntheticAddress("synthetic:program:fake-swap");

const TOKEN_ACCOUNT_RENT = 2039280;
/** Lamports for well-known non-wallet accounts the first time they are touched. */
const INITIAL_LAMPORTS: Record<string, number> = {
  [SYSTEM_PROGRAM]: 1,
  [ATA_PROGRAM]: 1,
  [COMPUTE_BUDGET_PROGRAM]: 1,
  [TOKEN_PROGRAM]: 4_513_000_000,
  [FAKE_SWAP_PROGRAM]: 1_141_440,
  [USDC_MINT]: 400_000_000,
  [FAKE_MINT]: 1_461_600,
};
const PAGE_LIMIT = 1000;
const MINT_DECIMALS: Record<string, number> = { [USDC_MINT]: 6, [FAKE_MINT]: 5 };
// Anchor the synthetic slot clock near real mainnet: slot 425356378 was at
// 2026-06-09T15:39:29Z (the a-to-b capture), ~0.4s per slot.
const REF_SLOT = 425356378;
const REF_TIME = 1781019569;
const slotForTime = (t: number) => REF_SLOT + Math.round((t - REF_TIME) / 0.4);

// ---------------------------------------------------------------------------
// Output types (subset of the JSON-RPC shapes the app consumes)

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type RecordedCall = {
  request: { method: string; params: Json[] };
  response: { result: Json } | { error: { code: number; message: string } };
};
export type FixtureManifest = {
  id: string;
  title: string;
  description: string;
  source: "synthetic";
  rpc: "synthetic";
  wallets: { address: string; role: "primary" | "mapped"; label: string }[];
  range: { start: string; end: string };
  expected: {
    signaturesByWallet: Record<string, string[]>;
    sharedSignatures: { signature: string; wallets: string[] }[];
    transactionCount: number;
  };
  generator: { module: string; export: string; options: Record<string, Json> };
  notes: string[];
};
export type SyntheticFixture = { manifest: FixtureManifest; rpc: RecordedCall[] };

// ---------------------------------------------------------------------------
// Ledger + transaction builder

type Ledger = {
  lamports: Map<string, number>;
  /** token account -> { mint, owner, amount (raw units) } */
  tokens: Map<string, { mint: string; owner: string; amount: number }>;
};

const ataFor = (owner: string, mint: string) => syntheticAddress(`synthetic:ata:${owner}:${mint}`);

function openTokenAccount(ledger: Ledger, owner: string, mint: string, amount: number): string {
  const ata = ataFor(owner, mint);
  if (!ledger.tokens.has(ata)) {
    ledger.tokens.set(ata, { mint, owner, amount });
    ledger.lamports.set(ata, TOKEN_ACCOUNT_RENT);
  }
  return ata;
}

type Op =
  | { kind: "sol"; from: string; to: string; lamports: number }
  | {
      kind: "token";
      mint: string;
      from: string; // owner wallet (authority)
      to: string; // owner wallet
      amount: number; // raw units
      payer: string; // pays createIdempotent (no-op, ATA exists)
    }
  | {
      kind: "swap";
      user: string;
      pool: string; // pool authority
      inMint: string;
      inAmount: number;
      outMint: string;
      outAmount: number;
    };

type TxSpec = {
  seed: string;
  blockTime: number;
  slot: number;
  feePayer: string;
  signers: string[];
  ops: Op[];
  /** Compute budget: adds two ComputeBudget instructions and a priority fee. */
  priority?: { unitLimit: number; microLamports: number };
  /** If set, the instruction at this op index fails with the given custom error. */
  failAt?: { opIndex: number; custom: number; log: string };
};

type BuiltTx = {
  signature: string;
  slot: number;
  blockTime: number;
  err: Json;
  accounts: string[];
  result: Json;
};

function uiAmount(raw: number, decimals: number): { amount: string; decimals: number; uiAmount: number; uiAmountString: string } {
  const s = String(raw).padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  const uiAmountString = frac ? `${int}.${frac}` : int;
  return { amount: String(raw), decimals, uiAmount: Number(uiAmountString), uiAmountString };
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function u64le(n: number): number[] {
  const lo = n % 2 ** 32;
  const hi = Math.floor(n / 2 ** 32);
  return [...u32le(lo), ...u32le(hi)];
}

function buildTx(ledger: Ledger, spec: TxSpec): BuiltTx {
  const signature = syntheticSignature(spec.seed);
  // --- collect accounts with flags
  const flags = new Map<string, { signer: boolean; writable: boolean }>();
  const touch = (k: string, writable: boolean, signer = false) => {
    if (!ledger.lamports.has(k)) ledger.lamports.set(k, INITIAL_LAMPORTS[k] ?? 0);
    const f = flags.get(k) ?? { signer: false, writable: false };
    f.writable ||= writable;
    f.signer ||= signer;
    flags.set(k, f);
  };
  touch(spec.feePayer, true, true);
  for (const s of spec.signers) touch(s, true, true);
  if (spec.priority) touch(COMPUTE_BUDGET_PROGRAM, false);
  for (const op of spec.ops) {
    if (op.kind === "sol") {
      touch(op.from, true, true);
      touch(op.to, true);
      touch(SYSTEM_PROGRAM, false);
    } else if (op.kind === "token") {
      touch(ataFor(op.from, op.mint), true);
      touch(ataFor(op.to, op.mint), true);
      touch(op.to, false);
      touch(op.mint, false);
      touch(SYSTEM_PROGRAM, false);
      touch(ATA_PROGRAM, false);
      touch(TOKEN_PROGRAM, false);
    } else {
      touch(ataFor(op.user, op.inMint), true);
      touch(ataFor(op.user, op.outMint), true);
      touch(ataFor(op.pool, op.inMint), true);
      touch(ataFor(op.pool, op.outMint), true);
      touch(op.pool, false);
      touch(op.inMint, false);
      touch(op.outMint, false);
      touch(TOKEN_PROGRAM, false);
      touch(FAKE_SWAP_PROGRAM, false);
    }
  }
  const rank = (k: string) => {
    const f = flags.get(k)!;
    return f.signer ? (f.writable ? 0 : 1) : f.writable ? 2 : 3;
  };
  const keys = [...flags.keys()].sort((a, b) => {
    if (a === spec.feePayer) return -1;
    if (b === spec.feePayer) return 1;
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  const accountKeys: Json[] = keys.map((k) => ({
    pubkey: k,
    signer: flags.get(k)!.signer,
    source: "transaction",
    writable: flags.get(k)!.writable,
  }));

  // --- snapshots
  const tokenKeys = keys.filter((k) => ledger.tokens.has(k));
  const snapBalances = () => keys.map((k) => ledger.lamports.get(k)!);
  const snapTokens = (): Json[] =>
    tokenKeys.map((k) => {
      const t = ledger.tokens.get(k)!;
      return {
        accountIndex: keys.indexOf(k),
        mint: t.mint,
        owner: t.owner,
        programId: TOKEN_PROGRAM,
        uiTokenAmount: uiAmount(t.amount, MINT_DECIMALS[t.mint]),
      };
    });
  const preBalances = snapBalances();
  const preTokenBalances = snapTokens();

  // --- fee
  const signerCount = keys.filter((k) => flags.get(k)!.signer).length;
  const priorityFee = spec.priority ? Math.ceil((spec.priority.unitLimit * spec.priority.microLamports) / 1e6) : 0;
  const fee = 5000 * signerCount + priorityFee;
  const payerBal = ledger.lamports.get(spec.feePayer) ?? 0;
  if (payerBal < fee) throw new Error(`${spec.seed}: fee payer cannot pay fee`);
  ledger.lamports.set(spec.feePayer, payerBal - fee);

  // --- instructions, logs, state changes
  const instructions: Json[] = [];
  const innerInstructions: Json[] = [];
  const logs: string[] = [];
  let units = 0;
  if (spec.priority) {
    instructions.push(
      { accounts: [], data: base58Encode(Uint8Array.from([2, ...u32le(spec.priority.unitLimit)])), programId: COMPUTE_BUDGET_PROGRAM, stackHeight: 1 },
      { accounts: [], data: base58Encode(Uint8Array.from([3, ...u64le(spec.priority.microLamports)])), programId: COMPUTE_BUDGET_PROGRAM, stackHeight: 1 },
    );
    for (let i = 0; i < 2; i++) logs.push(`Program ${COMPUTE_BUDGET_PROGRAM} invoke [1]`, `Program ${COMPUTE_BUDGET_PROGRAM} success`);
    units += 300;
  }
  // State changes are applied to a scratch copy and committed only on success.
  const scratchLamports = new Map(ledger.lamports);
  const scratchTokens = new Map([...ledger.tokens].map(([k, v]) => [k, { ...v }]));
  let err: Json = null;
  const transferToken = (fromAta: string, toAta: string, amount: number) => {
    const a = scratchTokens.get(fromAta)!;
    const b = scratchTokens.get(toAta)!;
    if (a.amount < amount) throw new Error(`${spec.seed}: insufficient token balance in ${fromAta}`);
    a.amount -= amount;
    b.amount += amount;
  };
  for (let i = 0; i < spec.ops.length && err == null; i++) {
    const op = spec.ops[i];
    const failing = spec.failAt?.opIndex === i;
    if (op.kind === "sol") {
      instructions.push({
        parsed: { info: { destination: op.to, lamports: op.lamports, source: op.from }, type: "transfer" },
        program: "system",
        programId: SYSTEM_PROGRAM,
        stackHeight: 1,
      });
      logs.push(`Program ${SYSTEM_PROGRAM} invoke [1]`);
      units += 150;
      if (failing) {
        logs.push(`Transfer: insufficient lamports`, `Program ${SYSTEM_PROGRAM} failed: custom program error: 0x1`);
      } else {
        const bal = scratchLamports.get(op.from) ?? 0;
        if (bal < op.lamports) throw new Error(`${spec.seed}: insufficient lamports`);
        scratchLamports.set(op.from, bal - op.lamports);
        scratchLamports.set(op.to, (scratchLamports.get(op.to) ?? 0) + op.lamports);
        logs.push(`Program ${SYSTEM_PROGRAM} success`);
      }
    } else if (op.kind === "token") {
      const fromAta = ataFor(op.from, op.mint);
      const toAta = ataFor(op.to, op.mint);
      instructions.push({
        parsed: {
          info: { account: toAta, mint: op.mint, source: op.payer, systemProgram: SYSTEM_PROGRAM, tokenProgram: TOKEN_PROGRAM, wallet: op.to },
          type: "createIdempotent",
        },
        program: "spl-associated-token-account",
        programId: ATA_PROGRAM,
        stackHeight: 1,
      });
      logs.push(`Program ${ATA_PROGRAM} invoke [1]`, "Program log: CreateIdempotent", `Program ${ATA_PROGRAM} consumed 4338 of 200000 compute units`, `Program ${ATA_PROGRAM} success`);
      instructions.push({
        parsed: {
          info: { authority: op.from, destination: toAta, mint: op.mint, source: fromAta, tokenAmount: uiAmount(op.amount, MINT_DECIMALS[op.mint]) },
          type: "transferChecked",
        },
        program: "spl-token",
        programId: TOKEN_PROGRAM,
        stackHeight: 1,
      });
      logs.push(`Program ${TOKEN_PROGRAM} invoke [1]`, "Program log: Instruction: TransferChecked");
      units += 4338 + 6200;
      if (failing) {
        logs.push("Program log: Error: insufficient funds", `Program ${TOKEN_PROGRAM} consumed 4300 of 195662 compute units`, `Program ${TOKEN_PROGRAM} failed: custom program error: 0x1`);
      } else {
        transferToken(fromAta, toAta, op.amount);
        logs.push(`Program ${TOKEN_PROGRAM} consumed 6200 of 195662 compute units`, `Program ${TOKEN_PROGRAM} success`);
      }
    } else {
      const userIn = ataFor(op.user, op.inMint);
      const userOut = ataFor(op.user, op.outMint);
      const poolIn = ataFor(op.pool, op.inMint);
      const poolOut = ataFor(op.pool, op.outMint);
      const outerIndex = instructions.length;
      instructions.push({
        accounts: [op.user, userIn, userOut, poolIn, poolOut, op.pool, op.inMint, op.outMint, TOKEN_PROGRAM],
        data: base58Encode(Uint8Array.from([0xf8, 0xc6, ...u64le(op.inAmount), ...u64le(op.outAmount)])),
        programId: FAKE_SWAP_PROGRAM,
        stackHeight: 1,
      });
      logs.push(`Program ${FAKE_SWAP_PROGRAM} invoke [1]`, "Program log: Instruction: Swap");
      units += 42000;
      if (failing) {
        logs.push(`Program log: ${spec.failAt!.log}`, `Program ${FAKE_SWAP_PROGRAM} failed: custom program error: 0x${spec.failAt!.custom.toString(16)}`);
      } else {
        transferToken(userIn, poolIn, op.inAmount);
        transferToken(poolOut, userOut, op.outAmount);
        innerInstructions.push({
          index: outerIndex,
          instructions: [
            {
              parsed: { info: { authority: op.user, destination: poolIn, mint: op.inMint, source: userIn, tokenAmount: uiAmount(op.inAmount, MINT_DECIMALS[op.inMint]) }, type: "transferChecked" },
              program: "spl-token",
              programId: TOKEN_PROGRAM,
              stackHeight: 2,
            },
            {
              parsed: { info: { authority: op.pool, destination: userOut, mint: op.outMint, source: poolOut, tokenAmount: uiAmount(op.outAmount, MINT_DECIMALS[op.outMint]) }, type: "transferChecked" },
              program: "spl-token",
              programId: TOKEN_PROGRAM,
              stackHeight: 2,
            },
          ],
        });
        logs.push(
          `Program ${TOKEN_PROGRAM} invoke [2]`, "Program log: Instruction: TransferChecked", `Program ${TOKEN_PROGRAM} success`,
          `Program ${TOKEN_PROGRAM} invoke [2]`, "Program log: Instruction: TransferChecked", `Program ${TOKEN_PROGRAM} success`,
          `Program ${FAKE_SWAP_PROGRAM} consumed 42000 of 200000 compute units`, `Program ${FAKE_SWAP_PROGRAM} success`,
        );
      }
    }
    if (failing) {
      const instructionIndex = instructions.length - 1;
      err = { InstructionError: [instructionIndex, { Custom: spec.failAt!.custom }] };
    }
  }
  if (err == null) {
    // Commit. (The fee was debited before the scratch copy was taken; a failed
    // transaction therefore keeps the fee debit and nothing else.)
    for (const [k, v] of scratchLamports) ledger.lamports.set(k, v);
    for (const [k, v] of scratchTokens) ledger.tokens.set(k, v);
  }

  const postBalances = snapBalances();
  const postTokenBalances = snapTokens();
  const accounts = keys;

  const result: Json = {
    blockTime: spec.blockTime,
    meta: {
      computeUnitsConsumed: units,
      costUnits: units + 1500 + 720 * signerCount,
      err,
      fee,
      innerInstructions,
      logMessages: logs,
      postBalances,
      postTokenBalances,
      preBalances,
      preTokenBalances,
      rewards: [],
      status: err == null ? { Ok: null } : { Err: err },
    },
    slot: spec.slot,
    transaction: {
      message: {
        accountKeys,
        instructions,
        recentBlockhash: syntheticAddress(`synthetic:blockhash:${spec.slot - 20}`),
      },
      signatures: keys.filter((k) => flags.get(k)!.signer).map((k, i) => (i === 0 ? signature : syntheticSignature(`${spec.seed}:cosig:${k}`))),
    },
    version: "legacy",
  };
  return { signature, slot: spec.slot, blockTime: spec.blockTime, err, accounts, result };
}

// ---------------------------------------------------------------------------
// RPC recording assembly (mirrors scripts/fixtures/capture.ts)

type WalletSpec = { address: string; role: "primary" | "mapped"; label: string };

function assembleRpc(
  txs: BuiltTx[], // chronological
  wallets: WalletSpec[],
  ledger: Ledger,
  range: { start: number; end: number },
  contextSlot: number,
): { rpc: RecordedCall[]; signaturesByWallet: Record<string, string[]>; order: string[] } {
  const rpc: RecordedCall[] = [];
  const newestFirst = [...txs].reverse();
  const slotIndex = new Map<number, number>();
  const txIndex = new Map<string, number>();
  for (const t of txs) {
    const n = slotIndex.get(t.slot) ?? 0;
    txIndex.set(t.signature, 100 + n * 7);
    slotIndex.set(t.slot, n + 1);
  }
  const signaturesByWallet: Record<string, string[]> = {};
  const order: string[] = [];
  const seen = new Set<string>();
  for (const w of wallets) {
    const mine = newestFirst.filter((t) => t.accounts.includes(w.address));
    let before: string | undefined;
    let offset = 0;
    for (;;) {
      const page = mine.slice(offset, offset + PAGE_LIMIT);
      const params: Json[] = [
        w.address,
        before ? { limit: PAGE_LIMIT, commitment: "finalized", before } : { limit: PAGE_LIMIT, commitment: "finalized" },
      ];
      rpc.push({
        request: { method: "getSignaturesForAddress", params },
        response: {
          result: page.map((t) => ({
            blockTime: t.blockTime,
            confirmationStatus: "finalized",
            err: t.err,
            memo: null,
            signature: t.signature,
            slot: t.slot,
            transactionIndex: txIndex.get(t.signature)!,
          })),
        },
      });
      offset += page.length;
      if (page.length < PAGE_LIMIT) break;
      const last = page[page.length - 1];
      if (last.blockTime < range.start) break;
      before = last.signature;
    }
    const inRange = mine.filter((t) => t.blockTime >= range.start && t.blockTime <= range.end).map((t) => t.signature);
    signaturesByWallet[w.address] = inRange;
    for (const s of inRange) {
      if (seen.has(s)) continue;
      seen.add(s);
      order.push(s);
    }
  }
  const bySig = new Map(txs.map((t) => [t.signature, t]));
  for (const s of order) {
    rpc.push({
      request: { method: "getTransaction", params: [s, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }] },
      response: { result: bySig.get(s)!.result },
    });
  }
  for (const w of wallets) {
    for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const value: Json[] =
        program === TOKEN_PROGRAM
          ? [...ledger.tokens]
              .filter(([, t]) => t.owner === w.address)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([pubkey, t]) => ({
                account: {
                  data: {
                    parsed: {
                      info: { isNative: false, mint: t.mint, owner: t.owner, state: "initialized", tokenAmount: uiAmount(t.amount, MINT_DECIMALS[t.mint]) },
                      type: "account",
                    },
                    program: "spl-token",
                    space: 165,
                  },
                  executable: false,
                  lamports: ledger.lamports.get(pubkey) ?? TOKEN_ACCOUNT_RENT,
                  owner: TOKEN_PROGRAM,
                  rentEpoch: 18446744073709552000,
                  space: 165,
                },
                pubkey,
              }))
          : [];
      rpc.push({
        request: { method: "getTokenAccountsByOwner", params: [w.address, { programId: program }, { encoding: "jsonParsed", commitment: "finalized" }] },
        response: { result: { context: { apiVersion: "synthetic", slot: contextSlot }, value } },
      });
    }
  }
  return { rpc, signaturesByWallet, order };
}

function sharedFrom(order: string[], wallets: WalletSpec[], byWallet: Record<string, string[]>) {
  const out: { signature: string; wallets: string[] }[] = [];
  for (const s of order) {
    const who = wallets.filter((w) => byWallet[w.address].includes(s)).map((w) => w.address);
    if (who.length >= 2) out.push({ signature: s, wallets: who });
  }
  return out;
}

const toUnix = (iso: string) => Date.parse(iso) / 1000;
const toIso = (unix: number) => new Date(unix * 1000).toISOString();
const SOL = 1_000_000_000;
const USDC = 1_000_000;

// ---------------------------------------------------------------------------
// Scenario: loop-c-d-a

export type LoopOptions = { seed?: string };

/**
 * A → C (SOL), C → D (USDC), D → A (USDC): a loop back to A across three mapped
 * wallets, plus a fee-only failed transaction on D and one pre-range funding
 * transaction (A → C USDC) that pagination must see but `expected` excludes.
 */
export function generateLoopCDA(options: LoopOptions = {}): SyntheticFixture {
  const seed = options.seed ?? "loop-c-d-a";
  const id = "loop-c-d-a";
  const A = syntheticAddress(`${seed}:wallet:A`);
  const C = syntheticAddress(`${seed}:wallet:C`);
  const D = syntheticAddress(`${seed}:wallet:D`);
  const E = syntheticAddress(`${seed}:wallet:E-external`);
  const wallets: WalletSpec[] = [
    { address: A, role: "primary", label: "A (origin)" },
    { address: C, role: "mapped", label: "C (hop 1)" },
    { address: D, role: "mapped", label: "D (hop 2)" },
  ];
  const range = { start: toUnix("2026-08-01T00:00:00.000Z"), end: toUnix("2026-08-02T00:00:00.000Z") };

  const ledger: Ledger = { lamports: new Map(), tokens: new Map() };
  ledger.lamports.set(A, 25 * SOL);
  ledger.lamports.set(C, 12_000_000); // 0.012 SOL — needs A's SOL to act
  ledger.lamports.set(D, 5_000_000);
  ledger.lamports.set(E, 1 * SOL);
  openTokenAccount(ledger, A, USDC_MINT, 1_000 * USDC);
  openTokenAccount(ledger, C, USDC_MINT, 0);
  openTokenAccount(ledger, D, USDC_MINT, 0);
  openTokenAccount(ledger, E, USDC_MINT, 0);

  const pr = { unitLimit: 40_000, microLamports: 250_000 };
  const at = (iso: string) => {
    const t = toUnix(iso);
    return { blockTime: t, slot: slotForTime(t) };
  };
  const specs: TxSpec[] = [
    // Pre-range: A funds C with USDC (visible in pagination, excluded from expected).
    { seed: `${seed}:tx:0`, ...at("2026-07-30T14:05:11.000Z"), feePayer: A, signers: [A], priority: pr,
      ops: [{ kind: "token", mint: USDC_MINT, from: A, to: C, amount: 500 * USDC, payer: A }] },
    // 1. A -> C 2 SOL
    { seed: `${seed}:tx:1`, ...at("2026-08-01T08:00:07.000Z"), feePayer: A, signers: [A],
      ops: [{ kind: "sol", from: A, to: C, lamports: 2 * SOL }] },
    // 2. C -> D 150 USDC
    { seed: `${seed}:tx:2`, ...at("2026-08-01T09:30:42.000Z"), feePayer: C, signers: [C], priority: pr,
      ops: [{ kind: "token", mint: USDC_MINT, from: C, to: D, amount: 150 * USDC, payer: C }] },
    // 3. D fails: tries to send 1,000 USDC to an external address (insufficient funds). Fee only.
    { seed: `${seed}:tx:3`, ...at("2026-08-01T10:15:19.000Z"), feePayer: D, signers: [D], priority: pr,
      ops: [{ kind: "token", mint: USDC_MINT, from: D, to: E, amount: 1_000 * USDC, payer: D }],
      failAt: { opIndex: 0, custom: 1, log: "insufficient funds" } },
    // 4. D -> A 149.5 USDC (loop closes)
    { seed: `${seed}:tx:4`, ...at("2026-08-01T11:02:55.000Z"), feePayer: D, signers: [D], priority: pr,
      ops: [{ kind: "token", mint: USDC_MINT, from: D, to: A, amount: 149_500_000, payer: D }] },
  ];
  const txs = specs.map((s) => buildTx(ledger, s));
  const { rpc, signaturesByWallet, order } = assembleRpc(txs, wallets, ledger, range, slotForTime(toUnix("2026-08-03T00:00:00.000Z")));
  const sig = (i: number) => txs[i].signature;
  const manifest: FixtureManifest = {
    id,
    title: "C → D → A loop",
    description:
      "Three mapped wallets forming a loop: A sends 2 SOL to C, C sends 150 USDC to D, D sends 149.5 USDC back to A. D also has a fee-only failed transfer attempt to an external address.",
    source: "synthetic",
    rpc: "synthetic",
    wallets,
    range: { start: toIso(range.start), end: toIso(range.end) },
    expected: { signaturesByWallet, sharedSignatures: sharedFrom(order, wallets, signaturesByWallet), transactionCount: order.length },
    generator: { module: "fixtures/solana/synthetic/generate.ts", export: "generateLoopCDA", options: { seed } },
    notes: [
      `Chronology: ${sig(1)} A→C 2 SOL; ${sig(2)} C→D 150 USDC; ${sig(3)} D failed (err ${JSON.stringify(txs[3].err)}, fee only); ${sig(4)} D→A 149.5 USDC.`,
      `${sig(0)} (A→C 500 USDC, 2026-07-30) is before range.start: it appears in the recorded getSignaturesForAddress pages for A and C but not in expected and has no getTransaction recording.`,
      `The failed tx touches external address ${E} (observed, not mapped), so it is D-only and not shared.`,
      "C starts with 0.012 SOL; its USDC comes from the pre-range funding tx. D keeps 0.5 USDC (150 in, 149.5 out); all SOL movement besides A→C is fees.",
      "Synthetic: ATA addresses are sha256-derived, not real PDAs. All transactions are legacy.",
    ],
  };
  return { manifest, rpc };
}

// ---------------------------------------------------------------------------
// Scenario: high-activity

export type HighActivityOptions = {
  seed?: string;
  /** In-range transaction count (default 1000). */
  transactionCount?: number;
  /** Range length in days (default 90). */
  days?: number;
  /** Range start (default 2026-04-01T00:00:00Z). */
  start?: string;
};

/**
 * One wallet, `transactionCount` in-range transactions over `days` days with
 * bursty clustering, plus 3 transactions after range.end and 5 before
 * range.start (so pagination needs >= 2 pages at limit 1000 and must skip
 * out-of-range entries at both ends).
 */
export function generateHighActivity(options: HighActivityOptions = {}): SyntheticFixture {
  const seed = options.seed ?? "high-activity";
  const count = options.transactionCount ?? 1000;
  const days = options.days ?? 90;
  const startIso = options.start ?? "2026-04-01T00:00:00.000Z";
  const rng = createRng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

  const W = syntheticAddress(`${seed}:wallet:primary`);
  const counterparties = Array.from({ length: 24 }, (_, i) => syntheticAddress(`${seed}:counterparty:${i}`));
  const pool = syntheticAddress(`${seed}:pool:authority`);
  const wallets: WalletSpec[] = [{ address: W, role: "primary", label: "High-activity wallet" }];
  const range = { start: toUnix(startIso), end: toUnix(startIso) + days * 86400 - 1 };

  const ledger: Ledger = { lamports: new Map(), tokens: new Map() };
  ledger.lamports.set(W, 400 * SOL);
  openTokenAccount(ledger, W, USDC_MINT, 40_000 * USDC);
  openTokenAccount(ledger, W, FAKE_MINT, 0);
  for (const c of counterparties) {
    ledger.lamports.set(c, 5_000 * SOL);
    openTokenAccount(ledger, c, USDC_MINT, 2_000_000 * USDC);
  }
  ledger.lamports.set(pool, 10 * SOL);
  openTokenAccount(ledger, pool, USDC_MINT, 50_000_000 * USDC);
  openTokenAccount(ledger, pool, FAKE_MINT, 900_000_000 * 10 ** 5); // 900M FAKE

  // --- timestamps: bursty allocation of `count` txs across `days`
  const perDay = new Array<number>(days).fill(0);
  const burstDays = new Set<number>();
  while (burstDays.size < Math.min(8, days)) burstDays.add(int(0, days - 1));
  let remaining = count;
  for (const d of [...burstDays].sort((a, b) => a - b)) {
    const n = Math.min(remaining, int(40, 65));
    perDay[d] = n;
    remaining -= n;
  }
  const quietDays = Array.from({ length: days }, (_, d) => d).filter((d) => !burstDays.has(d));
  const weights = quietDays.map(() => (rng() < 0.25 ? 0 : rng() ** 2 * 10 + 0.5));
  const wsum = weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < remaining; k++) {
    let r = rng() * wsum;
    let i = 0;
    while (i < weights.length - 1 && r >= weights[i]) r -= weights[i++];
    perDay[quietDays[i]]++;
  }
  const times: number[] = [];
  for (let d = 0; d < days; d++) {
    const dayStart = range.start + d * 86400;
    if (burstDays.has(d)) {
      // Clustered inside 1-3 windows of ~40 minutes.
      const centers = Array.from({ length: int(1, 3) }, () => int(3600, 86400 - 7200));
      for (let k = 0; k < perDay[d]; k++) times.push(dayStart + centers[k % centers.length] + int(0, 2400));
    } else {
      for (let k = 0; k < perDay[d]; k++) times.push(dayStart + int(0, 86399));
    }
  }
  times.sort((a, b) => a - b);
  const before = [5, 4, 3, 2, 1].map((n) => range.start - n * 3 * 86400 + int(0, 3600));
  const after = [1, 2, 3].map((n) => range.end + n * 7200 + int(0, 600));
  const allTimes = [...before, ...times, ...after];

  // --- swap indices (a handful) and failure rate
  const swapIdx = new Set<number>();
  while (swapIdx.size < 12) swapIdx.add(before.length + int(0, count - 1));

  let lastSlot = 0;
  let solIn = 0, solOut = 0, usdcIn = 0, usdcOut = 0, swaps = 0, failed = 0;
  // Balances must be checked as we go so outgoing amounts never exceed funds;
  // build each tx immediately against the ledger.
  const built: BuiltTx[] = [];
  for (let i = 0; i < allTimes.length; i++) {
    const t = allTimes[i];
    const slot = Math.max(slotForTime(t), lastSlot + 1);
    lastSlot = slot;
    const txSeed = `${seed}:tx:${i}`;
    const cp = counterparties[int(0, counterparties.length - 1)];
    const pr = rng() < 0.7 ? { unitLimit: int(30_000, 200_000), microLamports: int(1_000, 500_000) } : undefined;
    // ~4.5% of wallet-initiated txs fail (~45% of txs) => ~2% overall.
    const fail = rng() < 0.045;
    const wSol = ledger.lamports.get(W)!;
    const wUsdc = ledger.tokens.get(ataFor(W, USDC_MINT))!.amount;
    const wFake = ledger.tokens.get(ataFor(W, FAKE_MINT))!.amount;
    let spec: TxSpec;
    if (swapIdx.has(i)) {
      const sellFake = wFake > 0 && rng() < 0.4;
      const inAmount = sellFake ? Math.floor(wFake * (0.3 + rng() * 0.7)) : int(20, 400) * USDC;
      // 1 USDC = 3,000 FAKE. Raw units: USDC 6 dp, FAKE 5 dp.
      const outAmount = sellFake ? Math.floor(inAmount / 300) : inAmount * 300;
      spec = {
        seed: txSeed, blockTime: t, slot, feePayer: W, signers: [W],
        priority: { unitLimit: 250_000, microLamports: int(10_000, 800_000) },
        ops: [sellFake
          ? { kind: "swap", user: W, pool, inMint: FAKE_MINT, inAmount, outMint: USDC_MINT, outAmount }
          : { kind: "swap", user: W, pool, inMint: USDC_MINT, inAmount, outMint: FAKE_MINT, outAmount }],
        ...(fail ? { failAt: { opIndex: 0, custom: 6001, log: "Error: slippage tolerance exceeded" } } : {}),
      };
      swaps++;
    } else {
      const r = rng();
      if (r < 0.36) {
        spec = { seed: txSeed, blockTime: t, slot, feePayer: cp, signers: [cp], priority: pr,
          ops: [{ kind: "sol", from: cp, to: W, lamports: int(1, 4000) * 1_000_000 }] };
        solIn++;
      } else if (r < 0.62 && wSol > 2 * SOL) {
        spec = { seed: txSeed, blockTime: t, slot, feePayer: W, signers: [W], priority: pr,
          ops: [{ kind: "sol", from: W, to: cp, lamports: Math.floor(wSol * 0.08 * rng()) + 1_000 }],
          ...(fail ? { failAt: { opIndex: 0, custom: 1, log: "insufficient lamports" } } : {}) };
        solOut++;
      } else if (r < 0.81) {
        spec = { seed: txSeed, blockTime: t, slot, feePayer: cp, signers: [cp], priority: pr,
          ops: [{ kind: "token", mint: USDC_MINT, from: cp, to: W, amount: int(5, 2500) * USDC + int(0, 999_999), payer: cp }] };
        usdcIn++;
      } else if (wUsdc >= USDC) {
        const amt = Math.max(1, Math.floor(wUsdc * 0.1 * rng()));
        spec = { seed: txSeed, blockTime: t, slot, feePayer: W, signers: [W], priority: pr,
          ops: [{ kind: "token", mint: USDC_MINT, from: W, to: cp, amount: amt, payer: W }],
          ...(fail ? { failAt: { opIndex: 0, custom: 1, log: "insufficient funds" } } : {}) };
        usdcOut++;
      } else {
        spec = { seed: txSeed, blockTime: t, slot, feePayer: cp, signers: [cp], priority: pr,
          ops: [{ kind: "sol", from: cp, to: W, lamports: int(1, 4000) * 1_000_000 }] };
        solIn++;
      }
      // Failures only on wallet-initiated txs (the wallet is fee payer); an
      // incoming failure would not affect the wallet except via noise.
    }
    if (spec.failAt) failed++;
    built.push(buildTx(ledger, spec));
  }

  const { rpc, signaturesByWallet, order } = assembleRpc(built, wallets, ledger, range, lastSlot + 5000);
  const inRangeFailed = built.filter((b) => b.err != null && b.blockTime >= range.start && b.blockTime <= range.end).length;
  const maxDay = Math.max(...perDay);
  const manifest: FixtureManifest = {
    id: "high-activity",
    title: "High-activity wallet",
    description: `One wallet with ${count} in-range transactions over ${days} days, bursty (max ${maxDay} txs in one day), mixing SOL and USDC transfers in/out, fake-program swaps between USDC and a fake mint, and ~2% failed transactions.`,
    source: "synthetic",
    rpc: "synthetic",
    wallets,
    range: { start: toIso(range.start), end: toIso(range.end) },
    expected: { signaturesByWallet, sharedSignatures: [], transactionCount: order.length },
    generator: {
      module: "fixtures/solana/synthetic/generate.ts",
      export: "generateHighActivity",
      options: { seed, transactionCount: count, days, start: startIso },
    },
    notes: [
      "rpc.json is intentionally NOT written to disk for this scenario (several MB). Tests must call generateHighActivity() from fixtures/solana/synthetic/generate.ts with the options above to obtain { manifest, rpc }.",
      `getSignaturesForAddress is recorded as ${rpc.filter((c) => c.request.method === "getSignaturesForAddress").length} pages (limit 1000); the first page starts with 3 transactions newer than range.end and the last page contains 5 transactions older than range.start.`,
      `Mix (all ${allTimes.length} generated): SOL in ${solIn}, SOL out ${solOut}, USDC in ${usdcIn}, USDC out ${usdcOut}, swaps ${swaps}; failed ${failed} (${inRangeFailed} in range, all wallet-initiated and fee-only).`,
      `Bursts: ${burstDays.size} days with 40+ transactions; ${perDay.filter((n) => n === 0).length} days with none.`,
      `Fake mint ${FAKE_MINT} (5 decimals) and fake swap program ${FAKE_SWAP_PROGRAM} are synthetic; swaps are unparsed outer instructions with two spl-token transferChecked inner instructions.`,
      "Balances are internally consistent: for the wallet, each transaction's postBalances/postTokenBalances equal the next transaction's pre values (per asset); fees are debited from the fee payer, including on failed transactions.",
    ],
  };
  return { manifest, rpc };
}

export const SYNTHETIC_GENERATORS = {
  "loop-c-d-a": generateLoopCDA,
  "high-activity": generateHighActivity,
} as const;
