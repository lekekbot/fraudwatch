"use client";

import { ChevronDownIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { assetLabel, type Assets } from "../asset-format";

export function AssetMultiSelect({ assets, selected, onChange }: {
  assets: Assets;
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const summary = selected.length === 0 ? "Any asset" : selected.length <= 2 ? selected.map((id) => assetLabel(id, assets)).join(", ") : `${selected.length} assets selected`;
  return <div className="grid gap-1">
    <span>Assets</span>
    <Popover>
      <PopoverTrigger className="flex w-full min-w-0 items-center justify-between gap-2 rounded border bg-background p-2 text-left" aria-label={`Assets: ${summary}`}>
        <span className="truncate">{summary}</span><ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-64 w-72 p-2">
        <div className="flex items-center justify-between gap-2 px-2 pb-1 text-xs text-muted-foreground">
          <span>None selected means any asset</span>
          {selected.length > 0 && <button type="button" className="text-foreground underline" onClick={() => onChange([])}>Clear</button>}
        </div>
        {[...assets.keys()].map((id) => <label key={id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
          <input type="checkbox" checked={selected.includes(id)} onChange={() => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])} />
          <span className="truncate">{assetLabel(id, assets)}</span>
        </label>)}
        {assets.size === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No assets in this case yet.</p>}
      </PopoverContent>
    </Popover>
  </div>;
}
