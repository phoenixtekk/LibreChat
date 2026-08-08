---
title: OpenClaw on the AI Box — Analytikul.ai Integration
description: Containerized OpenClaw (personal AI assistant) on the AI Box, surfaced and managed through Analytikul.ai. Deploy done; embed + manage panel planned.
published: true
tags: analytikul, openclaw, aibox, integration, planning
editor: markdown
---

# OpenClaw on the AI Box — Analytikul.ai Integration

**Owner:** Lacy · **Status:** Container live (verified) → embed + manage (next)

## What OpenClaw is
`openclaw/openclaw` — an open-source **single-operator personal AI assistant**: a **Gateway**
(control plane) + **Control UI** (web) + CLI/TUI, connecting models, tools, and messaging channels
(WhatsApp/Telegram/Slack/Discord/…). TypeScript, ships a Dockerfile + prebuilt image
(`ghcr.io/openclaw/openclaw`). It is powerful and sensitive (connects personal channels, runs tools).

## Decisions (locked)
- **Scope:** one shared, **admin-gated** instance (matches OpenClaw's single-operator design).
- **Models:** the AI Box **Ollama** (`qwen2.5-coder:32b`), no cloud keys.
- **Surface:** embed the **Control UI** in Analytikul + a **manage panel** (start/stop/status/logs/config).

## Deployed (✅ done + verified, 2026-08-07)
- Container **`analytikul-openclaw`** (`ghcr.io/openclaw/openclaw:latest`) on the `analytikul_default`
  docker network in CT201; published `127.0.0.1:18789` (Gateway + Control UI); state in docker volume
  `analytikul_openclaw`.
- Onboarded **non-interactively** as a custom OpenAI-compatible provider → Ollama
  (`http://192.168.166.182:11434/v1`, model `qwen2.5-coder:32b`); `gateway.mode=local`, token auth
  (token in `/opt/analytikul/openclaw.token`, chmod 600), `gateway.bind=lan`.
- Verified: gateway boots healthy (8 plugins), HTTP 200 on `127.0.0.1:18789`, and **reachable from
  `analytikul-app`** at `http://analytikul-openclaw:18789/` (returns the Control UI HTML).
- Server inventory updated.

## Embed architecture (next)
The Control UI supports **`gateway.controlUi.basePath`** (e.g. `/openclaw`) and
`controlUi.allowedOrigins` — so it can be served/embedded under an Analytikul subpath **with no new
subdomain / Cloudflare route** and no asset-URL breakage. Plan:
1. Set `controlUi.basePath` = the Analytikul proxy path, `allowedOrigins` += `https://analytikul.ai`,
   and the embed/framing options (`allowExternalEmbedUrls`, `embedSandbox`); restart the gateway.
2. **Reverse proxy** `/(api/)analytikul/openclaw/*` in `analytikul-app` → `analytikul-openclaw:18789`,
   **admin-gated**, injecting the gateway bearer token. Must proxy **WebSocket** (Control UI is WS).
   - The app has `ws` + `http-proxy-agent` but **not** `http-proxy-middleware`. Options:
     **(a)** manual `ws`-based upgrade proxy wired in `api/server/index.js` (no new dep);
     **(b)** add `http-proxy-middleware` (image rebuild);
     **(c)** Cloudflare `claw.analytikul.ai` → the gateway + iframe that (needs a CF route).
     **Recommended: (a)** — keeps it under `analytikul.ai`, no new dep, no CF change.
   - Handle the Control UI **device-auth** handshake through the proxy (likely
     `controlUi.allowInsecureAuth` / rely on the admin gate + token injection since the gateway is
     never publicly exposed).
3. **Client:** an admin-only **"OpenClaw"** section in the rail/nav that iframes the proxied Control UI.

## Manage panel (next)
Start/stop/restart/status/logs/config for the container. `analytikul-app` has **no docker socket**, so
this needs a small ops path: a minimal, admin-authed ops helper on CT201 with the docker socket
(whitelisted to the `analytikul-openclaw` container), called by an Analytikul admin API. Status can also
come from the gateway's own health endpoint (no docker needed).

## Security notes
- Admin-gated in Analytikul; gateway bound `lan` but **only** exposed via loopback + the internal docker
  network (never publicly). Keep it that way.
- OpenClaw runs tools and pairs unknown senders on DM channels — treat channel connections as sensitive;
  enable sandboxing before connecting external users.
- Never expose `18789` publicly or commit the gateway token.
