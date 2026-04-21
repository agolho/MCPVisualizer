import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide } from "d3-force";
import type { Graph, GraphNode } from "@mcpviz/shared";
import { neighborIds, subtreeIds } from "./visibility";
import { nodeColor, edgeColor } from "./colors";

interface Props {
  graph: Graph;
  onSelect: (n: GraphNode) => void;
  onToggleFolder: (id: string) => void;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  focusSubtree?: { id: string; tick: number } | null;
  hideContainsEdges?: boolean;
}

function nodeRadius(n: GraphNode): number {
  if (n.kind === "folder") {
    const count = n.fileCount ?? 1;
    return 3 + Math.sqrt(count) * 1.2;
  }
  if (n.kind === "file") return 1.8;
  return 2.5;
}

export function GraphView({
  graph,
  onSelect,
  onToggleFolder,
  focusId,
  onFocusConsumed,
  focusSubtree,
  hideContainsEdges,
}: Props) {
  const fgRef = useRef<any>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: window.innerWidth - 360, h: window.innerHeight });

  useEffect(() => {
    const on = () => setDims({ w: window.innerWidth - 360, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const data = useMemo(() => {
    const kindOrder: Record<string, number> = { folder: 0, file: 1, class: 2, method: 3, field: 3 };
    const nodes = graph.nodes
      .slice()
      .sort((a, b) => {
        const d = nodeRadius(b) - nodeRadius(a);
        if (d !== 0) return d;
        return (kindOrder[a.kind] ?? 5) - (kindOrder[b.kind] ?? 5);
      })
      .map((n) => ({ ...n }));
    const links = graph.edges
      .filter((e) => !(hideContainsEdges && e.kind === "contains"))
      .map((e) => ({ ...e }));
    return { nodes, links };
  }, [graph, hideContainsEdges]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("link")?.distance((link: any) => (link.kind === "contains" ? 22 : 50));
    fg.d3Force("charge")?.strength(-60);
    // Weaken center pull so expanding a branch doesn't drag the rest of the graph toward origin.
    fg.d3Force("center")?.strength?.(0.05);
    fg.d3Force(
      "collide",
      forceCollide<any>((n) => nodeRadius(n) + 3).strength(0.9)
    );
    fg.d3ReheatSimulation?.();
  }, [data]);

  useEffect(() => {
    if (!focusId || !fgRef.current) return;
    const t = setTimeout(() => {
      const n: any = data.nodes.find((x: any) => x.id === focusId);
      if (n && typeof n.x === "number") {
        fgRef.current.centerAt(n.x, n.y, 600);
        fgRef.current.zoom(4, 600);
      }
      onFocusConsumed?.();
    }, 150);
    return () => clearTimeout(t);
  }, [focusId, data, onFocusConsumed]);

  // Frame the subtree when the user expands/collapses a folder.
  // Waits for the sim to settle with newly-visible nodes before fitting, so the
  // camera lands on the final layout, not a transient midpoint.
  useEffect(() => {
    if (!focusSubtree || !fgRef.current) return;
    const fg = fgRef.current;
    const ids = subtreeIds(graph, focusSubtree.id);
    const visibleIds = new Set(data.nodes.map((n: any) => n.id));
    for (const id of ids) if (!visibleIds.has(id)) ids.delete(id);
    if (ids.size === 0) return;
    const t = setTimeout(() => {
      fg.zoomToFit(700, 80, (n: any) => ids.has(n.id));
    }, 450);
    return () => clearTimeout(t);
  }, [focusSubtree, graph, data]);

  const highlight = hoverId ? neighborIds(graph, hoverId) : null;

  const drawNode = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode & { x: number; y: number };
    const r = nodeRadius(n);
    const dim = highlight && !highlight.has(n.id);
    const alpha = dim ? 0.18 : 1;

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor(n);
    ctx.fill();
    if (n.kind === "class" && n.unityKind === "Interface") {
      // Hollow ring for interfaces so they read as "contract" not "thing"
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(0.8, r * 0.25);
      ctx.strokeStyle = "#0b0d10";
      ctx.stroke();
      ctx.restore();
    }

    if (n.kind === "folder") {
      // Label visibility: always for hovered/highlighted, else LOD by size + zoom
      const isEmphasis = hoverId === n.id || (highlight?.has(n.id) ?? false);
      const sizeScore = (n.fileCount ?? 1) * globalScale;
      const showLabel = isEmphasis || sizeScore > 6 || globalScale > 2.2;
      if (showLabel) {
        const fontSize = Math.max(10 / globalScale, 2.5);
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isEmphasis ? "#fff" : "#c8d0d8";
        ctx.fillText(n.label, n.x, n.y + r + 1);
      }
    }
    ctx.globalAlpha = 1;
  };

  return (
    <ForceGraph2D
      ref={fgRef}
      width={dims.w}
      height={dims.h}
      graphData={data}
      nodeId="id"
      nodeLabel={(n: any) =>
        `<div style="font-family:system-ui;font-size:12px">
           <b>${n.label}</b><br/>
           <span style="opacity:0.7">${n.kind}${n.unityKind ? " · " + n.unityKind : ""}</span><br/>
           <span style="opacity:0.6">${n.path || "/"}</span>
         </div>`
      }
      nodeVal={(n: any) => nodeRadius(n) ** 2}
      nodeCanvasObjectMode={() => "replace"}
      nodeCanvasObject={drawNode}
      nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
        // Exact-match hit area so dense clusters pick the node under the cursor,
        // not whatever nodeVal approximation the default uses.
        const r = nodeRadius(node) + 1; // 1px tolerance so tiny file dots stay grabbable
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
      }}
      linkColor={(l: any) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        const touched = hoverId && (s === hoverId || t === hoverId);
        if (hoverId && !touched) return "rgba(255,255,255,0.03)";
        return edgeColor(l.kind ?? "contains", !!touched);
      }}
      linkWidth={(l: any) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        const touched = hoverId && (s === hoverId || t === hoverId);
        const base = l.kind === "contains" ? 0.5 : 1.1;
        return touched ? base + 1.2 : base;
      }}
      linkDirectionalArrowLength={(l: any) => (l.kind === "contains" ? 0 : 3)}
      linkDirectionalArrowRelPos={0.92}
      linkDirectionalArrowColor={(l: any) => edgeColor(l.kind ?? "contains", false)}
      cooldownTicks={180}
      d3VelocityDecay={0.3}
      backgroundColor="#0b0d10"
      onNodeHover={(n: any) => setHoverId(n ? n.id : null)}
      onNodeClick={(n: any) => {
        const node = n as GraphNode;
        onSelect(node);
        if (node.kind === "folder") onToggleFolder(node.id);
      }}
    />
  );
}
