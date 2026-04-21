import { useEffect, useMemo, useState } from "react";
import type { Graph, GraphNode } from "@mcpviz/shared";
import { GraphView } from "./GraphView";
import { NodePanel } from "./NodePanel";
import { SearchBar } from "./SearchBar";
import { Legend } from "./Legend";
import { computeVisible, folderDepth } from "./visibility";
import { api, type ProjectMeta } from "./api";

interface Props {
  projectId: string;
  onBackToWelcome: () => void;
  updateBanner?: React.ReactNode;
}

export function ProjectView({ projectId, onBackToWelcome, updateBanner }: Props) {
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusSubtree, setFocusSubtree] = useState<{ id: string; tick: number } | null>(null);
  const [hideContains, setHideContains] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reingestBusy, setReingestBusy] = useState(false);

  const loadProject = (preserveCollapsed = false) =>
    api
      .get(projectId)
      .then(({ meta: m, graph: g }) => {
        setMeta(m);
        setGraph(g);
        if (!preserveCollapsed) {
          const saved = m.viewState?.collapsed;
          if (saved && saved.length > 0) {
            setCollapsed(new Set(saved));
          } else {
            const init = new Set<string>();
            for (const n of g.nodes) {
              if (n.kind === "folder" && folderDepth(n.path) >= 2) init.add(n.id);
              if (n.kind === "file") init.add(n.id);
              if (n.kind === "class") init.add(n.id);
            }
            setCollapsed(init);
          }
          if (typeof m.viewState?.hideContainsEdges === "boolean") {
            setHideContains(m.viewState.hideContainsEdges);
          }
        }
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    setErr(null);
    setMeta(null);
    setGraph(null);
    loadProject(false);
  }, [projectId]);

  // Debounced save of view state (collapsed + toggles) back to the server.
  useEffect(() => {
    if (!graph || !meta) return;
    const h = setTimeout(() => {
      api
        .saveViewState(projectId, {
          collapsed: [...collapsed],
          hideContainsEdges: hideContains,
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(h);
  }, [collapsed, hideContains, projectId, graph, meta]);

  const visible = useMemo(
    () => (graph ? computeVisible(graph, collapsed) : null),
    [graph, collapsed]
  );

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    if (graph) for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFocusSubtree((prev) => ({ id, tick: (prev?.tick ?? 0) + 1 }));
  };

  const expandAllAncestors = (id: string) => {
    if (!graph) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let cur: string | undefined = id;
      while (cur) {
        next.delete(cur);
        cur = nodeById.get(cur)?.parentId;
      }
      return next;
    });
  };

  const handleReingest = async () => {
    if (!meta) return;
    setReingestBusy(true);
    try {
      await api.reingest(projectId);
      await loadProject(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setReingestBusy(false);
    }
  };

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Could not load project</h2>
        <p style={{ opacity: 0.75 }}>{err}</p>
        <button onClick={onBackToWelcome} style={backBtn}>← Back to projects</button>
      </div>
    );
  }
  if (!graph || !visible || !meta) return <div style={{ padding: 24 }}>Loading graph…</div>;

  const canReingest = !meta.portable && meta.localRootDir;
  const canIndexHere = !meta.portable && !!meta.localRootDir;

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", flexDirection: "column" }}>
      {updateBanner}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "6px 12px",
          background: "#0f1317",
          borderBottom: "1px solid #1f2937",
          flexShrink: 0,
        }}
      >
        <button onClick={onBackToWelcome} style={backBtn}>← Projects</button>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.name}</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>
          {meta.source.kind === "git" ? "🌐" : "📁"} {meta.source.value}
          {meta.portable && <span style={{ marginLeft: 8, opacity: 0.7 }}>(portable — view only)</span>}
        </div>
        <div style={{ flex: 1 }} />
        {canReingest && (
          <button onClick={handleReingest} style={ghostBtn} disabled={reingestBusy}>
            {reingestBusy ? "Re-ingesting…" : "Re-ingest"}
          </button>
        )}
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <GraphView
            graph={visible}
            onSelect={(n) => setSelectedId(n.id)}
            onToggleFolder={toggleCollapse}
            focusId={focusId}
            onFocusConsumed={() => setFocusId(null)}
            focusSubtree={focusSubtree}
            hideContainsEdges={hideContains}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <SearchBar
              graph={graph}
              query={query}
              setQuery={setQuery}
              onPick={(n) => {
                expandAllAncestors(n.id);
                setSelectedId(n.id);
                setFocusId(n.id);
              }}
            />
            <div
              style={{
                padding: "6px 10px",
                background: "#111a",
                borderRadius: 6,
                fontSize: 12,
                color: "#9aa3ad",
              }}
            >
              {visible.nodes.length}/{graph.nodes.length} nodes · {visible.edges.length}/
              {graph.edges.length} edges
            </div>
            <label
              style={{
                padding: "6px 10px",
                background: "#111a",
                borderRadius: 6,
                fontSize: 12,
                color: "#c8d0d8",
                cursor: "pointer",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <input
                type="checkbox"
                checked={hideContains}
                onChange={(e) => setHideContains(e.target.checked)}
                style={{ accentColor: "#6cb4ff" }}
              />
              wiring only
            </label>
          </div>
          <Legend />
        </div>
        <NodePanel
          node={selected}
          graph={graph}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onReindexed={() => loadProject(true)}
          projectId={projectId}
          canIndexHere={canIndexHere}
        />
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 12,
  background: "#1a222c",
  color: "#e6e8eb",
  border: "1px solid #26303c",
  borderRadius: 4,
  cursor: "pointer",
};
const backBtn: React.CSSProperties = { ...ghostBtn };
