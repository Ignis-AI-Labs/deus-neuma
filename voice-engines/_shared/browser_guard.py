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

Re-audit 2026-11-17 (P6-76): each sidecar receives a key derived for NEUMA_SIDECAR_ENGINE.
GET /identity?challenge=<hex>&socket=<loopback-host:port> answers only when that socket is the
ASGI server's own listening socket, then proves engine + socket + challenge with the derived key.
A proof relayed through another engine or port therefore fails. Every call but /health and /identity
must carry that engine's token (x-neuma-sidecar). A sidecar started without its key answers /health
and nothing else.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import sys
from urllib.parse import parse_qs

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


OPEN_PATHS = frozenset({"/health", "/identity"})
_CHALLENGE = re.compile(r"^[0-9a-f]{32,128}$")
_ENGINE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


_KEY = re.compile(r"^[0-9a-f]{64}$")


def _mac(key: str, text: str) -> str:
    """Pure: hex HMAC-SHA256 of text under this engine's derived key. The backend hands the key over
    as hex and MACs with its 32 raw bytes (sidecar-trust.js), so the same bytes are used here."""
    return hmac.new(bytes.fromhex(key), text.encode(), hashlib.sha256).hexdigest()


def _local_socket(local) -> str:
    """Pure: the ASGI listening server tuple in the proof's canonical loopback form."""
    if not local or len(local) < 2:
        return ""
    host, port = local[0], local[1]
    canonical = "[::1]" if host == "::1" else "127.0.0.1"
    return f"{canonical}:{port}"


def guard(headers, path: str, query: str = "", key: str | None = None,
          engine: str | None = None, local=None):
    """Pure but for environment defaults: the answer the middleware gives in place of the route."""
    key = os.environ.get("NEUMA_SIDECAR_KEY", "") if key is None else key
    engine = os.environ.get("NEUMA_SIDECAR_ENGINE", "") if engine is None else engine
    why = refusal(headers)
    if why:
        return 403, {"error": "forbidden", "detail": why}
    if path == "/identity":
        params = parse_qs(query or "")
        challenge = (params.get("challenge") or [""])[0]
        socket = (params.get("socket") or [""])[0]
        if (not _KEY.match(key or "") or not _ENGINE.match(engine or "") or not _CHALLENGE.match(challenge)
                or not socket or socket != _local_socket(local)):
            return 403, {"error": "forbidden", "detail": "no engine key, or the challenge is not for this socket"}
        proof = _mac(key, f"neuma-sidecar-identity-v2\n{engine}\n{socket}\n{challenge}")
        return 200, {"proof": proof}
    if path in OPEN_PATHS:
        return None
    if not _KEY.match(key or "") or not _ENGINE.match(engine or ""):
        return 403, {"error": "forbidden", "detail": "this sidecar was started without the app's engine key — start it from Neuma"}
    expected = _mac(key, f"neuma-sidecar-caller-v2\n{engine}")
    if not hmac.compare_digest(_get(headers, "x-neuma-sidecar"), expected):
        return 403, {"error": "forbidden", "detail": "this sidecar answers the Neuma backend only"}
    return None


def assert_loopback_bind(name: str, host: str) -> None:
    """Impure: exit before serving when asked to bind anywhere but loopback."""
    if host not in LOOPBACK_HOSTS:
        print(f"[{name}] FATAL: refusing non-loopback bind {host!r}", file=sys.stderr, flush=True)
        raise SystemExit(2)
