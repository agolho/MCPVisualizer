import type { ParsedType } from "./csharp.js";
import type { UnityKind } from "@mcpviz/shared";

const MONO_BASES = new Set([
  "MonoBehaviour",
  "UnityEngine.MonoBehaviour",
  "NetworkBehaviour",
  "Mirror.NetworkBehaviour",
  "Unity.Netcode.NetworkBehaviour",
]);
const SO_BASES = new Set(["ScriptableObject", "UnityEngine.ScriptableObject"]);
const EDITOR_BASES = new Set([
  "Editor",
  "EditorWindow",
  "PropertyDrawer",
  "UnityEditor.Editor",
  "UnityEditor.EditorWindow",
  "UnityEditor.PropertyDrawer",
]);

function stripGenerics(s: string): string {
  const i = s.indexOf("<");
  return (i === -1 ? s : s.slice(0, i)).trim();
}

export function classifyUnityKind(t: ParsedType): UnityKind {
  if (t.kind === "interface") return "Interface";
  if (t.kind === "struct") return "Struct";
  if (t.kind === "enum") return "Enum";
  if (t.hasEditorAttr) return "Editor";
  if (t.isStatic) return "Static";
  for (const raw of t.bases) {
    const name = stripGenerics(raw);
    if (MONO_BASES.has(name)) return "MonoBehaviour";
    if (SO_BASES.has(name)) return "ScriptableObject";
    if (EDITOR_BASES.has(name)) return "Editor";
  }
  return "Plain";
}
