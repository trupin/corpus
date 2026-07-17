#!/usr/bin/env bash
# corpus — open the agent INSIDE the sandbox box, in the FOREGROUND
# (interactive) of THIS shell. Run from the host.
#
#   ./walls/agent.sh                 # interactive claude inside the box
#   ./walls/agent.sh -p "<prompt>"   # one-shot (args pass through to claude)
#
# Auto-resume: it reopens the most recent in-box conversation (--continue)
# when one exists. Pass your own session flag to override — `--resume <id>`
# for a specific one; any -c/--continue/-r/--resume disables the auto-add.
#
# Runs as `node` (claude refuses root) and inherits the box env via `exec -u
# node` — HTTP_PROXY (→ egress proxy) + CLAUDE_CODE_OAUTH_TOKEN — so auth and
# network work. Never `su` (a login shell strips that env).
#
# Auth preflight: before launching, it checks `claude auth status` inside the
# box. If not logged in, it runs the subscription sign-in — open the URL it
# prints, authorize, and the credential persists to the claude_home volume
# (survives restarts). The auth hosts (claude.ai / claude.com / anthropic.com)
# are already in the egress allowlist.
#
# Caveat: if CLAUDE_CODE_OAUTH_TOKEN is set in walls/.env, status always
# reports logged-in (even if that token is expired). To rely on the persisted
# volume login instead, blank it in walls/.env and `up` again.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "${HERE}/compose.yml")

if [ -z "$("${COMPOSE[@]}" ps -q agent 2>/dev/null)" ]; then
  echo "[agent] agent container isn't running. Start the box first:  ./walls/up.sh" >&2
  exit 1
fi

# Is claude usably authenticated in the box?
#  - Fast path: a non-empty CLAUDE_CODE_OAUTH_TOKEN authenticates regardless of
#    what `auth status` reports.
#  - Else: `claude auth status` (JSON {"loggedIn": true, ...}, exit 0 either
#    way). The FIRST `claude` run on a freshly-(re)created container does
#    one-time onboarding and can emit a transient loggedIn:false, so we WARM it
#    once (discarded), then poll a few times with a beat in between. `-T`
#    forces clean non-TTY JSON whether or not this shell has a terminal.
#
#    We CAPTURE the JSON into a var and bash-regex it rather than `| grep -q`:
#    under `set -o pipefail`, `grep -q` exits the instant it matches, closing
#    the pipe — `claude auth status` then takes a SIGPIPE on its next write,
#    and pipefail reports the whole pipeline as FAILED (141) EVEN ON A MATCH.
logged_in() {
  if "${COMPOSE[@]}" exec -T -u node agent sh -lc '[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]' 2>/dev/null; then
    return 0
  fi
  "${COMPOSE[@]}" exec -T -u node agent claude auth status >/dev/null 2>&1 || true
  local try out
  for try in 1 2 3 4 5; do
    out="$("${COMPOSE[@]}" exec -T -u node agent claude auth status 2>/dev/null || true)"
    if [[ "$out" =~ \"loggedIn\"[[:space:]]*:[[:space:]]*true ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if logged_in; then
  echo "[agent] claude is logged in."
else
  echo "[agent] claude doesn't look logged in — starting subscription sign-in…"
  echo "[agent] Open the URL it prints, authorize, and the credential persists"
  echo "[agent] to the claude_home volume (survives restarts)."
  # Best-effort: an interactive TTY is needed for the paste-code step, so don't
  # use -T here. If it doesn't complete we DON'T abort — claude itself prompts
  # for login on launch with a cleaner flow than a re-run of this would.
  "${COMPOSE[@]}" exec -u node agent claude auth login --claudeai || true
  if logged_in; then
    echo "[agent] signed in."
  else
    echo "[agent] couldn't confirm sign-in — launching claude anyway; it will" >&2
    echo "[agent] prompt for login itself if the credential is truly missing." >&2
  fi
fi

# Auto-resume the most recent in-box conversation. `claude --continue` reopens
# the latest session for the working dir (/work) — but it ERRORS when there's
# no prior session, and we exec (no fallback after), so probe the claude_home
# volume first and only add the flag when a session jsonl actually exists.
# Skipped if the caller already passed a session flag.
caller_steers_session() {
  local a
  for a in "$@"; do
    case "$a" in -c|--continue|-r|--resume) return 0 ;; esac
  done
  return 1
}

RESUME=()
if caller_steers_session "$@"; then
  : # caller is steering the session explicitly — leave it alone
elif "${COMPOSE[@]}" exec -T -u node agent sh -lc '
       d="$HOME/.claude/projects/$(pwd | sed "s#/#-#g")"
       [ -n "$(find "$d" -maxdepth 1 -name "*.jsonl" -type f -print -quit 2>/dev/null)" ]
     ' 2>/dev/null; then
  RESUME=(--continue)
  echo "[agent] resuming the previous session (--continue)."
else
  echo "[agent] no previous session found — starting fresh."
fi

# ${RESUME[@]+...} guard so an empty array doesn't trip `set -u` on bash 3.2.
exec "${COMPOSE[@]}" exec -u node agent claude --dangerously-skip-permissions \
  ${RESUME[@]+"${RESUME[@]}"} "$@"
