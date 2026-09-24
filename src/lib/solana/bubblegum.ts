import { getAddressDecoder, getBase58Encoder } from "@solana/kit";
import type { CanonicalInstruction, CanonicalTransaction } from "./canonical";

/**
 * Compressed NFTs (Metaplex Bubblegum) have no token accounts: ownership is a
 * leaf in a Merkle tree, and every change is logged through a no-op program as
 * a leaf-schema event carrying the asset id and its new owner. This decodes
 * those events, so cNFT mints and transfers can be read like token moves.
 */

export const BUBBLEGUM_PROGRAM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
/** Log wrappers Bubblegum emits leaf events through: SPL Noop (v1 trees) and MPL Noop (v2 trees). */
const NOOP_PROGRAMS = new Set(["noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV", "mnoopTCrg4p8ry25e4bcWA9XZjbNjMTfgYVGGEdRsf3"]);

/** Anchor discriminators: first 8 bytes of sha256("global:<name>"). */
const OPS = new Map<string, "transfer" | "transfer_v2" | "mint">([
  ["163,52,200,231,140,3,69,186", "transfer"],
  ["119,40,6,235,234,221,248,49", "transfer_v2"],
  ["145,98,192,118,184,147,118,104", "mint"], // mint_v1
  ["153,18,178,47,197,158,86,15", "mint"], // mint_to_collection_v1
  ["120,121,23,146,173,110,199,205", "mint"], // mint_v2
]);

export type CnftMove = {
  /** The cNFT's asset id (PDA of "asset", tree, leaf nonce). */
  assetId: string;
  /** Previous owner; null for a mint, or when a v2 transfer doesn't say. */
  from: string | null;
  to: string;
  kind: "mint" | "transfer";
  /** From the mint instruction's metadata, when this transaction minted it. */
  name?: string;
};

const bytesOf = (data: string | null): Uint8Array | null => {
  if (!data) return null;
  try {
    return Uint8Array.from(getBase58Encoder().encode(data));
  } catch {
    return null;
  }
};

/**
 * Leaf event layout, confirmed against mainnet v1 and v2 trees:
 * [1 = application data][0 = v1][u32 length] then [1 = leaf schema][version][schema tag]
 * [asset id 32][owner 32][delegate 32][nonce u64]…
 */
function leafEvent(bytes: Uint8Array): { assetId: string; owner: string } | null {
  if (bytes.length < 105 || bytes[0] !== 1 || bytes[1] !== 0 || bytes[6] !== 1) return null;
  const decoder = getAddressDecoder();
  return { assetId: decoder.decode(bytes.subarray(9, 41)), owner: decoder.decode(bytes.subarray(41, 73)) };
}

function mintName(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (length === 0 || length > 200 || 12 + length > bytes.length) return undefined;
  return new TextDecoder().decode(bytes.subarray(12, 12 + length)).replace(/\0+$/, "").trim() || undefined;
}

/** Every cNFT mint and transfer in a transaction, in execution order. */
export function cnftMoves(tx: CanonicalTransaction): CnftMove[] {
  // Execution order: each outer instruction, then the inner ones it invoked.
  const ordered: CanonicalInstruction[] = tx.instructions.flatMap((ix, i) => [ix, ...tx.innerInstructions.filter((inner) => inner.outerIndex === i)]);
  const signers = new Set(tx.accounts.filter((a) => a.signer).map((a) => a.address));
  const moves: CnftMove[] = [];
  let pending: { op: "transfer" | "transfer_v2" | "mint"; ix: CanonicalInstruction; bytes: Uint8Array } | null = null;
  for (const ix of ordered) {
    if (ix.programId === BUBBLEGUM_PROGRAM) {
      const bytes = bytesOf(ix.data);
      const op = bytes && bytes.length >= 8 ? OPS.get(Array.from(bytes.subarray(0, 8)).join(",")) : undefined;
      pending = op && bytes ? { op, ix, bytes } : null;
      continue;
    }
    if (!pending || !NOOP_PROGRAMS.has(ix.programId)) continue;
    const bytes = bytesOf(ix.data);
    const event = bytes && leafEvent(bytes);
    if (!event) continue;
    const { op, ix: source, bytes: args } = pending;
    pending = null;
    if (op === "mint") {
      moves.push({ assetId: event.assetId, from: null, to: event.owner, kind: "mint", name: mintName(args) });
    } else {
      // v1 transfer accounts: tree authority, leaf owner, leaf delegate, new owner, tree, …
      // v2's layout isn't relied on: the previous owner is the signer among its accounts, if one is.
      const from =
        op === "transfer"
          ? (source.accounts[1] ?? null)
          : (source.accounts.find((a) => signers.has(a) && a !== event.owner) ?? null);
      moves.push({ assetId: event.assetId, from, to: event.owner, kind: "transfer" });
    }
  }
  return moves;
}
