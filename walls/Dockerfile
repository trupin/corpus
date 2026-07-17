# corpus — the sandboxed agent box.
#
# Runs the whole corpus stack inside the confinement: the dev server AND the
# agent loop. Because agent-edited code executes INSIDE the box
# (egress-allowlisted, no host FS beyond the mount, no host exec), editing it
# is not a sandbox-escape vector.
#
# Debian-slim Node LTS base (Claude Code CLI needs Node), with Bun baked in as
# the app runtime — corpus targets Hono-on-Bun (native TS execution, built-in
# SQLite + test runner), and if the Bun-vs-Node fork lands on Node, the routes
# are written against Hono so it's a runtime swap, not a rebuild of this image.
#
# What is baked into the image (and therefore NOT in /work, NOT agent-editable):
#   - the Node runtime + Bun + git + ssh client + build toolchain
#   - the Claude Code CLI
#   - boot.sh (the entrypoint) → /usr/local/bin/corpus-boot
# At runtime ONLY ../sandbox/ is bind-mounted at /work; the agent edits it
# freely. The walls (this Dockerfile, compose, egress config, secrets) live in
# the repo root ALONGSIDE sandbox/, NOT inside it — so they're simply not in
# the agent's mount. See walls/README.md.

# Bun binary source — pinned via the image tag; bump to upgrade.
ARG BUN_VERSION=1.2
FROM oven/bun:${BUN_VERSION} AS bun

FROM node:22-bookworm-slim

# git + ssh for push-from-inside (dedicated deploy key, see secrets/README.md);
# python3/make/g++ so npm/bun can compile any native module for THIS image's
# arch/libc; ca-certificates + curl for the allowlisted egress (through the
# proxy). procps gives the boot script `pgrep`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      ca-certificates \
      curl \
      python3 \
      make \
      g++ \
      procps \
      netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*
# netcat-openbsd provides `nc -X connect` — the box has no direct internet, so
# git-over-SSH must tunnel through the egress proxy's HTTP CONNECT (SSH can't
# use HTTP_PROXY itself). boot.sh wires the ssh ProxyCommand; the proxy allows
# CONNECT :22 to allowlisted hosts.

# Bun — copied from the pinned official image (build-time, host network — not a
# wall-widening; no runtime fetch). Installed as root to a system path so the
# agent can't overwrite it.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Claude Code CLI — the agent runtime. Installed globally as root before we
# drop to the unprivileged user, so the agent can't overwrite the binary.
# PINNED for a reproducible box: bump this ARG to upgrade — `./walls/up.sh`
# rebuilds the layer. The box never self-updates (DISABLE_AUTOUPDATER below).
ARG CLAUDE_CODE_VERSION=2.1.170
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# The entrypoint lives in the image, NOT under /work (= ../sandbox/) — so the
# agent cannot edit the thing that boots it.
COPY boot.sh /usr/local/bin/corpus-boot
RUN chmod 0555 /usr/local/bin/corpus-boot

# The container STARTS as root so the entrypoint can chown the named volumes
# (Docker creates them root-owned, and a non-root user can't write into them).
# boot.sh fixes ownership, then drops to the unprivileged `node` user for ALL
# real work — the agent never runs as root.
WORKDIR /work

# Pin HOME to node's home so the credential volumes (~/.claude, ~/.ssh) resolve
# there regardless of which uid a process runs as. Critically, this makes
# `docker compose exec -u node agent claude …` write the subscription
# credential into the claude_home volume the agent loop reads.
ENV HOME=/home/node

# Bind all interfaces INSIDE the box so the single published port reaches the
# dev server through the forward sidecar. Safe — only 127.0.0.1:<port> is
# published to the host; the LAN sees nothing.
ENV BIND_HOST=0.0.0.0
ENV VITE_HOST=0.0.0.0
# Wall-change guard hook: in-box tooling can refuse "apply" operations when
# this is set, so an in-box agent can only file a request, never stamp its own
# wall-change. (Framework invariant carried over from personal-assistant.)
ENV CORPUS_INSIDE_SANDBOX=1
# Keep git non-interactive + unsigned inside the box.
ENV GIT_TERMINAL_PROMPT=0
# The box never self-updates the CLI; version bumps come from rebuilding this
# image (bump CLAUDE_CODE_VERSION above), never from the running agent.
ENV DISABLE_AUTOUPDATER=1

ENTRYPOINT ["/usr/local/bin/corpus-boot"]
