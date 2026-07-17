#!/usr/bin/env bash
# corpus — in-container entrypoint (baked into the image at
# /usr/local/bin/corpus-boot, NOT under /work (= the mounted ../sandbox/), so
# the agent cannot edit the thing that boots it).
#
# Sequence:
#   1. privilege drop (chown the named volumes, re-exec as node)
#   2. make /work safe for git + wire git-over-SSH through the egress proxy
#   3. install deps into the node_modules volume (bun install) when present
#   4. start the dev stack (`bun run watch`) if the repo defines one
#   5. if CORPUS_RUN_LOOP=1 — also start the agent loop
#
# Stays PID 1: when the servers exit, the container exits and the
# restart-policy (unless-stopped) brings it back.

set -euo pipefail

log() { printf '[corpus-boot] %s\n' "$*"; }

# 0 ── privilege drop. The container starts as root ONLY to fix ownership of
# the named volumes — Docker creates them root-owned, so the unprivileged
# `node` user can't write into them (the EACCES that crash-loops first boot).
# chown the volume mountpoints, then re-exec as node so every real process
# (bun, claude, git) runs unprivileged.
if [ "$(id -u)" = "0" ]; then
  for d in /work/node_modules /home/node/.claude /home/node/.ssh; do
    chown node:node "$d" 2>/dev/null || true
  done
  exec runuser -u node -- "$0" "$@"
fi

# From here on we are `node`. Pin HOME so bun/npm caches + claude (~/.claude) +
# ssh (~/.ssh) resolve to node's home, where the volumes are mounted.
export HOME=/home/node

# Persist claude's top-level config. It lives at ~/.claude.json — OUTSIDE the
# ~/.claude dir the claude_home volume mounts — so on every container recreate
# it's lost, and claude warns + re-onboards + piles up backups each boot.
# Symlink it onto the volume so it survives restarts. (Only (re)create the link
# when the path is absent or already our symlink — never clobber a real file.)
mkdir -p "$HOME/.claude"
if [ ! -e "$HOME/.claude.json" ] || [ -L "$HOME/.claude.json" ]; then
  ln -sfn "$HOME/.claude/.claude.json" "$HOME/.claude.json"
fi

cd /work

# 1 ── git: the bind-mounted repo is owned by the host uid, not `node`. Mark it
# safe so git operations (status, worktree, commit) work, and set identity for
# headless commits.
git config --global --add safe.directory /work || true
git config --global user.name  "${GIT_AUTHOR_NAME:-corpus agent}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-agent@localhost}"
git config --global commit.gpgsign false || true
# Worktrees MUST resolve inside /work (the only writable mount).
git config --global --add safe.directory '/work/.worktrees/*' || true
mkdir -p /work/.worktrees || true

# 1b ── git-over-SSH egress. The box has no direct internet; SSH can't use
# HTTP_PROXY, so tunnel to the git host through the egress proxy's HTTP CONNECT
# (nc -X connect). The proxy resolves + dials github.com:22 (allowed by the
# allowlist + ConnectPort 22); accept-new trusts the host key headlessly. The
# deploy key lives in the ssh_home volume (~/.ssh/id_ed25519). Written
# authoritatively each boot so it's reproducible.
if [ -n "${HTTP_PROXY:-}" ]; then
  proxy_hostport="${HTTP_PROXY#http://}"; proxy_hostport="${proxy_hostport%/}"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  cat > "$HOME/.ssh/config" <<SSHCFG
Host github.com
  StrictHostKeyChecking accept-new
  ProxyCommand nc -X connect -x ${proxy_hostport} %h %p
SSHCFG
  chmod 600 "$HOME/.ssh/config"
fi

# 2 ── deps. The node_modules volume starts empty; populate it with a
# Linux-native install. Skip when already populated so restarts are fast.
# Greenfield: no package.json yet is fine — nothing to install.
if [ -f /work/package.json ]; then
  if [ ! -e /work/node_modules/.corpus-installed ]; then
    log "installing dependencies (first boot)…"
    bun install
    touch /work/node_modules/.corpus-installed
  else
    log "dependencies present — skipping install"
  fi
fi

# 3 ── the stack. Default: `bun run watch` if the repo defines it. Set
# CORPUS_RUN_WATCH=0 to NOT auto-start it: boot does all the setup above
# (git, ssh/egress, deps) then idles, so you can `exec -u node agent bash`
# and drive the stack by hand.
has_watch_script() {
  [ -f /work/package.json ] && bun -e '
    const p = await Bun.file("/work/package.json").json();
    process.exit(p.scripts && p.scripts.watch ? 0 : 1);
  ' 2>/dev/null
}

if [ "${CORPUS_RUN_WATCH:-1}" = "0" ] || ! has_watch_script; then
  if [ "${CORPUS_RUN_WATCH:-1}" != "0" ]; then
    log "no watch script in /work/package.json yet — idling (greenfield)."
  else
    log "CORPUS_RUN_WATCH=0 — not auto-starting the stack; idling."
  fi
  log "connect and drive it by hand:"
  log "  docker compose -f walls/compose.yml exec -u node agent bash   # -u node: NOT root (claude refuses root)"
  log "    inside →  bun run watch    # dashboard → http://127.0.0.1:5174"
  log "    inside →  claude           # the interactive agent"
  trap 'log "stopping…"; exit 0' SIGINT SIGTERM
  sleep infinity &
  wait $!
  exit 0
fi

log "starting bun run watch…"
bun run watch &
WATCH_PID=$!

# Graceful shutdown: forward signals to the watch process.
trap 'log "stopping…"; kill "$WATCH_PID" 2>/dev/null || true; exit 0' SIGINT SIGTERM

# 4 ── optional agent loop. Off by default. When on, wait for the server
# health endpoint (loopback, NOT via the proxy) then launch the loop,
# supervised: a drain ends the session and this relaunches it; the container
# restart-policy covers hard crashes. --dangerously-skip-permissions is
# appropriate ONLY because the box is the confinement (egress-allowlisted, no
# host FS, no host exec); a queued event IS authorization.
if [ "${CORPUS_RUN_LOOP:-0}" = "1" ]; then
  log "CORPUS_RUN_LOOP=1 — waiting for the server before starting the loop…"
  for _ in $(seq 1 60); do
    if curl -fsS --noproxy '*' http://127.0.0.1:8765/health >/dev/null 2>&1; then break; fi
    sleep 2
  done
  log "server up — starting the agent loop"
  (
    while kill -0 "$WATCH_PID" 2>/dev/null; do
      claude --dangerously-skip-permissions -p "/orchestrate" || true
      sleep 5
    done
  ) &
fi

# Stay alive on the servers; their exit ends the container.
wait "$WATCH_PID"
