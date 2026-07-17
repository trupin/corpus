#!/usr/bin/env bash
# corpus — host-side teardown. Run from the HOST.
#
#   ./walls/down.sh            stop + remove the containers (keeps volumes)
#   ./walls/down.sh --volumes  also remove the node_modules / claude / ssh
#                                 volumes (you'll re-login + rebuild deps next up)
#   ./walls/down.sh --stop-vm  also `colima stop` (the hard kill-switch)
#
# Stopping the containers leaves the repo and git history untouched (they're
# the bind mount) — the cut-over is reversible by design. NOTE: --stop-vm
# stops the shared Colima VM — it also halts any OTHER sandbox (e.g.
# pa-sandbox) running in the same VM.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f ${HERE}/compose.yml"

WITH_VOLUMES=0
STOP_VM=0
for arg in "$@"; do
  case "$arg" in
    --volumes) WITH_VOLUMES=1 ;;
    --stop-vm) STOP_VM=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [ "$WITH_VOLUMES" = "1" ]; then
  echo "[down] stopping + removing containers AND named volumes…"
  # shellcheck disable=SC2086
  $COMPOSE down --volumes
else
  echo "[down] stopping + removing containers (volumes kept)…"
  # shellcheck disable=SC2086
  $COMPOSE down
fi

if [ "$STOP_VM" = "1" ]; then
  echo "[down] colima stop (hard kill-switch — stops ALL sandboxes in the VM)…"
  colima stop || true
fi

echo "[down] done."
