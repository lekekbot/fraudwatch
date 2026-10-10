"use client";

import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, EyeOffIcon, StarIcon, WaypointsIcon, XIcon } from "lucide-react";
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
import type { BehaviorObservation } from "@/lib/behavior/observations";
import type { SemanticEvent } from "@/lib/semantic/events";
import { describeAction, type EffectSummary } from "@/lib/state/summarize";
import { type Assets, assetLabel, deltaClass, formatAssetAmount, formatUtc } from "../asset-format";
import { kindLabel } from "../filter-panel";
import { eventLabel } from "./event-card";
import { DebugDetails } from "./debug-details";
import { EventEvidence, EventSummary } from "./event-details";
import { BEHAVIOR_LABEL, observationSummary } from "./observation-details";
import { AddressButton, copy, Section } from "./inspector-ui";

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
  event,
  wallet,
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
  bookmarked,
  onToggleBookmark,
  onShowInGraph,
  observations = [],
}: {
  effect: WalletTransactionEffect;
  summary: EffectSummary;
  /** The transaction's semantic event; this lane's wallet decides how it's named. */
  event: SemanticEvent | undefined;
  wallet: string;
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
  bookmarked: boolean;
  onToggleBookmark: () => void;
  /** The Graph, narrowed to the wallets in this event. */
  onShowInGraph?: () => void;
  /** Behaviour observations this transaction is part of. */
  observations?: readonly BehaviorObservation[];
}) {
  const enrichment = tx ? enrichTransaction(tx) : null;
  const protocols = enrichment ? protocolsUsed(enrichment) : [];
  const format = (value: string, assetId: string, signed = false) => formatAssetAmount(value, assetId, state, assets, signed);

  return (
    <section className="flex min-w-0 flex-col gap-4 p-3" aria-label="Transaction details">
      {/* The buttons move to their own row when the panel is too narrow for both. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <Badge variant={summary.kind === "FAILED" ? "destructive" : "secondary"} className="min-w-0 truncate">
            {event ? eventLabel(event, wallet) : kindLabel(summary.kind)}
          </Badge>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {position.index + 1} / {position.count}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous transaction" onClick={onPrevious}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next transaction" onClick={onNext}>
            <ChevronRightIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark transaction"}
            aria-pressed={bookmarked}
            title={bookmarked ? "Remove bookmark" : "Bookmark transaction"}
            onClick={onToggleBookmark}
          >
            <StarIcon className={bookmarked ? "fill-current text-tone-approval" : undefined} />
          </Button>
          {onShowInGraph && (
            <Button variant="ghost" size="icon-sm" aria-label="Show in graph" title="Show the wallets in this event on the Graph" onClick={onShowInGraph}>
              <WaypointsIcon />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Hide from map" title="Hide from map" onClick={onHide}>
            <EyeOffIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      </div>

      {event && <EventSummary event={event} state={state} assets={assets} names={names} onSelectAddress={onSelectAddress} />}

      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {walletName && (
          <>
            <dt className="text-muted-foreground">Wallet</dt>
            <dd className="min-w-0 truncate font-medium">{walletName}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Signature</dt>
        <dd className="flex min-w-0 items-start gap-1">
          {/* In full: a signature cut short can't be checked by eye. */}
          <span className="min-w-0 font-mono text-xs break-all">{effect.signature}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy signature"
            onClick={() => copy(effect.signature, "Signature")}
          >
            <CopyIcon />
          </Button>
          <a
            href={`https://solscan.io/tx/${effect.signature}`}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open in explorer"
            title="Open in explorer (Solscan)"
            className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
          >
            <ExternalLinkIcon />
          </a>
        </dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd className="tabular-nums">{formatUtc(effect.timestamp)} UTC</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{effect.success ? "Success" : <span className="text-destructive">Failed</span>}</dd>
        <dt className="text-muted-foreground">Slot</dt>
        <dd className="tabular-nums">{effect.slot.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Action</dt>
        <dd className="min-w-0 font-mono text-xs break-words" title={summary.action?.programId}>
          {describeAction(summary.action, summary.action ? names.known(summary.action.programId) : undefined)}
        </dd>
        {summary.actor && (
          <>
            <dt className="text-muted-foreground">Sent by</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1">
              <AddressButton address={summary.actor} names={names} onSelect={onSelectAddress} />
              <span className="text-xs whitespace-nowrap text-muted-foreground">(not this wallet)</span>
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
                  <dd className={`text-right tabular-nums ${deltaClass(c.delta)}`}>{format(c.delta, c.assetId, true)}</dd>
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

      {event && (
        <EventEvidence
          event={event}
          tx={tx}
          state={state}
          assets={assets}
          names={names}
          onSelectAddress={onSelectAddress}
          observations={observations.map((o) => `◆ ${BEHAVIOR_LABEL[o.type]}: ${observationSummary(o, format, assets, names)}`)}
        />
      )}
      {event && <DebugDetails event={event} tx={tx} effect={effect} summary={summary} observations={observations} />}

      {tx && (
        <Section title="Raw">
          <Raw label={`Accounts (${tx.accounts.length})`} value={tx.accounts} />
          <Raw label={`Instructions (${tx.instructions.length} + ${tx.innerInstructions.length} inner)`} value={{ instructions: tx.instructions, inner: tx.innerInstructions }} />
          <RawJson tx={tx} />
        </Section>
      )}
    </section>
  );
}
