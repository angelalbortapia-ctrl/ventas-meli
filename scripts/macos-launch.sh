#!/bin/bash
# Arranca serve.py si hace falta y abre http://127.0.0.1:8877/
# Usado por Ventas Meli.app (copia en ~/Applications y Desktop).
set -euo pipefail

PROJECT="/Users/angelalbor/Projects/ventas-meli"
PORT="${PORT:-8877}"
URL="http://127.0.0.1:${PORT}/"
LOG="${TMPDIR:-/tmp}/ventas-meli-server.log"
PYTHON="/usr/bin/python3"

cd "$PROJECT" || exit 1

port_up() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

if ! port_up; then
  nohup "$PYTHON" -u "$PROJECT/serve.py" >>"$LOG" 2>&1 &
  for _ in $(seq 1 50); do
    port_up && break
    sleep 0.2
  done
fi

open "$URL"
