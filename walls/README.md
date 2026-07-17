# The walls — sandbox config the agent must never touch

Run the whole corpus stack — the dev server **and** the agent loop — inside a
Colima container, so a prompt-injected or misbehaving agent's blast radius is
the box, not your Mac. Modeled on `personal-assistant/walls` (DASHBOARD-164),
trimmed to the minimal core for the greenfield rebuild (DASHBOARD-206).

**Terminology + layout.** The repo is two sibling directories:

```
corpus/
├── walls/      ← this dir: host-only config — NOT mounted
└── sandbox/    ← the agent's world — mounted to /work
```

*The sandbox* is the agent's mounted world — the `sandbox/` directory, mounted
at `/work`, holding the whole codebase, which the agent reads and edits freely.
*The walls* are the **essential configuration the agent must never touch** —
the sandbox definition, the egress allowlist, and the secrets. They live here
in `walls/`, a **sibling** of `sandbox/`, NOT inside it.

> **The one invariant.** *The agent's mount is `sandbox/`, nothing above it.*
> `compose.yml` bind-mounts only `../sandbox` at `/work`, so the walls — being
> outside `sandbox/` — are simply not in the mount. No overlay trick: the
> agent can't reach what isn't mounted. (The image-baked bits — the
> Dockerfile, `boot.sh` → `/usr/local/bin/corpus-boot` — are likewise out of
> reach.) The agent edits everything under `/work` freely (that's its world);
> it cannot read or edit its own sandbox definition, egress allowlist, or
> secrets. Wall-changes go through a request → host-side apply, never from
> inside.

## What's where

| Path | Role | Visible to agent? |
|------|------|-------------------|
| `Dockerfile` | agent image (Node + Bun + git + Claude Code CLI) | no (image layer) |
| `Dockerfile.proxy` | tinyproxy egress proxy image | no |
| `Dockerfile.forward` | socat port-forwarder image | no |
| `compose.yml` | services, networks, volumes (mounts `../sandbox`), the one port | no (sibling of the mount) |
| `boot.sh` | entrypoint, baked to `/usr/local/bin/corpus-boot` | no (image layer) |
| `egress/tinyproxy.conf` + `allowlist.txt` | the egress wall (default-deny) | no (proxy-only mount) |
| `secrets/` | the Claude OAuth + deploy-key setup | no (sibling of the mount) |
| `up.sh` / `down.sh` / `agent.sh` | host-side bring-up / teardown / interactive agent | no (run from host) |

## Prerequisites (host, one-time)

```sh
brew install colima docker          # Colima provides the Linux VM + docker CLI
```

## Bring-up

```sh
./walls/up.sh                      # starts Colima (caps + virtiofs) + builds + runs
# dashboard → http://127.0.0.1:5174  (loopback only; the LAN can't reach it)
# (pa-sandbox uses 5173 — both boxes can run side by side in the one VM)
```

While the greenfield repo has no `watch` script yet, the box boots, does setup
(git, ssh-over-proxy, deps), and idles — enter it and work interactively.
Seed the credentials once (see `secrets/README.md`):

```sh
docker compose -f walls/compose.yml exec -u node agent claude setup-token
docker compose -f walls/compose.yml exec -u node agent \
  ssh-keygen -t ed25519 -N "" -f /home/node/.ssh/id_ed25519 -C corpus-sandbox-deploy
docker compose -f walls/compose.yml exec -u node agent cat /home/node/.ssh/id_ed25519.pub
#  → add as a write-enabled Deploy key on the sandbox GitHub repo
```

> **Always enter the box with `exec -u node`, never `su`.** The image boots as
> root (so `boot.sh` can chown the volumes) then drops to `node` for real
> work, so a plain `exec … bash` lands as **root** — and `claude` refuses
> `--dangerously-skip-permissions` as root. `su - node` is worse: a login
> shell strips the container env (`HTTP_PROXY`, `CLAUDE_CODE_OAUTH_TOKEN`), so
> egress and auth break. `exec -u node` gives you the `node` user **and** the
> full box env in one shot. The helper scripts always do this for you.

Teardown: `./walls/down.sh` (containers only) · `--stop-vm` (hard kill — note
the VM is shared with pa-sandbox) · `--volumes` (also drop creds + deps).

## Day-to-day

```sh
./walls/agent.sh                   # interactive claude inside the box
                                   # (auth preflight + auto --continue)
docker compose -f walls/compose.yml exec -u node agent bash   # a shell
docker compose -f walls/compose.yml logs -f agent             # boot + stack logs
```

Toggles live in `walls/.env` (`cp walls/.env.example walls/.env`):
`CORPUS_RUN_WATCH=0` boots the box idle; `CORPUS_RUN_LOOP=1` starts the agent
loop once the framework has one (off until then).

## Verify the egress wall holds

```sh
docker compose -f walls/compose.yml exec -u node agent sh -lc '
  curl -fsS -o /dev/null -w "anthropic: %{http_code}\n" https://api.anthropic.com/ ;
  curl -fsS -o /dev/null -w "github:    %{http_code}\n" https://github.com/ ;
  curl -fsS    -w "blocked:   %{http_code}\n" https://example.com/ || echo "blocked: refused (expected)" ;
  curl -fsS    -w "metadata:  %{http_code}\n" http://169.254.169.254/ || echo "metadata: refused (expected)"
'
```

Allowlisted hosts succeed; everything else (and cloud-metadata, RFC1918) is
refused by the proxy's default-deny. To add a host: edit
`walls/egress/allowlist.txt` on the host, then
`docker compose -f walls/compose.yml restart proxy`. (Once the framework's
request flow exists, in-box agents file a wall-change request instead.)

## Kill switches

- *Hard:* `./walls/down.sh --stop-vm` (or `colima stop`) halts everything;
  revoke the GitHub deploy key to instantly cut push ability.
- *Soft:* to be provided by the framework (halt sentinel honored by the agent
  loop — carry over the `pa queue halt` pattern when the queue exists).

## Troubleshooting

- **Dashboard unreachable on `127.0.0.1:5174`.** Docker will NOT publish a
  host port for a container that's only on an `internal: true` network — the
  `forward` socat sidecar publishes it. Check
  `docker compose -f walls/compose.yml ps` — `forward` should show
  `127.0.0.1:5174->5173/tcp`; the dev server must be up inside the agent
  first (greenfield: it idles until a `watch` script exists).
- **File-watching / invalidation stuck.** `CHOKIDAR_USEPOLLING=1` (default) —
  watchers don't receive host-side inotify events across the macOS↔VM
  virtiofs boundary. Costs CPU.
- **`git` "dubious ownership" / can't commit.** `boot.sh` runs
  `git config --global --add safe.directory /work`; if writes fail, check the
  Colima virtiofs uid mapping.
- **Claude token lapsed mid-run.** Re-seed per `secrets/README.md`; the
  allowlist already permits the refresh hosts.
