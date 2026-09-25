# Sprint 09A — Graph Tab as a Wallet Interaction Map

**Status:** ✅ Complete (checked 2026-09-25)

**Problem:** the Graph tab (Sprint 07A) drew a separate line per direction and kind (received, sent, sent-by, program) around one wallet. The result was a crowded radial graph that repeated what the Timeline already shows at transaction level.

**Now:** a wallet interaction map.

- **Model** (`buildInteractionGraph`, `src/lib/graph/build.ts`, tested): one node per address, and exactly **one undirected connection per pair** that directly exchanged value in the filtered data. That holds however many transactions, directions, tokens or days are involved.
  - "Direct" means a value movement between the two: a balance counterparty (the other side's balance moved against the wallet's), or an NFT's other side when it isn't a balance counterparty (compressed NFTs, escrowed listings).
  - Every underlying transaction stays on the connection as an `Interaction` with its real movements (`from`, `to`, asset, amount), sorted chronologically.
  - The same movement seen from two mapped wallets' sides is recorded once.
- **Program calls** are a separate connection kind (wallet ↔ program) and never join two wallets, even when both called the same program. They're hidden by default; the **Program calls** toggle in the toolbar shows them, dotted. Core programs and account setup are never drawn.
- **One source of truth:** the map is built from the same per-wallet filtered effects and summaries as the timeline (`perWallet`). The asset filter also drops movements of hidden assets, so a pair joined only by hidden assets loses its connection. Date, type, direction, amount, protocol, tag and address filters apply through the filtered transactions.
- **Coverage:** every visible mapped wallet, with the selected one pinned at the centre, so connections between mapped wallets appear once. Mapped wallets are filled nodes; programs are squares.
- **Drawing** (`wallet-graph.tsx`): one calm neutral line per pair, with no arrows, amounts, tokens or dates on it. The count shows in a hover tooltip instead ("A ↔ B · 3 transactions · click for details"). Selecting a line thickens and brightens it and dims the rest; hovering a node highlights its connections.
- **Legend and counts:** "N addresses · N connections · N transactions", a legend entry for the interaction line, and "N program connections hidden" or "Program called (N)".
- **Connection panel** (`edge-panel.tsx`): the pair (each side clickable to open the address), transaction count and date span. Then every transaction in time order, each with date and time, type, every movement with its real direction ("A → B"), amount and token, **Show on timeline** (on the right wallet's lane) and an explorer link.
- **Unchanged:** node clicks (address inspector with labels, tags, notes, map wallet, show only its transactions, bookmark), search, the mapped-wallet behaviour, and the Timeline and Table tabs.
- **Removed:** "sent the transaction" (fee payer) lines. A fee payer isn't a value interaction; it's still shown on the timeline cards and in details.

**Verified:**

- **Unit test:** three A → B transactions on different days and tokens plus one B → A give **exactly one connection**, whose detail list has all four in time order with the correct direction, token and amount each. Other tests cover both ends mapped (one connection, no duplicate movements), two wallets calling the same program (no wallet-to-wallet line, program links only when shown), hidden assets removing a connection, compressed NFTs, and the node cap.
- **Browser, real case (2 mapped wallets):**
  - 46 addresses · 45 connections · 37 transactions; 6 program connections hidden.
  - The line between the two mapped wallets listed 20 USDC then 3,520.476921 USDC, both `dLm6…` → `2hGU…`, on 30 Jul.
  - Hiding USDC reduced the map to 23 / 21 / 14 and removed the selected connection.
  - The program toggle added 6 dotted connections without changing the wallet counts.
- **Found in the case data:** a lookalike address `dLm6yzRB…BMf5Vo` (same first and last four characters as the primary `dLm61Lvp…Ddf5Vo`) sent 0.001 USDC to `2hGU…` 19 seconds after the primary's 3,520 USDC transfer. That's an address-poisoning pattern. The map shows the two as separate nodes, but both *label* as `dLm6…f5Vo`; the lookalike warning noted in Sprint 07 would flag this.

## Acceptance criteria

- [x] One node per address; one neutral, undirected line per interacting pair.
- [x] Multiple transactions in either direction, on any days or tokens, still give exactly one line.
- [x] Clicking a line lists every underlying transaction chronologically with direction, time, token, amount and link.
- [x] Filters apply to connections and detail lists; empty connections disappear.
- [x] Program calls are separate, hidden by default, toggleable, and never connect wallets.
- [x] The legend and counts describe interaction lines; selection highlights one and dims the rest.
- [x] Timeline and Table unchanged.
