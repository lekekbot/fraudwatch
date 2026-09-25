"use client";

import { useState } from "react";
import { CoinsIcon, HashIcon, LayersIcon, SearchIcon, TagIcon, UserIcon, WalletIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type SearchItem, type SearchKind, searchItems } from "@/lib/search";
import { cn } from "@/lib/utils";

const ICON: Record<SearchKind, typeof WalletIcon> = {
  wallet: WalletIcon,
  address: UserIcon,
  tag: TagIcon,
  asset: CoinsIcon,
  protocol: LayersIcon,
  transaction: HashIcon,
};

const KIND_TEXT: Record<SearchKind, string> = {
  wallet: "Mapped wallet",
  address: "Address",
  tag: "Tag",
  asset: "Token",
  protocol: "Protocol",
  transaction: "Transaction",
};

/** ⌘K palette: type, arrow through results, Enter to go there. */
export function SearchDialog({ items, onPick, onClose }: { items: SearchItem[]; onPick: (item: SearchItem) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = searchItems(items, query);
  const pick = (item: SearchItem | undefined) => item && onPick(item);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search this case</DialogTitle>
        <DialogDescription className="sr-only">Wallets, labels, tags, signatures, tokens and protocols.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="case-search-results"
            aria-activedescendant={results[active] ? `case-search-${active}` : undefined}
            placeholder="Search wallets, labels, tags, signatures, tokens, protocols"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
              else if (event.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              else if (event.key === "Enter") pick(results[active]);
              else return;
              event.preventDefault();
            }}
          />
        </div>
        <ul id="case-search-results" role="listbox" className="max-h-80 overflow-y-auto p-1">
          {query.trim() && results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing in this case matches.</li>}
          {!query.trim() && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">Paste an address or signature, or type a label, tag, token or protocol.</li>
          )}
          {results.map((item, i) => {
            const Icon = ICON[item.kind];
            return (
              <li
                key={`${item.kind}:${item.id}`}
                id={`case-search-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm", i === active && "bg-muted")}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", (item.kind === "transaction" || item.label === item.id) && "font-mono text-xs")}>{item.label}</span>
                  {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground uppercase">{KIND_TEXT[item.kind]}</span>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
