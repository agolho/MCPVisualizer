import { useEffect, useMemo, useState } from "react";
import type { Graph, GraphNode } from "@mcpviz/shared";
import { GraphView } from "./GraphView";
import { NodePanel } from "./NodePanel";
import { SearchBar } from "./SearchBar";
import { Legend } from "./Legend";
import { computeVisible, folderDepth } from "./visibility";
import { api, type ProjectMeta } from "./api";
import { getBridge } from "./electron";

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
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenPopoverOpen, setHiddenPopoverOpen] = useState(false);

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
          setHidden(new Set(m.viewState?.hidden ?? []));
        }
      })
      .catch((e) => setErr(e.message));

  // "Show methods" toggle: when on, walk every class and un-collapse the class plus
  // its full ancestor chain (file, folder, etc.) so methods actually render.
  const toggleShowMethods = () => {
    if (!graph) return;
    const next = !showMethods;
    setShowMethods(next);
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n] as const));
    setCollapsed((prev) => {
      const copy = new Set(prev);
      for (const n of graph.nodes) {
        if (n.kind !== "class") continue;
        if (next) {
          // Expand class + every ancestor.
          let cur: string | undefined = n.id;
          while (cur) {
            copy.delete(cur);
            cur = nodeMap.get(cur)?.parentId;
          }
        } else {
          copy.add(n.id);
        }
      }
      return copy;
    });
  };

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
          hidden: [...hidden],
          hideContainsEdges: hideContains,
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(h);
  }, [collapsed, hidden, hideContains, projectId, graph, meta]);

  const visible = useMemo(
    () => (graph ? computeVisible(graph, collapsed, hidden) : null),
    [graph, collapsed, hidden]
  );

  const hideNode = (id: string) => setHidden((s) => new Set(s).add(id));
  const unhideNode = (id: string) =>
    setHidden((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  const unhideAll = () => setHidden(new Set());

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

  const handleExport = async () => {
    if (!meta) return;
    const bridge = getBridge();
    try {
      if (bridge) {
        const res = await fetch(api.exportUrl(projectId));
        const raw = await res.text();
        await bridge.exportProjectDialog({
          suggestedName: `${meta.name}.mcpviz`,
          content: raw,
        });
      } else {
        window.open(api.exportUrl(projectId), "_blank");
      }
    } catch (e) {
      setErr((e as Error).message);
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
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <button onClick={onBackToWelcome} style={backBtn}>← Projects</button>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.name}</div>
        <div
          style={{
            fontSize: 11,
            opacity: 0.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: "0 1 auto",
          }}
          title={meta.source.value}
        >
          {meta.source.kind === "git" ? "🌐" : "📁"} {meta.source.value}
          {meta.portable && <span style={{ marginLeft: 8, opacity: 0.7 }}>(portable — view only)</span>}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} style={ghostBtn} title="Export as .mcpviz bundle">
          Export…
        </button>
        {canReingest && (
          <button onClick={handleReingest} style={ghostBtn} disabled={reingestBusy}>
            {reingestBusy ? "Re-ingesting…" : "Re-ingest"}
          </button>
        )}
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div
          style={{ flex: 1, position: "relative" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <GraphView
            graph={visible}
            onSelect={(n) => setSelectedId(n.id)}
            onToggleFolder={toggleCollapse}
            onHideNode={hideNode}
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
              title="Expand every class to show its methods"
            >
              <input
                type="checkbox"
                checked={showMethods}
                onChange={toggleShowMethods}
                style={{ accentColor: "#c896ff" }}
              />
              show methods
            </label>
            {hidden.size > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setHiddenPopoverOpen((v) => !v)}
                  style={{
                    padding: "6px 10px",
                    background: "#3a2530",
                    border: "1px solid #552a3a",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#ff9abf",
                    cursor: "pointer",
                  }}
                  title="Click to manage hidden nodes"
                >
                  Hidden {hidden.size}
                </button>
                {hiddenPopoverOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      background: "#0f1317",
                      border: "1px solid #1f2937",
                      borderRadius: 6,
                      padding: 8,
                      minWidth: 260,
                      maxHeight: 320,
                      overflowY: "auto",
                      zIndex: 20,
                      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase" }}>
                        Hidden nodes
                      </span>
                      <button
                        onClick={unhideAll}
                        style={{
                          padding: "2px 8px",
                          fontSize: 11,
                          background: "transparent",
                          color: "#6cb4ff",
                          border: "1px solid #26303c",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Unhide all
                      </button>
                    </div>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {[...hidden].map((id) => {
                        const n = nodeById.get(id);
                        return (
                          <li
                            key={id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "3px 0",
                              fontSize: 12,
                              color: "#c8d0d8",
                            }}
                          >
                            <span style={{ opacity: 0.5, fontSize: 10 }}>{n?.kind ?? "?"}</span>
                            <span
                              style={{
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={n?.path ?? id}
                            >
                              {n?.label ?? id}
                            </span>
                            <button
                              onClick={() => unhideNode(id)}
                              style={{
                                padding: "2px 6px",
                                fontSize: 11,
                                background: "#1a222c",
                                color: "#9ee39e",
                                border: "1px solid #26303c",
                                borderRadius: 3,
                                cursor: "pointer",
                              }}
                            >
                              Unhide
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <Legend />
        </div>
        {panelCollapsed ? (
          <button
            onClick={() => setPanelCollapsed(false)}
            style={railBtnStyle}
            title="Show details panel"
          >
            ‹
          </button>
        ) : (
          <NodePanel
            node={selected}
            graph={graph}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onReindexed={() => loadProject(true)}
            projectId={projectId}
            canIndexHere={canIndexHere}
            onCollapsePanel={() => setPanelCollapsed(true)}
            onHideNode={hideNode}
          />
        )}
      </div>
    </div>
  );
}

const railBtnStyle: React.CSSProperties = {
  width: 20,
  flexShrink: 0,
  background: "#0f1317",
  borderLeft: "1px solid #1f2937",
  border: "none",
  borderTop: "none",
  borderBottom: "none",
  color: "#8a95a3",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
  writingMode: "vertical-rl",
  textOrientation: "mixed",
};

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
