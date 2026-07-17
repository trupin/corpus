#!/usr/bin/env bash
# corpus — host-side bring-up. Run from the HOST (where walls/ is visible),
# NOT inside the box:
#
#   ./walls/up.sh
#
# Starts Colima (if not already running) with explicit CPU/mem caps and the
# virtiofs mount, then builds + starts the composition. The dashboard lands on
# http://127.0.0.1:5174 (loopback only; the LAN sees nothing).
#
# Tunables (env or walls/.env):
#   COLIMA_CPUS   (default 4)   VM cpu count
#   COLIMA_MEM    (default 8)   VM memory, GiB
#   COLIMA_DISK   (default 60)  VM disk, GiB

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f ${HERE}/compose.yml"

# Load host-only toggles (CORPUS_RUN_*, CORPUS_EVENT_TOKEN, resource caps, git
# identity) from walls/.env so compose's ${VAR} substitution picks them up.
# `set -a` exports them into the env docker compose inherits. walls/.env is
# gitignored; see walls/.env.example.
if [ -f "${HERE}/.env" ]; then
  set -a; . "${HERE}/.env"; set +a
fi

COLIMA_CPUS="${COLIMA_CPUS:-4}"
COLIMA_MEM="${COLIMA_MEM:-8}"
COLIMA_DISK="${COLIMA_DISK:-60}"

if ! command -v colima >/dev/null 2>&1; then
  echo "colima not found. Install with: brew install colima docker" >&2
  exit 1
fi

if ! colima status >/dev/null 2>&1; then
  echo "[up] starting Colima (cpu=${COLIMA_CPUS} mem=${COLIMA_MEM}G disk=${COLIMA_DISK}G, virtiofs)…"
  colima start \
    --cpu "${COLIMA_CPUS}" \
    --memory "${COLIMA_MEM}" \
    --disk "${COLIMA_DISK}" \
    --mount-type virtiofs
else
  echo "[up] Colima already running — reusing it"
fi

echo "[up] building + starting the sandbox…"
# shellcheck disable=SC2086
$COMPOSE up --build -d

echo "[up] up. Dashboard → http://127.0.0.1:5174"
echo "[up] logs:   $COMPOSE logs -f"
echo "[up] shell:  $COMPOSE exec -u node agent bash"
echo "[up] stop:   ${HERE}/down.sh"
