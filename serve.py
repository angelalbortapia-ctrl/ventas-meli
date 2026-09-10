#!/usr/bin/env python3
"""Servidor local de Ventas Meli + proxies Keepa / SerpAPI (evitan CORS).

Uso:
  python3 serve.py
  # → http://127.0.0.1:8877/

Keepa:
  GET /api/keepa/product?asin=B0XXXXXXXX&stats=90
    Header: X-Keepa-Key: <tu api key>

SerpAPI (Google Shopping MX):
  GET /api/serpapi/shopping?q=air+fryer
  GET /api/serpapi/immersive?page_token=…
    Header: X-SerpApi-Key: <tu api key>
  (también SERPAPI_KEY en el entorno)
"""

from __future__ import annotations

import gzip
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
SERPAPI_SEARCH = "https://serpapi.com/search.json"
SERPAPI_ACCOUNT = "https://serpapi.com/account.json"


def _decode_keepa_body(raw: bytes, headers) -> bytes:
    """Keepa suele mandar gzip; urllib no siempre lo descomprime solo."""
    if not raw:
        return raw
    enc = ""
    try:
        enc = (headers.get("Content-Encoding") or "").lower()
    except Exception:
        enc = ""
    if enc == "gzip" or raw[:2] == b"\x1f\x8b":
        try:
            return gzip.decompress(raw)
        except Exception:
            return raw
    return raw


def _parse_keepa_json(raw: bytes, headers) -> dict:
    data = json.loads(_decode_keepa_body(raw, headers).decode("utf-8"))
    if not isinstance(data, dict):
        return {"data": data}
    data.pop("key", None)
    # Keepa anida a veces { error: { message, type } }
    err = data.get("error")
    if isinstance(err, dict):
        msg = err.get("message") or err.get("type") or "Error Keepa"
        data = {**data, "error": msg, "keepaError": err}
    return data


def _serpapi_key(headers) -> str:
    key = (
        headers.get("X-SerpApi-Key")
        or headers.get("x-serpapi-key")
        or os.environ.get("SERPAPI_KEY")
        or ""
    )
    return str(key).strip()


def _normalize_shopping_payload(data: dict, query: str) -> dict:
    """Reduce la respuesta SerpAPI Shopping a lo que usa Ofertas."""
    if not isinstance(data, dict):
        return {"query": query, "results": [], "error": "Respuesta inválida"}
    if data.get("error"):
        return {
            "query": query,
            "results": [],
            "error": str(data.get("error")),
            "search_metadata": data.get("search_metadata"),
        }

    rows = []
    for block_key in ("shopping_results", "organic_results"):
        block = data.get(block_key)
        if not isinstance(block, list):
            continue
        for item in block:
            if not isinstance(item, dict):
                continue
            price = item.get("extracted_price")
            if price is None and isinstance(item.get("price"), (int, float)):
                price = item.get("price")
            link = (
                item.get("link")
                or item.get("product_link")
                or ""
            )
            extensions = item.get("extensions")
            if not isinstance(extensions, list):
                extensions = []
            rows.append({
                "position": item.get("position"),
                "title": item.get("title") or "",
                "source": item.get("source") or item.get("merchant") or "",
                "price": item.get("price") or "",
                "extracted_price": price if isinstance(price, (int, float)) else None,
                "link": link,
                "product_link": item.get("product_link") or "",
                "product_id": str(item.get("product_id") or ""),
                "thumbnail": item.get("thumbnail") or item.get("serpapi_thumbnail") or "",
                "rating": item.get("rating"),
                "reviews": item.get("reviews"),
                "old_price": item.get("old_price") or "",
                "extracted_old_price": item.get("extracted_old_price"),
                "delivery": item.get("delivery") or "",
                "snippet": item.get("snippet") or "",
                "extensions": [str(x) for x in extensions if x],
                "multiple_sources": bool(item.get("multiple_sources")),
                "immersive_product_page_token": item.get("immersive_product_page_token") or "",
            })

    meta = data.get("search_metadata") if isinstance(data.get("search_metadata"), dict) else {}
    return {
        "query": query,
        "results": rows,
        "total": len(rows),
        "search_metadata": {
            "id": meta.get("id"),
            "status": meta.get("status"),
            "google_url": meta.get("google_url"),
            "total_time_taken": meta.get("total_time_taken"),
        },
        "search_information": data.get("search_information"),
    }


