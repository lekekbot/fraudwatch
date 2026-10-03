"use client";

import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteRule, hiddenBy, ruleMatches, saveRule } from "@/lib/case/hiding";
import type { FraudWatchCase, HideRule } from "@/lib/case/model";
import type { Names } from "@/lib/labels/labels";
import { formatBaseUnits, parseUnits } from "@/lib/solana/amount";
import type { EffectKind } from "@/lib/state/summarize";
import { type FilterableTx, movedAssets } from "@/lib/timeline/filter";
import { cn } from "cn";
import { type Assets, assetLabel } from "./asset-format";
import { KINDS, protocolName } from "./filter-panel";
import { PanelSection } from "./panel";

const SHOWN_CHOICES = 12;

/** Left-panel section: what's hidden from the map, and the case's hide rules. */
export function HidingSection({ c, rows, assets, names, decimalsOf, onSave }: {
  c: FraudWatchCase;
  /** Every loaded transaction side across mapped wallets, before filters. */
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  decimalsOf: (assetId: string) => number;
  onSave: (next: FraudWatchCase) => void;
}) {
  const [open, setOpen] = useState(false);
  const tagsOf = (address: string) => names.label(address)?.tags ?? [];
  const unique = uniqueBySignature(rows);
  const manual = c.hiddenSignatures?.length ?? 0;
  const byRules = unique.filter((row) => {
    const why = hiddenBy(c, row, tagsOf);
    return why !== null && why !== "manual";
  }).length;
  const rules = c.hideRules ?? [];

  return (
    <PanelSection
      title="Hide from map"
      action={
        <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
          Rules{rules.length > 0 && ` (${rules.filter((r) => r.enabled).length}/${rules.length})`}
        </Button>
      }
    >
      {manual === 0 && byRules === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing hidden. Hide transactions from the table, or add a rule.</p>
      ) : (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {manual.toLocaleString()} by hand · {byRules.toLocaleString()} by rules
          </span>
          {manual > 0 && (
            <Button variant="ghost" size="xs" onClick={() => onSave({ ...c, hiddenSignatures: [], updatedAt: new Date().toISOString() })}>
              Unhide by hand
            </Button>
          )}
        </div>
      )}
      {open && <RulesDialog c={c} rows={unique} assets={assets} names={names} decimalsOf={decimalsOf} onSave={onSave} onClose={() => setOpen(false)} />}
    </PanelSection>
  );
}

/** One row per transaction: a transaction shared by two mapped wallets counts once. */
function uniqueBySignature(rows: FilterableTx[]): FilterableTx[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.signature) && (seen.add(row.signature), true));
}

