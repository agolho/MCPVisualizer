import { useState } from "react";
import { LEGEND } from "./colors";

export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        background: "#0f1317e8",
        border: "1px solid #1f2937",
        borderRadius: 6,
        padding: open ? "8px 10px" : "4px 8px",
        fontSize: 11,
        color: "#c8d0d8",
        minWidth: open ? 170 : undefined,
      }}
    >
      <div
        style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ opacity: 0.6 }}>{open ? "▾" : "▸"}</span>
        <strong style={{ fontWeight: 500 }}>Legend</strong>
      </div>
      {open && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
          {LEGEND.map((e) => (
            <li
              key={e.label}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: e.color,
                  border: e.label === "Interface" ? "2px solid #0b0d10" : "none",
                  boxSizing: "border-box",
                }}
              />
              <span>{e.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
