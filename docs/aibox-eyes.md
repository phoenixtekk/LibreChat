# AiBox — Amy's Eyes (always-on vision + camera control)

Always-on vision for the AiBox voice assistant ("Hey Amy"). An OBSBOT Tiny USB
gimbal camera gives Amy continuous awareness of the room, the ability to answer
questions about what she can see, and motorised pan/tilt/zoom so she can look
around the room on request.

Everything runs locally: frames never leave the AiBox, and the vision model is
the local Ollama instance on CT200. Nothing is recorded to disk.

---

## Hardware

| Item | Detail |
|---|---|
| Camera | **OBSBOT Tiny** (`3564:fef0`), USB, motorised gimbal |
| Nodes | `/dev/video0` (capture + control), `/dev/video1` |
| Capture | MJPEG, up to 1920x1080; daemon uses **1280x720 @ 2 fps** |
| Pan | **±130°** (`pan_absolute`, arcseconds, 1° steps) |
| Tilt | **±90°** (`tilt_absolute`, 2° steps) |
| Zoom | **0–100** (`zoom_absolute`) |
| Host | AiBox host `ai` / 192.168.166.168 (plugged into the host, like the SP92) |

Required packages on the host: `v4l-utils`, `ffmpeg` (installed 2026-08-02).

> The OBSBOT's own AI auto-tracking is **off**. If it is ever enabled (via the
> vendor app or a hand gesture) it will fight the daemon for gimbal control —
> manual pan/tilt positions will drift back on their own.

## Vision model

`qwen2.5vl:7b` on **CT200 Ollama** (192.168.166.182:11434), called via
`/api/generate` with a base64 frame. Frames are downscaled to **768 px wide**
before sending, which puts a single answer at **~3.5 s**. `mistral-small3.2:24b`
is also vision-capable if more accuracy is ever worth the latency.

---

## Components

| Path | What it is |
|---|---|
| `/opt/voice/eyes/eyes.py` | The eyes daemon — owns the camera, HTTP API on `127.0.0.1:8823` |
| `/opt/voice/eyes/ptz.py` | Gimbal control in degrees + named presets |
| `/opt/voice/eyes/presets.json` | Saved spots (created on first "remember this spot as …") |
| `/opt/voice/eyes/eyes.log` | Daemon log (scene updates, moves, errors) |
| `/run/amy-eyes/frame.jpg` | Newest frame — **tmpfs**, overwritten in place, never persisted |
| `/run/amy-eyes/scene.json` | Current room description + timestamp |
| `/opt/voice/assistant.py` | Voice assistant; consumes the eyes API |
| `/etc/systemd/system/amy-eyes.service` | Unit — always-on, boot-persistent, auto-restart |

Source of truth for both files is the repo at `services/aibox-voice/`.

### How the awareness loop works

1. A persistent `ffmpeg` process writes the newest frame to tmpfs at 2 fps
   (atomic writes, so a reader never catches a half-written JPEG).
2. A watcher downsamples each frame to 160 px greyscale and compares it to the
   previous one. Mean absolute difference above `EYES_MOTION_THRESHOLD` (6.0)
   counts as motion.
3. When motion **stops** for `EYES_QUIET_SECONDS` (2.5 s), the daemon asks the
   vision model to describe the room and caches the result. Describes are rate
   limited to one per `EYES_MIN_DESCRIBE_GAP` (20 s).
4. If nothing happens at all, the scene is refreshed every `EYES_IDLE_REFRESH`
   (300 s) so the description never goes stale.

The point of the cache: the assistant injects the **already-computed** scene into
Amy's system prompt on every turn, so she has ambient awareness of the room at
zero added latency. Only genuinely visual questions pay for a live model call.

### HTTP API (localhost only)

