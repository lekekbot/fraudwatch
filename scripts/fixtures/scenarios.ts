/**
 * Mainnet capture scenario definitions for the Sprint 00 fixture set.
 *
 * Consumed by `scripts/fixtures/capture.ts`. Keep these definitions stable so
 * captures are reproducible: re-running the capture against the same range
 * should yield the same in-range signatures (history only grows at the tip).
 *
 * All data referenced here is public on-chain data from the prototype case.
 */

export type WalletRole = "primary" | "mapped";

/**
 * A wallet address is either known outright, or resolved from a transaction's
 * account keys by matching a truncated display form (`prefix…suffix`).
 */
export type AddressDef =
  | string
  | { resolveFromTx: string; prefix: string; suffix: string };

export type WalletDef = {
  /** Short stable key used by `knownTransactions` (e.g. "A", "B"). */
  key: string;
  address: AddressDef;
  role: WalletRole;
  label: string;
  /**
   * "tip" (default): paginate getSignaturesForAddress from the newest
   * signature, exactly as the app will.
   * "block-scan": the wallet is too busy to page back from the tip (hundreds
   * of thousands of signatures). The capture script scans blocks just after
   * range.end to find a signature of this wallet and starts pagination with
   * `before: <that signature>`. The cursor is recorded in the manifest.
   */
  startCursor?: "tip" | "block-scan";
};

export type RangeDef =
  | { start: string; end: string }
  | { anchorSignature: string; beforeMinutes: number; afterMinutes: number };

export type KnownTransaction = {
  signature: string;
  /** Wallet keys that should see this transaction. */
  wallets: string[];
  description: string;
};

export type ScenarioDef = {
  id: string;
  title: string;
  description: string;
  wallets: WalletDef[];
  range: RangeDef;
  knownTransactions: KnownTransaction[];
  notes: string[];
};

