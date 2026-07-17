# corpus — the walls (host-only sandbox layer)

This repo is the **outer / host-only layer** for the confined corpus agent
(DASHBOARD-206 — the framework rebuild from scratch: minimal document-centric
core). The codebase the agent actually works on lives in a **separate repo** so
it can be mounted into the container as the agent's whole world while the walls
stay outside the mount:

```
corpus/                        # THIS repo — the walls layer
├── walls/      # host-only config the agent must NEVER touch — NOT mounted:
│               #   the sandbox definition (Dockerfile, compose), the egress
│               #   allowlist, the secrets carry-in. See walls/README.md.
└── sandbox/    # the agent's repo — checked out here and mounted at /work;
                #   gitignored by this repo (it's its own repo).
```

**Why two repos.** The container mounts only `sandbox/` at `/work`, so the
agent physically cannot see or edit the walls — they're in this repo, outside
its mount. The agent sees a normal git repo at `/work` (so it can commit + push
its own work), and is unaware it's sandboxed. The things that could widen the
confinement (egress allowlist, sandbox definition, secrets) live here in
`walls/` and change only via a host-side review.

This layout is modeled on `personal-assistant` (DASHBOARD-164); corpus is the
greenfield rebuild, so this walls layer starts minimal — agent + egress proxy +
port-forwarder, nothing else. Host capabilities (chrome bridge, gateways) can
be grafted back from the parent repo if and when a plugin needs them.

- **Develop / run the framework:** in the `sandbox/` checkout — that's the
  corpus codebase (see `sandbox/README.md` and `sandbox/docs/design.md`).
- **Bring up the container:** `walls/up.sh` (see `walls/README.md`).