def _normalize_immersive_payload(data: dict) -> dict:
    """Product popup Google: mismas tiendas del mismo producto."""
    if not isinstance(data, dict):
        return {"error": "Respuesta inválida", "product": {}, "stores": []}
    if data.get("error"):
        return {
            "error": str(data.get("error")),
            "product": {},
            "stores": [],
            "search_metadata": data.get("search_metadata"),
        }

    pr = data.get("product_results")
    if not isinstance(pr, dict):
        pr = {}

    thumbs = pr.get("thumbnails")
    if not isinstance(thumbs, list):
        thumbs = []

    stores_out = []
    raw_stores = pr.get("stores")
    if isinstance(raw_stores, list):
        for s in raw_stores:
            if not isinstance(s, dict):
                continue
            details = s.get("details_and_offers")
            if not isinstance(details, list):
                details = []
            price = s.get("extracted_price")
            if price is None and isinstance(s.get("price"), (int, float)):
                price = s.get("price")
            stores_out.append({
                "name": s.get("name") or "",
                "logo": s.get("logo") or "",
                "link": s.get("link") or "",
                "title": s.get("title") or "",
                "rating": s.get("rating"),
                "reviews": s.get("reviews"),
                "tag": s.get("tag") or "",
                "discount": s.get("discount") or "",
                "price": s.get("price") or "",
                "extracted_price": price if isinstance(price, (int, float)) else None,
                "original_price": s.get("original_price") or "",
                "extracted_original_price": s.get("extracted_original_price"),
                "shipping": s.get("shipping") or "",
                "shipping_extracted": s.get("shipping_extracted"),
                "total": s.get("total") or "",
                "extracted_total": s.get("extracted_total"),
                "details_and_offers": [str(x) for x in details if x],
            })

    meta = data.get("search_metadata") if isinstance(data.get("search_metadata"), dict) else {}
    return {
        "product": {
            "title": pr.get("title") or "",
            "brand": pr.get("brand") or "",
            "rating": pr.get("rating"),
            "reviews": pr.get("reviews"),
            "price_range": pr.get("price_range") or "",
            "thumbnails": [str(t) for t in thumbs if t],
        },
        "stores": stores_out,
        "stores_next_page_token": pr.get("stores_next_page_token") or "",
        "total_stores": len(stores_out),
        "search_metadata": {
            "id": meta.get("id"),
            "status": meta.get("status"),
            "total_time_taken": meta.get("total_time_taken"),
        },
    }


