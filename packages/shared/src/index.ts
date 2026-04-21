export type NodeKind = "folder" | "file" | "class" | "method" | "field";

export type UnityKind =
  | "MonoBehaviour"
  | "ScriptableObject"
  | "Editor"
  | "Interface"
  | "Struct"
  | "Enum"
  | "Static"
  | "Plain";

export type EdgeKind =
  | "contains"        // folder -> child folder/file/symbol
  | "inherits"        // class -> base class / interface
  | "calls"           // method -> method (source-derived, phase 4+)
  | "references"      // symbol -> symbol (field type, parameter, etc.)
  | "gets-component"  // Unity GetComponent<T>() -> T
  | "serialized-ref"  // [SerializeField] field -> referenced type
  | "doc-relation";   // Claude-inferred from CLAUDE.md summaries

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  path: string;          // repo-relative; for symbols "file.cs#Symbol"
  parentId?: string;
  unityKind?: UnityKind;
  summary?: string;      // Claude-generated, optional
  docs?: string[];       // raw doc excerpts (CLAUDE.md etc.)
  loc?: number;          // lines of code (files/symbols)
  fileCount?: number;    // folders only
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
  evidence?: string;     // where we inferred this from (file:line or doc path)
}

export interface GraphMeta {
  source: { kind: "path" | "git"; value: string; commit?: string };
  generatedAt: string;
  stats: { files: number; folders: number; classes: number; methods: number };
  warnings: string[];
}

export interface Graph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
