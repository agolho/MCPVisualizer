import type { GraphNode } from "@mcpviz/shared";

// Kind-level defaults. Class/method colors only apply when no unityKind override matches.
const KIND_COLOR: Record<GraphNode["kind"], string> = {
  folder: "#6cb4ff",  // blue
  file: "#6b7380",    // grey
  class: "#ffb86c",   // orange (fallback for unknown-unityKind classes)
  method: "#8be9fd",  // cyan
  field: "#c792ea",   // purple
};

// Unity-kind overrides for class nodes. Picked to be distinct under low-alpha dimming too.
const UNITY_COLOR: Record<string, string> = {
  MonoBehaviour: "#b4ff6c",    // bright green — the main Unity thing
  ScriptableObject: "#c792ea", // purple — data container
  Editor: "#ffd76c",           // yellow — editor-only
  Interface: "#79c0ff",        // light blue
  Struct: "#b8bec7",           // light grey
  Enum: "#556070",             // dim grey — usually trivial
  Static: "#ff9f78",           // salmon — utilities
  Plain: "#ffb86c",            // orange — default class
};

export function nodeColor(n: Pick<GraphNode, "kind" | "unityKind">): string {
  if (n.kind === "class" && n.unityKind && UNITY_COLOR[n.unityKind]) {
    return UNITY_COLOR[n.unityKind];
  }
  return KIND_COLOR[n.kind] ?? "#888";
}

// Edge colors by kind. "contains" is the structural spine — muted.
// Wiring edges are saturated so they read over the structural mesh.
export const EDGE_COLOR: Record<string, string> = {
  contains:         "rgba(255,255,255,0.10)",
  inherits:         "rgba(121,192,255,0.85)",  // light blue — "is-a"
  "serialized-ref": "rgba(199,146,234,0.85)",  // purple — Unity Inspector
  "gets-component": "rgba(255,215,108,0.90)",  // yellow — runtime GetComponent
  references:       "rgba(180,180,180,0.70)",
  calls:            "rgba(139,233,253,0.85)",
  "doc-relation":   "rgba(180,255,108,0.55)",
};

export function edgeColor(kind: string, highlighted: boolean): string {
  if (highlighted) {
    // Boost to full alpha when highlighted
    const base = EDGE_COLOR[kind] ?? EDGE_COLOR.references;
    return base.replace(/[\d.]+\)$/, "1)");
  }
  return EDGE_COLOR[kind] ?? "rgba(255,255,255,0.20)";
}

// Legend entries in display order.
export const LEGEND: Array<{ label: string; color: string; kindHint: string }> = [
  { label: "Folder",         color: KIND_COLOR.folder,          kindHint: "folder" },
  { label: "File",           color: KIND_COLOR.file,            kindHint: "file" },
  { label: "MonoBehaviour",  color: UNITY_COLOR.MonoBehaviour,  kindHint: "class" },
  { label: "ScriptableObject", color: UNITY_COLOR.ScriptableObject, kindHint: "class" },
  { label: "Editor",         color: UNITY_COLOR.Editor,         kindHint: "class" },
  { label: "Interface",      color: UNITY_COLOR.Interface,      kindHint: "class" },
  { label: "Static",         color: UNITY_COLOR.Static,         kindHint: "class" },
  { label: "Struct",         color: UNITY_COLOR.Struct,         kindHint: "class" },
  { label: "Plain class",    color: UNITY_COLOR.Plain,          kindHint: "class" },
  { label: "Enum",           color: UNITY_COLOR.Enum,           kindHint: "class" },
  { label: "Method",         color: KIND_COLOR.method,          kindHint: "method" },
];
