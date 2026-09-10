#!/bin/bash
# Doble-clic en Finder → abre Terminal con el proxy Keepa/SerpAPI.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8877}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Ya hay algo en :$PORT"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  echo
  echo "Abre http://127.0.0.1:$PORT/  — si falla, matá el proceso y volvé a correr esto."
  echo "Presioná Enter para salir…"
  read -r
  exit 0
fi

echo "Arrancando Ventas Meli en http://127.0.0.1:$PORT/"
echo "Dejá esta ventana abierta mientras uses Keepa / Ofertas / SerpAPI."
echo "Ctrl+C para detener."
echo
exec python3 -u serve.py
