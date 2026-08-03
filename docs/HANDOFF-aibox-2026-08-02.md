# HANDOFF — AiBox migration + standalone voice assistant (2026-08-02)

Pick-up doc for continuing the AiBox work in a fresh session. Pairs with
`~/.claude/server-inventory.md` (the `ai` host section has the authoritative infra map).

---

## TL;DR — where things stand
The **Analytikul Coder platform was migrated off the g-boxes onto the AiBox** and is live at
**analytikul.ai**, all Ollama-backed. On top of it, a **standalone always-on voice assistant**
(wake word **"Hey Amy"**, Amy TTS voice) runs on the AiBox host and talks through a Yealink SP92.
Core is done; remaining work is voice-assistant polish, **security gating**, and **backups**.

The one real repo is **`G:\VisualStudioCode\Analytikul-One`**, branch **`feature/analytikul-coder`**.
(`CodeDesktopApp` and `IndenicalCode` are empty folders — ignore them.)

---

## Infrastructure map

**AiBox host** — Proxmox VE, `ai` / **`ai.phoenixtekk.org`** / **192.168.166.168** (NOT `.com`; internal AD domain phoenixtekk.org).
- SSH: `ssh ai` (root, key) **or** `ssh lacy@ai.phoenixtekk.org` (user `lacy`, key-based, **passwordless sudo** via `/etc/sudoers.d/90-lacy`).
- Timezone: **America/Phoenix** (MST).
- ⚠️ Renaming the Proxmox node hostname is risky — left as `ai` (user dropped the rename).

**CT200 `ollama`** — 192.168.166.182:11434 (OpenAI-compat at `/v1`). Models: `llama3:latest` (fast, used by the assistant), `llama3.3:70b` (slow ~5 tok/s), `qwen2.5-coder:32b` (best local coder), `nomic-embed-text`. Vulkan backend.

**CT201 `librechat`** — 192.168.166.181, Docker-in-LXC. **The Analytikul platform.**
- Compose: `/opt/analytikul/docker-compose.aibox.yml`, project **`analytikul`**, app on **:3080**.
- Source: `/opt/analytikul` (git-archive of `feature/analytikul-coder`). Env: `/opt/analytikul/.env.aibox` (chmod 600 — JWT/CREDS/MEILI/VAULT/INTERNAL_SERVICE_TOKEN/POSTGRES/MEMORY_RT, all generated fresh — NOT the g-box secrets).
- 11 containers: `analytikul-app` (image `analytikul-app:coder`), `-hermes-adapter` (image `analytikul-hermes:coder`, `TERMINAL_ENV=local`), `-memory`, `-billing`, `-analytics`, `-gateway`, `-mongodb`, `-meilisearch`, `-vectordb` (pgvector, user `myuser` db `analytikul`), `-rag`, `-redis`. The 4 microservices are volume-mounted code (npm/pip install on boot).
- RAM was bumped 12→24 GB for image builds.

**Yealink SP92** — USB speakerphone, **ALSA card 3** (`plughw:3,0`), speaker **and** mic. Plugged into the host.

**Public route** — Cloudflare tunnel → CT201:3080, **analytikul.ai APEX ONLY (never www — owner rule)**. cloudflared config `/etc/cloudflared/config.yml` on the host.

---

