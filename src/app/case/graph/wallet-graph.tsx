"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon, FocusIcon, MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon, WorkflowIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddressState } from "@/lib/case/address-state";
import { graphWheelAction } from "@/lib/gestures";
import { BURNED_NODE_ID, CLUSTER_LABELS, type ClusterKind, edgeFlow, entityNodeId, flowShares, startedBy, summarizeRelationship, type GraphEdge, type GraphNode, type GraphRanking, type WalletGraph as Graph } from "@/lib/graph/build";
import { classifyLayout, layoutGraph, majorEdges, nodeRadius, type Point, type Spacing, SPACINGS, type ZoomTier, zoomTier } from "@/lib/graph/layout";
import type { Names } from "@/lib/labels/labels";
import { AssetIcon } from "../asset-icon";

/** Remembers the chosen graph spacing in this browser. */
const SPACING_KEY = "fraudwatch:graph-spacing";

type Palette = Record<"fg" | "muted" | "border" | "card" | "bg" | "program" | "send" | "receive" | "lookalike" | "burn", string>;

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    fg: v("--foreground", "#eee"),
    muted: v("--muted-foreground", "#999"),
    border: v("--border", "#333"),
    card: v("--card", "#1a1a1a"),
    bg: v("--background", "#111"),
    program: "oklch(0.7 0.14 250)",
    send: v("--destructive", "#e5484d"),
    receive: "oklch(0.72 0.16 155)",
    lookalike: "oklch(0.77 0.16 70)",
    burn: "oklch(0.72 0.17 50)",
  };
}

type Segment = { edge: GraphEdge; from: Point; to: Point; control?: Point };
type HoverAsset = { id: string; label: string; logo?: string };
type HoverFlow = { kind: "sent" | "received"; count: number };
type HoverCard = {
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
  title: string;
  kicker?: string;
  lines: string[];
  assets?: HoverAsset[];
  flows?: HoverFlow[];
  hint: string;
};

function edgePerspective(edge: GraphEdge, wallet: string, nodes: ReadonlyMap<string, { kind: string }>) {
  const reference = edge.a === wallet || edge.b === wallet ? wallet : nodes.get(edge.a)?.kind === "wallet" ? edge.a : edge.b;
  const flow = edgeFlow(edge);
  const aToB = edge.summary?.aToB ?? (flow.from === edge.a ? flow.forward : flow.reverse);
  const bToA = edge.summary?.bToA ?? (flow.from === edge.b ? flow.forward : flow.reverse);
  return {
    reference,
    counterparty: reference === edge.a ? edge.b : edge.a,
    sent: reference === edge.a ? aToB : bToA,
    received: reference === edge.a ? bToA : aToB,
  };
}

function nodeLabel(node: GraphNode, names: Names) {
  return node.cluster ? `${CLUSTER_LABELS[node.cluster.kind]} (${node.cluster.addresses})` : (names.known(node.id) ?? names.of(node.id, 4));
}

const kindLabel = (kind: string) => kind.replaceAll("_", " ").toLowerCase();

const shortDate = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A node's activity over its drawn lines, for its hover card: assets, first and last seen, the mapped wallets it dealt with. */
function nodeFacts(id: string, graph: Graph) {
  const wallets = new Set(graph.nodes.filter((node) => node.kind === "wallet").map((node) => node.id));
  const assets = new Set<string>();
  const connected = new Set<string>();
  let first = Infinity;
  let last = -Infinity;
  for (const edge of graph.edges) {
    if (edge.kind !== "interaction" || (edge.a !== id && edge.b !== id)) continue;
    const other = edge.a === id ? edge.b : edge.a;
    if (wallets.has(other)) connected.add(other);
    for (const asset of edge.summary?.assets ?? []) assets.add(asset.assetId);
    if (edge.summary?.firstInteraction != null) first = Math.min(first, edge.summary.firstInteraction);
    if (edge.summary?.lastInteraction != null) last = Math.max(last, edge.summary.lastInteraction);
  }
  return { assets: assets.size, connected: [...connected], first: Number.isFinite(first) ? first : null, last: Number.isFinite(last) ? last : null };
}

/** A fixed pseudo-random number in [0, 1) for `seed`: the same every frame, different per particle. */
const jitter = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointOnPath(segment: Segment, progress: number): Point {
  if (!segment.control) return { x: segment.from.x + (segment.to.x - segment.from.x) * progress, y: segment.from.y + (segment.to.y - segment.from.y) * progress };
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * segment.from.x + 2 * inverse * progress * segment.control.x + progress * progress * segment.to.x,
    y: inverse * inverse * segment.from.y + 2 * inverse * progress * segment.control.y + progress * progress * segment.to.y,
  };
}

function pathTangent(segment: Segment, progress: number): Point {
  if (!segment.control) return { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
  return {
    x: 2 * ((1 - progress) * (segment.control.x - segment.from.x) + progress * (segment.to.x - segment.control.x)),
    y: 2 * ((1 - progress) * (segment.control.y - segment.from.y) + progress * (segment.to.y - segment.control.y)),
  };
}

function distanceToPath(point: Point, segment: Segment) {
  if (!segment.control) return distanceToSegment(point, segment.from, segment.to);
  let distance = Infinity;
  let previous = segment.from;
  for (let i = 1; i <= 12; i++) {
    const next = pointOnPath(segment, i / 12);
    distance = Math.min(distance, distanceToSegment(point, previous, next));
    previous = next;
  }
  return distance;
}

function routeControl(edge: GraphEdge, from: Point, to: Point, nodes: GraphNode[], positions: ReadonlyMap<string, Point>): Point | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 90) return undefined;
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const obstruction = nodes.find((node) => {
    if (node.id === edge.a || node.id === edge.b) return false;
    const point = positions.get(node.id);
    if (!point) return false;
    const progress = ((point.x - from.x) * dx + (point.y - from.y) * dy) / (length * length);
    const clearance = node.kind === "wallet" ? 42 : node.kind === "aggregate" ? 65 : 22;
    return progress > 0.12 && progress < 0.88 && distanceToSegment(point, from, to) < clearance;
  });
  if (!obstruction) return undefined;
  const point = positions.get(obstruction.id)!;
  const cross = dx * (point.y - middle.y) - dy * (point.x - middle.x);
  const fallback = [...edge.id].reduce((hash, char) => hash + char.charCodeAt(0), 0) % 2 ? 1 : -1;
  const side = cross === 0 ? fallback : -Math.sign(cross);
  const offset = obstruction.kind === "wallet" ? 46 : 32;
  return { x: middle.x + (-dy / length) * offset * side, y: middle.y + (dx / length) * offset * side };
}

