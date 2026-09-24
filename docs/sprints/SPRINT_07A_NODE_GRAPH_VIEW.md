# Sprint 07A — Node Graph View

**Status:** 🟡 Built, browser check partly done (2026-09-24). Node dragging and one possible redraw glitch still need a manual look; see "Open items".

Built before Sprint 07 at the user's request. It works on the single selected wallet today; Sprint 07's mapped wallets and Sprint 08's lanes build on it.

- **Graph tab:** the top bar switch is now Timeline | Graph | Table. All three views share the filters, labels, counterparty list and inspector.
- **Graph model** (`src/lib/graph/build.ts`, tested): the selected wallet plus everything its (filtered) transactions touch.
  - **flow** edges: value moved to or from a counterparty, one edge per direction, with base-unit totals per asset (from the counterparty's own balance changes), transaction count and first/last time.
  - **sent_by** edges: another address paid for a transaction touching the wallet (keeper bots, relayers).
  - **program** edges: non-core programs the wallet's transactions called (core programs and account setup would connect to everything).
  - The busiest 150 nodes are drawn; the legend says how many quieter ones were left out.
- **Layout** (`src/lib/graph/layout.ts`, tested): a `d3-force` layout (new dependency, same family as the existing `d3-*` modules), run to completion up front so a graph always lands the same way. The wallet is pinned at the centre, busier relationships sit closer, nodes never overlap, and there's room for labels.
- **Canvas** (`src/app/case/graph/wallet-graph.tsx`):
  - Nodes: circles for addresses, squares for programs (INFRASTRUCTURE), outline by address state, and a transaction count inside. Labels use user names, then registry names, with a background halo.
  - Edges: green = received by the wallet, red = sent by it, dashed = sent the transaction, dotted blue = program called. Width grows with transaction count, and opposite directions bow apart.
  - Hovering highlights a node's or edge's connections and draws an edge summary ("14 tx · sent", "3 tx · 250 USDC").
  - Scroll to zoom, drag the background to pan, drag a node to move it. Floating toolbar: zoom, Fit, Reset layout. A legend sits bottom-left.
- **Inspector:**
  - Clicking a node opens its address panel: label, tags, state, registry match.
  - Clicking an edge opens `EdgePanel`: source → target (clickable), date span, per-asset totals, and every transaction with "Show on timeline" and explorer links.
  - "Show on timeline" switches tabs with that transaction selected and centred (`WalletTimeline` `initialSignature`).
- **Browser-checked** on the real 65-transaction wallet:
  - 44 counterparties plus program nodes (Tensor Marketplace, CCTP v2 Token Messenger, the unknown `Hobb…i8qG` with 37 calls).
  - Selecting the 14-transaction sender node highlighted its edge and opened its address.
  - Its edge listed all 14 transactions (2026-07-12 → 2026-09-22), and "Show on timeline" landed on 19 Aug 21:20 with Protocol: Kamino.
  - Hiding Program call removed the program node and both keeper bots.
  - No console errors.
  - The first layout was too tight and labels were hard to read over edges. Spacing was increased and labels got a background halo.

**Goal:** Let the investigator switch between the time-based view and a relationship view of the same transactions.

## Open items

- **Node drag untested in the browser.** The Chrome extension disconnected before the check. The code routes presses on a node to dragging and presses elsewhere to panning.
- **Possible redraw ghost.** One screenshot, taken while the browser window was resizing, showed a second small copy of the graph; clicking Fit cleared it. Each frame clears the whole canvas, so it's most likely a resize artifact, but it hasn't been reproduced either way.
- **Changing a filter re-runs the layout,** so dragged node positions are lost.
- **Left panel counts:** the Counterparties list still counts across all transactions, not just filtered ones.

## Acceptance criteria

- [x] The user can switch between the timeline and a node graph in a tab.
- [x] Nodes and edges reflect the same filtered transactions as the timeline.
- [x] Edges aggregate per relationship and direction, with totals and the transactions behind them.
- [x] Any node or edge can be inspected, and a transaction can be opened on the timeline from the graph.
- [ ] Node drag and redraw confirmed in the browser.
