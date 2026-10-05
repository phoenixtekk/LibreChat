#!/usr/bin/env python3
"""Aigartha desk-bridge client (Windows).

Long-polls the AiBox desk bridge and opens any URL it hands back in this PC's
default browser. This is the desktop half of Amy's "open it in your browser"
feature: the AiBox queues a URL, this agent (running in Lacy's logon session)
pulls it and opens it. Polling out means no inbound firewall rule is needed.

LAN-only, token-authenticated. Configure via env:
  AIGARTHA_BRIDGE      default http://192.168.166.168:8824
  AIGARTHA_TOKEN_FILE  default ~/.aigartha/deskbridge.token
"""
import os
import time
import json
import webbrowser
import urllib.parse
import urllib.request
from pathlib import Path

BRIDGE = os.environ.get("AIGARTHA_BRIDGE", "http://192.168.166.168:8824").rstrip("/")
TOKEN_FILE = Path(os.environ.get("AIGARTHA_TOKEN_FILE", str(Path.home() / ".aigartha" / "deskbridge.token")))
LOG = Path.home() / ".aigartha" / "deskbridge_client.log"
TOKEN = TOKEN_FILE.read_text(encoding="utf-8").strip() if TOKEN_FILE.exists() else ""


def log(msg):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def poll_once():
    query = urllib.parse.urlencode({"token": TOKEN})
    req = urllib.request.Request(f"{BRIDGE}/pending?{query}")
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read().decode() or "{}")


def main():
    if not TOKEN:
        log(f"no token at {TOKEN_FILE}; exiting")
        return
    log(f"desk-bridge client started -> {BRIDGE}")
    while True:
        try:
            item = poll_once()
            url = item.get("url") if isinstance(item, dict) else None
            if url and url.startswith(("http://", "https://")):
                log(f"open {url}")
                webbrowser.open(url)
        except Exception as exc:
            log(f"poll error: {exc}")
            time.sleep(3)


if __name__ == "__main__":
    main()
