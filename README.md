# Corpus

Corpus is a local-first webapp for **conversations around documents**: everything is a markdown file
with YAML frontmatter, selecting text opens a comment thread anchored to that selection, and an AI
agent works the corpus alongside you — answering threads, filing notes, keeping the tree tidy.
It ships as one command, `corpus`, that manages a local server, the agent's job queue, and every
agent-facing verb; your documents stay on your disk, in a git repository you own.

- **Documents are files.** Markdown + frontmatter under `data/`, version-controlled by git, readable
  and editable with or without Corpus running.
- **One writer.** Every mutation goes through the local server, which auto-commits with the acting
  party (`user` or `agent`) as the git author — so the history is the audit trail.
- **The agent uses the same CLI you do.** No hidden API, no privileged path.

> **Status: pre-release.** Nothing has been published to npm yet, and the package name below is
> **provisional** — `corpus` and `corpus-cli` are both taken on the registry, so the published name is
> still being decided. The command itself will be `corpus` whatever the package ends up being called.
> Until then, run it from a clone: see [Contributing](#contributing).

## Requirements

- **Node.js ≥ 22** (`node --version`)
- **git** on your `PATH` — a workspace is a git repository
- [Claude Code](https://claude.com/claude-code) if you want the agent half

## Install

Corpus is not published to npm — install it from the repository (user decision, 2026-07-29):

```sh
git clone https://github.com/trupin/corpus.git
cd corpus
npm install
npm run build
npm run package:build          # stages the self-contained tool into dist-package/
npm pack ./dist-package        # produces corpus-<version>.tgz
npm install -g ./corpus-*.tgz  # installs the `corpus` binary
```

The packed tool is entirely self-contained: the CLI, the server and the pre-built board all ship
inside the one tarball, and nothing is built on the machine that installs it.

## The operator loop

### 1. Create a workspace

```sh
mkdir ~/notes && cd ~/notes
corpus init
```

This creates `data/docs` and `data/threads`, a `.corpus/` runtime directory with a freshly generated
bearer token (mode `600`), the agent skills under `.claude/skills/`, a few seed documents, and a git
repository with one initial commit. It refuses to touch a directory that already holds a workspace.

Pin the port if you want a specific one — otherwise Corpus probes upward from `8765`:

```sh
corpus init --port 8790
```

### 2. Start the server

```sh
corpus server start
```

It prints the board's URL. The server is the workspace's sole writer; it watches the files, keeps a
SQLite projection in sync, and streams invalidations to the board. `corpus server status`,
`corpus server logs` and `corpus server stop` manage its lifecycle.

### 3. Open the board

Visit the printed URL (`http://127.0.0.1:8765` by default). The board is served statically by the
same server — there is no second process and no separate UI install.

### 4. Start the agent

From the workspace directory:

```sh
claude
```

then, inside Claude Code:

```
/orchestrate
```

`corpus init` installed that skill into the workspace's `.claude/skills/`. The agent parks on
`corpus queue idle`, wakes when there is work, and does everything through the same `corpus` verbs
documented in [`docs/cli.md`](docs/cli.md).

### Everyday commands

| Command                 | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `corpus doc create …`   | Create a document (the server writes it and commits it) |
| `corpus thread reply …` | Answer a comment thread                                 |
| `corpus queue status`   | What the agent is working on                            |
| `corpus health`         | Is the server up, and does it agree with this workspace |
| `corpus server stop`    | Shut the server down cleanly                            |

The full reference — every verb, flag, and exit code — is [`docs/cli.md`](docs/cli.md), generated
from the command registry so it cannot drift from the binary.

## Contributing

Corpus is an npm workspaces monorepo: `apps/server`, `apps/cli`, `apps/ui`, `packages/contract`,
`packages/kit`, and `plugins/*`.

```sh
git clone https://github.com/trupin/corpus.git
cd corpus
npm install
npm run setup-hooks     # one-time per clone: wires .githooks/ via core.hooksPath
npm run build           # contract → kit → plugins → cli → server/ui
npm test
```

`npm run setup-hooks` is a required one-time step: the hooks are versioned in `.githooks/` and are
not active until you point git at them. Pre-commit runs build + lint + format + typecheck + unit
tests; pre-push adds the generated-artifact drift check and the version-singularity check.

Run the tool from your clone with:

```sh
npm run dev -w apps/cli -- init ~/scratch
```

### Useful scripts

| Script                    | What it does                                                    |
| ------------------------- | --------------------------------------------------------------- |
| `npm run lint`            | ESLint across the repo (`lint:fix` to autofix)                  |
| `npm run format:check`    | Prettier (`format` to write)                                    |
| `npm run typecheck`       | `tsc --noEmit` in every workspace, plus `scripts/`              |
| `npm test`                | Vitest across all workspaces                                    |
| `npm run e2e`             | Playwright against the real app                                 |
| `npm run coverage`        | unit → e2e → merge → the ≥ 90% gate CI enforces                 |
| `npm run version:check`   | Version singularity: every manifest matches the root            |
| `npm run package:build`   | Assembles the publishable package into `dist-package/`          |
| `npm run pack:check`      | Audits the tarball `npm pack` would produce, in both directions |
| `npm run publish:dry-run` | `npm publish --dry-run` over the staged package                 |

### How changes land

- Work happens on a branch per plan phase (`phase-<n>-<slug>`); every commit is prefixed with its
  issue id (`[INFRA-008] …`).
- Everything reaches `main` through a pull request. `CI / validate` — lint, format, typecheck, unit
  tests, the merged coverage gate and Playwright e2e — must be green on the PR's head commit.
- **Merges are squash-only.** No merge commits, no rebase-merges.
- `SPEC.md` is the source of truth for product behaviour; `docs/TS_GUIDELINES.md` for code style.

### Releasing

One version number describes the whole tool: the root `package.json`'s `version`, matched by every
workspace and enforced by `npm run version:check`.

```sh
npm version <x.y.z> --workspaces --include-workspace-root
git push --follow-tags
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which re-runs the full validate gate, rebuilds
everything, refuses to continue if the tag and the manifests disagree, and publishes with npm
provenance. It requires an `NPM_TOKEN` repository secret.

## License

[MIT](LICENSE) © 2026 Theophane RUPIN
