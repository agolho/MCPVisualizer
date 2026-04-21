import { useEffect, useState } from "react";
import { api, type ProjectMeta } from "./api";
import { getBridge } from "./electron";

interface Props {
  onOpen: (id: string) => void;
  onUpdateBanner?: React.ReactNode;
}

type CreateState =
  | { kind: "idle" }
  | { kind: "running"; jobId: string; log: string[] }
  | { kind: "error"; message: string };

export function WelcomeScreen({ onOpen, onUpdateBanner }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [createState, setCreateState] = useState<CreateState>({ kind: "idle" });
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const bridge = getBridge();

  const refresh = () =>
    api
      .list()
      .then((r) => setProjects(r.projects))
      .catch((e) => setErr(e.message));

  useEffect(() => {
    refresh();
    bridge?.appVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (createState.kind !== "running") return;
    const jobId = createState.jobId;
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        if (j.status === "done" && j.projectId) {
          await refresh();
          setCreateState({ kind: "idle" });
          setCreateOpen(false);
          setName("");
          setSource("");
          onOpen(j.projectId);
        } else if (j.status === "error") {
          setCreateState({ kind: "error", message: j.error ?? "unknown error" });
        } else {
          setCreateState({ kind: "running", jobId, log: j.log });
        }
      } catch (e) {
        setCreateState({ kind: "error", message: (e as Error).message });
      }
    };
    const h = setInterval(tick, 1000);
    tick();
    return () => clearInterval(h);
  }, [createState.kind === "running" ? createState.jobId : null]);

  const pickFolder = async () => {
    if (!bridge) return;
    const p = await bridge.selectFolder();
    if (p) {
      setSource(p);
      if (!name.trim()) {
        const base = p.split(/[\\/]/).filter(Boolean).pop() ?? "project";
        setName(base);
      }
    }
  };

  const submitCreate = async () => {
    if (!name.trim() || !source.trim()) return;
    try {
      const { jobId } = await api.create(name.trim(), source.trim());
      setCreateState({ kind: "running", jobId, log: [] });
    } catch (e) {
      setCreateState({ kind: "error", message: (e as Error).message });
    }
  };

  const handleImport = async () => {
    try {
      if (bridge) {
        const p = await bridge.importProjectDialog();
        if (!p) return;
        const { meta } = await api.importFromPath(p);
        await refresh();
        onOpen(meta.id);
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".mcpviz,.json,application/json";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          const raw = await f.text();
          try {
            const { meta } = await api.importFromRaw(raw);
            await refresh();
            onOpen(meta.id);
          } catch (e) {
            setErr((e as Error).message);
          }
        };
        input.click();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(id);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleExport = async (id: string, name: string) => {
    if (bridge) {
      try {
        const res = await fetch(api.exportUrl(id));
        const raw = await res.text();
        await bridge.exportProjectDialog({ suggestedName: `${name}.mcpviz`, content: raw });
      } catch (e) {
        setErr((e as Error).message);
      }
    } else {
      window.open(api.exportUrl(id), "_blank");
    }
  };

  return (
    <div style={{ height: "100vh", width: "100vw", overflowY: "auto", background: "#0b0d10" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px" }}>
        {onUpdateBanner}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-0.02em" }}>MCPVisualizer</h1>
          {appVersion && (
            <span style={{ opacity: 0.5, fontSize: 12 }}>v{appVersion}</span>
          )}
        </div>
        <p style={{ opacity: 0.65, marginTop: 8, marginBottom: 32 }}>
          Interactive neural-map of a Unity C# codebase. Pick a project to open, ingest a new one,
          or import a <code style={codeStyle}>.mcpviz</code> file shared by a colleague.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <button style={primaryBtn} onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? "Cancel" : "+ New project"}
          </button>
          <button style={ghostBtn} onClick={handleImport}>
            Import .mcpviz…
          </button>
          <button style={ghostBtn} onClick={refresh}>
            Refresh
          </button>
        </div>

        {createOpen && (
          <div style={cardStyle}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>New project</h3>
            <label style={labelStyle}>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-unity-project"
                style={inputStyle}
                disabled={createState.kind === "running"}
              />
            </label>
            <label style={labelStyle}>
              Source — local folder or git URL
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="C:\\path\\to\\unity-repo  OR  https://github.com/user/repo.git"
                  style={{ ...inputStyle, flex: 1 }}
                  disabled={createState.kind === "running"}
                />
                {bridge && (
                  <button
                    style={ghostBtn}
                    onClick={pickFolder}
                    disabled={createState.kind === "running"}
                  >
                    Browse…
                  </button>
                )}
              </div>
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                style={primaryBtn}
                onClick={submitCreate}
                disabled={createState.kind === "running" || !name.trim() || !source.trim()}
              >
                {createState.kind === "running" ? "Ingesting…" : "Ingest & create"}
              </button>
            </div>
            {createState.kind === "running" && (
              <pre style={logStyle}>
                {createState.log.slice(-12).join("\n") || "starting…"}
              </pre>
            )}
            {createState.kind === "error" && (
              <div style={{ marginTop: 12, color: "#ff8080", fontSize: 13, whiteSpace: "pre-wrap" }}>
                {createState.message}
              </div>
            )}
          </div>
        )}

        <h3 style={{ margin: "24px 0 12px", fontSize: 14, textTransform: "uppercase", opacity: 0.6 }}>
          Projects
        </h3>
        {err && <div style={{ color: "#ff8080", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        {!projects ? (
          <div style={{ opacity: 0.6 }}>Loading…</div>
        ) : projects.length === 0 ? (
          <div style={{ ...cardStyle, opacity: 0.7 }}>
            No projects yet. Create one above, or import a <code style={codeStyle}>.mcpviz</code> bundle.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {projects.map((p) => (
              <li key={p.id} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{p.name}</strong>
                    {p.portable && <span style={tagStyle}>portable</span>}
                    <span style={{ fontSize: 11, opacity: 0.55 }}>
                      {p.source.kind === "git" ? "🌐" : "📁"} {p.source.value}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
                    {p.stats ? `${p.stats.nodes} nodes · ${p.stats.edges} edges · ` : ""}
                    updated {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={primaryBtn} onClick={() => onOpen(p.id)}>
                    Open
                  </button>
                  <button style={ghostBtn} onClick={() => handleExport(p.id, p.name)}>
                    Export
                  </button>
                  <button style={dangerBtn} onClick={() => handleDelete(p.id, p.name)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  background: "#2a4a6a",
  color: "#e6e8eb",
  border: "1px solid #3a5a7a",
  borderRadius: 4,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  background: "#1a222c",
  color: "#e6e8eb",
  border: "1px solid #26303c",
  borderRadius: 4,
  cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  ...ghostBtn,
  color: "#ff9a9a",
  borderColor: "#3a2530",
};
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  background: "#0b0d10",
  color: "#e6e8eb",
  border: "1px solid #26303c",
  borderRadius: 4,
  width: "100%",
  marginTop: 4,
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  opacity: 0.7,
  marginBottom: 12,
};
const cardStyle: React.CSSProperties = {
  padding: 16,
  background: "#0f1317",
  border: "1px solid #1f2937",
  borderRadius: 8,
  marginBottom: 12,
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 12,
  background: "#0f1317",
  border: "1px solid #1f2937",
  borderRadius: 6,
};
const tagStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  background: "#2a3442",
  color: "#9abfde",
  borderRadius: 3,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const codeStyle: React.CSSProperties = {
  background: "#0b0d10",
  padding: "1px 4px",
  borderRadius: 3,
  fontSize: "0.9em",
};
const logStyle: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  background: "#0b0d10",
  border: "1px solid #1f2937",
  borderRadius: 4,
  fontSize: 11,
  maxHeight: 180,
  overflow: "auto",
  whiteSpace: "pre-wrap",
};
