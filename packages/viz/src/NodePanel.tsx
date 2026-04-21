import { useState } from "react";
import type { Graph, GraphNode } from "@mcpviz/shared";
import { nodeColor } from "./colors";
import { api } from "./api";

interface Props {
  node: GraphNode | null;
  graph: Graph;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onReindexed?: () => void;
  projectId?: string;
  canIndexHere?: boolean;
}

type IndexState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "error"; message: string }
  | { kind: "done"; durationMs: number; numTurns?: number };

export function NodePanel({
  node,
  graph,
  collapsed,
  onToggleCollapse,
  onReindexed,
  projectId,
  canIndexHere,
}: Props) {
  const [indexState, setIndexState] = useState<IndexState>({ kind: "idle" });

  const children = node ? graph.nodes.filter((n) => n.parentId === node.id) : [];
  const isCollapsed = node ? collapsed.has(node.id) : false;
  const isDarkFolder =
    node?.kind === "folder" && (!node.docs || node.docs.length === 0) && canIndexHere;

  const handleIndexHere = async () => {
    if (!node || node.kind !== "folder" || !projectId) return;
    setIndexState({ kind: "running", startedAt: Date.now() });
    try {
      const j = await api.indexHere(projectId, node.path);
      if (!j.ok) {
        setIndexState({ kind: "error", message: j.error ?? "failed" });
        return;
      }
      setIndexState({ kind: "done", durationMs: j.durationMs ?? 0, numTurns: j.numTurns });
      onReindexed?.();
    } catch (e) {
      setIndexState({ kind: "error", message: (e as Error).message });
    }
  };

  return (
    <aside
      style={{
        width: 360,
        borderLeft: "1px solid #1f2937",
        padding: 16,
        overflowY: "auto",
        background: "#0f1317",
      }}
    >
      {!node ? (
        <p style={{ opacity: 0.6 }}>
          Click a node to inspect. Click a folder to expand/collapse.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>
            {node.kind}
            {node.unityKind ? ` · ${node.unityKind}` : ""}
          </div>
          <h2 style={{ margin: "4px 0 8px", fontSize: 18 }}>{node.label}</h2>
          <code style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-all" }}>
            {node.path || "/"}
          </code>

          {node.kind === "folder" && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => onToggleCollapse(node.id)}
                style={buttonStyle}
              >
                {isCollapsed ? `Expand (${children.length})` : "Collapse"}
              </button>
              {typeof node.fileCount === "number" && (
                <span style={{ fontSize: 12, opacity: 0.65 }}>
                  {node.fileCount} direct files
                </span>
              )}
            </div>
          )}

          {isDarkFolder && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px dashed #3a4656",
                borderRadius: 6,
                background: "#131b24",
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                DARK FOLDER — no CLAUDE.md or docs
              </div>
              <button
                onClick={handleIndexHere}
                disabled={indexState.kind === "running"}
                style={{
                  ...buttonStyle,
                  background: "#2a4a6a",
                  borderColor: "#3a5a7a",
                  cursor: indexState.kind === "running" ? "wait" : "pointer",
                }}
              >
                {indexState.kind === "running" ? "indexing with claude…" : "🔎 Index here"}
              </button>
              <div style={{ marginTop: 8, fontSize: 11, opacity: 0.6, lineHeight: 1.4 }}>
                Runs <code>claude -p</code> locally. Asks Claude to read the folder's <code>.cs</code> files
                and write a <code>CLAUDE.md</code> here. No API key needed — uses your Claude Code login.
              </div>
              {indexState.kind === "error" && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#ff8080", whiteSpace: "pre-wrap" }}>
                  {indexState.message}
                </div>
              )}
              {indexState.kind === "done" && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#9ee39e" }}>
                  ✓ done in {(indexState.durationMs / 1000).toFixed(1)}s
                  {indexState.numTurns ? ` (${indexState.numTurns} turns)` : ""}
                </div>
              )}
            </div>
          )}

          {node.summary && (
            <>
              <h4 style={{ marginTop: 16 }}>Summary</h4>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>{node.summary}</p>
            </>
          )}

          {node.docs?.length ? (
            <>
              <h4 style={{ marginTop: 16 }}>Docs ({node.docs.length})</h4>
              {node.docs.map((d, i) => (
                <pre
                  key={i}
                  style={{
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    background: "#0b0d10",
                    padding: 8,
                    borderRadius: 4,
                    maxHeight: 240,
                    overflow: "auto",
                  }}
                >
                  {d.slice(0, 2000)}
                  {d.length > 2000 ? "\n…" : ""}
                </pre>
              ))}
            </>
          ) : null}

          {children.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>Children ({children.length})</h4>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {children.slice(0, 50).map((c) => (
                  <li
                    key={c.id}
                    style={{
                      padding: "2px 0",
                      fontSize: 12,
                      color: nodeColor(c),
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: nodeColor(c),
                        flexShrink: 0,
                      }}
                    />
                    <span>{c.label}</span>
                    {c.unityKind && c.kind === "class" && (
                      <span style={{ opacity: 0.5, fontSize: 10 }}>{c.unityKind}</span>
                    )}
                  </li>
                ))}
                {children.length > 50 && (
                  <li style={{ fontSize: 12, opacity: 0.5 }}>
                    …and {children.length - 50} more
                  </li>
                )}
              </ul>
            </>
          )}
        </>
      )}
    </aside>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  background: "#1a222c",
  color: "#e6e8eb",
  border: "1px solid #26303c",
  borderRadius: 4,
  cursor: "pointer",
};
