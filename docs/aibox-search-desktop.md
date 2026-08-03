# AiBox — Amy web search + "pull that up on my computer"

Amy can search the web out loud and then open the page she found in a browser on
Lacy's Windows desktop, on command.

Search uses the **self-hosted SearXNG** on linuxg3 — no API key, no rate limit,
and the query never lands in a commercial search account. The desktop hand-off
goes through a small token-authenticated queue that an agent in the Windows
logon session polls.

---

## The flow

1. *"Hey Amy, search for who won the 2026 Super Bowl."*
   → SearXNG query → Amy answers in 1–3 spoken sentences and names the top source.
   She quietly remembers the top 5 links.
2. *"Pull that up on my computer."*
   → the top link is queued on the AiBox; the Windows agent picks it up within a
   second and opens it in the default browser (Edge).
3. *"Open the second one."* → picks link #2 instead.

Measured: search + spoken answer in **~2 s**; the page appears on screen in about
another second.

## Why the desktop side polls

Windows puts SSH logons in a **separate, non-interactive session**. A browser
launched over SSH renders to an invisible desktop — you get a process and no
window. It *looks* like it works when the browser is already running (the new
instance hands the URL to the visible one), which fails exactly when you don't
expect it.

So the agent runs **inside the interactive logon session** and long-polls the
AiBox. That guarantees a visible window, needs **no inbound firewall rule**, and
survives the desktop's IP changing.

---

## Components

| Path | What it is |
|---|---|
| `/opt/voice/web.py` | SearXNG client + desktop hand-off client |
| `/opt/voice/deskbridge.py` | The queue — token-auth long-poll API on **:8824** |
| `/opt/voice/bridge.token` | Shared secret (chmod 600). **Treat as a credential.** |
| `/opt/voice/deskbridge.log` | Bridge log (queued / delivered / rejected) |
| `/etc/systemd/system/amy-deskbridge.service` | Unit — always-on, boot-persistent |
| `%LOCALAPPDATA%\AmyBridge\amy-bridge.ps1` | Windows agent (user session) |
| `%LOCALAPPDATA%\AmyBridge\token.txt` | Same token, ACL-restricted to the user |
| `%APPDATA%\...\Startup\Amy Desktop Bridge.lnk` | Autostart at logon |

Source of truth: `services/aibox-voice/` (agent + installer under `windows/`).

### Bridge API

| Endpoint | Who calls it | Purpose |
|---|---|---|
| `GET /open?url=…` | the assistant, **localhost only** | Queue a URL |
| `GET /pending?token=…` | the Windows agent | Long-poll (25 s) for the next URL |
| `GET /health` | anyone | Queue depth and delivery counters |

Only `http`/`https` URLs are accepted, at both ends. Pollers must present the
token **and** come from `BRIDGE_ALLOWED_CIDR` (default `192.168.166.0/24`).

---

## What to say

| Phrase | Result |
|---|---|
| "search for X" / "look up X" / "google X" / "find me X" | Search + **spoken answer**, no browser |
| **"show me a search for X"** / "open a search for X" / "show me the search results for X" | Opens the **results page** in the browser |
| "…using google" | Same, but on Google instead of SearXNG |
| "pull that up on my computer" / "show me that" / "open that" | Opens the **top result** |
| "open the second one" / "show me the third one" / "open the last one" | Opens that result |
| **"pull up X"** (a subject, not "that") | Searches X fresh, opens its top result |

### Three behaviours, deliberately distinct

- **"search for X"** — Amy answers out loud. Nothing opens.
- **"show me a search for X"** — the *results page* opens, so you choose. Use this
  when you want to browse rather than be told.
- **"pull that up"** — opens the *one site* the answer came from.

> A command that names its own subject always triggers a **fresh search**.
> "Pull up Crestwell Travel Services" searches that and opens its top hit; it
> never reopens whatever was found earlier. Only pointing words — "that", "it",
> "the second one" — reuse the remembered results, and those expire after 15
> minutes rather than opening something stale.

> **Command precedence** (in `respond()`): desktop hand-off → search → camera →
> visual → plain chat. This ordering is load-bearing: **"look up the weather" is
> a search, while a bare "look up" is a camera tilt.** A search trigger only wins
> if an actual query follows it.

---

## Security

This lets a voice command make a workstation open an arbitrary web page, so:

- The token in `/opt/voice/bridge.token` and `token.txt` is a **credential** —
  never commit it, print it, or publish it. Rotate by regenerating on the AiBox
  (`openssl rand -hex 32`) and re-running the installer with the new value.
- `/open` is **localhost-only**, so nothing on the LAN can queue a page; only
  processes on the AiBox can.
- The desktop-facing `/pending` requires the token *and* a source IP inside the
  allowed CIDR.
- Both the bridge and the agent independently reject anything that isn't an
  ordinary `http(s)` URL — no `file:`, no `javascript:`, no UNC paths.

---

## Operations

```bash
ssh ai 'systemctl status amy-deskbridge'
ssh ai 'tail -f /opt/voice/deskbridge.log'
ssh ai 'curl -s 127.0.0.1:8824/health'
```

Windows side:

```powershell
Get-Content "$env:LOCALAPPDATA\AmyBridge\amy-bridge.log" -Tail 20
```

Restart the agent by logging out and in, or:

```powershell
Start-Process powershell -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',"$env:LOCALAPPDATA\AmyBridge\amy-bridge.ps1"
```

It holds a global mutex, so a second copy exits immediately — running the
command twice is harmless.

### Installing on another machine

```powershell
.\install-amy-bridge.ps1 -Token '<contents of /opt/voice/bridge.token>'
```

Per-user, no admin required. Every machine running the agent opens **every**
page Amy hands over, so only install it where that's wanted.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "I couldn't reach your computer to open that." | Bridge down (`systemctl status amy-deskbridge`). |
| Nothing opens, bridge shows `delivered` incrementing | Agent opened it in another session — confirm it was started from the interactive logon, not SSH. |
| Agent log: `Access to the path 'token.txt' is denied` | ACL locked the owner out — re-run the installer (it grants by SID). |
| `rejected` climbing in `/health` | Wrong token or a poller outside the allowed CIDR. |
| "I don't have a link to open yet." | No search yet this session — links are remembered in the assistant process and reset on restart. |
| "I don't have a recent search to open." | The remembered results aged out (15 min). Search again. |
| Opens the same wrong page repeatedly | Was the pre-fix stale-link bug (2026-08-02): any phrase containing "on my computer" reused result #1 without re-searching. Fixed — a named subject now forces a fresh search. |
| Amy names a source that clearly isn't where the answer came from | Was fixed 2026-08-02: the answer now carries `SOURCE: <n>` from the model and only that result is cited; if it cites nothing, Amy names no source. |
| Search says it can't reach the service | SearXNG on linuxg3:8080 is down. |

## Known limits

- Remembered links live **in memory** in the assistant process — a restart of
  `aigartha` clears them.
- Amy cites the result the model says it used (`SOURCE: <n>`); if the model does
  not name one, she gives no attribution rather than guessing. If the snippets
  don't cover the question she says so instead of narrating whatever they said.
- Amy answers from **search snippets**, not the full page. Fine for facts and
  headlines; she can be thin on detail buried inside an article. Reading the top
  page before answering is a config change away, at +3–8 s per search.
- One desktop target. Multiple machines would need a per-machine queue name.