const DLM = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "simple-transfers",
    title: "One wallet / simple transfers",
    description:
      "Two-transaction passthrough wallet: receives 2,000 USDG (~2026-06-02 15:59 UTC) and forwards it (~2026-06-11 10:24 UTC).",
    wallets: [
      {
        key: "A",
        address: "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi",
        role: "primary",
        label: "USDG passthrough",
      },
    ],
    range: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-12T00:00:00.000Z" },
    knownTransactions: [],
    notes: [
      "USDG (mint 2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH) is a Token-2022 mint: the wallet's USDG account only shows up in the Token-2022 getTokenAccountsByOwner call (the classic Token program call returns nothing).",
      "Inbound 5aYfVHGs… (legacy tx) comes from the grant funding wallet fr6yQk… with an spl-memo and creates this wallet's ATA (rent paid by the sender).",
      "Outbound qcF4bqno… is a v0 transaction fee-paid by a relayer (2wjsaCA… signs as fee payer), so this wallet's SOL balance does not change; the 2,000 USDG goes to dLm61L… (the grant recipient used in other scenarios).",
    ],
  },
  {
    id: "swap",
    title: "One wallet / swap",
    description:
      "Primary wallet performing a USDG -> USDC swap through the OKX DEX router (v0 transaction with address lookup tables). Range is the swap's blockTime +/- 10 minutes.",
    wallets: [{ key: "A", address: DLM, role: "primary", label: "Grant recipient (dLm6)" }],
    range: {
      anchorSignature:
        "2LqaMocidaSMRqBnMXvjcXgo5gRUdBb7ecs5mzBNnmovgSUjprPW4zxD7iciSu6r3DnWkFX65MEP8MFvpeSqJhZe",
      beforeMinutes: 10,
      afterMinutes: 10,
    },
    knownTransactions: [
      {
        signature:
          "2LqaMocidaSMRqBnMXvjcXgo5gRUdBb7ecs5mzBNnmovgSUjprPW4zxD7iciSu6r3DnWkFX65MEP8MFvpeSqJhZe",
        wallets: ["A"],
        description: "OKX router swap USDG -> USDC",
      },
    ],
    notes: [
      "2LqaMoci… (the swap) is v0 and loads 16 accounts from address lookup tables; USDG 5,000 -> USDC 5,000.974921 via the OKX router program proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u, with a USDC fee leg to D9GYt4….",
      "3H3Rj6Ny… is a second OKX-router swap (v0, 43 lookup-table accounts): 15 USDC -> ~0.2176 SOL (native SOL delta on the wallet, wrapped SOL via intermediate pools).",
      "3f5n8Pxh… sends 200 USDC to 7Wpp33Dn5KKUFjaij4zKYy1XZ9kdBtHjUatAT6NcjjGt plus ~0.0058 SOL to two other accounts (3GN2xX…, 5VY91w…) through unrecognised programs (BULK2C…, L2TExM…).",
      "igbAv9qb… is third-party dust spam: BqdRyEU4aU9TfFoZ38bsShF5zkteW13TGQa3YDTquSMp sends 1 lamport to 18 addresses including this wallet. The wallet is not a signer; it should render as incoming noise, not a counterparty relationship.",
    ],
  },
  {
    id: "a-to-b",
    title: "A → B",
    description:
      "Direct token transfer from the grant funding wallet (A, very busy) to the grant recipient (B). Range is the transfer's blockTime +/- 5 minutes.",
    wallets: [
      {
        key: "A",
        address: "fr6yQkDmWy6R6pecbUsxXaw6EvRJznZ2HsK5frQgud8",
        role: "primary",
        label: "Grant funding wallet (fr6y)",
        startCursor: "block-scan",
      },
      { key: "B", address: DLM, role: "mapped", label: "Grant recipient (dLm6)" },
    ],
    range: {
      anchorSignature:
        "3yPC3i5NEh2kbU1PCmxEAQu74RFQ1ikTbLsetqdfU3uzsoiJ3UCo8RXiNQ3H7V8GgyVLcHdcnBPZQHDFptc9dkbG",
      beforeMinutes: 5,
      afterMinutes: 5,
    },
    knownTransactions: [
      {
        signature:
          "3yPC3i5NEh2kbU1PCmxEAQu74RFQ1ikTbLsetqdfU3uzsoiJ3UCo8RXiNQ3H7V8GgyVLcHdcnBPZQHDFptc9dkbG",
        wallets: ["A", "B"],
        description: "A -> B direct transfer (3,000 USDG, creates B's ATA)",
      },
    ],
    notes: [
      "Every in-range fr6y transaction carries an spl-memo instruction; fr6y behaves like a payout distributor (SOL system transfers plus USDG/USDC transferChecked, many creating recipient ATAs).",
      "3yPC3i5N… transfers 3,000 USDG (Token-2022) and creates B's USDG ATA 8Sgs9eE4H5Lmqae6eRWnNjvv9DmgU5V9rwXZ6R6FKtuP. B appears in the tx only as ATA owner/readonly account, yet getSignaturesForAddress(B) does return it.",
    ],
  },
  {
    id: "a-to-b-to-c",
    title: "A → B → C",
    description:
      "A sends 200 USDC to a short-lived intermediary B, which forwards 199.819667 USDC to C nine minutes later (gas-relayed) and closes its token account.",
    wallets: [
      { key: "A", address: DLM, role: "primary", label: "Grant recipient (dLm6)" },
      {
        key: "B",
        // Resolves to Ea3yxavbLEjgefLxvZLWtmXDMv3rbzfWrbtUSn9LB4ee
        address: {
          resolveFromTx:
            "4C2FSmimTs5XurB3jxYQKywZ6gTBRNCfLJonk6ySPHkcBcFAPNMcRg4vm3Ks7fKeL3xgWc7AmxnJuWwgp8LzNvjR",
          prefix: "Ea3yxav",
          suffix: "LB4ee",
        },
        role: "mapped",
        label: "Intermediary (Ea3y)",
      },
      {
        key: "C",
        address: "2hGUBZ7DFEdxAfturprijDLSQuG8byWijLZkUz5DE1An",
        role: "mapped",
        label: "Destination (2hGU)",
      },
    ],
    range: { start: "2026-07-30T08:40:00.000Z", end: "2026-07-30T09:10:00.000Z" },
    knownTransactions: [
      {
        signature:
          "4C2FSmimTs5XurB3jxYQKywZ6gTBRNCfLJonk6ySPHkcBcFAPNMcRg4vm3Ks7fKeL3xgWc7AmxnJuWwgp8LzNvjR",
        wallets: ["A", "B"],
        description: "A -> B 200 USDC",
      },
      {
        signature:
          "3PwsDsDBqMxL7HS41Q4Kn9iNk3hkn2R9ZGhW2hHVNuGcNPMNYH71nKr9WbAyJLKTGovQprqHhYvhmUdMZ1h7kA41",
        wallets: ["B", "C"],
        description: "B -> C 199.819667 USDC (fee paid by a gas relayer)",
      },
    ],
    notes: [
      "ADDRESS POISONING in range: 5sANhxg6… (08:50:36) sends 0.001 USDC to B from dLm6yzRBcha48dokvEP9oNyZvFrt7p1syauDeBMf5Vo, a lookalike of A (dLm6…f5Vo), 29s after the real A->B transfer. That is why B held 200.001 USDC before forwarding.",
      "ADDRESS POISONING in range: 34T9T6rt… (08:50:48) sends 0.001 USDC to A from Ea3Ru9KWxtpJGjMfvXqDDn6DqDe7v5x7gLbvkteHB4ee, and 3dtc1fxP… (08:50:48) sends 1,000 lamports to A from Ea12LDPUGLmd9b3EZaMnzv7vJmvnRgDxFvJHtwhvT4ee; both mimic B (Ea…4ee). They are not shared between mapped wallets and should not be treated as real flows.",
      "B (Ea3yxavbLEjgefLxvZLWtmXDMv3rbzfWrbtUSn9LB4ee) has exactly 3 signatures in its entire history, all in range, and getSignaturesForAddress on the wallet address returns all of them (no token-account fallback needed). getAccountInfo(B) returns null: the system account never held lamports (A paid the ATA rent, a relayer paid the forward's fee).",
      "B's USDC token account CzaKeRM7t9ysyuUGRRJVTu9iv17pSVpEgCyhREoDdFUs was NOT closed: getTokenAccountsByOwner(B) still returns it with a 0 balance. B 'ceased to exist' only in the sense that its system account does not exist.",
      "3PwsDsDB… is gas-relayed: gasCUPQ7LzQf3DZtG4wGZUsBDQxqshW6GpugQ94MTRy is fee payer, takes a 0.181513 USDC fee via a second transferChecked and pays C's ATA rent; B co-signs. C receives 199.819667 USDC.",
      "Outside this range, C's USDC token account 56emmenmWf3ZSSwnSfKzNAte8kb4FZbMfxEHGRUZsMuM has two transactions (2026-07-30 09:12:30 and 09:14:23) that getSignaturesForAddress(C) does NOT return — widening the range past 09:10 requires token-account coverage for C.",
    ],
  },
  {
    // Extra scenario (not in the Sprint 00 list) isolating the Sprint 02
    // token-account coverage problem with real data.
    id: "token-account-only",
    title: "A → B, visible to B only via its token account",
    description:
      "The simple-transfers passthrough wallet (A) forwards 2,000 USDG to B in a v0 transaction that references only B's USDG token account, not B itself. getSignaturesForAddress(B) misses it; getSignaturesForAddress(B's token account) finds it.",
    wallets: [
      {
        key: "A",
        address: "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi",
        role: "primary",
        label: "USDG passthrough",
      },
      { key: "B", address: DLM, role: "mapped", label: "Grant recipient (dLm6)" },
    ],
    range: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-12T00:00:00.000Z" },
    knownTransactions: [
      {
        signature:
          "qcF4bqnojcf44pXA6fDMfVGsFV6GdKnFa8z1TQXT6fN7PRkEenvCjrzyuxSCQXucei8SuLgtshe5wbwCHpW7YTp",
        wallets: ["A", "B"],
        description: "A -> B 2,000 USDG (Token-2022), relayer-paid, B's wallet address absent from account keys",
      },
    ],
    notes: [
      "B's USDG account 8Sgs9eE4H5Lmqae6eRWnNjvv9DmgU5V9rwXZ6R6FKtuP is a Token-2022 account: it is only discoverable via getTokenAccountsByOwner with the Token-2022 program id.",
    ],
  },
];
