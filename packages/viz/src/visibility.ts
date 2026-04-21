import type { Graph, GraphEdge, GraphNode } from "@mcpviz/shared";

export function folderDepth(path: string): number {
  if (!path) return 0;
  return path.split("/").length;
}

export function computeVisible(graph: Graph, collapsed: Set<string>): Graph {
  const byId = new Map<string, GraphNode>();
  const childrenOf = new Map<string, string[]>();
  for (const n of graph.nodes) byId.set(n.id, n);
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }

  const hidden = new Set<string>();
  const walk = (rootId: string) => {
    const stack = [...(childrenOf.get(rootId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (hidden.has(id)) continue;
      hidden.add(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
  };
  for (const id of collapsed) walk(id);

  const visibleNodes = graph.nodes.filter((n) => !hidden.has(n.id));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = graph.edges.filter((e: GraphEdge) => {
    const s = typeof e.source === "string" ? e.source : (e.source as any).id;
    const t = typeof e.target === "string" ? e.target : (e.target as any).id;
    return visibleIds.has(s) && visibleIds.has(t);
  });

  return { ...graph, nodes: visibleNodes, edges: visibleEdges };
}

export function subtreeIds(graph: Graph, rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of childrenOf.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

export function neighborIds(graph: Graph, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of graph.edges) {
    const s = typeof e.source === "string" ? e.source : (e.source as any).id;
    const t = typeof e.target === "string" ? e.target : (e.target as any).id;
    if (s === id) out.add(t);
    if (t === id) out.add(s);
  }
  return out;
}
