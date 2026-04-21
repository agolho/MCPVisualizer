import { useMemo, useState } from "react";
import type { Graph, GraphEdge, GraphNode } from "@mcpviz/shared";
import { nodeColor } from "./colors";

interface Props {
  graph: Graph;
  onClose: () => void;
  onJumpTo: (nodeId: string) => void;
}

type Tab = "hubs" | "methods" | "folders" | "kinds";

const WIRING_KINDS = new Set([
  "inherits",
  "calls",
  "references",
  "gets-component",
  "serialized-ref",
  "doc-relation",
]);

function edgeEndpoints(e: GraphEdge): [string, string] {
  const s = typeof e.source === "string" ? e.source : (e.source as { id: string }).id;
  const t = typeof e.target === "string" ? e.target : (e.target as { id: string }).id;
  return [s, t];
}

interface HubRow {
  node: GraphNode;
  incoming: number;
  outgoing: number;
  total: number;
}

interface EdgeKindBreakdown {
  kind: string;
  count: number;
}

export function StatsModal({ graph, onClose, onJumpTo }: Props) {
  const [tab, setTab] = useState<Tab>("hubs");

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);

  const stats = useMemo(() => {
    const inCount = new Map<string, number>();
    const outCount = new Map<string, number>();
    const inByKind = new Map<string, Map<string, number>>();
    const kindCount = new Map<string, number>();

    for (const e of graph.edges) {
      const [s, t] = edgeEndpoints(e);
      if (!WIRING_KINDS.has(e.kind)) continue; // exclude structural "contains"
      inCount.set(t, (inCount.get(t) ?? 0) + 1);
      outCount.set(s, (outCount.get(s) ?? 0) + 1);
      kindCount.set(e.kind, (kindCount.get(e.kind) ?? 0) + 1);
      const km = inByKind.get(t) ?? new Map<string, number>();
      km.set(e.kind, (km.get(e.kind) ?? 0) + 1);
      inByKind.set(t, km);
    }

    // Folder-level rollup: for every wiring edge touching a node, credit every
    // ancestor folder. Gives a "what folder is most depended on" view.
    const folderIncoming = new Map<string, number>();
    const ancestorsOf = (id: string) => {
      const out: string[] = [];
      let cur: string | undefined = nodeById.get(id)?.parentId;
      while (cur) {
        out.push(cur);
        cur = nodeById.get(cur)?.parentId;
      }
      return out;
    };
    for (const e of graph.edges) {
      if (!WIRING_KINDS.has(e.kind)) continue;
      const [, t] = edgeEndpoints(e);
      for (const anc of ancestorsOf(t)) {
        const ancNode = nodeById.get(anc);
        if (ancNode?.kind === "folder") {
          folderIncoming.set(anc, (folderIncoming.get(anc) ?? 0) + 1);
        }
      }
    }

    const hubs: HubRow[] = graph.nodes.map((n) => {
      const inc = inCount.get(n.id) ?? 0;
      const out = outCount.get(n.id) ?? 0;
      return { node: n, incoming: inc, outgoing: out, total: inc + out };
    });

    const topHubs = hubs
      .filter((h) => h.total > 0 && h.node.kind !== "folder")
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);

    const topMethods = hubs
      .filter((h) => h.node.kind === "method" && h.incoming > 0)
      .sort((a, b) => b.incoming - a.incoming)
      .slice(0, 50);

    const topFolders = graph.nodes
      .filter((n) => n.kind === "folder")
      .map((n) => ({ node: n, incoming: folderIncoming.get(n.id) ?? 0 }))
      .filter((r) => r.incoming > 0)
      .sort((a, b) => b.incoming - a.incoming)
      .slice(0, 50);

    const edgeKindBreakdown: EdgeKindBreakdown[] = [...kindCount.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);

    return { topHubs, topMethods, topFolders, edgeKindBreakdown, inByKind };
  }, [graph, nodeById]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: "100%",
          maxHeight: "90vh",
          background: "#0f1317",
          border: "1px solid #1f2937",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid #1f2937",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>Project stats</h3>
          <div style={{ fontSize: 11, opacity: 0.6, marginRight: 12 }}>
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </div>
          <button onClick={onClose} style={closeBtn}>
            ✕
          </button>
        </div>
        <div style={{ display: "flex", borderBottom: "1px solid #1f2937" }}>
          {(
            [
              ["hubs", "Top hubs"],
              ["methods", "Most-called methods"],
              ["folders", "Most-depended folders"],
              ["kinds", "Edge kinds"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                ...tabBtn,
                color: tab === key ? "#e6e8eb" : "#8a95a3",
                borderBottom: tab === key ? "2px solid #6cb4ff" : "2px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {tab === "hubs" && (
            <LeaderTable
              rows={stats.topHubs.map((r) => ({
                node: r.node,
                right: `${r.incoming} in · ${r.outgoing} out`,
                score: r.total,
              }))}
              emptyText="No wiring edges in this project yet — try ingesting a codebase with cross-references."
              onJumpTo={(id) => {
                onJumpTo(id);
                onClose();
              }}
            />
          )}
          {tab === "methods" && (
            <LeaderTable
              rows={stats.topMethods.map((r) => ({
                node: r.node,
                right: `${r.incoming} callers`,
                score: r.incoming,
              }))}
              emptyText="No method-call edges — expand 'show methods' and re-ingest if needed."
              onJumpTo={(id) => {
                onJumpTo(id);
                onClose();
              }}
            />
          )}
          {tab === "folders" && (
            <LeaderTable
              rows={stats.topFolders.map((r) => ({
                node: r.node,
                right: `${r.incoming} incoming`,
                score: r.incoming,
              }))}
              emptyText="No folder-level dependencies yet."
              onJumpTo={(id) => {
                onJumpTo(id);
                onClose();
              }}
            />
          )}
          {tab === "kinds" && (
            <div style={{ padding: "8px 16px", fontSize: 13 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {stats.edgeKindBreakdown.map((r) => (
                    <tr key={r.kind} style={{ borderBottom: "1px solid #1a222c" }}>
                      <td style={{ padding: "6px 8px", color: "#c8d0d8" }}>{r.kind}</td>
                      <td
                        style={{
                          padding: "6px 8px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {r.count}
                      </td>
                    </tr>
                  ))}
                  {stats.edgeKindBreakdown.length === 0 && (
                    <tr>
                      <td style={{ padding: 12, opacity: 0.5 }}>no edges</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface LeaderRow {
  node: GraphNode;
  right: string;
  score: number;
}

function LeaderTable({
  rows,
  emptyText,
  onJumpTo,
}: {
  rows: LeaderRow[];
  emptyText: string;
  onJumpTo: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <div style={{ padding: 20, opacity: 0.55, fontSize: 13 }}>{emptyText}</div>;
  }
  const max = rows[0].score || 1;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.node.id}
            style={{ borderBottom: "1px solid #1a222c", cursor: "pointer" }}
            onClick={() => onJumpTo(r.node.id)}
          >
            <td
              style={{ padding: "6px 4px 6px 16px", width: 24, color: "#8a95a3", fontVariantNumeric: "tabular-nums" }}
            >
              {i + 1}
            </td>
            <td style={{ padding: "6px 8px", width: 14 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: nodeColor(r.node),
                }}
              />
            </td>
            <td style={{ padding: "6px 8px", color: "#e6e8eb" }}>
              <div style={{ fontWeight: 500 }}>{r.node.label}</div>
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.55,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 420,
                }}
              >
                {r.node.kind}
                {r.node.unityKind ? ` · ${r.node.unityKind}` : ""} · {r.node.path || "/"}
              </div>
            </td>
            <td
              style={{
                padding: "6px 16px 6px 8px",
                textAlign: "right",
                color: "#9aa3ad",
                fontVariantNumeric: "tabular-nums",
                width: 120,
              }}
            >
              <div>{r.right}</div>
              <div
                style={{
                  height: 3,
                  background: "#6cb4ff44",
                  marginTop: 2,
                  width: `${(r.score / max) * 100}%`,
                  marginLeft: "auto",
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tabBtn: React.CSSProperties = {
  padding: "10px 14px",
  background: "transparent",
  border: "none",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#c8d0d8",
  cursor: "pointer",
  fontSize: 16,
  padding: "2px 8px",
};
