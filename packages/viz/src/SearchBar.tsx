import { useMemo, useState } from "react";
import type { Graph, GraphNode } from "@mcpviz/shared";

interface Props {
  graph: Graph;
  query: string;
  setQuery: (q: string) => void;
  onPick: (n: GraphNode) => void;
}

export function SearchBar({ graph, query, setQuery, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [graph, query]);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search folder or file…"
        style={{
          padding: "6px 10px",
          width: 260,
          background: "#111",
          color: "#e6e8eb",
          border: "1px solid #1f2937",
          borderRadius: 6,
          fontSize: 12,
          outline: "none",
        }}
      />
      {open && results.length > 0 && (
        <ul
          style={{
            position: "absolute",
            top: 32,
            left: 0,
            right: 0,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "#0f1317",
            border: "1px solid #1f2937",
            borderRadius: 6,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 10,
          }}
        >
          {results.map((n) => (
            <li
              key={n.id}
              onMouseDown={() => {
                onPick(n);
                setOpen(false);
              }}
              style={{
                padding: "6px 8px",
                cursor: "pointer",
                fontSize: 12,
                borderRadius: 4,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#1a222c")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ color: "#e6e8eb" }}>{n.label}</div>
              <div style={{ color: "#7a8494", fontSize: 11 }}>{n.path || "/"}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
