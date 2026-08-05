#!/usr/bin/env python3
"""Servidor local de Ventas Meli + proxy Keepa (evita CORS del navegador).

Uso:
  python3 serve.py
  # → http://127.0.0.1:8877/

Keepa:
  GET /api/keepa/product?asin=B0XXXXXXXX&stats=90
  Header: X-Keepa-Key: <tu api key>
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8877"))
KEEPA_BASE = "https://api.keepa.com"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # PWA local: no cachear HTML agresivamente
        if self.path.endswith(".html") or self.path in ("/", ""):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/api/keepa"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "X-Keepa-Key, Content-Type")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/keepa/"):
            return self._proxy_keepa(parsed)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/keepa/deal":
            return self.send_error(404)
        key = (self.headers.get("X-Keepa-Key") or "").strip()
        if not key:
            return self._json(401, {"error": "Falta API key de Keepa."})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 100_000)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            payload["domainId"] = 11
            body = json.dumps(payload).encode("utf-8")
            url = f"{KEEPA_BASE}/deal/?{urllib.parse.urlencode({'key': key})}"
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "User-Agent": "VentasMeli-KeepaProxy/1.0",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, dict):
                    data.pop("key", None)
                return self._json(200, data)
        except urllib.error.HTTPError as err:
            try:
                payload = json.loads(err.read().decode("utf-8"))
            except Exception:
                payload = {"error": f"Keepa HTTP {err.code}"}
            if isinstance(payload, dict):
                payload.pop("key", None)
            return self._json(err.code if err.code < 500 else 502, payload)
        except Exception:
            # No interpolar la excepción: puede incluir la URL con `key=`.
            return self._json(502, {"error": "Proxy Keepa: fallo de red o timeout"})

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_keepa(self, parsed: urllib.parse.ParseResult):
        key = self.headers.get("X-Keepa-Key") or self.headers.get("x-keepa-key") or ""
        key = key.strip()
        if not key:
            return self._json(401, {
                "error": "Falta header X-Keepa-Key. Pégala en Ajustes → Keepa.",
            })

        rel = parsed.path[len("/api/keepa/"):].strip("/") or "token"
        # Solo endpoints seguros de lectura
        allowed = {"product", "token", "query", "seller", "graphimage"}
        endpoint = rel.split("/")[0]
        if endpoint not in allowed:
            return self._json(400, {"error": f"Endpoint no permitido: {endpoint}"})

        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
        # Nunca reenviar un `key` del cliente: la autenticación va solo por header.
        flat = []
        for k, vals in qs.items():
            if k == "key":
                continue
            for v in vals:
                flat.append((k, v))
        flat.append(("key", key))
        url = f"{KEEPA_BASE}/{endpoint}/?{urllib.parse.urlencode(flat)}"

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "VentasMeli-KeepaProxy/1.0",
                    "Accept-Encoding": "gzip",
                    "Accept": "application/json",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                raw = resp.read()
                encoding = (resp.headers.get("Content-Encoding") or "").lower()
                if encoding == "gzip":
                    import gzip
                    raw = gzip.decompress(raw)
                content_type = (resp.headers.get("Content-Type") or "").lower()
                if endpoint == "graphimage" or content_type.startswith("image/"):
                    self.send_response(200)
                    self.send_header("Content-Type", content_type or "image/png")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "private, max-age=21600")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                data = json.loads(raw.decode("utf-8"))
                # No devolver la key si Keepa la echoa
                if isinstance(data, dict):
                    data.pop("key", None)
                return self._json(200, data)
        except urllib.error.HTTPError as err:
            try:
                raw = err.read()
                if (err.headers.get("Content-Encoding") or "").lower() == "gzip":
                    import gzip
                    raw = gzip.decompress(raw)
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                payload = {"error": f"Keepa HTTP {err.code}", "message": str(err.reason)}
            if isinstance(payload, dict):
                payload.pop("key", None)
                if "error" not in payload:
                    payload["error"] = payload.get("message") or f"Keepa HTTP {err.code}"
            return self._json(err.code if err.code < 500 else 502, payload)
        except Exception:
            # No interpolar la excepción: puede incluir la URL con `key=`.
            return self._json(502, {"error": "Proxy Keepa: fallo de red o timeout"})

    def log_message(self, fmt, *args):
        # Silenciar assets ruidosos; dejar APIs
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


def main():
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Ventas Meli + Keepa proxy → http://{HOST}:{PORT}/")
    print("Ctrl+C para salir")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye")


if __name__ == "__main__":
    main()
