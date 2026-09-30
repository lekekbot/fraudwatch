"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MappedWalletConfig } from "@/lib/case/model";
import { type CaseRange, datesFromRange } from "@/lib/case/range";
import { cn } from "cn";
import { formatUtc } from "./asset-format";

export type MapWalletChoice = { rangeMode: MappedWalletConfig["rangeMode"]; start?: string };

/**
 * Confirms mapping a wallet and where its history should start. For an
 * observed address it defaults to its first interaction with the mapped
 * wallets. With `enterAddress` the user pastes any address instead (for a
 * wallet the map hasn't met yet).
 */
export function MapWalletDialog({
  name,
  first: givenFirst,
  enterAddress,
  caseRange,
  hasRpc,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  /** Its first loaded transaction with a mapped wallet, if any. */
  first: { timestamp: string } | null;
  /** Ask for the address: why a pasted one can't be added, and its first interaction if loaded. */
  enterAddress?: { problem: (address: string) => string | null; firstFor: (address: string) => { timestamp: string } | null };
  caseRange: CaseRange;
  hasRpc: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (choice: MapWalletChoice, address?: string) => void;
  onCancel: () => void;
}) {
  const { startDate, endDate } = datesFromRange(caseRange);
  const [address, setAddress] = useState("");
  const addressProblem = enterAddress ? enterAddress.problem(address) : null;
  const first = enterAddress ? (addressProblem ? null : enterAddress.firstFor(address.trim())) : givenFirst;
  const [chosen, setMode] = useState<MappedWalletConfig["rangeMode"] | null>(null);
  // Until the user picks, default to first interaction when there is one.
  const mode = chosen === "first_interaction" && !first ? "case" : (chosen ?? (first ? "first_interaction" : "case"));
  const [customDate, setCustomDate] = useState(givenFirst ? givenFirst.timestamp.slice(0, 10) : startDate);

  const options: { mode: MappedWalletConfig["rangeMode"]; title: string; detail: string; disabled?: boolean }[] = [
    {
      mode: "first_interaction",
      title: "From first interaction",
      detail: first
        ? `${formatUtc(first.timestamp)} UTC, its first loaded transaction with a mapped wallet.`
        : "No loaded transaction involves it yet.",
      disabled: !first,
    },
    { mode: "case", title: "From case start", detail: `${startDate}, the whole case range.` },
    { mode: "custom", title: "Custom start", detail: "Pick a UTC day inside the case range." },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{enterAddress ? "Add wallet" : `Map ${name}`}</DialogTitle>
          <DialogDescription>
            Loads this wallet&apos;s own history from your RPC up to the case end ({endDate}) and finds the transactions it
            shares with every mapped wallet. Addresses it reveals stay observed.
          </DialogDescription>
        </DialogHeader>
        {enterAddress && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Wallet address
            <Input
              autoFocus
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Solana address"
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              aria-invalid={address.trim() !== "" && addressProblem !== null ? true : undefined}
            />
            {address.trim() !== "" && addressProblem && <span className="text-xs font-normal text-destructive">{addressProblem}</span>}
          </label>
        )}
        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-1 text-sm font-medium">Load its history</legend>
          {options.map((o) => (
            <label
              key={o.mode}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm",
                mode === o.mode && "border-ring bg-muted/50",
                o.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name="range-mode"
                className="mt-0.5"
                checked={mode === o.mode}
                disabled={o.disabled}
                onChange={() => setMode(o.mode)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{o.title}</span>
                <span className="text-xs text-muted-foreground">{o.detail}</span>
                {o.mode === "custom" && mode === "custom" && (
                  <Input
                    type="date"
                    aria-label="Custom start (UTC)"
                    className="mt-1 h-8 w-44"
                    value={customDate}
                    min={startDate}
                    max={endDate}
                    onChange={(event) => setCustomDate(event.target.value)}
                  />
                )}
              </span>
            </label>
          ))}
        </fieldset>
        {!hasRpc && <p className="text-sm text-destructive">Add an RPC in settings to load its history.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={busy || !hasRpc || (mode === "custom" && !customDate) || addressProblem !== null}
            onClick={() =>
              onConfirm(
                mode === "case"
                  ? { rangeMode: "case" }
                  : { rangeMode: mode, start: mode === "custom" ? `${customDate}T00:00:00.000Z` : first?.timestamp },
                enterAddress ? address.trim() : undefined,
              )
            }
          >
            Map and load
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
