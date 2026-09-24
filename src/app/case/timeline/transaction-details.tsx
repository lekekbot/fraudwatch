"use client";

import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, EyeOffIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { getDb } from "@/lib/db/db";
import { getRawTransaction } from "@/lib/db/transaction-cache";
import { NATIVE_SOL } from "@/lib/assets/assets";
import { formatLamports } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState, WalletTransactionEffect } from "@/lib/state/reconstruct";
import { describeAction, type EffectSummary } from "@/lib/state/summarize";
import { type Assets, assetLabel, formatAssetAmount, formatUtc } from "../asset-format";

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
}) {
  const format = (value: string, assetId: string, signed = false) => formatAssetAmount(value, assetId, state, assets, signed);

  return (
    <section className="flex min-w-0 flex-col gap-4 p-3" aria-label="Transaction details">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={summary.kind === "FAILED" ? "destructive" : "secondary"}>{summary.kind}</Badge>
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
          {describeAction(summary.action)}
        </dd>
        {summary.actor && (
          <>
            <dt className="text-muted-foreground">Sent by</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <a
                href={`https://solscan.io/account/${summary.actor}`}
                target="_blank"
                rel="noreferrer noopener"
                className="truncate font-mono text-xs underline-offset-4 hover:underline"
              >
                {shortenAddress(summary.actor, 6)}
              </a>
              <span className="text-xs text-muted-foreground">(not this wallet)</span>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Protocol</dt>
        <dd className="text-muted-foreground">Not identified yet</dd>
        <dt className="text-muted-foreground">Fee paid</dt>
        <dd className="tabular-nums">{effect.feeLamports === "0" ? "None (another account paid)" : formatLamports(effect.feeLamports)}</dd>
      </dl>

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
                <a
                  href={`https://solscan.io/account/${cp.address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-mono text-xs underline-offset-4 hover:underline"
                >
                  {shortenAddress(cp.address, 6)}
                </a>
                <span className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                  {format(cp.delta, cp.assetId, true)} {assetLabel(cp.assetId, assets)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

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
