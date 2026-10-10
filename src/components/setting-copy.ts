import type { Category, SettingKey } from "@/lib/preferences/schema";

/** What each setting is called and what its choices say. The registry is data; the wording lives here. */
export const SETTING_COPY: { [K in SettingKey]: { label: string; help?: string; options: Record<string, string> } } = {
  "appearance.theme": { label: "Theme", options: { system: "System", light: "Light", dark: "Dark" } },
  "appearance.motion": { label: "Motion", help: "Moving value dots and layout transitions on the graph.", options: { system: "System", reduced: "Reduced", full: "Full" } },
  "appearance.addressFormat": {
    label: "Addresses",
    help: "How much of an address without a name is shown. Graphs and the timeline show medium at most.",
    options: { short: "Short", medium: "Medium", full: "Full" },
  },
  "appearance.numberFormat": { label: "Amounts on timeline cards", help: "The inspector, table and copied values are always exact.", options: { full: "Exact", compact: "Compact (1.2M)" } },

  "labels.preferNames": { label: "Show names instead of addresses", help: "Your labels, protocol names and other known names. Off shows the address, with the name alongside where there's room.", options: { on: "On", off: "Off" } },
  "labels.community": { label: "Community labels", help: "Names from a public list. Unverified.", options: { shown: "Shown", hidden: "Hidden" } },
  "labels.sns": { label: ".sol names", help: "Names wallets chose for themselves, looked up on-chain. Hidden stops the lookups.", options: { shown: "Shown", hidden: "Hidden" } },

  "investigation.startView": { label: "Open cases on", options: { timeline: "Timeline", graph: "Graph", table: "Table", last: "Last used view" } },
  "investigation.inspector": { label: "Inspector", help: "The panel on the right of a case.", options: { open: "Open", on_selection: "When something is selected", closed: "Closed" } },
  "investigation.detailPreset": { label: "Investigation detail", options: { minimal: "Minimal", balanced: "Balanced", forensic: "Forensic" } },

  "graph.nodeLimit": { label: "Addresses shown", help: "The rest are grouped. Mapped wallets are always shown.", options: { "10": "10", "25": "25", "50": "50", "100": "100", all: "All" } },
  "graph.programs": { label: "Program calls", help: "Dotted lines to programs a wallet called. They never connect two wallets.", options: { hidden: "Hidden", shown: "Shown" } },
  "graph.knownServices": { label: "Known services", help: "Exchanges and protocols, grouped or as their addresses.", options: { collapsed: "Grouped", expanded: "Expanded" } },
  "graph.lowValue": { label: "Low-value connections", help: "Connections where only dust moved. Hidden ones are counted on the graph.", options: { shown: "Shown", faded: "Faded", hidden: "Hidden" } },
  "graph.spacing": { label: "Spacing", options: { compact: "Compact", normal: "Normal", wide: "Wide", widest: "Very wide" } },
  "graph.arrows": { label: "Direction arrows", options: { all: "On every line", selected: "Selected only" } },
  "graph.confirmLarge": { label: "Confirm before drawing more than 200 addresses", options: { on: "On", off: "Off" } },

  "timeline.density": { label: "Lane density", options: { compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" } },
  "timeline.connectors": { label: "Lines between lanes", options: { always: "Always", hover: "On hover", selected: "Selected only" } },
  "timeline.programInteractions": { label: "Program calls", help: "Hidden ones are counted on the timeline.", options: { shown: "Shown", hidden: "Hidden" } },
  "timeline.nft": { label: "NFT activity", help: "Hidden ones are counted on the timeline.", options: { shown: "Shown", hidden: "Hidden" } },
};

export const CATEGORY_COPY: Record<Category, { title: string; description?: string }> = {
  appearance: { title: "Appearance" },
  labels: { title: "Entities & labels", description: "Labels never change how a transaction is read." },
  investigation: { title: "Investigation defaults" },
  graph: { title: "Interaction graph" },
  timeline: { title: "Timeline" },
};
