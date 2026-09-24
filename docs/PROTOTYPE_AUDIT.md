# Prototype Audit — Railway MVP ("Wallet Flow Map")

Audited 2026-09-24 against the live deployment at
`https://234quw4htirejksgdfnv.up.railway.app/` (package name `lecook-tam`).

**Summary:** the prototype is a one-case, hand-curated diagram, not a mapper. Every node, edge, amount, timestamp and balance is hard-coded in `app.js`. It makes no RPC calls and does no parsing. What carries forward is the product shape: evidence cards, the details panel, direct vs inferred links, and net-position reconciliation. The data pipeline has to be built from scratch (Sprints 02–04).

## Framework

- Plain HTML + CSS + vanilla JS. No build step, no framework, no dependencies.
- Files: `index.html` (4.7 KB), `styles.css` (~570 lines), `app.js` (~645 lines).
- Served by a ~90-line Node `http` static server (`server.js`, `npm start`, Node ≥ 18) with a `/healthz` endpoint for Railway.

## Graph library

- None. Nodes are absolutely positioned `<button>` elements, and edges are drawn into one hand-built `<svg>` layer.
- Edges are cubic Bézier curves (`curvePath`) that start and end on the card border (`nodeEdgePoint`). Each has an arrow marker and a two-line label (amount + time) on a background rect sized with `getBBox()`.
- Pan, zoom (0.5–1.4×, buttons only, no wheel zoom) and fit-to-view come from one CSS `transform` on the canvas.
- Nodes can be dragged. Every pointer move re-renders all edges, which works for about 20 edges but won't scale.

## RPC / provider calls

- None. There is no `fetch`, no RPC client and no API key.
- The only external references are outbound explorer links (Solscan, Arbiscan) attached to nodes as evidence.

## Data parsing

- None. The data was traced by hand beforehand and written into two literals: `nodeData` (17 nodes) and `edgeData` (20 edges).
- Amounts and times are display strings (`"+3,000 USDG"`, `"Jun 14 → Aug 29, 2026"`), not numbers or timestamps. Nothing can be sorted, summed or checked against the chain.

## Transaction model

- There is no transaction entity. An edge is a *summarised flow* between two nodes: `{ id, from, to, label, time, tags, inferred? }`.
- One edge can stand for many transactions (`"3 swaps"`, `"530 + 520 USDC"`). Signatures only appear inside node `links` as Solscan URLs.
- Nodes mix several concepts in one list: wallets, services (DEX router, Jup Card, Jupiter vault), bridges (CCTP, deBridge), assets (NFT purchase, stake) and snapshot positions. `kind` is a CSS class string (`"wallet primary"`, `"wallet inferred"`, `"service"`, `"asset"`, `"bridge"`).
- Filtering uses a manual `tags` array on each node and edge (`funding`, `swap`, `routing`, `bridge`).

## Token balance logic

- None computed. Balances (`244.681592 USDC`, `0.007943123` liquid SOL, `3.809105981` staked SOL) are typed-in facts from a Sep 16, 2026 snapshot.
- The "Net current assets" panel adds up primary wallet + Jup Card by hand. Its note says it excludes an external EVM wallet and an unpriced NFT, and that the ledger was reconciled with a pre-window 4.5 USDC balance. That pre-window balance is the need behind Sprint 10's boundary snapshots.

## Layout behavior

- Node positions are hand-picked `x`/`y` percentages of the canvas. There is no automatic layout, and position has no link to time or wallet.
- Time only appears in edge labels, so the chronological order of events can't be seen. This is the main gap FraudWatch's `x = time, y = wallet lane` layout fixes.
- Fit-to-view has a minimum zoom (0.68 desktop, 0.58 under 640 px), so on small screens content can overflow instead of shrinking further.

## Reusable UI pieces

Ideas worth carrying over (not code; FraudWatch is Next.js + shadcn):

- **Node card:** type kicker / name / value, three lines, with colour coded by kind.
- **Details side panel:** kicker, title, address, description, a key–value facts list and evidence links. Works for both nodes and edges.
- **Direct vs inferred edges:** solid line for on-chain evidence, dashed for a likely common owner, explained in the footer legend. This matches FraudWatch's "no ownership inference" rule if inferred links stay user-asserted.
- **Selection highlighting:** a selected node lights up its connected edges and switches their arrow markers.
- **Filters dim instead of hide,** so context stays visible.
- **Net-position summary card** with an as-of date and a list of what's excluded.
- Dark palette tokens (`--bg #07090c`, `--green #61d79a`, `--blue #6ea8fe`, …) and the explorer deep-link format.

## Hard-coded assumptions

- One case, one primary wallet (`dLm61…Df5Vo`), one date window (Jun 2 – Sep 16, 2026). The header counts ("2 networks", "20 key routes", "High bridge confidence") are written into the HTML.
- Cross-chain: Arbitrum addresses and CCTP/deBridge bridge pairing. The EVM side is out of MVP scope (see `00_README.md`).
- Labels such as "Superteam's Grant", "Jup Card" and "Likely same owner" come from outside knowledge, with no registry or provenance.
- Explorer links point only at Solscan and Arbiscan.
- Changes made in the UI (drags, selection) are never saved.

## Deployment note

`server.js` serves **any file** under its directory, not just the page assets. `/package.json` and `/server.js` are publicly readable, and so would be dotfiles such as `.env` or `.git/` if they exist in the deploy. There are no secrets in the prototype today, but if it stays online it should either allow-list `index.html`/`styles.css`/`app.js` or refuse dotfiles.

## Implications for FraudWatch

| Prototype | FraudWatch |
|---|---|
| Hand-traced literals | RPC ingestion into IndexedDB (Sprints 02–03) |
| Edge = summarised flow | Canonical transaction + per-wallet effects (Sprints 03–04) |
| Typed-in balances | Before/change/after reconstruction (Sprint 04) |
| Free x/y positions | Time × wallet-lane layout (Sprints 05, 08) |
| Manual labels | Local labels/tags + versioned protocol JSON (Sprint 06) |
| Every wallet drawn up front | Observed stays shallow until the user maps it (Sprint 07) |
| Pre-window 4.5 USDC footnote | Boundary snapshots (Sprint 10) |
| Solana + Arbitrum | Solana only |
