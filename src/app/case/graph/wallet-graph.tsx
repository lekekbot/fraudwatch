"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon, MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon, WorkflowIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddressState } from "@/lib/case/address-state";
import { graphWheelAction } from "@/lib/gestures";
import { edgeFlow, OMITTED_NODE_ID, type GraphEdge, type GraphRanking, type WalletGraph as Graph } from "@/lib/graph/build";
import { layoutGraph, nodeRadius, type Point } from "@/lib/graph/layout";
import type { Names } from "@/lib/labels/labels";
import { AssetIcon } from "../asset-icon";

type Palette = Record<"fg" | "muted" | "border" | "card" | "bg" | "program" | "send" | "receive", string>;

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
  };
}

type Segment = { edge: GraphEdge; from: Point; to: Point };
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

function nodeLabel(node: { id: string; kind: string; txCount: number }, names: Names) {
  return node.kind === "aggregate" ? `Other addresses (${node.txCount})` : (names.known(node.id) ?? names.of(node.id, 4));
}

const kindLabel = (kind: string) => kind.replaceAll("_", " ").toLowerCase();

/** Distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
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
}: {
  graph: Graph;
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const sizeRef = useRef({ width: 800, height: 600 });
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<{ node?: string; edge?: string }>({});
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges, wallet), [graph, wallet]);
  // Positions start from the layout; dragging moves them without re-running it.
  const positions = useRef(new Map<string, Point>());
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
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

  const latest = useRef({ graph, wallet, names, stateOf, selectedNode, selectedEdge, nodesById, relationshipsByNode });
  // Drawing reads props through this ref; refresh it before any effect or frame uses it.
  useLayoutEffect(() => {
    latest.current = { graph, wallet, names, stateOf, selectedNode, selectedEdge, nodesById, relationshipsByNode };
  });

  const segments = useCallback((): Segment[] => {
    const out: Segment[] = [];
    for (const edge of latest.current.graph.edges) {
      const from = positions.current.get(edge.a);
      const to = positions.current.get(edge.b);
      if (from && to) out.push({ edge, from, to });
    }
    return out;
  }, []);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { names, stateOf, selectedNode, selectedEdge, graph, wallet, nodesById, relationshipsByNode } = latest.current;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const p = readPalette(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

    const hover = hoverRef.current;
    const focusEdge = selectedEdge ?? hover.edge ?? undefined;
    const focusNode = focusEdge ? undefined : (hover.node ?? selectedNode ?? undefined);
    const lit = (e: GraphEdge) => (focusEdge ? e.id === focusEdge : focusNode ? e.a === focusNode || e.b === focusNode : true);

    // Relationship significance changes opacity and bounded particle density, never stroke width.
    const line = 1.25 / t.k;
    const now = performance.now();
    const aggregate = positions.current.get(OMITTED_NODE_ID);
    const primary = positions.current.get(latest.current.wallet);
    if (aggregate && primary) {
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = p.muted;
      ctx.lineWidth = line;
      ctx.setLineDash([3 / t.k, 4 / t.k]);
      ctx.beginPath();
      ctx.moveTo(primary.x, primary.y);
      ctx.lineTo(aggregate.x, aggregate.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    for (const { edge, from, to } of segments()) {
      const on = lit(edge);
      const selected = edge.id === selectedEdge;
      const perspective = edgePerspective(edge, wallet, nodesById);
      const { sent, received } = perspective;
      const sentOnly = sent > 0 && received === 0;
      const receivedOnly = received > 0 && sent === 0;
      const intensity = Math.min(0.8, 0.45 + Math.log1p(edge.interactions.length) / 15);
      ctx.globalAlpha = on ? (selected ? 1 : intensity) : 0.12;
      ctx.strokeStyle =
        edge.kind === "program"
          ? p.program
          : sentOnly
            ? p.send
            : receivedOnly
              ? p.receive
              : selected || (on && (focusEdge || focusNode))
                ? p.fg
                : p.muted;
      ctx.lineWidth = selected ? 2 / t.k : line;
      const dotted = edge.kind === "program";
      ctx.setLineDash(dotted ? [2 / t.k, 4 / t.k] : []);
      ctx.lineCap = dotted ? "round" : "butt";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (edge.kind === "interaction") {
        const { reference, counterparty } = perspective;
        const flows = [
          ...(sent > 0 ? [{ source: reference, target: counterparty, count: sent, color: p.send }] : []),
          ...(received > 0 ? [{ source: counterparty, target: reference, count: received, color: p.receive }] : []),
        ];
        for (const flow of flows) {
          const source = positions.current.get(flow.source);
          const target = positions.current.get(flow.target);
          const targetNode = nodesById.get(flow.target);
          if (!source || !target) continue;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const length = Math.hypot(dx, dy) || 1;
          const ux = dx / length;
          const uy = dy / length;
          const inset = (targetNode ? nodeRadius(targetNode) : 10) + 1 / t.k;
          const tipX = target.x - ux * inset;
          const tipY = target.y - uy * inset;
          const arrow = (selected ? 7 : 5.5) / t.k;
          ctx.globalAlpha = on ? (selected || focusEdge === edge.id || focusNode ? 0.95 : 0.65) : 0.1;
          ctx.fillStyle = flow.color;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * arrow - uy * arrow * 0.55, tipY - uy * arrow + ux * arrow * 0.55);
          ctx.lineTo(tipX - ux * arrow + uy * arrow * 0.55, tipY - uy * arrow - ux * arrow * 0.55);
          ctx.closePath();
          ctx.fill();

          const particles = Math.min(5, Math.max(1, Math.round(Math.log1p(flow.count))));
          const phase = (edge.id.length % 17) / 17;
          for (let i = 0; i < particles; i++) {
            const progress = (now / 5000 + phase + i / particles) % 1;
            ctx.beginPath();
            ctx.arc(source.x + dx * progress, source.y + dy * progress, (selected ? 2.3 : 1.7) / t.k, 0, Math.PI * 2);
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
    const far = t.k < 0.55;
    const close = t.k > 1.25;
    const drawNodes = [...graph.nodes].sort((a, b) => Number(a.id === nodeFocus) - Number(b.id === nodeFocus));
    for (const n of drawNodes) {
      const pos = positions.current.get(n.id);
      if (!pos) continue;
      const r = nodeRadius(n);
      const known = n.kind === "aggregate" ? undefined : names.known(n.id);
      const label = nodeLabel(n, names);
      const relationship = relationshipsByNode.get(n.id);
      const relationshipFlow = relationship ? edgePerspective(relationship, wallet, nodesById) : undefined;
      const infrastructure = n.kind === "program" || (n.kind === "counterparty" && stateOf(n.id) === "INFRASTRUCTURE");
      ctx.globalAlpha = litNodes.size > 0 && !litNodes.has(n.id) ? 0.3 : 1;
      ctx.beginPath();
      if (infrastructure || n.kind === "aggregate") ctx.roundRect(pos.x - r, pos.y - r, r * 2, r * 2, 4);
      else ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.kind === "wallet" ? p.fg : p.card;
      ctx.fill();
      ctx.lineWidth = n.id === nodeFocus ? 2.5 : 1.5;
      ctx.strokeStyle = n.id === nodeFocus ? p.fg : n.kind === "program" ? p.program : n.kind === "wallet" || n.kind === "aggregate" ? p.fg : p.muted;
      ctx.stroke();
      if (!far && n.kind !== "wallet" && n.kind !== "aggregate" && n.txCount > 0) {
        const count = n.txCount.toLocaleString();
        ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
        const badgeWidth = ctx.measureText(count).width + 8;
        ctx.fillStyle = p.bg;
        ctx.strokeStyle = p.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pos.x - badgeWidth / 2, pos.y - r - 15, badgeWidth, 13, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.fg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(count, pos.x, pos.y - r - 8.5);
      }
      const showLabel = !far && (close || n.kind === "wallet" || n.kind === "aggregate" || names.label(n.id) || topLabels.has(n.id));
      if (!showLabel) continue;
      ctx.font = known || n.kind === "wallet" || n.kind === "aggregate" ? "500 11px ui-sans-serif, system-ui, sans-serif" : "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // A halo in the background colour keeps labels readable over lines.
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.bg;
      ctx.strokeText(label, pos.x, pos.y + r + 4);
      ctx.fillStyle = known || n.kind === "wallet" || n.kind === "aggregate" ? p.fg : p.muted;
      ctx.fillText(label, pos.x, pos.y + r + 4);
      if (relationshipFlow) {
        const total = relationshipFlow.sent + relationshipFlow.received;
        const sentRatio = total ? relationshipFlow.sent / total : 0;
        const direction = relationshipFlow.sent === 0 ? `← ${Math.round((relationshipFlow.received / total) * 100)}%` : relationshipFlow.received === 0 ? `→ ${Math.round(sentRatio * 100)}%` : sentRatio >= 0.6 ? `→ ${Math.round(sentRatio * 100)}%` : sentRatio <= 0.4 ? `← ${Math.round((1 - sentRatio) * 100)}%` : "↔ reciprocal";
        ctx.font = "500 9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = relationshipFlow.sent === 0 ? p.receive : relationshipFlow.received === 0 ? p.send : p.muted;
        ctx.fillText(direction, pos.x, pos.y + r + 18);
      }
    }
    ctx.globalAlpha = 1;
  }, [segments]);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !zoomRef.current || positions.current.size === 0) return;
    const pts = [...positions.current.values()];
    const pad = 60;
    const x0 = Math.min(...pts.map((q) => q.x)) - pad;
    const x1 = Math.max(...pts.map((q) => q.x)) + pad;
    const y0 = Math.min(...pts.map((q) => q.y)) - pad;
    const y1 = Math.max(...pts.map((q) => q.y)) + pad;
    const { width, height } = sizeRef.current;
    const k = Math.min(2, width / (x1 - x0), height / (y1 - y0));
    const t = zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, height / 2 - (k * (y0 + y1)) / 2).scale(k);
    select(canvas).call(zoomRef.current.transform, t);
  }, []);

  useEffect(schedule, [selectedNode, selectedEdge, names, schedule]);

  useEffect(() => {
    let animation = requestAnimationFrame(function tick() {
      draw();
      animation = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(animation);
  }, [draw]);

  // Size to the container, crisp on HiDPI, and redraw on theme change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const resize = () => {
      const width = canvas.parentElement?.clientWidth ?? 800;
      const height = canvas.parentElement?.clientHeight ?? 600;
      sizeRef.current = { width, height };
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
      const { graph, selectedNode, selectedEdge, wallet, nodesById } = latest.current;
      const selectedRelationship = selectedEdge ? graph.edges.find((edge) => edge.id === selectedEdge) : undefined;
      const focused = hoverRef.current.node ?? selectedNode ?? (selectedRelationship ? edgePerspective(selectedRelationship, wallet, nodesById).counterparty : undefined);
      const hitNodes = [...graph.nodes].sort((a, b) => Number(a.id === focused) - Number(b.id === focused));
      for (let i = hitNodes.length - 1; i >= 0; i--) {
        const n = hitNodes[i];
        const pos = positions.current.get(n.id);
        if (!pos) continue;
        if (Math.hypot(pos.x - w.x, pos.y - w.y) <= nodeRadius(n) + 4) return { node: n.id };
      }
      const tolerance = 6 / transformRef.current.k;
      let best: { id: string; d: number } | null = null;
      for (const sgm of segments()) {
        const d = distanceToSegment(w, sgm.from, sgm.to);
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

  // New graph: start from the layout and frame it. Declared after the size and
  // zoom effects so both exist on the first fit.
  useEffect(() => {
    positions.current = new Map(layout);
    fit();
    schedule();
  }, [layout, fit, schedule]);

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
          if (!hit.node || hit.node === OMITTED_NODE_ID) return;
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
          if (node?.kind === "aggregate") {
            place({ title: `Other addresses (${node.txCount.toLocaleString()})`, lines: ["Lower-ranked counterparties are collapsed here."], hint: "Click to reveal all addresses" });
          } else if (edge) {
            const { counterparty, sent, received } = edgePerspective(edge, latest.current.wallet, latest.current.nodesById);
            const assets = (edge.summary?.assets.map((asset) => asset.assetId) ?? [...new Set(edge.interactions.flatMap((it) => it.movements.map((m) => m.assetId)))]).map(assetInfo);
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
            if (hit.node === OMITTED_NODE_ID) return onNodeLimitChange(null);
            const relationship = relationshipsByNode.get(hit.node);
            onSelectNode(hit.node === wallet ? null : hit.node);
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
          <Button variant="ghost" size="icon-sm" aria-label="Fit graph" title="Fit graph" onClick={fit}>
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
              Outgoing from focus <span className="font-semibold text-destructive">→</span>
            </Legend>
            <Legend color="bg-emerald-500">
              <span className="font-semibold text-emerald-500">←</span> Incoming to focus
            </Legend>
            <Legend color="bg-muted-foreground">Bidirectional · red and green particles</Legend>
            {showPrograms ? (
              <Legend color="border-t-2 border-dotted border-[oklch(0.7_0.14_250)] bg-transparent">Program called ({graph.counts.programConnections})</Legend>
            ) : (
              graph.counts.programConnections > 0 && <span>{graph.counts.programConnections.toLocaleString()} program connections hidden</span>
            )}
            <span className="pt-0.5">Moving dots show direction · more dots mean more activity</span>
            <span>Badge: interactions · filled node: mapped wallet · click a node or line to inspect</span>
            {graph.omittedNodes > 0 && <span>Click Other addresses to reveal {graph.omittedNodes.toLocaleString()} more</span>}
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