function RulesDialog({ c, rows, assets, names, decimalsOf, onSave, onClose }: {
  c: FraudWatchCase;
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  decimalsOf: (assetId: string) => number;
  onSave: (next: FraudWatchCase) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<HideRule | null>(null);
  const tagsOf = (address: string) => names.label(address)?.tags ?? [];
  const rules = c.hideRules ?? [];
  const matches = (rule: HideRule) => rows.filter((row) => ruleMatches(rule, row, tagsOf)).length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        {editing ? (
          <RuleEditor
            rule={editing}
            isNew={!rules.some((r) => r.id === editing.id)}
            rows={rows}
            assets={assets}
            names={names}
            decimalsOf={decimalsOf}
            matches={matches}
            onCancel={() => setEditing(null)}
            onSave={(rule) => {
              onSave(saveRule(c, rule));
              setEditing(null);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Hide rules</DialogTitle>
              <DialogDescription>
                Transactions matching an enabled rule are left off the map, on every lane. Unhide one from the table to keep it visible anyway.
              </DialogDescription>
            </DialogHeader>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rules yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                      onChange={() => onSave(saveRule(c, { ...rule, enabled: !rule.enabled }))}
                    />
                    <span className={cn("min-w-0 flex-1 truncate", !rule.enabled && "text-muted-foreground")}>{rule.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{matches(rule).toLocaleString()} match</span>
                    <Button variant="ghost" size="icon-xs" aria-label={`Edit ${rule.name}`} onClick={() => setEditing(rule)}>
                      <PencilIcon />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Delete ${rule.name}`} onClick={() => onSave(deleteRule(c, rule.id))}>
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              <Button onClick={() => setEditing({ id: crypto.randomUUID(), name: `Rule ${rules.length + 1}`, enabled: true })}>
                <PlusIcon /> New rule
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Values seen in the loaded transactions, most frequent first, to pick conditions from. */
function seen<T>(rows: FilterableTx[], values: (row: FilterableTx) => readonly T[]): T[] {
  const counts = new Map<T, number>();
  for (const row of rows) for (const v of new Set(values(row))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function RuleEditor({ rule, isNew, rows, assets, names, decimalsOf, matches, onCancel, onSave }: {
  rule: HideRule;
  isNew: boolean;
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  decimalsOf: (assetId: string) => number;
  matches: (rule: HideRule) => number;
  onCancel: () => void;
  onSave: (rule: HideRule) => void;
}) {
  const [draft, setDraft] = useState(rule);
  const assetChoices = seen(rows, (row) => movedAssets(row.summary));
  const [dustAsset, setDustAsset] = useState(rule.dust?.assetId ?? assetChoices[0] ?? "");
  const [dustText, setDustText] = useState(rule.dust ? formatBaseUnits(rule.dust.below, decimalsOf(rule.dust.assetId)).replaceAll(",", "") : "");
  const [addressText, setAddressText] = useState((rule.counterparties ?? []).join("\n"));

  const dustBelow = dustText.trim() ? parseUnits(dustText, decimalsOf(dustAsset)) : null;
  const dustInvalid = dustText.trim() !== "" && (dustBelow === null || dustBelow === "0");
  const counterparties = addressText.split(/[\s,]+/).filter(Boolean);
  const candidate: HideRule = {
    id: draft.id,
    name: draft.name.trim() || "Untitled rule",
    enabled: draft.enabled,
    ...(draft.kinds?.length ? { kinds: draft.kinds } : {}),
    ...(draft.onlyAssets?.length ? { onlyAssets: draft.onlyAssets } : {}),
    ...(dustBelow && !dustInvalid && dustAsset ? { dust: { assetId: dustAsset, below: dustBelow } } : {}),
    ...(counterparties.length ? { counterparties } : {}),
    ...(draft.tags?.length ? { tags: draft.tags } : {}),
    ...(draft.protocols?.length ? { protocols: draft.protocols } : {}),
  };
  const empty = Object.keys(candidate).length === 3;
  const count = empty ? 0 : matches(candidate);
  const toggle = <K extends "kinds" | "onlyAssets" | "tags" | "protocols">(key: K, value: NonNullable<HideRule[K]>[number]) => {
    const list = (draft[key] ?? []) as (typeof value)[];
    setDraft({ ...draft, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  const kindsSeen = new Set(seen<EffectKind>(rows, (row) => [row.summary.kind]));
  const tagChoices = seen(rows, (row) => row.addresses.flatMap((a) => names.label(a)?.tags ?? []));
  const protocolChoices = seen(rows, (row) => row.protocols);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isNew ? "New rule" : "Edit rule"}</DialogTitle>
        <DialogDescription>Every condition you set must match. Leave a condition empty to ignore it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <Input value={draft.name} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>

        <Condition title="Transaction type is any of">
          <div className="flex flex-wrap gap-1">
            {KINDS.filter((k) => kindsSeen.has(k.kind) || draft.kinds?.includes(k.kind)).map((k) => (
              <Chip key={k.kind} on={draft.kinds?.includes(k.kind) ?? false} onClick={() => toggle("kinds", k.kind)}>
                {k.label}
              </Chip>
            ))}
          </div>
        </Condition>

        <Condition title="Only moves these assets" hint="For spam tokens: matches when every asset moved is selected.">
          <Choices
            items={assetChoices}
            selected={draft.onlyAssets ?? []}
            label={(a) => assetLabel(a, assets)}
            onToggle={(a) => toggle("onlyAssets", a)}
          />
        </Condition>

        <Condition title="Dust: moves less than" hint="Matches when the transaction moves this asset and every movement of it is smaller.">
          <div className="flex gap-1">
            <Input
              inputMode="decimal"
              aria-label="Dust threshold"
              aria-invalid={dustInvalid || undefined}
              placeholder="e.g. 0.001"
              className="h-8 min-w-0 flex-1"
              value={dustText}
              onChange={(event) => setDustText(event.target.value)}
            />
            <select
              aria-label="Dust asset"
              className="h-8 max-w-36 truncate rounded-md border bg-transparent px-1 text-xs dark:bg-input/30"
              value={dustAsset}
              onChange={(event) => setDustAsset(event.target.value)}
            >
              {assetChoices.map((a) => (
                <option key={a} value={a}>
                  {assetLabel(a, assets)}
                </option>
              ))}
            </select>
          </div>
          {dustInvalid && <p className="text-xs text-destructive">Not a valid amount for this asset.</p>}
        </Condition>

        <Condition title="Involves any of these addresses" hint="One per line.">
          <textarea
            aria-label="Addresses"
            rows={2}
            className="w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs dark:bg-input/30"
            value={addressText}
            onChange={(event) => setAddressText(event.target.value)}
          />
        </Condition>

        {tagChoices.length > 0 && (
          <Condition title="Involves an address tagged">
            <Choices items={tagChoices} selected={draft.tags ?? []} label={(t) => t} onToggle={(t) => toggle("tags", t)} />
          </Condition>
        )}

        {protocolChoices.length > 0 && (
          <Condition title="Uses any of these protocols">
            <Choices items={protocolChoices} selected={draft.protocols ?? []} label={protocolName} onToggle={(p) => toggle("protocols", p)} />
          </Condition>
        )}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {empty ? "Set at least one condition." : `Matches ${count.toLocaleString()} transaction${count === 1 ? "" : "s"}`}
        </span>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={empty || dustInvalid} onClick={() => onSave(candidate)}>
          Save rule
        </Button>
      </DialogFooter>
    </>
  );
}

function Condition({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1 text-xs text-muted-foreground">{title}</legend>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-foreground bg-secondary" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}

/** Chips for the most common values; selected ones always show. */
function Choices<T extends string>({ items, selected, label, onToggle }: {
  items: T[];
  selected: T[];
  label: (item: T) => string;
  onToggle: (item: T) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : [...new Set([...selected, ...items.slice(0, SHOWN_CHOICES)])];
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <Chip key={item} on={selected.includes(item)} onClick={() => onToggle(item)}>
          {label(item)}
        </Chip>
      ))}
      {items.length > SHOWN_CHOICES && (
        <Button variant="ghost" size="xs" onClick={() => setAll(!all)}>
          {all ? "Fewer" : `+${(items.length - SHOWN_CHOICES).toLocaleString()} more`}
        </Button>
      )}
    </div>
  );
}
