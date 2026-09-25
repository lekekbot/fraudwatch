"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, EyeOffIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { getDb } from "@/lib/db/db";
import { getRawTransaction } from "@/lib/db/transaction-cache";
import { NATIVE_SOL } from "@/lib/assets/assets";
import type { Names } from "@/lib/labels/labels";
import { enrichTransaction, protocolsUsed } from "@/lib/protocols/registry";
import { formatLamports } from "@/lib/solana/amount";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState, WalletTransactionEffect } from "@/lib/state/reconstruct";
import { describeAction, type EffectSummary, type RecipientRole } from "@/lib/state/summarize";
import { type Assets, assetLabel, formatAssetAmount, formatUtc } from "../asset-format";

const ROLE_TEXT: Record<RecipientRole, string> = {
  royalty: "Royalty",
  rent: "Rent (new account)",
  marketplace_fee: "Marketplace fee",
  unidentified: "Unidentified",
};

/** An address that opens in the inspector, where it can be labelled. */
function AddressButton({ address, names, onSelect }: { address: string; names: Names; onSelect: (address: string) => void }) {
  const known = names.known(address);
  return (
    <button
      type="button"
      title={address}
      onClick={() => onSelect(address)}
      className={`truncate text-left text-xs underline-offset-4 hover:underline ${known ? "" : "font-mono"}`}
    >
      {known ?? names.of(address, 6)}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Raw({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-2 py-1.5 text-xs">{label}</summary>
      <pre className="max-h-72 overflow-auto border-t p-2 text-[11px] leading-snug">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

/** Loads the raw RPC response on demand; cached transactions don't keep it in memory. */
function RawJson({ tx }: { tx: CanonicalTransaction }) {
  const [raw, setRaw] = useState<{ signature: string; value: unknown } | null>(null);
  useEffect(() => {
    if (tx.raw != null) return;
    let active = true;
    (async () => {
      try {
        const value = await getRawTransaction(getDb(), tx.signature);
        if (active) setRaw({ signature: tx.signature, value: value ?? null });
      } catch {
        if (active) setRaw({ signature: tx.signature, value: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [tx]);
  const value = tx.raw ?? (raw?.signature === tx.signature ? raw.value : undefined);
  if (value === undefined) return <p className="text-xs text-muted-foreground">Loading raw JSON…</p>;
  if (value === null) return <p className="text-xs text-muted-foreground">Raw response isn&apos;t cached for this transaction.</p>;
  return <Raw label="Raw JSON (RPC response)" value={value} />;
}

export function TransactionDetails({
  effect,
  summary,
  tx,
  state,
  assets,
  position,
  onPrevious,
  onNext,
  onClose,
  onHide,
  names,
  onSelectAddress,
  sharedWith,
  walletName,
}: {
  effect: WalletTransactionEffect;
  summary: EffectSummary;
  tx: CanonicalTransaction | undefined;
  state: WalletState;
  assets: Assets;
  position: { index: number; count: number };
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onHide: () => void;
  names: Names;
  onSelectAddress: (address: string) => void;
  /** Other mapped wallets that also have this transaction. */
  sharedWith: string[];
  /** With several lanes: whose side of the transaction this is. */
  walletName?: string;
}) {
  const enrichment = tx ? enrichTransaction(tx) : null;
  const protocols = enrichment ? protocolsUsed(enrichment) : [];
  const format = (value: string, assetId: string, signed = false) => formatAssetAmount(value, assetId, state, assets, signed);

  return (
    <section className="flex min-w-0 flex-col gap-4 p-3" aria-label="Transaction details">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={summary.kind === "FAILED" ? "destructive" : "secondary"}>{summary.kind.replace("_", " ")}</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {position.index + 1} / {position.count}
          </span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous transaction" onClick={onPrevious}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next transaction" onClick={onNext}>
            <ChevronRightIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Hide from map" title="Hide from map" onClick={onHide}>
            <EyeOffIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {walletName && (
          <>
            <dt className="text-muted-foreground">Wallet</dt>
            <dd className="min-w-0 truncate font-medium">{walletName}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Signature</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs">{effect.signature}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy signature"
            onClick={() => navigator.clipboard.writeText(effect.signature).then(() => toast.success("Signature copied."), () => {})}
          >
            <CopyIcon />
          </Button>
        </dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd className="tabular-nums">{formatUtc(effect.timestamp)} UTC</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{effect.success ? "Success" : <span className="text-destructive">Failed</span>}</dd>
        <dt className="text-muted-foreground">Slot</dt>
        <dd className="tabular-nums">{effect.slot.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Action</dt>
        <dd className="min-w-0 truncate font-mono text-xs" title={summary.action?.programId}>
          {describeAction(summary.action, summary.action ? names.known(summary.action.programId) : undefined)}
        </dd>
        {summary.actor && (
          <>
            <dt className="text-muted-foreground">Sent by</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <AddressButton address={summary.actor} names={names} onSelect={onSelectAddress} />
              <span className="text-xs text-muted-foreground">(not this wallet)</span>
            </dd>
          </>
        )}
        {sharedWith.length > 0 && (
          <>
            <dt className="text-muted-foreground">Shared with</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-2">
              {sharedWith.map((w) => (
                <AddressButton key={w} address={w} names={names} onSelect={onSelectAddress} />
              ))}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Protocol</dt>
        <dd className="min-w-0">
          {protocols.length > 0 ? (
            protocols.map((p) => p.name).join(", ")
          ) : (
            <span className="text-muted-foreground">{enrichment ? "None identified" : "Transaction not loaded"}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Fee paid</dt>
        <dd className="tabular-nums">{effect.feeLamports === "0" ? "None (another account paid)" : formatLamports(effect.feeLamports)}</dd>
      </dl>

      {summary.nft && (
        <Section title="NFT trade">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {(
              [
                ["Received", summary.nft.received],
                ["Sent", summary.nft.sent],
              ] as const
            ).map(
              ([label, mints]) =>
                mints.length > 0 && (
                  <Fragment key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="flex min-w-0 flex-col">
                      {mints.map((m) => (
                        <span key={m} className="truncate" title={m}>
                          {assetLabel(m, assets)}
                        </span>
                      ))}
                    </dd>
                  </Fragment>
                ),
            )}
            {summary.nft.payment && (
              <>
                <dt className="text-muted-foreground">
                  {summary.kind === "NFT_SELL" ? "Received" : summary.kind === "NFT_MINT" ? "Mint price" : "Paid"}
                </dt>
                <dd className="tabular-nums">
                  {format(summary.nft.payment.delta.replace("-", ""), summary.nft.payment.assetId)} {assetLabel(summary.nft.payment.assetId, assets)}
                </dd>
              </>
            )}
            {summary.nft.party && (
              <>
                <dt className="text-muted-foreground">
                  {summary.kind === "NFT_BUY" ? "Seller" : summary.kind === "NFT_SELL" ? "Buyer" : summary.kind === "NFT_MINT" ? "Paid to" : "Other side"}
                </dt>
                <dd className="min-w-0">
                  <AddressButton address={summary.nft.party} names={names} onSelect={onSelectAddress} />
                </dd>
              </>
            )}
            {summary.nft.marketplace && (
              <>
                <dt className="text-muted-foreground">Marketplace</dt>
                <dd className="min-w-0 truncate">{names.of(summary.nft.marketplace)}</dd>
              </>
            )}
          </dl>
          {summary.nft.payment && summary.nft.others.length > 0 && (
            <>
              <p className="pt-1 text-xs text-muted-foreground">
                Also paid in {assetLabel(summary.nft.payment.assetId, assets)}. Royalty: a creator in the NFT&apos;s
                metadata. Rent: an account created here. Unidentified: often a marketplace fee.
              </p>
              <ul className="flex flex-col gap-1">
                {summary.nft.others.slice(0, 6).map((o) => (
                  <li key={o.address} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <AddressButton address={o.address} names={names} onSelect={onSelectAddress} />
                      <span className="text-[10px] text-muted-foreground uppercase">{ROLE_TEXT[o.role]}</span>
                    </span>
                    <span className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                      {format(o.amount, summary.nft!.payment!.assetId)} {assetLabel(summary.nft!.payment!.assetId, assets)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      <Section title="Wallet before · change · after">
        {effect.assetChanges.length === 0 ? (
          <p className="text-xs text-muted-foreground">No balance of this wallet was touched.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {effect.assetChanges.map((c) => (
              <li key={c.assetId} className="py-1.5">
                <p className="text-sm font-medium" title={c.assetId}>
                  {assetLabel(c.assetId, assets)}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
                  <dt className="text-muted-foreground">Before</dt>
                  <dd className="text-right tabular-nums">{c.before ? format(c.before, c.assetId) : "—"}</dd>
                  <dt className="text-muted-foreground">Change</dt>
                  <dd
                    className={`text-right tabular-nums ${c.delta.startsWith("-") ? "text-destructive" : c.delta !== "0" ? "text-emerald-500" : "text-muted-foreground"}`}
                  >
                    {format(c.delta, c.assetId, true)}
                  </dd>
                  <dt className="text-muted-foreground">After</dt>
                  <dd className="text-right tabular-nums">{c.after ? format(c.after, c.assetId) : "—"}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
        {effect.feeLamports !== "0" && effect.assetChanges.some((c) => c.assetId === NATIVE_SOL) && (
          <p className="text-xs text-muted-foreground">The SOL change includes the {formatLamports(effect.feeLamports)} fee.</p>
        )}
      </Section>

      <Section title="Counterparties">
        {summary.counterparties.length === 0 ? (
          <p className="text-xs text-muted-foreground">No other account&apos;s balance moved against this wallet&apos;s.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {summary.counterparties.slice(0, 8).map((cp) => (
              <li key={`${cp.address}:${cp.assetId}`} className="flex items-center justify-between gap-2">
                <AddressButton address={cp.address} names={names} onSelect={onSelectAddress} />
                <span className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                  {format(cp.delta, cp.assetId, true)} {assetLabel(cp.assetId, assets)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {enrichment && enrichment.unknownPrograms.length > 0 && (
        <Section title="Unknown programs">
          <ul className="flex flex-col gap-1">
            {enrichment.unknownPrograms.map((programId) => (
              <li key={programId}>
                <AddressButton address={programId} names={names} onSelect={onSelectAddress} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Not in protocol registry v{enrichment.protocolRegistryVersion}. Name one yourself; it stays unknown to the
            registry.
          </p>
        </Section>
      )}

      {tx && (
        <Section title="Raw">
          <Raw label={`Accounts (${tx.accounts.length})`} value={tx.accounts} />
          <Raw label={`Instructions (${tx.instructions.length} + ${tx.innerInstructions.length} inner)`} value={{ instructions: tx.instructions, inner: tx.innerInstructions }} />
          <RawJson tx={tx} />
        </Section>
      )}

      <a
        href={`https://solscan.io/tx/${effect.signature}`}
        target="_blank"
        rel="noreferrer noopener"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <ExternalLinkIcon />
        Open in explorer
      </a>
    </section>
  );
}
