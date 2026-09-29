#!/usr/bin/env python3
"""Desk bridge — hands URLs from Amy to the desktop she's asked to open them on.

The assistant enqueues a URL on localhost; an agent running inside the user's
Windows logon session long-polls for it and opens the browser there. Polling
(rather than the AiBox pushing) means no inbound firewall rule on the desktop
and nothing breaks when its IP changes.

Only http/https URLs are accepted, the desktop-facing endpoint requires a shared
token, and clients can be restricted to a CIDR. This service can make a
workstation open arbitrary pages, so treat the token as a credential.
"""
import ipaddress
import json
import os
import queue
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from hmac import compare_digest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("BRIDGE_PORT", "8824"))
TOKEN_FILE = Path(os.environ.get("BRIDGE_TOKEN_FILE", "/opt/voice/bridge.token"))
ALLOWED_CIDR = os.environ.get("BRIDGE_ALLOWED_CIDR", "192.168.166.0/24")
POLL_TIMEOUT = float(os.environ.get("BRIDGE_POLL_TIMEOUT", "25"))
QUEUE_MAX = 20

pending = queue.Queue(maxsize=QUEUE_MAX)
stats = {"queued": 0, "delivered": 0, "rejected": 0, "last_delivered_at": 0.0}

TOKEN = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else ""
NETWORK = ipaddress.ip_network(ALLOWED_CIDR) if ALLOWED_CIDR else None


def log(message):
    print(f"[bridge] {message}", flush=True)


def safe_url(raw):
    """Only ever hand a browser an ordinary web URL."""
    if not raw or len(raw) > 2000:
        return None
    parsed = urlparse(raw.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return parsed.geturl()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _client(self):
        return self.client_address[0]

    def _local(self):
        return self._client() in ("127.0.0.1", "::1")

    def _authorized(self, query):
        if not TOKEN:
            return False
        if not compare_digest(query.get("token", ""), TOKEN):
            return False
        if NETWORK:
            try:
                if ipaddress.ip_address(self._client()) not in NETWORK:
                    return False
            except ValueError:
                return False
        return True

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = url.path.rstrip("/") or "/"

        if route == "/health":
            return self._send({"ok": True, "waiting": pending.qsize(), **stats})

        if route == "/pending":
            if not self._authorized(query):
                stats["rejected"] += 1
                log(f"rejected poll from {self._client()}")
                return self._send({"error": "unauthorized"}, 401)
            try:
                item = pending.get(timeout=POLL_TIMEOUT)
            except queue.Empty:
                return self._send({})
            stats["delivered"] += 1
            stats["last_delivered_at"] = time.time()
            log(f"delivered {item['url']} to {self._client()}")
            return self._send(item)

        if route == "/open":
            if not self._local():
                return self._send({"error": "local only"}, 403)
            target = safe_url(query.get("url", ""))
            if not target:
                return self._send({"error": "bad url"}, 400)
            if pending.full():
                return self._send({"error": "queue full"}, 429)
            pending.put({"url": target, "at": time.time()})
            stats["queued"] += 1
            log(f"queued {target}")
            return self._send({"queued": target})

        return self._send({"error": "not found"}, 404)


def main():
    if not TOKEN:
        raise SystemExit(f"no token at {TOKEN_FILE} — generate one before starting")
    log(f"listening on 0.0.0.0:{PORT} (clients limited to {ALLOWED_CIDR or 'any'})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