| Endpoint | Purpose |
|---|---|
| `GET /status` | Full state: scene, age, motion, position, presets, capture health |
| `GET /scene` | Cached room description + age (what the assistant injects) |
| `GET /frame` | Newest JPEG frame |
| `GET /describe` | Force a fresh scene description |
| `GET /ask?q=…` | Ask the vision model about the live view |
| `GET /look?dir=left\|right\|up\|down\|center[&deg=N]` | Move and report what came into view |
| `GET /look?to=<preset>` | Move to a saved/named spot |
| `GET /scan` | Sweep the room (5 positions), describe each, return to origin |
| `GET /remember?name=…` | Save the current position under a name |
| `GET /pause` / `GET /resume` | Close/open the eyes (see Privacy) |

Bound to `127.0.0.1` — not reachable off the box.

---

## Privacy

- **Nothing is recorded.** One frame lives in tmpfs and is overwritten twice a
  second. No video files, no frame history, no stills written to disk.
- **Nothing leaves the AiBox.** The vision model is local Ollama on CT200.
- **`/pause` is a real off switch** — it stops the `ffmpeg` capture process
  entirely and releases the device, so the camera's own indicator light goes
  out. It is not just a software flag. `/resume` brings it back.
- Say **"Hey Amy, close your eyes"** to pause, **"open your eyes"** to resume.

---

## Operations

```bash
systemctl status amy-eyes            # health
systemctl restart amy-eyes           # reload after a code change
tail -f /opt/voice/eyes/eyes.log     # watch scene updates and moves
curl -s 127.0.0.1:8823/status | python3 -m json.tool
curl -s 127.0.0.1:8823/frame -o /tmp/now.jpg    # grab what it sees right now
```

Both `amy-eyes` and `aigartha` are `enabled` (start at boot) with
`Restart=always`.

### Deploying a change

```bash
scp services/aibox-voice/eyes/*.py ai:/opt/voice/eyes/
scp services/aibox-voice/assistant.py ai:/opt/voice/assistant.py
ssh ai 'systemctl restart amy-eyes aigartha'
```

### Tuning (environment variables, set in the unit file)

| Variable | Default | Effect |
|---|---|---|
| `EYES_MOTION_THRESHOLD` | `6.0` | Lower = more sensitive to movement |
| `EYES_QUIET_SECONDS` | `2.5` | How long the room must be still before describing |
| `EYES_MIN_DESCRIBE_GAP` | `20` | Floor between model calls |
| `EYES_IDLE_REFRESH` | `300` | Refresh interval when nothing moves |
| `EYES_VLM_WIDTH` | `768` | Image width sent to the model — raise for accuracy, lower for speed |
| `EYES_VLM` | `qwen2.5vl:7b` | Vision model |
| `EYES_CAPTURE_SIZE` | `1280x720` | Capture resolution |
| `EYES_PORT` | `8823` | API port |

### Cost

~9 % of one core for `ffmpeg` plus ~2 % for the daemon, on a 32-core host —
negligible. Model calls only happen on motion-settle, idle refresh, or a direct
question.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `"error": "Eyes are closed."` | Paused. `curl 127.0.0.1:8823/resume`. |
| Scene never updates | Check `capture_alive` in `/status`; the daemon self-restarts a dead ffmpeg within ~1 s. |
| Camera won't hold a position | OBSBOT AI tracking got enabled — disable it in the vendor app. |
| Describes are slow | Ollama is busy with a big model (llama3.3:70b/qwen-coder). Lower `EYES_VLM_WIDTH`. |
| `/dev/video0` missing | Camera unplugged or on a different node — `v4l2-ctl --list-devices`. |
| Blurry frame after a move | Gimbal still settling; raise `SETTLE_FLOOR` in `ptz.py`. |

---

## Known limits / next steps

- **No face recognition** — Amy describes people generically ("a man at a
  desk"), she does not identify who they are.
- **Scan is ~25 s** for five positions; it announces "Let me take a look around"
  first so the wait is not silent.
- Vision is **one-shot per question** — it inherits the assistant's existing
  lack of multi-turn memory.
- Possible next: proactive greeting when someone enters the room (deliberately
  not enabled — an always-on camera that talks unprompted is a bigger behavioural
  change than it sounds), and tracking a speaker automatically during a call.
