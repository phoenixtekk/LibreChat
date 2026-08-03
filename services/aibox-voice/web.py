"""Web search for Amy, plus the hand-off that opens a page on Lacy's desktop.

Search goes through the self-hosted SearXNG on linuxg3 — no API key, no rate
limit, and the query never reaches a commercial search account.
"""
import os
import re
from urllib.parse import quote_plus, urlparse

import requests

# Queries go straight to the box on the LAN (fast, no external hop); links we
# hand the browser use the public HTTPS host — same SearXNG instance, but no
# "Not secure" warning and it carries Lacy's saved preferences.
SEARX = os.environ.get("AIBOX_SEARX", "http://192.168.166.161:8080")
SEARX_PUBLIC = os.environ.get("AIBOX_SEARX_PUBLIC", "https://search.analytikul.ai")
BRIDGE = os.environ.get("AIBOX_BRIDGE", "http://127.0.0.1:8824")
RESULT_COUNT = int(os.environ.get("AIBOX_SEARCH_RESULTS", "5"))
SNIPPET_CHARS = 320


# Where "show me a search for X" sends the browser. Defaults to our own SearXNG
# so the query stays off a commercial search account; say "google" to override.
SERP_ENGINES = {
    "searxng": SEARX_PUBLIC + "/search?q={q}&language=auto&safesearch=0",
    "google": "https://www.google.com/search?q={q}",
    "duckduckgo": "https://duckduckgo.com/?q={q}",
    "bing": "https://www.bing.com/search?q={q}",
}
DEFAULT_SERP = os.environ.get("AIBOX_SERP", "searxng")


def serp_url(query, engine=None):
    """A search RESULTS page for the query — not one of the results."""
    template = SERP_ENGINES.get(engine or DEFAULT_SERP, SERP_ENGINES["searxng"])
    return template.format(q=quote_plus(query))


def domain(url):
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def relevance(result, terms):
    haystack = f"{result['title']} {result['content']} {result['url']}".lower()
    return sum(1 for term in terms if term in haystack)


def search(query, count=RESULT_COUNT):
    """Top results from SearXNG as {title, url, content, domain}.

    Results are re-ordered by how many query terms they actually mention. The
    upstream engines occasionally degrade and return wholly unrelated pages;
    without this, one of those can land at position 1 and become both the spoken
    answer's source and whatever "pull that up" opens.
    """
    response = requests.get(
        f"{SEARX}/search",
        params={"q": query, "format": "json", "safesearch": "0", "language": "en-US"},
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
        if len(results) >= max(count * 4, 20):
            break

    terms = re.findall(r"[a-z0-9]{3,}", query.lower())
    if terms:
        results.sort(key=lambda r: -relevance(r, terms))   # stable: ties keep engine order
    return results[:count]


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
