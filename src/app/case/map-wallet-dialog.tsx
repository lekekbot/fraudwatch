"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MappedWalletConfig } from "@/lib/case/model";
import { type CaseRange, datesFromRange } from "@/lib/case/range";
import { cn } from "@/lib/utils";
import { formatUtc } from "./asset-format";

export type MapWalletChoice = { rangeMode: MappedWalletConfig["rangeMode"]; start?: string };

/**
 * Confirms mapping an observed wallet and where its history should start.
 * Defaults to its first interaction with the mapped wallets.
 */
export function MapWalletDialog({
  name,
  first,
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
  caseRange: CaseRange;
  hasRpc: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (choice: MapWalletChoice) => void;
  onCancel: () => void;
}) {
  const { startDate, endDate } = datesFromRange(caseRange);
  const [mode, setMode] = useState<MappedWalletConfig["rangeMode"]>(first ? "first_interaction" : "case");
  const [customDate, setCustomDate] = useState(first ? first.timestamp.slice(0, 10) : startDate);

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
          <DialogTitle>Map {name}</DialogTitle>
          <DialogDescription>
            Loads this wallet&apos;s own history from your RPC up to the case end ({endDate}) and finds the transactions it
            shares with every mapped wallet. Addresses it reveals stay observed.
          </DialogDescription>
        </DialogHeader>
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
            disabled={busy || !hasRpc || (mode === "custom" && !customDate)}
            onClick={() =>
              onConfirm(
                mode === "case"
                  ? { rangeMode: "case" }
                  : { rangeMode: mode, start: mode === "custom" ? `${customDate}T00:00:00.000Z` : first?.timestamp },
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
