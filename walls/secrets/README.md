# Sandbox secrets — host-only, never committed

These are **walls**: the agent inside the box can't see this directory — it's
under `walls/`, a sibling of the mounted `sandbox/`, so it's simply not in the
agent's mount — and the real files are gitignored so they never reach GitHub.
Set them up once on the host.

## 1. Toggles (CORPUS_RUN_*, token, polling, caps)

These are NOT here — they're compose `${VAR}` substitutions, set in
**`walls/.env`** (which `up.sh` sources). `cp walls/.env.example walls/.env`
and edit. (Putting them in this dir wouldn't work: a re-declared
`environment:` key in compose overrides `env_file`.) This directory is only
for the credential carry-in below.

## 2. The Claude subscription credential (the `claude_home` volume)

Theo authenticates Claude Code with his **membership**, not an API key. The
credential lives in `~/.claude` — inside the box that's the `claude_home`
named volume (a wall: a named volume, never a host-home mount, never under
`/work`). Seed it once; it persists in the volume and refreshes there.

**Exec as `node`** — the container's entrypoint runs as root (to chown the
volumes) then drops to `node`, so a bare `docker compose exec` lands as root
and would write the credential to the wrong home. Always pass `-u node`:

```sh
# bring the box up first (walls/up.sh), then, INSIDE it, mint a long-lived
# subscription token (best for an unattended box):
docker compose -f walls/compose.yml exec -u node agent claude setup-token
# follow the prompt: open the printed URL on your Mac, authorize, paste the
# code back. Put the token in walls/.env (CLAUDE_CODE_OAUTH_TOKEN).
# (Alternative: `claude auth login` for the standard OAuth credential,
# persisted to the claude_home volume.)

# verify:
docker compose -f walls/compose.yml exec -u node agent claude auth status   # loggedIn: true
```

The egress allowlist permits `claude.ai` / `claude.com` / `anthropic.com`, so
the in-box CLI reaches the auth/refresh endpoints on its own. If auth ever
lapses, re-run the command above. Do **not** bake the token into the image or
any committed file.

## 3. The GitHub deploy key (the `ssh_home` volume)

The box mounts the corpus **sandbox repo** at `/work` (the codebase / agent
repo — the walls live in this separate outer repo, outside the mount). Push
from inside the box uses a **dedicated deploy key for the sandbox repo only**
(revocable, least-privilege) — never the host `~/.ssh`.

```sh
# generate the key INSIDE the box so the private key never touches the host fs
# (exec as node — same reason as the credential above):
docker compose -f walls/compose.yml exec -u node agent \
  ssh-keygen -t ed25519 -N "" -f /home/node/.ssh/id_ed25519 -C "corpus-sandbox-deploy"
# print the PUBLIC key and add it to the SANDBOX repo's deploy keys:
docker compose -f walls/compose.yml exec -u node agent cat /home/node/.ssh/id_ed25519.pub
```

Then on GitHub: **the sandbox repo → Settings → Deploy keys → Add deploy
key**, paste the public key, check **Allow write access**. Revoke it there to
instantly cut the box's push ability (a kill-switch lever).

The key persists in the `ssh_home` volume across restarts. Set the sandbox
repo's remote to the SSH form once it exists on GitHub:

```sh
docker compose -f walls/compose.yml exec -u node agent \
  git -C /work remote -v
```
