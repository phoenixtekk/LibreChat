---
title: Analytikul Coder — Deploy
description: How the first-class Deploy action ships a workspace project to a fleet server behind Cloudflare.
published: true
tags: analytikul-coder, deploy, pm2, cloudflare, runbook
editor: markdown
---

# Analytikul Coder — Deploy

The **Deploy** action ships a project you've built in a workspace folder to one of the linuxg fleet
servers and surfaces the Cloudflare route to make it public. It encapsulates the manually-proven
scaffold → push → deploy loop as a reliable, repeatable, **deterministic** routine — the deploy
steps are fixed code, not something the LLM improvises.

## Using it (Help Center)

1. Open the **Preview Rail** and select the **Deploy** tab (also reachable from the chat-header tab
   strip — the 🚀 rocket).
2. Choose:
   - **Project** — the workspace folder to deploy (under your `Analytikul_Coder` root).
   - **Server** — the target fleet server (`linuxg1`…`linuxg6`).
   - **App type** — leave on **auto** (detects static / Node / Next), or force one.
   - **Domain** / **Subdomain** *(optional)* — if you want a public URL. Blank subdomain =
     canonical `www.`; e.g. domain `example.com` → `www.example.com`.
3. Click **Deploy**. Live progress streams in the log: detect → copy → build → start → verify.
4. When it finishes you get a result card with the server, port, pm2 name, HTTP status, and — if you
   gave a domain — the **Cloudflare route to add** (copy button). Add that route in Cloudflare to go
   live; until then the app runs on the server behind the fleet firewall.

## How it works

| Step | What happens |
|------|--------------|
| Detect | Reads `package.json`: `next` dep → **next**; `start` script → **node**; else **static** (finds `index.html` in `.`/`public`/`dist`/`build`/`out`). |
| Copy | `rsync -az --delete` the source to `<server>:~/deploys/<project>` (excludes `.git`, `node_modules`, `.next`, `dist`, `.env`). Static copies just the folder holding `index.html`. |
| Build | node/next only: `npm ci` (falls back to `npm install`) then `npm run build` if a build script exists — **on the server** (avoids arch mismatch). |
| Start | Under **pm2** on a live-picked free port (8100–8139). Next binds `HOSTNAME=0.0.0.0` (fleet rule for the middleware-rewrite proxy); Node uses `PORT`; static uses `pm2 serve … --spa`. `pm2 save` persists across reboot. |
| Verify | `curl 127.0.0.1:<port>` on the server; the HTTP code is reported. |
| Route | Emits `"<host> → http://localhost:<port>"` for you to add in Cloudflare (we can't edit Cloudflare without a token). |

## Configuration (Admin)

- **`POWER_MODE=true`** — required. Deploy runs shell on production servers, so it is disabled
  unless power mode is on (`GET /agent/deploy/servers` returns `enabled:false` otherwise, and the
  panel shows a disabled notice).
- **SSH** — the adapter container deploys using the host `~/.ssh` mounted read-only at `/ssh-host`
  and staged to `~/.ssh` (600) at startup (`HOME_SSH_DIR` in `docker-compose.analytikul.yml`). The
  SSH host aliases (`linuxg1`…) must resolve for the mounted config.
- **Server allow-list** — `linuxg1..linuxg6`, enforced in both the backend route and `deploy.py`.
- **Ports** — deploy picks a free port in **8100–8139** on the target via live `ss` recon.

## Endpoints

- `POST /api/analytikul/agent/deploy` — `{ workspace, server, domain?, subdomain?, appType? }` →
  `{ taskId }` (JWT-auth, rate-limited, POWER_MODE-gated).
- `GET /api/analytikul/agent/deploy/stream/:taskId` — SSE progress (`status | log | done | error`).
- `GET /api/analytikul/agent/deploy/servers` — `{ enabled, servers[] }` for the UI.
- Adapter: `POST /deploy` (`analytikul_adapter/deploy.py`), streamed via the shared
  `/stream/{task_id}`.

## Troubleshooting

- **"Deploy is disabled (POWER_MODE off)"** — set `POWER_MODE=true` for the hermes-adapter and the
  backend, recreate/restart.
- **`cannot ssh to linuxgN`** — the mounted SSH key/alias isn't resolving in the container; confirm
  `HOME_SSH_DIR` is mounted and the host `~/.ssh/config` has the alias.
- **Build fails** — check the streamed log; run `npm ci && npm run build` manually in
  `~/deploys/<project>` on the server to reproduce.
- **App started but HTTP != 200** — a Node/Next app may need runtime env vars; check
  `pm2 logs atk-<project>` on the server.
- **Managing a deployed app** — it runs as pm2 `atk-<project>`:
  `pm2 restart|stop|delete atk-<project>`, `pm2 logs atk-<project>`.
