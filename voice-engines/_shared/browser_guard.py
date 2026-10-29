"""browser_guard — a voice sidecar answers the backend, never a web page. Pure; stdlib only.

Audit 2026-10-28 M-06: the sidecars bind loopback, but a page the operator visits IS loopback to
them — a cross-origin text/plain POST reached /speak, /design, /transcribe and /shutdown, and the
whisper /stream socket took any origin. The backend's own calls (Node fetch, the ws client) carry
no Origin, no Sec-Fetch-Site, and a loopback Host; a browser always marks its requests. So every
sidecar refuses:

  * any request with an Origin header (a page's fetch, form post or socket);
  * any request a browser marked with Sec-Fetch-Site (an <img>, a no-cors GET);
  * a Host that is not loopback (a DNS-rebound name pointing at 127.0.0.1).

And a sidecar never binds off loopback: an unauthenticated /speak on a LAN address is a
voice-cloning service for anyone on the network.
"""

from __future__ import annotations

import sys

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _host_name(host: str) -> str:
    """Pure: the name part of a Host header ("127.0.0.1:7860" -> "127.0.0.1", "[::1]:80" -> "::1")."""
    host = (host or "").strip().lower()
    if host.startswith("["):
        return host[1:host.find("]")] if "]" in host else host
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def _get(headers, name: str) -> str:
    """Pure: one header from a Starlette Headers, a dict, or an ASGI header list."""
    if isinstance(headers, (list, tuple)):
        for key, value in headers:
            key = key.decode("latin-1") if isinstance(key, bytes) else key
            if key.lower() == name:
                return value.decode("latin-1") if isinstance(value, bytes) else value
        return ""
    return headers.get(name) or headers.get(name.title()) or ""


def refusal(headers) -> str | None:
    """Pure: why this request is refused, or None when it is the backend's own."""
    if _get(headers, "origin"):
        return "a web page's request (Origin) — this sidecar answers the Neuma backend only"
    if _get(headers, "sec-fetch-site"):
        return "a browser's request — this sidecar answers the Neuma backend only"
    if _host_name(_get(headers, "host")) not in LOOPBACK_HOSTS:
        return "a non-loopback Host — this sidecar answers the Neuma backend only"
    return None


def assert_loopback_bind(name: str, host: str) -> None:
    """Impure: exit before serving when asked to bind anywhere but loopback."""
    if host not in LOOPBACK_HOSTS:
        print(f"[{name}] FATAL: refusing non-loopback bind {host!r}", file=sys.stderr, flush=True)
        raise SystemExit(2)
