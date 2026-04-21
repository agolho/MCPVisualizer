import { useEffect, useState } from "react";
import { getBridge, type UpdateEvent } from "./electron";

interface Props {
  compact?: boolean;
}

export function UpdateBanner({ compact }: Props) {
  const [evt, setEvt] = useState<UpdateEvent | null>(null);
  const bridge = getBridge();

  useEffect(() => {
    if (!bridge) return;
    const off = bridge.onUpdateEvent((e) => setEvt(e));
    bridge.checkForUpdates().catch(() => {});
    return off;
  }, []);

  if (!bridge || !evt) return null;
  if (evt.type === "not-available" || evt.type === "checking") return null;

  const base: React.CSSProperties = {
    padding: compact ? "6px 12px" : "10px 16px",
    background: "#1f2a38",
    borderBottom: "1px solid #2a3a4c",
    color: "#c8d8ec",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 10,
  };

  if (evt.type === "available") {
    return (
      <div style={base}>
        <span>⬆ Update {evt.version} available — downloading…</span>
      </div>
    );
  }
  if (evt.type === "downloading") {
    return (
      <div style={base}>
        <span>Downloading update… {Math.round(evt.percent)}%</span>
      </div>
    );
  }
  if (evt.type === "downloaded") {
    return (
      <div style={base}>
        <span>✓ Update {evt.version} ready.</span>
        <button
          onClick={() => bridge.quitAndInstall()}
          style={{
            padding: "4px 10px",
            fontSize: 12,
            background: "#2a4a6a",
            color: "#e6e8eb",
            border: "1px solid #3a5a7a",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Restart to install
        </button>
      </div>
    );
  }
  if (evt.type === "error") {
    return (
      <div style={{ ...base, background: "#3a1f24", borderColor: "#4c2a30", color: "#eccac8" }}>
        <span>Update check failed: {evt.message}</span>
      </div>
    );
  }
  return null;
}
