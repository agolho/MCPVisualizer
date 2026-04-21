import { useEffect, useState } from "react";
import { WelcomeScreen } from "./WelcomeScreen";
import { ProjectView } from "./ProjectView";
import { UpdateBanner } from "./UpdateBanner";
import { api } from "./api";

type View = { kind: "welcome" } | { kind: "project"; id: string };

const LAST_KEY = "mcpviz:lastProjectId";

export function App() {
  const [view, setView] = useState<View>({ kind: "welcome" });
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      const last = localStorage.getItem(LAST_KEY);
      if (last) {
        try {
          await api.get(last);
          setView({ kind: "project", id: last });
        } catch {
          localStorage.removeItem(LAST_KEY);
        }
      }
      setBooted(true);
    })();
  }, []);

  const openProject = (id: string) => {
    localStorage.setItem(LAST_KEY, id);
    setView({ kind: "project", id });
  };

  const backToWelcome = () => {
    localStorage.removeItem(LAST_KEY);
    setView({ kind: "welcome" });
  };

  if (!booted) return <div style={{ padding: 24 }}>Loading…</div>;

  if (view.kind === "welcome") {
    return <WelcomeScreen onOpen={openProject} onUpdateBanner={<UpdateBanner />} />;
  }
  return (
    <ProjectView
      projectId={view.id}
      onBackToWelcome={backToWelcome}
      updateBanner={<UpdateBanner compact />}
    />
  );
}
