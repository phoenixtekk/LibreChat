"""Web search for Amy, plus the hand-off that opens a page on Lacy's desktop.

Search goes through the self-hosted SearXNG on linuxg3 — no API key, no rate
limit, and the query never reaches a commercial search account.
"""
import os
from urllib.parse import urlparse

import requests

SEARX = os.environ.get("AIBOX_SEARX", "http://192.168.166.161:8080")
BRIDGE = os.environ.get("AIBOX_BRIDGE", "http://127.0.0.1:8824")
RESULT_COUNT = int(os.environ.get("AIBOX_SEARCH_RESULTS", "5"))
SNIPPET_CHARS = 320


def domain(url):
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def search(query, count=RESULT_COUNT):
    """Top results from SearXNG as {title, url, content, domain}."""
    response = requests.get(
        f"{SEARX}/search",
        params={"q": query, "format": "json", "safesearch": "0"},
        timeout=25,
    )
    response.raise_for_status()
    results = []
    for item in response.json().get("results", []):
        url = item.get("url", "")
        if not url.startswith(("http://", "https://")):
            continue
        results.append({
            "title": (item.get("title") or "").strip(),
            "url": url,
            "content": (item.get("content") or "").strip()[:SNIPPET_CHARS],
            "domain": domain(url),
        })
        if len(results) >= count:
            break
    return results


def sources_block(results):
    return "\n".join(
        f"{i}. {r['title']} ({r['domain']}) — {r['content']}"
        for i, r in enumerate(results, 1)
    )


def spoken_sources(results, limit=3):
    return ", ".join(r["domain"] for r in results[:limit])


def open_on_desktop(url):
    """Queue a URL for the desktop agent. True if it was accepted."""
    try:
        response = requests.get(f"{BRIDGE}/open", params={"url": url}, timeout=10)
        return response.status_code == 200
    except requests.RequestException:
        return False


def desktop_online():
    """Whether the desktop agent has polled recently enough to be considered up."""
    try:
        health = requests.get(f"{BRIDGE}/health", timeout=5).json()
        return bool(health.get("ok"))
    except requests.RequestException:
        return False
