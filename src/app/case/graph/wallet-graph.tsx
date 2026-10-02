"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeftIcon, ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon, MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon, WorkflowIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddressState } from "@/lib/case/address-state";
import { graphWheelAction } from "@/lib/gestures";
import { edgeFlow, OMITTED_NODE_ID, type GraphEdge, type GraphNode, type GraphRanking, type WalletGraph as Graph } from "@/lib/graph/build";
import { classifyLayout, layoutGraph, nodeRadius, type Point } from "@/lib/graph/layout";
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

  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges, primaryWallet, layoutSize), [graph, primaryWallet, layoutSize]);
  // Positions start from the layout; dragging moves them without re-running it.
  const positions = useRef(new Map<string, Point>());
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const layoutRoles = useMemo(() => classifyLayout(graph.nodes, graph.edges), [graph]);
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

  const latest = useRef({ graph, wallet, primaryWallet, names, stateOf, selectedNode, selectedEdge, nodesById, layoutRoles, relationshipsByNode });
  // Drawing reads props through this ref; refresh it before any effect or frame uses it.
  useLayoutEffect(() => {
    latest.current = { graph, wallet, primaryWallet, names, stateOf, selectedNode, selectedEdge, nodesById, layoutRoles, relationshipsByNode };
  });

  const segments = useCallback((): Segment[] => {
    const out: Segment[] = [];
    const { graph } = latest.current;
    for (const edge of graph.edges) {
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
    const { names, stateOf, selectedNode, selectedEdge, graph, wallet, primaryWallet, nodesById, layoutRoles } = latest.current;
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
    const primary = positions.current.get(primaryWallet);
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
    for (const segment of segments()) {
      const { edge, from, to, control } = segment;
      const on = lit(edge);
      const selected = edge.id === selectedEdge;
      const coreEdge = layoutRoles.get(edge.a) === "core" && layoutRoles.get(edge.b) === "core";
      const bridgeEdge = layoutRoles.get(edge.a) === "bridge" || layoutRoles.get(edge.b) === "bridge";
      const perspective = edgePerspective(edge, wallet, nodesById);
      const { sent, received } = perspective;
      const sentOnly = sent > 0 && received === 0;
      const receivedOnly = received > 0 && sent === 0;
      const intensity = coreEdge ? Math.min(0.85, 0.72 + Math.log1p(edge.interactions.length) / 40) : bridgeEdge ? 0.52 : Math.min(0.48, 0.3 + Math.log1p(edge.interactions.length) / 24);
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
      ctx.lineWidth = selected ? 2 / t.k : coreEdge ? 1.5 / t.k : line;
      const dotted = edge.kind === "program";
      ctx.setLineDash(dotted ? [2 / t.k, 4 / t.k] : []);
      ctx.lineCap = dotted ? "round" : "butt";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (control) ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
      else ctx.lineTo(to.x, to.y);
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
          const flowSegment: Segment = { edge, from: source, to: target, control };
          const tangent = pathTangent(flowSegment, 1);
          const length = Math.hypot(tangent.x, tangent.y) || 1;
          const ux = tangent.x / length;
          const uy = tangent.y / length;
          const inset = (targetNode ? nodeRadius(targetNode) + (layoutRoles.get(targetNode.id) === "bridge" ? 3 : 0) : 10) + 1 / t.k;
          const tipX = target.x - ux * inset;
          const tipY = target.y - uy * inset;
          const arrow = (selected ? 7 : 5.5) / t.k;
          ctx.globalAlpha = on ? (selected || focusEdge === edge.id || focusNode ? 0.95 : 0.48) : 0.1;
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
            const point = pointOnPath(flowSegment, progress);
            ctx.beginPath();
            ctx.arc(point.x, point.y, (selected ? 2.3 : 1.7) / t.k, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (edge.kind === "interaction" && (coreEdge || selected || focusEdge === edge.id)) {
        const point = pointOnPath(segment, 0.72);
        const tangent = pathTangent(segment, 0.72);
        const length = Math.hypot(tangent.x, tangent.y) || 1;
        const side = [...edge.id].reduce((hash, char) => hash + char.charCodeAt(0), 0) % 2 ? 1 : -1;
        const badgeX = point.x + (-tangent.y / length) * (10 / t.k) * side;
        const badgeY = point.y + (tangent.x / length) * (10 / t.k) * side;
        const count = edge.interactions.length.toLocaleString();
        ctx.font = `600 ${9 / t.k}px ui-sans-serif, system-ui, sans-serif`;
        const badgeWidth = ctx.measureText(count).width + 8 / t.k;
        ctx.globalAlpha = on ? (selected ? 1 : 0.9) : 0.12;
        ctx.fillStyle = p.bg;
        ctx.strokeStyle = p.border;
        ctx.lineWidth = 1 / t.k;
        ctx.beginPath();
        ctx.roundRect(badgeX - badgeWidth / 2, badgeY - 6.5 / t.k, badgeWidth, 13 / t.k, 4 / t.k);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.fg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(count, badgeX, badgeY);
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
      const role = layoutRoles.get(n.id) ?? "peripheral";
      const r = nodeRadius(n) + (role === "bridge" ? 3 : 0);
      const known = n.kind === "aggregate" ? undefined : names.known(n.id);
      const label = nodeLabel(n, names);
      const infrastructure = n.kind === "program" || (n.kind === "counterparty" && stateOf(n.id) === "INFRASTRUCTURE");
      const primaryNode = n.id === primaryWallet;
      const restingAlpha = role === "core" ? 1 : role === "bridge" ? 0.88 : role === "aggregate" ? 0.58 : 0.66;
      const nodeAlpha = litNodes.size > 0 && !litNodes.has(n.id) ? 0.18 : restingAlpha;
      ctx.globalAlpha = nodeAlpha;
      if (n.kind === "aggregate") {
        ctx.beginPath();
        ctx.roundRect(pos.x - 58, pos.y - 21, 116, 42, 7);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.lineWidth = n.id === nodeFocus ? 2.5 : 1.5;
        ctx.strokeStyle = n.id === nodeFocus ? p.fg : p.muted;
        ctx.stroke();
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = p.fg;
        ctx.fillText("Other addresses", pos.x - 47, pos.y - 6);
        ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = p.muted;
        ctx.fillText(`${n.txCount.toLocaleString()} wallets`, pos.x - 47, pos.y + 8);
        continue;
      }
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
      ctx.strokeStyle = n.id === nodeFocus ? p.fg : n.kind === "program" ? p.program : role === "core" || role === "bridge" ? p.fg : p.muted;
      ctx.stroke();
      if (!far && primaryNode) {
        ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = p.muted;
        ctx.fillText("PRIMARY", pos.x, pos.y - r - 8);
      }
      const showLabel = !far && (close || role === "core" || role === "bridge" || names.label(n.id) || topLabels.has(n.id));
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
      ctx.fillStyle = known || n.kind === "wallet" ? p.fg : p.muted;
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
    const { graph, primaryWallet, selectedNode, selectedEdge } = latest.current;
    const important = new Set<string>([primaryWallet, ...graph.nodes.filter((node) => node.kind === "wallet").map((node) => node.id)]);
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
    const k = Math.min(1.15, Math.max(0.65, Math.min(width / (x1 - x0), height / (y1 - y0))));
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
      const { graph, selectedNode, selectedEdge, wallet, nodesById, layoutRoles } = latest.current;
      const selectedRelationship = selectedEdge ? graph.edges.find((edge) => edge.id === selectedEdge) : undefined;
      const focused = hoverRef.current.node ?? selectedNode ?? (selectedRelationship ? edgePerspective(selectedRelationship, wallet, nodesById).counterparty : undefined);
      const hitNodes = [...graph.nodes].sort((a, b) => Number(a.id === focused) - Number(b.id === focused));
      for (let i = hitNodes.length - 1; i >= 0; i--) {
        const n = hitNodes[i];
        const pos = positions.current.get(n.id);
        if (!pos) continue;
        const radius = nodeRadius(n) + (layoutRoles.get(n.id) === "bridge" ? 3 : 0);
        if (n.kind === "aggregate" ? Math.abs(pos.x - w.x) <= 62 && Math.abs(pos.y - w.y) <= 25 : Math.hypot(pos.x - w.x, pos.y - w.y) <= radius + 4) return { node: n.id };
      }
      let best: { id: string; d: number } | null = null;
      for (const sgm of segments()) {
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
          } else if (node) {
            place({
              title: latest.current.names.of(node.id),
              kicker: node.id === latest.current.primaryWallet ? "Primary wallet" : node.kind === "wallet" ? "Mapped wallet" : node.kind === "program" ? "Program" : "Address",
              lines: [`${node.txCount.toLocaleString()} ${node.kind === "program" ? "program calls" : "transactions"}`],
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
