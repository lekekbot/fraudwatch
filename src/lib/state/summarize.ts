import { NATIVE_SOL } from "@/lib/assets/assets";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { AssetChange, WalletTransactionEffect } from "./reconstruct";

/**
 * A plain-language reading of what one transaction did to one wallet, from its
 * balance changes alone. Protocol-aware labels (Sprint 06) refine this; they
 * never replace the observed deltas.
 */
export type EffectKind = "SEND" | "RECEIVE" | "SWAP" | "FEE" | "FAILED" | "OTHER";

export type ValueChange = { assetId: string; delta: string };

export type Counterparty = {
  /** Owner of the counterparty token account, or the account itself for SOL. */
  address: string;
  assetId: string;
  /** The counterparty's own delta; opposite in sign to the wallet's. */
  delta: string;
};

export type EffectSummary = {
  kind: EffectKind;
  /** Assets the wallet lost / gained, with SOL net of the fee it paid. */
  outflows: ValueChange[];
  inflows: ValueChange[];
  counterparties: Counterparty[];
};

const ZERO = BigInt(0);
const abs = (v: bigint) => (v < ZERO ? -v : v);

function valueChanges(effect: WalletTransactionEffect): ValueChange[] {
  const fee = BigInt(effect.feeLamports);
  return effect.assetChanges
    .map((c: AssetChange) => {
      // The fee is reported separately; don't let it read as a SOL transfer.
      const delta = c.assetId === NATIVE_SOL ? BigInt(c.delta) + fee : BigInt(c.delta);
      return { assetId: c.assetId, delta };
    })
    .filter((c) => c.delta !== ZERO)
    .map((c) => ({ assetId: c.assetId, delta: c.delta.toString() }));
}

function counterpartiesFor(wallet: string, tx: CanonicalTransaction, changes: ValueChange[]): Counterparty[] {
  const tokenAccounts = new Set(tx.tokenChanges.map((t) => t.account));
  const found: Array<Counterparty & { size: bigint }> = [];
  for (const change of changes) {
    const negative = change.delta.startsWith("-");
    const opposite = (delta: string) => delta !== "0" && delta.startsWith("-") !== negative;
    if (change.assetId === NATIVE_SOL) {
      for (const n of tx.nativeChanges) {
        // Token accounts move lamports for rent, not value.
        if (n.account === wallet || tokenAccounts.has(n.account) || !opposite(n.delta)) continue;
        found.push({ address: n.account, assetId: NATIVE_SOL, delta: n.delta, size: abs(BigInt(n.delta)) });
      }
    } else {
      for (const t of tx.tokenChanges) {
        if (t.mint !== change.assetId || t.owner === wallet || !opposite(t.delta)) continue;
        found.push({ address: t.owner ?? t.account, assetId: t.mint, delta: t.delta, size: abs(BigInt(t.delta)) });
      }
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => (b.size > a.size ? 1 : b.size < a.size ? -1 : 0))
    .filter((c) => {
      const key = `${c.address}:${c.assetId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ address, assetId, delta }) => ({ address, assetId, delta }));
}

export function summarizeEffect(effect: WalletTransactionEffect, tx: CanonicalTransaction | undefined): EffectSummary {
  const changes = valueChanges(effect);
  const outflows = changes.filter((c) => c.delta.startsWith("-"));
  const inflows = changes.filter((c) => !c.delta.startsWith("-"));
  const kind: EffectKind = !effect.success
    ? "FAILED"
    : outflows.length > 0 && inflows.length > 0
      ? "SWAP"
      : outflows.length > 0
        ? "SEND"
        : inflows.length > 0
          ? "RECEIVE"
          : effect.feeLamports !== "0"
            ? "FEE"
            : "OTHER";
  return { kind, outflows, inflows, counterparties: tx ? counterpartiesFor(effect.wallet, tx, changes) : [] };
}
