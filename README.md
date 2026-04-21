# MCPVisualizer

Interactive "neural map" of a large Unity C# codebase — bootstrapped from `CLAUDE.md` files and source, rendered as a force-directed graph you can navigate, hover, and zoom.

Ships as a **desktop app** with project open / save / import / export and **auto-updates from GitHub Releases**.

## Packages

- `packages/shared` — graph types shared between ingester and viz
- `packages/ingester` — Node server + CLI: ingests a local path or git URL and manages projects
- `packages/viz` — Vite + React + react-force-graph-2d frontend
- `packages/app` — Electron shell with auto-updater

## Dev quickstart (no Electron)

```bash
npm install
# Terminal 1 — backend (stores projects under ~/.mcpviz/)
npm run serve
# Terminal 2 — frontend with HMR
npm run viz
```

Open http://localhost:5173 and create a project from the welcome screen. Point it at a local path (`C:/path/to/unity/repo`) or a git URL.

## Dev quickstart (Electron)

```bash
npm install
npm run app:dev
```

Launches the Electron window, which spawns the server in-process and loads the Vite dev server. Projects live in the Electron `userData` dir.

## Building a release

The Electron app publishes to **GitHub Releases**; every install checks for updates on launch.

1. Edit `packages/app/electron-builder.yml` — set `publish.owner` to your GitHub org/user and `publish.repo` to the repository name.
2. Bump `packages/app/package.json` version (e.g. `0.1.1`).
3. Tag + push:
   ```bash
   git tag v0.1.1
   git push --tags
   ```
4. The `Release` workflow (`.github/workflows/release.yml`) builds the app on Windows and publishes a draft GitHub Release. Open the draft on github.com, add release notes, and publish.
5. Colleagues running the previous version see an "Update available" banner on next launch; one click to install.

### Local packaging (no publish)

```bash
# unpacked build in packages/app/release/win-unpacked/
npm run app:pack
# full installer in packages/app/release/
npm run app:dist
```

## Project format

Projects are stored at `<userData>/projects/<id>/`:

- `project.json` — metadata (name, source, viewState, stats)
- `graph.json` — the ingested graph

**Export** writes a single `.mcpviz` JSON bundle — share it with colleagues, they import it and view the graph without needing the original source. Portable projects are view-only (no re-ingest, no "Index here").

## CLI (optional, power-user)

```bash
npm run ingest -- "C:/path/to/unity/repo" -o graph.json
npm run serve -- --data-dir ./.mcpviz-dev --port 3001
```

## Status

- [x] Multi-project store with create/open/delete/import/export
- [x] Electron desktop shell with native dialogs
- [x] Auto-update from GitHub Releases
- [x] tree-sitter C# parsing (classes/methods/fields)
- [x] Unity-aware edges (MonoBehaviour, SerializeField, GetComponent<T>)
- [x] Claude-powered "Index here" for dark folders (uses local `claude -p` — no API key)
- [ ] Claude folder-level summaries (CLAUDE.md-wide)
- [ ] Cross-folder relationship inference
