# Analytikul Coder — Desktop shell (Phase 3)

A native desktop window for the Analytikul web app that **bundles the local bridge and
starts it automatically**, so "Build on my machine" works with nothing to launch by hand.
It's the Approach B counterpart to the web + bridge flow.

## What it does today

- Opens `https://analytikul.ai` in a native window (no browser chrome).
- Spawns the bundled bridge (`services/coder-bridge/bridge.mjs`) in-process on launch and
  stops it on quit. The bridge reuses its saved pairing (`~/.analytikul-coder-bridge.json`),
  so after pairing once from the rail there's nothing else to do.
- External links (docs, OAuth) open in the system browser.

## Run it (dev)

```bash
cd services/coder-desktop
npm install        # downloads Electron (~150 MB) the first time
npm start
```

Point it at a different origin with `ANALYTIKUL_URL=https://localhost:3090 npm start`.

## Package

```bash
npm run dist       # electron-builder -> dist/win-unpacked (portable app + bundled bridge)
```

`npm run dist` produces a **portable** build under `dist/win-unpacked/` (run
`Analytikul Coder.exe` directly — no install). The bridge is bundled at
`resources/coder-bridge/` and started in-process.

**Signed NSIS installer:** building a `.exe` installer needs electron-builder to extract its
`winCodeSign` cache, which contains macOS symlinks Windows can only create with elevated rights.
Enable **Settings → Privacy & security → For developers → Developer Mode** (or run the build as
Administrator), then set `win.target` back to `"nsis"` and re-run `npm run dist`.

## Roadmap (next)

- **Auto-pair:** obtain a pairing code from the logged-in session in the window (via a
  preload IPC bridge calling `/api/analytikul/bridge/pair`) and hand it to the spawned
  bridge — zero manual pairing in the desktop app.
- **Bundle the client** for offline/local-first loading instead of the remote origin.
- **In-process execution:** run the bridge's tool logic inside the app process rather than
  as a child, and (optionally) a local model runner.
- Auto-update via electron-builder's update feed.