def _serpapi_get(params: dict, timeout: int = 60):
    """GET serpapi.com/search.json; returns (status_or_None, payload_dict)."""
    url = f"{SERPAPI_SEARCH}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "VentasMeli-SerpApiProxy/1.0",
                "Accept": "application/json",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict):
                data.pop("api_key", None)
            return None, data if isinstance(data, dict) else {"error": "Respuesta inválida"}
    except urllib.error.HTTPError as err:
        try:
            payload = json.loads(err.read().decode("utf-8"))
        except Exception:
            payload = {"error": f"SerpAPI HTTP {err.code}"}
        if isinstance(payload, dict):
            payload.pop("api_key", None)
            if not payload.get("error"):
                payload["error"] = payload.get("message") or f"SerpAPI HTTP {err.code}"
        else:
            payload = {"error": f"SerpAPI HTTP {err.code}"}
        code = err.code if err.code < 500 else 502
        return code, payload
    except Exception as err:
        kind = type(err).__name__
        return 502, {
            "error": f"Proxy SerpAPI: no alcanzó serpapi.com ({kind}). ¿Red o firewall?",
        }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # PWA local: no cachear HTML agresivamente
        if self.path.endswith(".html") or self.path in ("/", ""):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/api/keepa") or self.path.startswith("/api/serpapi"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "X-Keepa-Key, X-SerpApi-Key, Content-Type",
            )
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path in ("/api/health", "/api/ping"):
                return self._json(200, {
                    "ok": True,
                    "service": "ventas-meli",
                    "keepa": True,
                    "serpapi": True,
                    "port": PORT,
                })
            if parsed.path.startswith("/api/keepa/"):
                return self._proxy_keepa(parsed)
            if parsed.path == "/api/serpapi/shopping":
                return self._proxy_serpapi_shopping(parsed)
            if parsed.path == "/api/serpapi/immersive":
                return self._proxy_serpapi_immersive(parsed)
            if parsed.path == "/api/serpapi/account":
                return self._proxy_serpapi_account()
            return super().do_GET()
        except BrokenPipeError:
            return
        except Exception as err:
            if parsed.path.startswith("/api/"):
                try:
                    return self._json(500, {
                        "error": f"Proxy local falló: {type(err).__name__}: {err}",
                    })
                except Exception:
                    return
            raise

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/diag/dump":
            return self._diag_dump()
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
                raw = _decode_keepa_body(resp.read(), resp.headers)
                data = json.loads(raw.decode("utf-8"))
                if isinstance(data, dict):
                    data.pop("key", None)
                return self._json(200, data)
        except urllib.error.HTTPError as err:
            try:
                payload = _parse_keepa_json(err.read(), err.headers)
            except Exception:
                payload = {"error": f"Keepa HTTP {err.code}"}
            if isinstance(payload, dict):
                payload.pop("key", None)
            return self._json(err.code if err.code < 500 else 502, payload)
        except Exception as err:
            kind = type(err).__name__
            return self._json(502, {
                "error": f"Proxy Keepa: no alcanzó api.keepa.com ({kind}). ¿Red o firewall?",
            })

    def _diag_dump(self):
        """Escribe un JSON de diagnóstico en .diag/ (solo local)."""
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 8_000_000)
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
            name = str(payload.get("name") or "dump").strip()
            name = "".join(ch if (ch.isalnum() or ch in "-_") else "-" for ch in name)[:64] or "dump"
            data = payload.get("data")
            if data is None:
                return self._json(400, {"error": "Falta data"})
            diag_dir = os.path.join(ROOT, ".diag")
            os.makedirs(diag_dir, exist_ok=True)
            path = os.path.join(diag_dir, f"{name}.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
            return self._json(200, {"ok": True, "path": f".diag/{name}.json"})
        except Exception as err:
            return self._json(500, {"error": f"diag dump falló: {err}"})

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_serpapi_shopping(self, parsed: urllib.parse.ParseResult):
        key = _serpapi_key(self.headers)
        if not key:
            return self._json(401, {
                "error": "Falta API key de SerpAPI. Pégala en Ajustes → SerpAPI, o SERPAPI_KEY en el entorno.",
            })

        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
        q = (qs.get("q") or qs.get("query") or [""])[0].strip()
        if not q:
            return self._json(400, {"error": "Falta parámetro q (búsqueda)."})
        if len(q) > 200:
            return self._json(400, {"error": "Búsqueda demasiado larga."})

        params = {
            "engine": "google_shopping",
            "q": q,
            "gl": (qs.get("gl") or ["mx"])[0].strip() or "mx",
            "hl": (qs.get("hl") or ["es"])[0].strip() or "es",
            "google_domain": (qs.get("google_domain") or ["google.com.mx"])[0].strip()
                or "google.com.mx",
            "api_key": key,
        }
        for opt in (
            "min_price", "max_price", "tbs", "start", "num",
            "location", "uule", "sort_by", "shoprs",
        ):
            if qs.get(opt):
                params[opt] = qs[opt][0]
        for flag in ("free_shipping", "on_sale", "small_business", "no_cache"):
            if qs.get(flag):
                val = qs[flag][0].strip().lower()
                if val in ("1", "true", "yes"):
                    params[flag] = "true"

        code, data = _serpapi_get(params, timeout=60)
        if code is not None:
            return self._json(code, data)
        return self._json(200, _normalize_shopping_payload(data, q))

    def _proxy_serpapi_immersive(self, parsed: urllib.parse.ParseResult):
        key = _serpapi_key(self.headers)
        if not key:
            return self._json(401, {
                "error": "Falta API key de SerpAPI. Pégala en Ajustes → SerpAPI.",
            })

        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
        token = (qs.get("page_token") or qs.get("token") or [""])[0].strip()
        if not token:
            return self._json(400, {"error": "Falta page_token (de un resultado Shopping)."})
        if len(token) > 8000:
            return self._json(400, {"error": "page_token demasiado largo."})

        params = {
            "engine": "google_immersive_product",
            "page_token": token,
            "api_key": key,
        }
        more = (qs.get("more_stores") or ["1"])[0].strip().lower()
        if more in ("1", "true", "yes", ""):
            params["more_stores"] = "true"
        if qs.get("next_page_token"):
            params["next_page_token"] = qs["next_page_token"][0]

        code, data = _serpapi_get(params, timeout=60)
        if code is not None:
            return self._json(code, data)
        return self._json(200, _normalize_immersive_payload(data))

    def _proxy_serpapi_account(self):
        key = _serpapi_key(self.headers)
        if not key:
            return self._json(401, {
                "error": "Falta API key de SerpAPI. Pégala en Ajustes → SerpAPI.",
            })
        url = f"{SERPAPI_ACCOUNT}?{urllib.parse.urlencode({'api_key': key})}"
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "VentasMeli-SerpApiProxy/1.0",
                    "Accept": "application/json",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, dict):
                    data.pop("api_key", None)
                return self._json(200, data)
        except urllib.error.HTTPError as err:
            try:
                payload = json.loads(err.read().decode("utf-8"))
            except Exception:
                payload = {"error": f"SerpAPI HTTP {err.code}"}
            if isinstance(payload, dict):
                payload.pop("api_key", None)
                if not payload.get("error"):
                    payload["error"] = payload.get("message") or f"SerpAPI HTTP {err.code}"
            return self._json(err.code if err.code < 500 else 502, payload)
        except Exception as err:
            kind = type(err).__name__
            return self._json(502, {
                "error": f"Proxy SerpAPI: no alcanzó serpapi.com ({kind}).",
            })

    def _proxy_keepa(self, parsed: urllib.parse.ParseResult):
        key = self.headers.get("X-Keepa-Key") or self.headers.get("x-keepa-key") or ""
        key = key.strip()
        if not key:
            return self._json(401, {
                "error": "Falta header X-Keepa-Key. Pégala en Ajustes → Keepa.",
            })

        rel = parsed.path[len("/api/keepa/"):].strip("/") or "token"
        allowed = {"product", "token", "query", "seller", "graphimage"}
        endpoint = rel.split("/")[0]
        if endpoint not in allowed:
            return self._json(400, {"error": f"Endpoint no permitido: {endpoint}"})

        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
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
                raw = _decode_keepa_body(resp.read(), resp.headers)
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
                if isinstance(data, dict):
                    data.pop("key", None)
                return self._json(200, data)
        except urllib.error.HTTPError as err:
            try:
                payload = _parse_keepa_json(err.read(), err.headers)
            except Exception:
                payload = {"error": f"Keepa HTTP {err.code}", "message": str(err.reason)}
            if isinstance(payload, dict):
                payload.pop("key", None)
                if not isinstance(payload.get("error"), str):
                    payload["error"] = payload.get("message") or f"Keepa HTTP {err.code}"
            return self._json(err.code if err.code < 500 else 502, payload)
        except Exception as err:
            kind = type(err).__name__
            return self._json(502, {
                "error": f"Proxy Keepa: no alcanzó api.keepa.com ({kind}). ¿Red o firewall?",
            })

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


def main():
    os.chdir(ROOT)
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    print(f"Ventas Meli + Keepa/SerpAPI proxy → http://{HOST}:{PORT}/", flush=True)
    print("Health: GET /api/health", flush=True)
    print("Ctrl+C para salir", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
