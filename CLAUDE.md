ORB Modpack Exporter – Development Handoff

Project Overview
Build a desktop application for modpack developers to collaborate via GitHub, export Modrinth .mrpack files, and track changes. Use Electron + React + TypeScript for frontend, spawn child_process to call existing Python exporter (core.py, sync_mods.py). Include GitHub OAuth (repo scope). Store token securely using electron-store.

UI Reference
- Use the provided Figma design (via MCP Figma to code plugin) for exact component styling.
- Dark theme: Background #1E1E1E, Cards #323234, Text white #FFFFFF / secondary #A9A9AB.
- Accent colors: #E24729, #C665F2, #FF3F6E, #0890FE, #FFA809, #20AC64.
- Rounded corners (12px for cards, 8px for buttons), no borders, no outlines, no transparency.
- Font: Inter only.
- Icons: Lucide.

Main Dashboard Layout (single column + right sidebar)
- Header: Logo + "ORB Modpack Exporter" (left); GitHub avatar, settings cog, "Export New Version" button (#0890FE) (right).
- Activity Feed (main area): Cards showing commits with parsed mod/config changes (fetched via GitHub Compare API). Each card: user avatar, name, commit message, relative time, list of added/removed/updated mods (color-coded) and changed config files. Click item → open GitHub diff.
- Right Sidebar (width 280px):
  - Modpack Info: current dev version (from config.yaml), last local export time.
  - Team Sync: "Pull latest" (#20AC64) and "Push changes" (#0890FE) buttons. Status (branch, last pull time).
  - Bugs: List of open GitHub issues from configured repo, "Report a Bug" link (#FFA809).

Modals / Overlays
- Push Changes Modal (triggered by "Push changes"):
  - Dark overlay (rgba(0,0,0,0.75)).
  - Card: title, commit message textarea (required), read-only list of files to commit (config.yaml, manifests/*, .last_export_state.json), optional checkbox "Include local mod JARs" (disabled, not recommended).
  - Cancel + Push button (#0890FE).
  - On success: toast, close modal, refresh feed.

Backend Integration (Python)
- Existing files: core.py, sync_mods.py, config.yaml, Modpack_Exporter.bat.
- Electron app must:
  - Spawn python core.py with arguments? Actually core.build_export is a function. Better to keep same interface: call python -c "from core import build_export; ..." or spawn a small wrapper script.
  - For sync: python sync_mods.py (cwd = modpack root).
  - Read/write config.yaml directly (yaml library).
  - Manage .last_export_state.json (format: { version, timestamp, mods: {filename: sha1}, configs: {path: sha256} }).

GitHub Integration
- OAuth scopes: repo, read:user.
- Redirect URI: http://localhost:3000/callback (or custom scheme).
- Store token in electron-store.
- Use Octokit/rest.js.
- Fetch commits: GET /repos/{owner}/{repo}/commits?sha={branch}&per_page=20.
- Compare commits: GET /repos/{owner}/{repo}/compare/{base}...{head} – parse file diffs to extract mod/config changes (look for manifests/ and config.yaml changes). For mods, parse manifest JSON diffs.
- Pull: git pull via child_process (requires git installed). After pull, run sync_mods.py.
- Push: git add config.yaml manifests/ .last_export_state.json, git commit -m "message", git push.

Export Workflow
- "Export New Version": 
  - Read current version from config.yaml, auto-increment patch (or allow manual edit in modal?). Use modal to confirm variant (Standard/Lite), version, release type (dev/test/release).
  - Call core.build_export with parameters (root, config, pack_name, version, is_lite, is_release, export_dir, embed_unresolved=True).
  - After success: update .last_export_state.json, increment version in config.yaml (if release), refresh UI.

Requirements
- Node.js 18+, Python 3.10+.
- Electron Forge for packaging.
- React + Tailwind CSS for styling (or emotion/styled-components).
- Provide build instructions (npm run make).
- No external runtime dependencies beyond Node and Python.

Deliverables (to Claude)
- Full Electron app source code (main process, renderer, preload).
- React components for dashboard, modals, activity feed.
- GitHub OAuth handler.
- IPC handlers for Python calls.
- package.json with dependencies.
- README for setup.

Notes for Claude
- Use the Figma design as primary visual reference (import via MCP Figma plugin).
- Ensure UI matches colors, spacing, and component styling exactly.
- No log area, no console output visible to user (toast notifications for status).
- All buttons must have hover states (brighten by 10%).
- Handle errors gracefully (toast errors, no crashes).
- Platform: Windows (primary), but ensure cross‑platform compatibility.