## Platform (CT201) — done + notes
- Migrated whole stack; **19 marketplace agents restored** (mongodump from g3 analytikul-mongodb → author + ACL grants remapped to the AiBox user).
- Model picker: personas + Ollama + `qwen-local` (repointed to Ollama qwen2.5-coder:32b). **Anthropic/OpenAI/Google are `user_provided` (BYOK)** — they appear but need real API keys to respond (I don't have them).
- `ALLOW_REGISTRATION=false`.
- **Redeploy after a code change:** copy changed file(s) into `/opt/analytikul/...`, then on CT201:
  `docker build -t analytikul-app:coder -f Dockerfile .` (in `/opt/analytikul`), tag a rollback first, then
  `docker compose -p analytikul -f docker-compose.aibox.yml up -d --force-recreate app`.
  ⚠️ **The recreate races the build** — always recreate *after* the new image is tagged, then verify the running image id == the fresh `analytikul-app:coder` id, and grep a known new string in `/app/client/dist/assets/`.
- Rollback tags exist: `analytikul-app:rollback-prevviz`, `-preurl`, etc.

## Voice assistant (host `/opt/voice`) — done + notes
- **systemd service `aigartha`** (`/etc/systemd/system/aigartha.service`), always-on + boot-persistent + auto-restart. Log: `/opt/voice/assistant.log`. Script: `/opt/voice/assistant.py`.
- **Wake word: "Hey Amy"** (WAKE patterns in assistant.py — common words, so Whisper renders them reliably; the earlier "Aigartha"/"J Mac" failed because Whisper can't spell OOV words).
- **Flow:** 3s listen windows (RMS gate 350) → wake match → say "How can I help you, Lacy?" → record **6s** question → `small.en` STT → **Ollama llama3** → speak answer.
- **TTS:** Piper via `/opt/voice/say.sh` (reads `/opt/voice/voice.conf`). Switch voices: `/opt/voice/setvoice.sh <jarvis|ryan|amy|lacy>`. **Current: amy.**
  - **Speed:** `AIBOX_LENGTH_SCALE` in `voice.conf`, set with **`/opt/voice/setspeed.sh <scale>`** (lower = faster).
    **Current 0.79** (was 0.9 → measured **~10 % faster** on speech-only duration, 2026-08-02). `say.sh` re-reads the
    conf on every call, so **no service restart is needed** after a change; `setvoice.sh`/`setspeed.sh` each rewrite
    only their own key so they don't clobber each other.
  - ⚠️ Piper's duration predictor is **stochastic** (±1.5 % run to run) and `length-scale` is not a perfectly linear
    multiplier — measure a 5-run average of *speech-only* duration (trim silence) if you need an exact percentage.
  - Voices installed: `en_GB-alan` (jarvis), `en_US-ryan`, `en_US-amy` (default), and a **cloned "lacy"** voice.
- **Cloned voice (lacy):** XTTS v2 via `/opt/voice/xtts_say.py`, reference `/opt/voice/samples/lacy.wav`. ⚠️ **Pinned deps** (hard-won): `torch==2.8.0` + `torchaudio==2.8.0` (CPU) + `transformers>=4.57,<5` — do NOT let torch go to 2.9 (needs torchcodec) or transformers to 5.x (removes APIs coqui-tts uses). XTTS reloads the 1.8 GB model per call → slow; needs a persistent server for interactive use.
- **STT:** faster-whisper (`small.en` + `tiny.en`), CPU int8.
- **Commands:** `systemctl restart aigartha`, `journalctl -u aigartha` / `tail -f /opt/voice/assistant.log`, `/opt/voice/say.sh "text"` to test TTS.

## Amy's eyes (host `/opt/voice/eyes`) — done
Full reference: **`docs/aibox-eyes.md`**. Source of truth: **`services/aibox-voice/`** in the repo.
- **Camera: OBSBOT Tiny** USB gimbal on the host, `/dev/video0`. Motorised: **pan ±130°, tilt ±90°, zoom 0–100**
  via plain v4l2 `pan_absolute`/`tilt_absolute`/`zoom_absolute` — no vendor driver needed. Installed `v4l-utils` + `ffmpeg`.
- **systemd service `amy-eyes`** (`/opt/voice/eyes/eyes.py`), always-on + boot-persistent + auto-restart.
  Log `/opt/voice/eyes/eyes.log`; HTTP API on **127.0.0.1:8823**.
- **Always-on loop:** persistent ffmpeg → newest frame in **tmpfs** (`/run/amy-eyes/frame.jpg`, 1280x720 @ 2 fps,
  atomic writes) → motion detection (160 px greyscale diff) → on motion-settle, describe the room with
  **`qwen2.5vl:7b`** (already on CT200 — no pull needed) and cache it. Idle refresh every 5 min.
- **Assistant integration:** cached scene is injected into Amy's system prompt every turn (**ambient awareness at
  zero latency**); visual questions go to the VLM live (**~3.5 s**); "look left/right/up/down", "look at <spot>",
  "remember this spot as X", and "look around the room" (5-position sweep, **~25 s**, spoken summary via llama3).
- **Privacy:** `/pause` ("close your eyes") **kills the ffmpeg capture and releases the device** — the camera's own
  light goes out. Nothing is recorded; no frame leaves the box.
- **Verified live:** capture, motion-triggered describes, PTZ movement, 5-position room scan (each stop distinct and
  accurate), visual Q&A, pause/resume, boot-enable. Cost ~9 % of one core.
- ⚠️ **OBSBOT AI auto-tracking must stay off** — if enabled it fights the daemon for gimbal control.
- Old assistant backed up at `/opt/voice/assistant.py.bak-preeyes`.

## Amy web search + "pull that up on my computer" — done
Full reference: **`docs/aibox-search-desktop.md`**.
- **Search:** self-hosted **SearXNG on linuxg3:8080** (JSON API, no key, no rate limit) via `/opt/voice/web.py`.
  "search for X" / "look up X" / "google X" → spoken 1–3 sentence answer naming the top source, **~2 s**.
  Top 5 links remembered in-process for follow-ups.
- **Desk bridge:** systemd **`amy-deskbridge`** (`/opt/voice/deskbridge.py`), **port 8824**, token-auth long-poll
  queue. `/open` is **localhost-only**; `/pending` needs the token **+** a source IP in `192.168.166.0/24`.
  Token at `/opt/voice/bridge.token` (chmod 600) — **a credential, never commit/publish it.**
- **Windows agent:** `%LOCALAPPDATA%\AmyBridge\amy-bridge.ps1`, autostarts at logon (Startup shortcut),
  long-polls the bridge and opens URLs in Edge. ⚠️ **It must run in the interactive logon session** — Windows
  puts SSH logons in a separate non-interactive session, so an SSH-launched browser renders to an invisible
  desktop (it only *appears* to work when the browser is already open).
- **Verified live:** search→spoken answer 2.0 s; "pull that up on my computer" opened a visible Edge window;
  ordinal selection ("open the second one") correct.
- ⚠️ **Command precedence in `respond()`**: desktop → search → camera → visual → chat. Load-bearing:
  **"look up the weather" is a search, bare "look up" is a camera tilt.**
- ⚠️ Installer must set the token ACL **by SID** — a bare `%USERNAME%` grant with `/inheritance:r` locked the
  owner out of `token.txt` (hit and fixed 2026-08-02).

## On-screen visualizer (browser) — done
Glowing ring bottom-right that pulses while TTS plays (component `client/src/components/analytikul/VoiceVisualizer.tsx`, mounted in `AnalytikulProvider`). v1 is playback-driven; v2 (amplitude-reactive) pending.

---

## NEXT / open work (priority order)

**1. Finish the voice assistant**
- [ ] Confirm "Hey Amy" wakes reliably (pending owner test → tune WAKE / RMS gate).
- [ ] Replace fixed 6s question window with **record-until-silence (VAD)**.
- [ ] **Multi-turn memory** (currently one-shot per question).
- [ ] Voice commands: "Hey Amy, stop / mute / switch to Jarvis".
- [ ] Latency tuning (keep models warm; fastest good model).
- [ ] Eyes: owner test of the spoken vision/look commands (API paths all verified; voice paths unit-tested).
- [ ] Eyes (optional): proactive greeting when someone enters — deliberately left off, needs an owner call.

**2. Security (platform is public now)**
- [ ] **Cloudflare Access** on analytikul.ai (one-time-PIN / email allowlist) — currently reachable on the internet with only registration disabled.
- [ ] **gVisor sandbox** for agent code-execution (currently `TERMINAL_ENV=local`).

**3. Backups (primary box, nothing backed up yet)**
- [ ] Scheduled dumps: Mongo, Postgres/pgvector, `/opt/voice` (voice models + cloned voice), `/opt/analytikul/.env.aibox` + compose + librechat.yaml, cloudflared config. Target TrueNAS (192.168.166.252) or the incoming M.2 drives.

**4. Platform polish**
- [ ] Add real **cloud model keys** (Anthropic/OpenAI/Google) if cloud models are wanted.
- [ ] **Daily Logs**: bounded backfill to seed content; fix `MEMORY_TZ` (set to `America/Chicago` earlier) → **America/Phoenix**.
- [ ] **v2 amplitude-reactive** visualizer ring.
- [ ] Container timezones (CT200/CT201) → Phoenix (cosmetic).

---

## Key gotchas / lessons
- **Long processes over SSH must be systemd** (nohup didn't survive the session) — that's why `aigartha` is a service.
- **Wake words must be common words** — Whisper can't reliably spell made-up words ("Aigartha" came out as "aggressive"/"i got there"). "Hey Amy" works.
- **XTTS dependency pins** above — regressions there break the cloned voice.
- **analytikul.ai is apex-only, never www** (see memory `analytikul-apex-canonical`).
- **AiBox FQDN is `.org` not `.com`.**
- Deploy = rebuild image + recreate app; **verify the running image id changed** (recreate can race the build).