function outwardText(pos: Point, radius: number, gap = 7): { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline } {
  const distance = Math.hypot(pos.x, pos.y);
  if (!distance) return { x: pos.x, y: pos.y + radius + gap, align: "center", baseline: "top" };
  const x = pos.x / distance;
  const y = pos.y / distance;
  if (Math.abs(x) > Math.abs(y)) {
    return { x: pos.x + x * (radius + gap), y: pos.y, align: x > 0 ? "left" : "right", baseline: "middle" };
  }
  return { x: pos.x, y: pos.y + y * (radius + gap), align: "center", baseline: y > 0 ? "top" : "bottom" };
}

/**
 * Wallet interaction map: one node per address, one calm undirected line per
 * pair that directly exchanged value. Transaction detail (direction, amounts,
 * dates) lives in the side panel, not on the lines. Program links are dotted
 * and only drawn when turned on. Pan and zoom, drag nodes, click a node or
 * line to inspect it.
 */
export function WalletGraph({
  graph,
  wallet,
  primaryWallet,
  names,
  assetInfo,
  stateOf,
  selectedNode,
  selectedEdge,
  onSelectNode,
  onSelectEdge,
  showPrograms,
  onToggleProgramCalls,
  ranking,
  onRankingChange,
  nodeLimit,
  onNodeLimitChange,
  timeRange,
  onClearTimeRange,
  expandedClusters,
  onToggleCluster,
  expandedEntities,
  onToggleEntity,
}: {
  graph: Graph;
  /** Case primary. `wallet` may change as investigator focuses another mapped wallet. */
  primaryWallet: string;
  wallet: string;
  names: Names;
  assetInfo: (assetId: string) => HoverAsset;
  stateOf: (address: string) => AddressState;
  selectedNode: string | null;
  selectedEdge: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  showPrograms: boolean;
  onToggleProgramCalls: () => void;
  ranking: GraphRanking;
  onRankingChange: (ranking: GraphRanking) => void;
  nodeLimit: 10 | 25 | 50 | 100 | null;
  onNodeLimitChange: (limit: 10 | 25 | 50 | 100 | null) => void;
  timeRange: { start: number; end: number } | null;
  onClearTimeRange: () => void;
  /** Clusters drawn as their addresses; clicking a cluster expands it. */
  expandedClusters: ReadonlySet<ClusterKind>;
  onToggleCluster: (kind: ClusterKind) => void;
  /** Registry protocols drawn as their separate addresses. */
  expandedEntities: ReadonlySet<string>;
  onToggleEntity: (protocolId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const sizeRef = useRef({ width: 800, height: 600 });
  const [layoutSize, setLayoutSize] = useState({ width: 800, height: 600 });
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<{ node?: string; edge?: string }>({});
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  // How spread out the map is; remembered in this browser. The graph only mounts client-side, so storage is there.
  const [spacing, setSpacing] = useState<Spacing>(() => {
    const saved = localStorage.getItem(SPACING_KEY);
    return saved && saved in SPACINGS ? (saved as Spacing) : "normal";
  });
  const layout = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, primaryWallet, layoutSize, undefined, SPACINGS[spacing]),
    [graph, primaryWallet, layoutSize, spacing],
  );
  // Positions start from the layout; dragging moves them without re-running it.
  const positions = useRef(new Map<string, Point>());
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const layoutRoles = useMemo(() => classifyLayout(graph.nodes, graph.edges), [graph]);
  const major = useMemo(() => majorEdges(graph.nodes, graph.edges), [graph]);
  const shares = useMemo(() => flowShares(graph.edges), [graph]);
  // Semantic zoom: how much detail is drawn, with hysteresis (see zoomTier).
  const tierRef = useRef<ZoomTier>("medium");
  const relationshipsByNode = useMemo(
    () =>
      new Map(
        graph.edges.flatMap((edge) => {
          if (edge.kind !== "interaction" || (edge.a !== wallet && edge.b !== wallet)) return [];
          return [[edge.a === wallet ? edge.b : edge.a, edge] as const];
        }),
      ),
    [graph, wallet],
  );

  // Isolate: only this node, its direct neighbours and the lines among them are drawn. Positions don't change.
  const [isolatedId, setIsolated] = useState<string | null>(null);
  const isolated = isolatedId && nodesById.has(isolatedId) ? isolatedId : null;
  const visible = useMemo(() => {
    if (!isolated) return null;
    const shown = new Set([isolated]);
    for (const edge of graph.edges) if (edge.a === isolated || edge.b === isolated) shown.add(edge.a).add(edge.b);
    return shown;
  }, [graph, isolated]);

  const latest = useRef({ graph, wallet, primaryWallet, names, stateOf, selectedNode, selectedEdge, nodesById, layoutRoles, relationshipsByNode, visible, major, shares });
  // Drawing reads props through this ref; refresh it before any effect or frame uses it.
  useLayoutEffect(() => {
    latest.current = { graph, wallet, primaryWallet, names, stateOf, selectedNode, selectedEdge, nodesById, layoutRoles, relationshipsByNode, visible, major, shares };
  });

  const segments = useCallback((): Segment[] => {
    const out: Segment[] = [];
    const { graph, visible } = latest.current;
    for (const edge of graph.edges) {
      if (visible && !(visible.has(edge.a) && visible.has(edge.b))) continue;
      const from = positions.current.get(edge.a);
      const to = positions.current.get(edge.b);
      if (from && to) out.push({ edge, from, to, control: routeControl(edge, from, to, graph.nodes, positions.current) });
    }
    return out;
  }, []);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { names, stateOf, selectedNode, selectedEdge, graph, wallet, primaryWallet, nodesById, layoutRoles, visible, major, shares } = latest.current;
    const now = performance.now();
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const p = readPalette(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

    // A hovered node or line can vanish under the cursor (an expanded cluster, a filter change): ignore it then.
    const hover = { node: hoverRef.current.node && nodesById.has(hoverRef.current.node) ? hoverRef.current.node : undefined, edge: graph.edges.some((e) => e.id === hoverRef.current.edge) ? hoverRef.current.edge : undefined };
    // A selection beats hover. A selected node lights all its connections and the addresses they reach, even though
    // clicking it also selects its line to the focus wallet (for the panel); a selected line alone lights just that line.
    const focusNode = selectedNode ?? (selectedEdge ? undefined : (hover.node ?? undefined));
    const focusEdge = focusNode ? undefined : (selectedEdge ?? hover.edge ?? undefined);
    const lit = (e: GraphEdge) => (focusEdge ? e.id === focusEdge : focusNode ? e.a === focusNode || e.b === focusNode : true);
    const focusing = Boolean(focusEdge || focusNode);
    const tier = (tierRef.current = zoomTier(tierRef.current, t.k));

    const line = 1.25 / t.k;
    // Hovering a cluster or a mapped wallet ties the cluster by a dashed line to each wallet its addresses dealt with.
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = p.muted;
    ctx.lineWidth = line;
    ctx.setLineDash([3 / t.k, 4 / t.k]);
    for (const n of graph.nodes) {
      const at = positions.current.get(n.id);
      if (!n.cluster || !at || (visible && !visible.has(n.id))) continue;
      for (const id of n.cluster.wallets) {
        if (hover.node !== n.id && hover.node !== id) continue;
        const owner = positions.current.get(id);
        if (!owner) continue;
        ctx.beginPath();
        ctx.moveTo(owner.x, owner.y);
        ctx.lineTo(at.x, at.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const segment of segments()) {
      const { edge, from, to, control } = segment;
      const on = lit(edge);
      const selected = edge.id === selectedEdge;
      // Far out, only the case's major relationships are drawn, plus whatever the focus lights.
      const inFocus = on && focusing;
      if (tier === "far" && !major.has(edge.id) && !inFocus) continue;
      const coreEdge = layoutRoles.get(edge.a) === "core" && layoutRoles.get(edge.b) === "core";
      const bridgeEdge = layoutRoles.get(edge.a) === "bridge" || layoutRoles.get(edge.b) === "bridge";
      const perspective = edgePerspective(edge, wallet, nodesById);
      const { sent, received } = perspective;
      const intensity = coreEdge ? Math.min(0.85, 0.72 + Math.log1p(edge.interactions.length) / 40) : bridgeEdge ? 0.52 : Math.min(0.48, 0.3 + Math.log1p(edge.interactions.length) / 24);
      ctx.globalAlpha = on ? (selected ? 1 : intensity) : 0.05;
      // One neutral line per relationship; direction is carried by the coloured arrowheads, not the line.
      // One-way lines take the direction's colour (red: the focus sent, green: it received); two-way lines stay neutral.
      ctx.strokeStyle =
        edge.kind === "program"
          ? p.program
          : sent > 0 && received === 0
            ? p.send
            : received > 0 && sent === 0
              ? p.receive
              : selected || (on && focusing)
                ? p.fg
                : p.muted;
      // Thickness: transactions on a log scale (1 → 1px, 10 → 1.9, 100 → 2.8, 1,000+ → 3.7), so one busy pair can't dominate.
      const weight = edge.kind === "program" ? 1 : Math.min(3.7, 1 + 0.9 * Math.log10(edge.interactions.length));
      ctx.lineWidth = (weight + (selected ? 0.75 : 0)) / t.k;
      const dotted = edge.kind === "program";
      ctx.setLineDash(dotted ? [2 / t.k, 4 / t.k] : []);
      ctx.lineCap = dotted ? "round" : "butt";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (control) ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
      else ctx.lineTo(to.x, to.y);
      ctx.stroke();
      // Direction markers are close-up detail.
      if (edge.kind === "interaction" && (tier !== "far" || inFocus)) {
        // Who made the first move: a solid diamond just outside each end that approved (signed) transactions on this line;
        // a hollow one at the middle when someone else entirely signed them (a delegate, drainer or bot).
        const started = edge.summary ?? summarizeRelationship(edge);
        const diamond = (at: Point, filled: boolean) => {
          const size = (selected ? 4.2 : 3.4) / t.k;
          ctx.beginPath();
          ctx.moveTo(at.x, at.y - size);
          ctx.lineTo(at.x + size, at.y);
          ctx.lineTo(at.x, at.y + size);
          ctx.lineTo(at.x - size, at.y);
          ctx.closePath();
          if (filled) ctx.fill();
          else ctx.stroke();
        };
        const beside = (end: "a" | "b") => {
          const progress = end === "a" ? 0 : 1;
          const tangent = pathTangent(segment, progress);
          const length = Math.hypot(tangent.x, tangent.y) || 1;
          const node = nodesById.get(end === "a" ? edge.a : edge.b);
          const gap = (node ? nodeRadius(node) + (layoutRoles.get(node.id) === "bridge" ? 3 : 0) : 8) + 6 / t.k;
          const sign = end === "a" ? 1 : -1;
          const anchor = end === "a" ? from : to;
          return { x: anchor.x + (tangent.x / length) * gap * sign, y: anchor.y + (tangent.y / length) * gap * sign };
        };
        ctx.globalAlpha = on ? (selected || focusEdge === edge.id || focusNode ? 0.95 : 0.6) : 0.05;
        ctx.fillStyle = p.fg;
        ctx.strokeStyle = p.fg;
        ctx.lineWidth = 1.2 / t.k;
        if (started.initiatedByA > 0) diamond(beside("a"), true);
        if (started.initiatedByB > 0) diamond(beside("b"), true);
        if (started.initiatedByOthers > 0 && started.initiatedByA + started.initiatedByB === 0) diamond(pointOnPath(segment, 0.5), false);
        const { reference, counterparty } = perspective;
        const share = shares.get(edge.id);
        const sentShare = (reference === edge.a ? share?.aToB : share?.bToA) ?? 0;
        const receivedShare = (reference === edge.a ? share?.bToA : share?.aToB) ?? 0;
        const flows = [
          ...(sent > 0 ? [{ source: reference, target: counterparty, share: sentShare, color: p.send }] : []),
          ...(received > 0 ? [{ source: counterparty, target: reference, share: receivedShare, color: p.receive }] : []),
        ];
        for (const flow of flows) {
          const source = positions.current.get(flow.source);
          const target = positions.current.get(flow.target);
          const targetNode = nodesById.get(flow.target);
          if (!source || !target) continue;
          const flowSegment: Segment = { edge, from: source, to: target, control };
          const tangent = pathTangent(flowSegment, 1);
          const length = Math.hypot(tangent.x, tangent.y) || 1;
          const ux = tangent.x / length;
          const uy = tangent.y / length;
          const inset = (targetNode ? nodeRadius(targetNode) + (layoutRoles.get(targetNode.id) === "bridge" ? 3 : 0) : 10) + 1 / t.k;
          const tipX = target.x - ux * inset;
          const tipY = target.y - uy * inset;
          const arrow = (selected ? 7 : 5.5) / t.k;
          ctx.globalAlpha = on ? (selected || focusEdge === edge.id || focusNode ? 0.95 : 0.48) : 0.05;
          ctx.fillStyle = flow.color;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * arrow - uy * arrow * 0.55, tipY - uy * arrow + ux * arrow * 0.55);
          ctx.lineTo(tipX - ux * arrow + uy * arrow * 0.55, tipY - uy * arrow - ux * arrow * 0.55);
          ctx.closePath();
          ctx.fill();

          // Dots run source → target along the line: 1 for little value, up to 5 for the largest flows of an asset.
          // Each keeps its own speed and start, so a busy line doesn't move in lockstep.
          const particles = 1 + Math.round(4 * Math.sqrt(flow.share));
          const seed = [...edge.id, ...flow.source].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 100_003, 7);
          for (let i = 0; i < particles; i++) {
            const speed = 0.8 + 0.4 * jitter(seed + i * 3);
            const progress = ((now / 5200) * speed + jitter(seed + i * 3 + 1) + i / particles) % 1;
            const point = pointOnPath(flowSegment, progress);
            ctx.beginPath();
            ctx.arc(point.x, point.y, (selected ? 2.3 : 1.7) / t.k, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    ctx.globalAlpha = 1;

    const litNodes = new Set<string>();
    if (focusEdge || focusNode) {
      for (const e of graph.edges) if (lit(e)) litNodes.add(e.a).add(e.b);
      if (focusNode) litNodes.add(focusNode);
    }
    const topLabels = new Set(
      [...graph.nodes]
        .filter((node) => node.kind === "counterparty")
        .sort((a, b) => b.txCount - a.txCount || a.id.localeCompare(b.id))
        .slice(0, 8)
        .map((node) => node.id),
    );
    const selectedRelationship = selectedEdge ? graph.edges.find((edge) => edge.id === selectedEdge) : undefined;
    const selectedCounterparty = selectedRelationship ? edgePerspective(selectedRelationship, wallet, nodesById).counterparty : undefined;
    const nodeFocus = hover.node ?? selectedNode ?? selectedCounterparty;
    const drawNodes = graph.nodes.filter((node) => !visible || visible.has(node.id)).sort((a, b) => Number(a.id === nodeFocus) - Number(b.id === nodeFocus));
    // A hovered or selected look-alike is tied to its twins on the map by a dashed line, so the pair reads as one
    // without lines criss-crossing the whole map the rest of the time.
    ctx.strokeStyle = p.lookalike;
    ctx.lineWidth = 1.25 / t.k;
    ctx.setLineDash([4 / t.k, 4 / t.k]);
    ctx.globalAlpha = 0.75;
    for (const n of drawNodes) {
      const from = positions.current.get(n.id);
      for (const twin of names.lookalikes(n.id)) {
        if (n.id !== nodeFocus && twin !== nodeFocus) continue;
        const to = twin > n.id ? positions.current.get(twin) : undefined;
        if (!from || !to) continue;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    for (const n of drawNodes) {
      const pos = positions.current.get(n.id);
      if (!pos) continue;
      const role = layoutRoles.get(n.id) ?? "peripheral";
      const r = nodeRadius(n) + (role === "bridge" ? 3 : 0);
      const known = n.kind === "aggregate" ? undefined : names.known(n.id);
      const label = nodeLabel(n, names);
      const infrastructure = n.kind === "program" || n.kind === "entity" || (n.kind === "counterparty" && stateOf(n.id) === "INFRASTRUCTURE");
      const primaryNode = n.id === primaryWallet;
      const restingAlpha = role === "core" ? 1 : role === "bridge" ? 0.88 : role === "aggregate" ? 0.58 : 0.66;
      const nodeAlpha = litNodes.size > 0 && !litNodes.has(n.id) ? (role === "core" ? 0.55 : 0.15) : restingAlpha;
      // An opaque backing in the page colour keeps connections
      // from showing through a translucent node body — they read as a line across the node
      // once you zoom in.
      ctx.globalAlpha = 1;
      ctx.beginPath();
      if (n.kind === "aggregate") ctx.roundRect(pos.x - 58, pos.y - 21, 116, 42, 7);
      else if (infrastructure) ctx.roundRect(pos.x - r, pos.y - r, r * 2, r * 2, 4);
      else ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.bg;
      ctx.fill();
      if (n.kind === "aggregate") {
        ctx.globalAlpha = nodeAlpha;
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.lineWidth = n.id === nodeFocus ? 2.5 : 1.5;
        // Likely decoys keep their warning colour even collapsed.
        const decoys = n.cluster?.kind === "decoy";
        ctx.strokeStyle = n.id === nodeFocus ? p.fg : decoys ? p.send : p.muted;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = decoys ? p.send : p.fg;
        ctx.fillText(n.cluster ? CLUSTER_LABELS[n.cluster.kind] : "", pos.x - 50, pos.y - 6, 100);
        ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = p.muted;
        ctx.fillText(`${n.cluster?.addresses.toLocaleString()} addresses · ${n.txCount.toLocaleString()} tx`, pos.x - 50, pos.y + 8, 100);
        continue;
      }
      ctx.globalAlpha = nodeAlpha;
      if (primaryNode) {
        ctx.globalAlpha = nodeAlpha * 0.14;
        ctx.fillStyle = p.fg;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = nodeAlpha;
      }
      ctx.beginPath();
      if (infrastructure) ctx.roundRect(pos.x - r, pos.y - r, r * 2, r * 2, 4);
      else ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = primaryNode ? p.fg : p.card;
      ctx.fill();
      ctx.lineWidth = n.id === nodeFocus ? 2.5 : role === "core" || role === "bridge" ? 2 : 1.5;
      ctx.strokeStyle = n.id === nodeFocus ? p.fg : n.kind === "program" || n.kind === "entity" ? p.program : n.kind === "burn" ? p.burn : role === "core" || role === "bridge" ? p.fg : p.muted;
      ctx.stroke();
      // Other mapped wallets get a centre dot, so they stay distinct from counterparties of any size.
      if (n.kind === "wallet" && !primaryNode) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = p.fg;
        ctx.fill();
      }
      // A look-alike (reads alike with another address in the case) gets a dashed halo: red for a likely decoy, amber otherwise.
      const lookalike = names.lookalikes(n.id).length > 0;
      if (lookalike) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = names.verdict(n.id) === "decoy" ? p.send : p.lookalike;
        ctx.lineWidth = 1.75;
        ctx.setLineDash([3, 2.5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (tier !== "far" && primaryNode) {
        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = p.muted;
        ctx.fillText("PRIMARY", pos.x, pos.y - r - 8);
      }
      // Label tiers: wallets, services, flagged addresses and the focus always; shared, named and busiest
      // counterparties from medium zoom; everything else close up.
      const showLabel =
        tier === "close" ||
        n.id === nodeFocus ||
        role === "core" ||
        n.kind === "entity" ||
        n.kind === "burn" ||
        lookalike ||
        (tier === "medium" && (role === "bridge" || known || topLabels.has(n.id)));
      if (!showLabel) continue;
      ctx.font = primaryNode ? "600 12px ui-sans-serif, system-ui, sans-serif" : known || n.kind === "wallet" ? "500 11px ui-sans-serif, system-ui, sans-serif" : "11px ui-monospace, monospace";
      const labelPosition = primaryNode ? { x: pos.x, y: pos.y + r + 7, align: "center" as const, baseline: "top" as const } : outwardText(pos, r);
      ctx.textAlign = labelPosition.align;
      ctx.textBaseline = labelPosition.baseline;
      // A halo in the background colour keeps labels readable over lines.
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.bg;
      ctx.strokeText(label, labelPosition.x, labelPosition.y);
      ctx.fillStyle = lookalike ? (names.verdict(n.id) === "decoy" ? p.send : p.lookalike) : known || n.kind === "wallet" ? p.fg : p.muted;
      ctx.fillText(label, labelPosition.x, labelPosition.y);
    }
    ctx.globalAlpha = 1;
  }, [segments]);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback((source: ReadonlyMap<string, Point> = positions.current) => {
    const canvas = canvasRef.current;
    if (!canvas || !zoomRef.current || source.size === 0) return;
    const { graph, primaryWallet, selectedNode, selectedEdge, visible } = latest.current;
    // Everything drawn, clusters included, so nothing sits off-screen or under the toolbar.
    const important = new Set<string>(visible ?? [primaryWallet, ...graph.nodes.map((node) => node.id)]);
    if (selectedNode) important.add(selectedNode);
    const selected = selectedEdge ? graph.edges.find((edge) => edge.id === selectedEdge) : undefined;
    if (selected) important.add(selected.a).add(selected.b);
    const pts = [...important].flatMap((id) => (source.get(id) ? [source.get(id)!] : []));
    if (pts.length === 0) return;
    const pad = 90;
    const x0 = Math.min(...pts.map((q) => q.x)) - pad;
    const x1 = Math.max(...pts.map((q) => q.x)) + pad;
    const y0 = Math.min(...pts.map((q) => q.y)) - pad;
    const y1 = Math.max(...pts.map((q) => q.y)) + pad;
    const { width, height } = sizeRef.current;
    // Zoom out as far as it takes to show every wallet: wide spacing can spread them well beyond one screen.
    const k = Math.min(1.15, Math.max(0.2, Math.min(width / (x1 - x0), height / (y1 - y0))));
    const t = zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, height / 2 - (k * (y0 + y1)) / 2).scale(k);
    select(canvas).call(zoomRef.current.transform, t);
  }, []);

  useEffect(schedule, [selectedNode, selectedEdge, names, visible, schedule]);
  // The value dots move, so the map redraws every frame while it's on screen.
  useEffect(() => {
    let animation = requestAnimationFrame(function tick() {
      draw();
      animation = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(animation);
  }, [draw]);
  // Entering or leaving isolation frames what's shown.
  useEffect(() => fit(), [isolated, fit]);

  // Size to the container, crisp on HiDPI, and redraw on theme change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const resize = () => {
      const width = canvas.parentElement?.clientWidth ?? 800;
      const height = canvas.parentElement?.clientHeight ?? 600;
      sizeRef.current = { width, height };
      setLayoutSize((current) => (current.width === width && current.height === height ? current : { width, height }));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    resize();
    const theme = matchMedia("(prefers-color-scheme: dark)");
    theme.addEventListener("change", schedule);
    return () => {
      observer.disconnect();
      theme.removeEventListener("change", schedule);
    };
  }, [fit, schedule]);

  const toWorld = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const [x, y] = transformRef.current.invert([event.clientX - rect.left, event.clientY - rect.top]);
    return { x, y };
  }, []);

  const hitAt = useCallback(
    (event: { clientX: number; clientY: number }): { node?: string; edge?: string } => {
      const w = toWorld(event);
      const { graph, selectedNode, selectedEdge, wallet, nodesById, layoutRoles, visible } = latest.current;
      const selectedRelationship = selectedEdge ? graph.edges.find((edge) => edge.id === selectedEdge) : undefined;
      const focused = hoverRef.current.node ?? selectedNode ?? (selectedRelationship ? edgePerspective(selectedRelationship, wallet, nodesById).counterparty : undefined);
      const hitNodes = graph.nodes.filter((node) => !visible || visible.has(node.id)).sort((a, b) => Number(a.id === focused) - Number(b.id === focused));
      for (let i = hitNodes.length - 1; i >= 0; i--) {
        const n = hitNodes[i];
        const pos = positions.current.get(n.id);
        if (!pos) continue;
        const radius = nodeRadius(n) + (layoutRoles.get(n.id) === "bridge" ? 3 : 0);
        if (n.kind === "aggregate" ? Math.abs(pos.x - w.x) <= 62 && Math.abs(pos.y - w.y) <= 25 : Math.hypot(pos.x - w.x, pos.y - w.y) <= radius + 4) return { node: n.id };
      }
      let best: { id: string; d: number } | null = null;
      for (const sgm of segments()) {
        if (tierRef.current === "far" && !latest.current.major.has(sgm.edge.id)) continue;
        const coreEdge = layoutRoles.get(sgm.edge.a) === "core" && layoutRoles.get(sgm.edge.b) === "core";
        const tolerance = (coreEdge ? 9 : 6) / transformRef.current.k;
        const d = distanceToPath(w, sgm);
        if (d < tolerance && (!best || d < best.d)) best = { id: sgm.edge.id, d };
      }
      return best ? { edge: best.id } : {};
    },
    [segments, toWorld],
  );

  // Pan and zoom, except when the press starts on a node (that drags the node).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .clickDistance(4)
      .filter((event: MouseEvent & TouchEvent) => {
        // Wheel and trackpad gestures are handled below (see graphWheelAction).
        if (event.type === "wheel") return false;
        if (event.button) return false;
        const point = event.touches?.[0] ?? event;
        return !hitAt(point).node;
      })
      .on("zoom", (event: { transform: ZoomTransform }) => {
        transformRef.current = event.transform;
        schedule();
      });
    zoomRef.current = behavior;
    select(canvas).call(behavior).on("dblclick.zoom", null);
    return () => {
      select(canvas).on(".zoom", null);
    };
  }, [hitAt, schedule]);

  // Pinch (or Ctrl/⌘ + wheel) zooms around the pointer; swipes and the plain wheel pan.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      const behavior = zoomRef.current;
      if (!behavior) return;
      event.preventDefault();
      const action = graphWheelAction(event);
      if (action.type === "zoom") {
        const rect = canvas.getBoundingClientRect();
        select(canvas).call(behavior.scaleBy, action.factor, [event.clientX - rect.left, event.clientY - rect.top]);
      } else {
        const k = transformRef.current.k;
        select(canvas).call(behavior.translateBy, -action.dx / k, -action.dy / k);
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Move existing nodes to new topology targets instead of abruptly rebuilding the graph.
  useEffect(() => {
    if (positions.current.size === 0) {
      positions.current = new Map(layout);
      fit(layout);
      schedule();
      return;
    }
    const from = new Map(positions.current);
    for (const [id, target] of layout) {
      if (from.has(id)) continue;
      const edge = graph.edges.find((item) => item.a === id || item.b === id);
      const parent = edge ? from.get(edge.a === id ? edge.b : edge.a) : undefined;
      from.set(id, parent ?? target);
    }
    fit(layout);
    const started = performance.now();
    let animation = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 320);
      const eased = 1 - (1 - progress) ** 3;
      positions.current = new Map(
        [...layout].map(([id, target]) => {
          const start = from.get(id) ?? target;
          return [id, { x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased }];
        }),
      );
      schedule();
      if (progress < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animation);
  }, [graph.edges, layout, fit, schedule]);

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Node graph of the wallet's counterparties, senders and programs. Click a node or edge to inspect it."
        className="absolute top-0 left-0 block touch-none"
        onPointerDown={(event) => {
          setHoverCard(null);
          const hit = hitAt(event);
          if (!hit.node || latest.current.nodesById.get(hit.node)?.kind === "aggregate") return;
          dragRef.current = { id: hit.node, x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag) {
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
            drag.moved = true;
            positions.current.set(drag.id, toWorld(event));
            schedule();
            return;
          }
          const hit = hitAt(event);
          const rect = event.currentTarget.getBoundingClientRect();
          const place = (card: Omit<HoverCard, "x" | "y" | "flipX" | "flipY">) =>
            setHoverCard({
              ...card,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              flipX: event.clientX - rect.left > rect.width - 300,
              flipY: event.clientY - rect.top > rect.height - 180,
            });
          if (hit.node !== hoverRef.current.node || hit.edge !== hoverRef.current.edge) {
            hoverRef.current = hit;
            schedule();
          }
          const node = hit.node ? latest.current.graph.nodes.find((n) => n.id === hit.node) : undefined;
          const edge = hit.edge
            ? latest.current.graph.edges.find((item) => item.id === hit.edge)
            : node && node.id !== latest.current.wallet
              ? (latest.current.relationshipsByNode.get(node.id) ?? latest.current.graph.edges.find((item) => item.a === node.id || item.b === node.id))
              : undefined;
          event.currentTarget.style.cursor = node?.kind === "aggregate" ? "pointer" : hit.node ? "grab" : hit.edge ? "pointer" : "";
          if (node?.cluster) {
            const { kind, addresses, wallets } = node.cluster;
            place({
              title: CLUSTER_LABELS[kind],
              kicker: "Collapsed addresses",
              lines: [
                `${addresses.toLocaleString()} addresses · ${node.txCount.toLocaleString()} transactions`,
                `With ${wallets.map((id) => latest.current.names.of(id)).join(", ")}`,
                ...(kind === "decoy" ? ["Look-alikes that only moved dust: likely address poisoning."] : []),
              ],
              hint: "Click to show these addresses",
            });
          } else if (node) {
            const facts = nodeFacts(node.id, latest.current.graph);
            const shared = node.kind !== "wallet" && facts.connected.length >= 2;
            place({
              title: latest.current.names.of(node.id),
              kicker:
                node.id === latest.current.primaryWallet
                  ? "Primary wallet"
                  : node.kind === "wallet"
                    ? "Mapped wallet"
                    : node.kind === "program"
                      ? "Program"
                      : node.kind === "burn"
                        ? "Burned tokens"
                        : node.kind === "entity"
                          ? `Service · ${node.entity!.addresses.length.toLocaleString()} address${node.entity!.addresses.length === 1 ? "" : "es"}`
                          : shared
                            ? "Shared counterparty"
                            : latest.current.names.known(node.id)
                              ? "Known address"
                              : "Unknown address",
              lines:
                node.kind === "burn"
                  ? ["Burned tokens leave supply; they don't reach any address. Bridges burn tokens to move them to another chain."]
                  : [
                      `${node.txCount.toLocaleString()} transactions${facts.assets ? ` · ${facts.assets.toLocaleString()} asset${facts.assets === 1 ? "" : "s"}` : ""}`,
                      ...(facts.first !== null && facts.last !== null ? [`${shortDate(facts.first)} → ${shortDate(facts.last)}`] : []),
                      ...(shared ? [`Connected to ${facts.connected.map((id) => latest.current.names.of(id)).join(", ")}`] : []),
                    ],
              hint: node.id === latest.current.wallet ? "Drag to reposition" : "Click for transaction details · drag to reposition",
            });
          } else if (edge) {
            const { counterparty, sent, received } = edgePerspective(edge, latest.current.wallet, latest.current.nodesById);
            const assets = (edge.summary?.assets.map((asset) => asset.assetId) ?? [...new Set(edge.interactions.flatMap((it) => it.movements.map((m) => m.assetId)))]).map(assetInfo);
            const flowTotal = sent + received;
            const flowSummary =
              edge.kind !== "interaction" || flowTotal === 0
                ? undefined
                : sent === 0
                  ? "Incoming only · 100%"
                  : received === 0
                    ? "Outgoing only · 100%"
                    : sent >= received
                      ? `Mostly outgoing · ${Math.round((sent / flowTotal) * 100)}%`
                      : `Mostly incoming · ${Math.round((received / flowTotal) * 100)}%`;
            place({
              title: latest.current.names.of(counterparty),
              kicker: edge.kind === "program" ? "Program connection" : "Wallet interaction",
              lines: [
                `${edge.interactions.length.toLocaleString()} ${edge.kind === "program" ? "program calls" : "transactions"}`,
                ...(edge.summary?.transactionTypes.length
                  ? [edge.summary.transactionTypes.slice(0, 3).map((type) => `${kindLabel(type.kind)} ${type.count.toLocaleString()}`).join(" · ")]
                  : []),
                ...(edge.summary?.assets.length
                  ? [edge.summary.assets.slice(0, 3).map((asset) => `${assetInfo(asset.assetId).label} ${asset.txCount.toLocaleString()} tx`).join(" · ")]
                  : []),
                ...(flowSummary ? [flowSummary] : []),
                ...(edge.kind === "interaction" ? [startedBy(edge, latest.current.names)] : []),
              ],
              flows:
                edge.kind === "interaction"
                  ? [
                      ...(sent ? [{ kind: "sent" as const, count: sent }] : []),
                      ...(received ? [{ kind: "received" as const, count: received }] : []),
                    ]
                  : undefined,
              assets,
              hint: "Click for transaction details",
            });
          } else {
            setHoverCard(null);
          }
        }}
        onPointerUp={() => {
          suppressClick.current = dragRef.current?.moved ?? false;
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          if (hoverRef.current.node || hoverRef.current.edge) {
            hoverRef.current = {};
            setHoverCard(null);
            schedule();
          }
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const hit = hitAt(event);
          if (hit.node) {
            const cluster = nodesById.get(hit.node)?.cluster;
            if (cluster) {
              setHoverCard(null);
              return onToggleCluster(cluster.kind);
            }
            const relationship = relationshipsByNode.get(hit.node);
            // The burn node isn't an address: it opens its burns, not an address panel.
            onSelectNode(hit.node === wallet || hit.node === BURNED_NODE_ID ? null : hit.node);
            onSelectEdge(hit.node === wallet ? null : (relationship?.id ?? null));
          } else if (hit.edge) {
            onSelectNode(null);
            onSelectEdge(hit.edge);
          } else {
            onSelectNode(null);
            onSelectEdge(null);
          }
        }}
      />

      {hoverCard && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 w-72 rounded-lg border bg-popover/95 p-3 text-xs shadow-xl backdrop-blur"
          style={{
            left: hoverCard.x,
            top: hoverCard.y,
            transform: `translate(${hoverCard.flipX ? "calc(-100% - 12px)" : "12px"}, ${hoverCard.flipY ? "calc(-100% - 12px)" : "12px"})`,
          }}
        >
          <p className="truncate font-medium text-foreground">{hoverCard.title}</p>
          {hoverCard.kicker && <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{hoverCard.kicker}</p>}
          <div className="mt-2 space-y-1 text-muted-foreground">
            {hoverCard.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          {hoverCard.flows && hoverCard.flows.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hoverCard.flows.map((flow) =>
                flow.kind === "sent" ? (
                  <span key={flow.kind} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive">
                    <ArrowUpRightIcon className="size-3.5" aria-hidden /> Sent {flow.count.toLocaleString()}
                  </span>
                ) : (
                  <span key={flow.kind} className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-500">
                    <ArrowDownLeftIcon className="size-3.5" aria-hidden /> Received {flow.count.toLocaleString()}
                  </span>
                ),
              )}
            </div>
          )}
          {hoverCard.assets && hoverCard.assets.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              {hoverCard.assets.slice(0, 7).map((asset) => (
                <AssetIcon key={asset.id} label={asset.label} logo={asset.logo} className="size-8 text-[9px]" />
              ))}
              {hoverCard.assets.length > 7 && <span className="text-[10px] text-muted-foreground">+{hoverCard.assets.length - 7}</span>}
            </div>
          )}
          <p className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">{hoverCard.hint}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-lg backdrop-blur">
          <label className="sr-only" htmlFor="graph-ranking">
            Rank addresses
          </label>
          <select
            id="graph-ranking"
            value={ranking}
            onChange={(event) => onRankingChange(event.target.value as GraphRanking)}
            className="h-7 rounded-md bg-transparent px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="significant">Significant</option>
            <option value="interactions">Most interactions</option>
            <option value="incoming">Most incoming</option>
            <option value="outgoing">Most outgoing</option>
            <option value="recent">Most recent</option>
          </select>
          <label className="sr-only" htmlFor="graph-node-limit">
            Address limit
          </label>
          <select
            id="graph-node-limit"
            value={nodeLimit ?? "all"}
            onChange={(event) => onNodeLimitChange(event.target.value === "all" ? null : (Number(event.target.value) as 10 | 25 | 50 | 100))}
            className="h-7 rounded-md bg-transparent px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {[10, 25, 50, 100].map((limit) => (
              <option key={limit} value={limit}>
                Top {limit}
              </option>
            ))}
            <option value="all">All</option>
          </select>
          <label className="sr-only" htmlFor="graph-spacing">
            Spacing
          </label>
          <select
            id="graph-spacing"
            value={spacing}
            title="How spread out the map is. Secondary wallets always sit beyond the primary's own counterparties."
            onChange={(event) => {
              const next = event.target.value as Spacing;
              setSpacing(next);
              localStorage.setItem(SPACING_KEY, next);
            }}
            className="h-7 rounded-md bg-transparent px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="compact">Compact</option>
            <option value="normal">Normal spacing</option>
            <option value="wide">Wide</option>
            <option value="widest">Very wide</option>
          </select>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => canvasRef.current && zoomRef.current && select(canvasRef.current).call(zoomRef.current.scaleBy, 1 / 1.4)}
          >
            <MinusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => canvasRef.current && zoomRef.current && select(canvasRef.current).call(zoomRef.current.scaleBy, 1.4)}
          >
            <PlusIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fit graph" title="Fit graph" onClick={() => fit()}>
            <MaximizeIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reset layout"
            title="Reset layout (undo node drags)"
            onClick={() => {
              positions.current = new Map(layout);
              fit();
              schedule();
            }}
          >
            <RotateCcwIcon />
          </Button>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button
            variant={showPrograms ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={showPrograms}
            title="Program calls are separate from wallet-to-wallet interactions and hidden by default"
            onClick={onToggleProgramCalls}
          >
            <WorkflowIcon />
            Program calls
          </Button>
          {[...expandedEntities].map((protocolId) => (
            <Button key={protocolId} variant="secondary" size="sm" title="Collapse these addresses back into one service" onClick={() => onToggleEntity(protocolId)}>
              {names.of(entityNodeId(protocolId))} addresses
              <XIcon />
            </Button>
          ))}
          {selectedNode && (nodesById.get(selectedNode)?.entity?.addresses.length ?? 0) > 1 && (
            <Button variant="ghost" size="sm" title="Draw this service's addresses separately" onClick={() => onToggleEntity(nodesById.get(selectedNode)!.entity!.protocolId)}>
              Show {nodesById.get(selectedNode)!.entity!.addresses.length.toLocaleString()} addresses
            </Button>
          )}
          {[...expandedClusters].map((kind) => (
            <Button key={kind} variant="secondary" size="sm" title={`Collapse ${CLUSTER_LABELS[kind].toLowerCase()} back into one box`} onClick={() => onToggleCluster(kind)}>
              {CLUSTER_LABELS[kind]}
              <XIcon />
            </Button>
          ))}
          {isolated ? (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
              <span className="max-w-48 truncate pl-1 text-xs" title={isolated}>
                Isolated: {nodeLabel(nodesById.get(isolated)!, names)}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Show the whole case" title="Show the whole case" onClick={() => setIsolated(null)}>
                <XIcon />
              </Button>
            </>
          ) : (
            selectedNode &&
            nodesById.has(selectedNode) && (
              <Button variant="ghost" size="sm" title="Show only this address, its direct counterparties and the connections among them" onClick={() => setIsolated(selectedNode)}>
                <FocusIcon />
                Isolate
              </Button>
            )
          )}
          {timeRange && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
              <span className="pl-1 text-xs tabular-nums">
                {new Date(timeRange.start).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} –{" "}
                {new Date(timeRange.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Clear timeline range" title="Show the full case range" onClick={onClearTimeRange}>
                <XIcon />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-auto absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border bg-popover/90 px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {graph.counts.addresses.toLocaleString()} addresses · {graph.counts.connections.toLocaleString()} connections ·{" "}
            {graph.counts.transactions.toLocaleString()} transactions
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label={legendOpen ? "Minimize graph legend" : "Expand graph legend"}
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((open) => !open)}
          >
            {legendOpen ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </Button>
        </div>
        {legendOpen && (
          <>
            <Legend color="bg-destructive">
              Sent from focus <span className="font-semibold text-destructive">→</span>
            </Legend>
            <Legend color="bg-emerald-500">
              <span className="font-semibold text-emerald-500">←</span> Received by focus
            </Legend>
            <Legend color="bg-muted-foreground">Both ways · red and green arrows · thicker line: more transactions</Legend>
            <span>Dots flow in the direction value moved · more dots: more value, against the largest flow of the same token</span>
            {showPrograms ? (
              <Legend color="border-t-2 border-dotted border-[oklch(0.7_0.14_250)] bg-transparent">Program called ({graph.counts.programConnections})</Legend>
            ) : (
              graph.counts.programConnections > 0 && <span>{graph.counts.programConnections.toLocaleString()} program connections hidden</span>
            )}
            <span className="flex items-center gap-2 pt-0.5">
              <span className="flex w-5 items-center justify-center gap-0.5" aria-hidden>
                <span className="size-1.5 rounded-full border border-muted-foreground" />
                <span className="size-3 rounded-full border border-muted-foreground" />
              </span>
              Bigger node · more transactions
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="size-2.5 rounded-full bg-foreground" />
              </span>
              Primary wallet
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="flex size-3 items-center justify-center rounded-full border border-foreground">
                  <span className="size-1 rounded-full bg-foreground" />
                </span>
              </span>
              Mapped wallet
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="size-3 rounded-full border border-muted-foreground" />
              </span>
              Counterparty · bright ring: shared by mapped wallets
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="size-2.5 rounded-[2px] border border-muted-foreground" />
              </span>
              Square: program or infrastructure · blue: a service standing for several of its addresses, select it to show them
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="size-3 rounded-full border border-dashed border-[oklch(0.77_0.16_70)]" />
              </span>
              Look-alike · starts and ends like another address · hover to see its twin
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="size-3 rounded-full border border-dashed border-destructive" />
              </span>
              Likely decoy · only moves dust while its look-alike moves real value
            </span>
            <span className="flex items-center gap-2">
              <span className="flex w-5 justify-center" aria-hidden>
                <span className="size-2 rotate-45 bg-foreground" />
              </span>
              Diamond at a line&apos;s end: that side approved (signed) the transactions · hollow in the middle: someone else did
            </span>
            <span>Hover a line for its details · click a node or line to inspect · select a node, then Isolate</span>
            <span>Zoomed out, only wallets, services, flagged addresses and the busiest lines are drawn; zoom in for the rest</span>
            {graph.omittedNodes > 0 && <span>Dashed boxes collapse {graph.omittedNodes.toLocaleString()} lower-ranked addresses by kind · click one to show its addresses</span>}
          </>
        )}
      </div>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-block h-0.5 w-5 ${color}`} aria-hidden />
      {children}
    </span>
  );
}
