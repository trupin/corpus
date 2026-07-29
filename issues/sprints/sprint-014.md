# Sprint 014 — Phase 4 final core: the comment skill, trace lines, and the todos plugin

**Issues**: AGENT-003, AGENT-004 (stage A) · PLUGINS-002 (stage B)
**Domains**: agent, agent-runtime, plugins
**Branch**: `phase-4-agent-loop`
**Date**: 2026-07-28
**Test numbering**: continues the ladder from sprint-013's `TEST-167`; this sprint runs `TEST-168`–`TEST-297`.

---

## What makes this sprint different

Sprint-013 shipped the last of the machinery. This sprint spends it. Three of the four issues write
no core code at all — they write **skill prose** and a **plugin**, and both are judged by whether a
real Claude Code session and a real browser do the right thing. That inverts the usual risk profile:

1. **The comment skill is the product's conversational behavior.** Everything upstream — the write
   path, the anchor engine, the queue, the CLI — exists so that AGENT-003's text can be true. There
   is no unit test for "the reply was good". The acceptance tests below are therefore split into
   two halves that must **both** pass: mechanical assertions on the skill document (sections, literal
   rules, command existence) and a **live-session E2E** across all four entry shapes. The mechanical
   half alone has never caught a bad skill.

2. **The template extractor now has an empty allowlist.** `CLI_COMMANDS_PENDING_CLI_006` is `[]`
   (sprint-013 Adjudication 17), and the extractor scans **every** `.md` in `assets/workspace/`
   against `docs/cli.md`. AGENT-003 cannot write an aspirational command. Three of this sprint's
   Open Conflicts exist because the skill's issue text asks for behavior no shipped verb supports —
   that is the extractor doing its job at contract time instead of at test time.

3. **PLUGINS-002 is the first committed non-underscore plugin.** Two rules that have never had a
   subject get one: Adjudication 9's underscore exclusion (todos must NOT be excluded) and
   Adjudication 12's dist-first packaging inclusion (todos must be packed). INFRA-008 found two real
   gaps in that path and deferred them here with no plugin to test against. They are **riders in
   PLUGINS-002's scope**, not follow-ups.

4. **Two of PLUGINS-002's acceptance criteria are not implementable as written**, and the reasons are
   structural rather than sloppy — item-level anchored commenting and frontmatter seeding both
   collide with invariants the system deliberately holds. Open Conflicts 8 and 9. Do not let an
   implementing agent discover these at hour six.

5. **AGENT-003 and AGENT-004 edit the same file in the same session.** They are staged sequentially
   into one agent-runtime session precisely so they cannot conflict — but the ownership boundary
   between "the comment skill's Reply section" and "the trace-line grammar" has to be written down
   or the second half will rewrite the first. Open Conflict 3.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue           | The real application in this sprint |
| --------------- | ----------------------------------- |
| **AGENT-003**   | A **real `corpus init` workspace on `9132`**, a **real server**, the **real board in a real browser**, and a **live `claude` session** running `/orchestrate` against it. Not a simulation: the loop AGENT-002 shipped drives every step. Every claim is checked against the file on disk, `git log` in the workspace, `GET /api/tree`, and the SSE stream. The session transcript is captured with `--output-format stream-json` and **retained in the scratch directory** (agent-runtime-dev Domain Knowledge, 2026-07-28) — TEST-206 through TEST-215 are not re-derivable without it. |
| **AGENT-004**   | The **same session and workspace** as AGENT-003 (`9132`), continued. The proof is a real agent turn, posted by the live session through `corpus thread reply --from agent`, that the **shipped UI** renders as a `.turn-trace` element — read out of the real browser, not out of a Vitest DOM. |
| **PLUGINS-002** | A **real workspace on `9142`** with the plugin discovered from the repo-root `plugins/`, a **real server**, the **real Vite dev UI on `5285`**, the **real `corpus` binary from source**, and a **real packed tarball** for the two INFRA riders (`npm pack -w apps/cli` → install into a scratch prefix). The §15 M6 subtractive check (`rm -rf plugins/todos`, restart) runs against the real running system, twice. |

### Port allocation

Continuing the ladder upward from sprint-013's `9090`–`9119` and its evaluator's `9120`–`9129`.
Verified free at contract time: `lsof -nP -iTCP -sTCP:LISTEN` shows **nothing bound in `9130`–`9199`**,
and `8765` is free.

| Consumer                         | Range         | Primary | Vite (only if needed) |
| -------------------------------- | ------------- | ------- | --------------------- |
| AGENT-003                        | `9130`–`9134` | `9132`  | `5285` (board check)  |
| AGENT-004                        | `9135`–`9139` | `9137`  | reuses `5285`         |
| PLUGINS-002                      | `9140`–`9149` | `9142`  | `5285`                |
| sprint-014 evaluator             | `9150`–`9159` | `9152`  | `5286`                |
| Automated tests, every workspace | —             | `0` (ephemeral). **Never hardcode.** | — |

**AGENT-003 and AGENT-004 share one session and should share one workspace** (`9132`). AGENT-004's
own range exists only if the agent wants a second clean workspace for the trace-only check.

**Reserved and off-limits:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the workspace default and the
  target of `apps/ui/vite.config.ts`'s proxy; `apps/ui/e2e/smoke.spec.ts` asserts the console strip
  reads exactly `"server unreachable"`, which is only true when nothing listens there. **Always pass
  `--port` explicitly to `corpus init`** so its upward probe never reaches it, and check
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done. Re-verified free at contract time.
- **`5173` and `5174` are held by an `ssh` process**, re-confirmed at contract time. `apps/ui/vite.config.ts`
  sets `server.port: 5173, strictPort: true` and does **not** read `CORPUS_UI_PORT`, so a bare
  `npm run dev -w apps/ui` **fails to start**. Use `npm run dev -w apps/ui -- --port 5285 --strictPort`.
  `CORPUS_UI_PORT` is read **only** by `apps/ui/playwright.config.ts`.
- **`5273` was bound at contract time** by `node .../vite --port 5273 --strictPort` — the `[PLAN]`
  commit's pre-push hook running e2e. It is transient and is the **hook's** port
  (`.githooks/pre-push` defaults `CORPUS_UI_PORT=5273`). Nobody in this batch may bind it; a stray
  holder there breaks the next push, not this sprint.
- **Playwright is single-holder** (`reuseExistingServer: false` + `--strictPort`). **No issue in this
  batch runs `npm run e2e`.** The orchestrator runs it once at harvest. PLUGINS-002's browser steps
  use a manually started dev server on `5285` and a driven browser, not the Playwright runner.

### Scratch directories — one prefix per issue

| Issue       | Prefix                                          |
| ----------- | ----------------------------------------------- |
| AGENT-003   | `mktemp -d /tmp/corpus-s014-agent003-XXXXXX`    |
| AGENT-004   | `mktemp -d /tmp/corpus-s014-agent004-XXXXXX`    |
| PLUGINS-002 | `mktemp -d /tmp/corpus-s014-plugins002-XXXXXX`  |

Automated tests use `fs.mkdtemp`/`mkdtempSync` with the same prefix.

**Never** `rm -rf /tmp/corpus-*`. There are **105** leftover `corpus-*` directories in `/tmp` from
sprints 003–013; a glob delete would destroy other agents' in-flight evidence. Delete only paths you
created and captured in a variable.

**The scratch hazard specific to this sprint is the live `claude` session.** AGENT-003 runs a real
agent with `Bash` access inside a scratch workspace. Two rules:

- **`cd` into the scratch workspace before launching `claude`, and confirm it**, so the session's
  `corpus` calls resolve their workspace by upward search to the scratch root and never to this
  repository. `corpus --workspace <scratch>` on every manual command is the belt to that suspenders.
- **The session's allowed tools are `Bash(corpus *)` plus reads.** AGENT-002's run used
  `--allowedTools "Bash(corpus *)"`; keep that. A session with unrestricted `Bash` inside a repo
  checkout is how a scratch experiment becomes a commit.

**PLUGINS-002 additionally writes inside the repository** (`plugins/todos/`), which is the one
issue in this batch whose work product is tracked source. `git -C <repo> status` before declaring
done; only `plugins/todos/**` and the two rider files should appear.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` kill sibling agents'
servers — **forbidden for the duration of this sprint.** Stop what you started, by pid:

```sh
node --import tsx apps/cli/src/bin/corpus.ts server start   # then: corpus server stop
npm run dev -w apps/ui -- --port 5285 --strictPort & VITE=$! ; kill -TERM "$VITE"
curl -N "http://127.0.0.1:9132/events?token=$TOK" & SSE=$! ; kill -TERM "$SSE"
```

A `claude` session started for E2E is **interactive or `-p`**; when it is `-p` it exits on its own,
and when it is not, record its pid and `kill -TERM` it. Before declaring a port free, check it with
`lsof -nP -iTCP:<port> -sTCP:LISTEN`.

### Machine-load discipline — binding on every agent in this batch

- **Scoped tests only during development**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`.
  **Never** the repo-wide suite, never `npm test` without a workspace filter, never `npm run coverage`
  or `npm run test:coverage` from a worktree. The orchestrator's harvest run is the single repo-wide
  gate (sprint-012 Adjudication 4, carried forward through sprint-013 Adjudication 1).
- **One workspace-scoped run at the very end of your session is the maximum.**
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time.** Never overlap builds, test runs, or `npm install`. PLUGINS-002's
  `npm run build` (which must now also build `plugins/todos`) and its `npm pack` are heavy commands.
- **A live `claude` session is a heavy consumer too.** AGENT-003 must not run a build or a test suite
  while its session is working an event.
- **Nobody runs `npm run e2e`.** Playwright is the orchestrator's at harvest.
- **Two concurrent implementation agents maximum this sprint**, and the staging below makes it one
  for stage A.

### From-source CLI

`node --import tsx apps/cli/src/bin/corpus.ts` — **never `npx`**. The single exception is
PLUGINS-002's packaged-plugin riders (TEST-284–TEST-290), which must drive the **installed** binary
out of a tarball prefix, because proving the packaged layout is the point.

For the live session, put a wrapper named `corpus` on `PATH` (AGENT-002's pattern) so the skill's
literal `corpus …` commands work unmodified:

```sh
mkdir -p "$SCRATCH/bin"
printf '#!/bin/sh\nexec node --import tsx %s/apps/cli/src/bin/corpus.ts "$@"\n' "$REPO" > "$SCRATCH/bin/corpus"
chmod +x "$SCRATCH/bin/corpus"
```

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree at `ef921c3` while writing this contract.

**The `comment.created` payload has six fields, not three.** `apps/server/src/threads/events.ts:39`:

```ts
export const commentPayload = (input: CommentEventInput): Record<string, unknown> => ({
  threadId: input.threadId,
  parentId: input.parentId,
  turnTs: input.turnTs,
  mentions: targets(input.parsed.mentions),
  skills: targets(input.parsed.skills),
  unresolved: [...input.parsed.unresolved],
});
```

AGENT-003's issue text names only `threadId`, `parentId`, `mentions`, `skills`. **`turnTs` and
`unresolved` are load-bearing**: `turnTs` identifies the turn that woke the agent (a thread may have
many), and `unresolved` — *not* `mentions` — is where a **missing** `@target` shows up. An
**archived** target appears in `mentions`/`skills` with `status: "archived"`. The module's own
comment says so: *"'you wrote `@nobody` and there is no such subagent' is exactly the 'missing or
archived' case §8 asks the orchestrator to answer in its reply."* A skill that reads only `mentions`
handles the archived case and silently drops the missing one.

**The `form.respond` payload has no `parentId`.** `apps/server/src/threads/forms.ts:136`:
`{threadId, formTs, option, note}` — `note` is `null` when none was given. On a form continuation the
skill must re-derive the parent with `corpus thread show <threadId>`, which prints it.

**Engagement is mechanical; the skill never sets it.** `apps/server/src/threads/participation.ts:93`
is `if (author === "agent" && current === "requested") return "engaged";`, with the docblock naming
§7 explicitly: *"the server does it mechanically instead"*. There is **no CLI verb** that sets
`agent:`. The skill states the consequence and never attempts the flag.

**Nothing validates a form block at post time.** `extractFormSource` is called only from
`requireForm` (`forms.ts:100`), i.e. when the user *answers*. `corpus thread reply` passes the body
through verbatim. A malformed form therefore posts successfully, renders as nothing useful, and fails
only when the user tries to answer it. The skill must state the exact shape rather than trusting a
server rejection that never comes.

**The form fence is backticks, whole-match.** `packages/contract/src/schemas/form.ts:50`:

```ts
export const FORM_FENCE_PATTERN =
  /(?:^|\r?\n)```form[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*(?=\r?\n|$)/;
```

Fields: `prompt` (required, non-empty) and `options` (required, ≥1, each non-empty, all distinct).
Single-select; an answer names one option verbatim. **`docs/cli.md` currently describes this as
"`~~~form` blocks"** in `corpus thread reply`'s prose — a fence the server does not recognize. See
Open Conflict 5; the skill uses backticks regardless of what the reference says.

**Anchors resolve against the BODY, and only the body.** `apps/server/src/anchors/resolve.ts:25`
is `resolveAnchorExact(body, selector)`; the whole §6 ladder takes a `body: string`. And the UI's
selection→selector path (`apps/ui/src/anchors/selectorFromSelection.ts`) slices `exact` out of
`source.markdown` via the ProseMirror serializer's emission trace — *"The quote comes from the
**markdown source**, never from the DOM's text"*. Both facts matter to PLUGINS-002: see Open
Conflict 8.

**`extra` is on every list row, not just the single read.** `packages/contract/src/schemas/doc.ts:133`
spreads `viewFrontmatterShape` (including `extra: ExtraFrontmatterSchema`) into **both**
`DocFrontmatterSchema` and `docRowBaseShape`, *"what lets the board read its whole column set from
the list response with no N+1"*. So `useDocs({ type: "todo" })` returns each document's `items`
inside `row.extra`, and `TodosColumn` needs exactly one query. This is the good news in PLUGINS-002.

**`broadcastInvalidate` auto-namespaces and rejects core keys.** A plugin passing `[["items"]]`
reaches the wire as `{"keys":[["x","todos","items"]]}`; passing `[["docs"]]` is rejected with
*"plugin todos may not invalidate \"docs\" — plugin keys are namespaced x/todos/…; core keys are
broadcast by the core write path itself"* **and no frame is emitted**. The core write path already
broadcasts `["docs"]` itself, so a route that writes through the context gets board refresh for free.

**`corpus doc create` and `corpus doc move` cannot leave `data/docs/`.**
`apps/server/src/core/paths.ts`'s `normalizeDocFolder` unconditionally prefixes `DOCS_ROOT` and
throws `PathTraversalError` otherwise; `write.ts:347`'s `resolveFolder` turns that into a 400. The
generated reference says it plainly: *"Destination folder under `data/docs/`"*, and `doc move`'s
prose adds *"skills inside their own folder, so neither can be moved"*. Consequence: **the agent can
edit an existing skill but cannot create a new one.** Open Conflict 1.

**There is no enumeration verb.** `docs/cli.md` documents 37 commands; none of them lists documents
or folders (`job list` and `lock list` are the only `list`s). `GET /api/tree` exists (SERVER-011) but
has no CLI wrapper, and per SERVER-018 it counts `data/docs/` only — skills are counted nowhere.
Open Conflict 2.

**A fresh workspace has three folders.** `assets/workspace/data/docs/` ships `inbox/`, `templates/`,
`views/` and nothing else. "Prefer an existing folder that already holds similar documents" has, on
day one, no such folder — the first filing necessarily creates one. `corpus doc move --folder finance`
creates the directory on write; the skill does not need a mkdir step.

**Skill ids are synthetic and start `doc_`.** `projection/project-document.ts:84-87` →
`doc_skill<8 hex>`; the shipped skills are `doc_skillorchestrate` / `doc_skillcomment` in their own
frontmatter. A skill's identity is its **path**. `SkillNameSchema` forbids `/`, so a nested skill is
indexable but unaddressable by `corpus skill rollback`.

**`corpus doc check` is clean on a fresh workspace and on commented documents.** Sprint-013's
Adjudication 6 leniency shipped, and CLI-006's round-2 fix removed the false `anchor-unused` error a
comment thread used to produce. A hand-written `SKILL.md` carrying only `name`/`description` checks
clean. The exit-6 contract is safe to lean on.

**`thread show` prints raw turn bodies.** No form parsing, no attachment rendering, no read-state,
no `events` array (sprint-013 Adjudication 14). Anything the skill needs out of a turn — a form's
YAML, an attachment link — it reads out of the raw markdown itself.

**`docs/cli.md` is generated, sorted, and drift-checked against HEAD.** `scripts/check-generated-artifacts.ts`
hashes → regenerates → re-hashes **and** requires `git diff --stat HEAD --` over the artifacts to be
empty. Consequence, as CONTRACT-008 and CLI-006 both hit it: **an agent cannot turn this check green
inside its own worktree before the orchestrator commits.** PLUGINS-002 adds three verbs and will hit
it. Record the red output verbatim with the reason and drive the regenerate-and-compare half against
a pre-run snapshot. That is the accepted pattern; skipping or hand-editing is not.

**The kit-only lint rule and the coverage glob already cover `plugins/todos/**` with zero edits.**
`eslint.config.js`'s `files: ["plugins/**/*.{ts,tsx}"]` allows exactly `@corpus/kit`, `@corpus/kit/**`,
`@corpus/contract`, `@corpus/contract/plugin` — `@corpus/contract/client` stays banned by omission.
`COVERAGE_INCLUDE` is `["apps/*/src/**", "packages/*/src/**", "plugins/*/**"]` with `plugins/_*/**`
excluded. **`plugins/todos` is therefore inside the ≥90% four-metric merged gate**, with no
per-plugin exemption. Budget test effort accordingly.

**`PluginManifest` lives in `@corpus/kit/plugin`, not `@corpus/contract`.** It carries React
component types, and the contract stays React-free. `PluginServerContext` and
`PluginCommandSpec`/`PluginCommandContext` live in `@corpus/contract/plugin`. PLUGINS-002's issue
text and the orchestrator's brief both say "contract" for the manifest; the import is the kit.

**`PluginCommandClient` is `{baseUrl}` and nothing else** (sprint-013 Adjudication 16). A plugin CLI
verb does its own `fetch` with `context.workspace.baseUrl`, the bearer token, and the `ACTOR_HEADER`
— `plugins/_fixture/cli/commands/add.ts` is the pattern to copy verbatim.

**Dist-first resolution already works for the server, and does not for the CLI.**
`discover.ts`'s `resolveRoutesModule` prefers `dist/server/routes.js`. But
`apps/cli/src/registry/plugins.ts`'s `discoverPluginTopics` does
`readdirSync(commandsDir).filter(name => name.endsWith(".ts"))` against the **source** directory,
using `dist` only to remap names it already found. A dist-only packaged plugin therefore exposes
**zero** CLI verbs. This is INFRA-008 escalation 3(a) and it is a rider below.

**A packaged plugin's `dist` cannot resolve `@corpus/contract`.** `stagePlugins` copies `dist/`
verbatim; `@corpus/contract` is **inlined into the tool's own bundles rather than installed**, so a
bare specifier in `dist/server/routes.js` throws `ERR_MODULE_NOT_FOUND` at dynamic import. Discovery
contains it as a warning and skips the plugin — routes never mount, and the CLI verbs (thin clients
over those routes) fail at request time. The fix is named in a comment in `stagePlugins`: bundle each
plugin's entry points at staging with the same first-party-inlined boundary. INFRA-008 escalation
3(b), rider below.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification, or an external precondition is unavailable — is marked
`STRUCK → Adjudication N`, `STRUCK → Open Conflict N`, or `DEFERRED → <reason>` in the E2E
Verification Log, **with the reason and the substitute evidence supplied**. Silent omission is a
fail. PLUGINS-002 will have several under Open Conflicts 8 and 9; that is expected and honest.

---

## Acceptance Tests

### AGENT-003: Comment skill — thread handling, inbox filing, skill genesis

`assets/workspace/claude/skills/comment/SKILL.md` replaces the AGENT-001 skeleton.
`scripts/workspace-template.test.ts` gains a `describe("comment skill body")` block mirroring the
orchestrate one.

#### A. Document shape and the pinned template tests

TEST-168: Frontmatter shape is preserved exactly
  Given: `assets/workspace/claude/skills/comment/SKILL.md` after AGENT-003
  When: The document is parsed by `scripts/workspace-template.ts`'s `documentAt`
  Then: Exactly two `---` fences; `name: comment` (equal to the directory basename); a non-empty
  `description`; `type: skill`; `title: Comment`; plus `id`, `created`, `updated`, `tags`, `status`,
  `anchors`, `evergreen`. No Corpus field is named `name`. `updated` is advanced beyond
  `2026-07-26T00:00:00Z`. The existing `it.each(skills)("$name carries both frontmatter field sets")`
  passes unchanged.

TEST-169: The six pinned section keywords still resolve
  Given: The new skill body
  When: `## `-level headings are lowercased and matched against
  `["gather context", "inbox filing", "reply", "forms", "skill genesis", "worked example"]`
  Then: Every keyword is contained in some heading. The existing
  `it.each(skills)("$name carries its required section headings")` passes **without editing its
  comment branch** — new sections are added, none of the six is renamed away.

TEST-170: The full twelve-section coverage is asserted
  Given: The issue's Technical Design lists twelve required sections
  When: A new assertion checks headings for the remaining six concerns
  Then: Headings also cover **when this runs / entry**, **inherited invariants**, **routing or
  directives**, **doing the work**, **engagement or closure**, and **stewardship**. Wording is free;
  coverage is asserted so a future edit cannot silently drop routing or engagement.

TEST-171: The CLI-only invariant is stated
  Given: The new skill body
  When: `it.each(skills)("$name states the CLI-only invariant")` runs
  Then: The body matches `/`corpus` CLI/` and `/never (?:hand-)?edit(?:ed)?\b/i`.

TEST-172: Queue terminal-state handling stays with the orchestrator
  Given: The new skill body
  When: The pinned guard `expect(body).not.toMatch(/corpus queue (?:complete|fail)/)` runs
  Then: It passes. The comment skill names **neither** verb — including inside its deferral text
  (see TEST-183) and including inside heredoc bodies and worked examples.

TEST-173: No skeleton remnants, no placeholders, no dev-harness references
  Given: The new skill body
  When: Scanned for `"Arrives with AGENT-003"`, `TODO`, `TBD`, `...`-only sections, and references
  to this repository's harness (`issues/`, `SPEC.md §`, `.claude/agents/` as a dev path, `npm run`)
  Then: Zero hits. Every `## ` section has a substantive body, not a bare heading — same
  minimum-length idiom as the orchestrate skill's
  `it("gives every section a substantive body, not a bare heading")`.

TEST-174: Every `corpus …` invocation resolves against `docs/cli.md`
  Given: `CLI_COMMANDS_PENDING_CLI_006` is `[]`
  When: `extractCorpusInvocations` runs over the new skill and `normalizeInvocation` resolves each
  against `parseCliDoc(docs/cli.md)`
  Then: The unresolved set is `[]`. **No allowlist entry is added.** If the skill needs a verb that
  does not exist, the issue escalates to the orchestrator rather than adding one (Open Conflicts 1
  and 2 are the two known candidates and are ruled below).

TEST-175: Every multi-line text argument uses a quoted heredoc
  Given: The new skill body
  When: Each heredoc marker is inspected
  Then: Each matches `/^<<'EOF'$/`, and the body never contains `-m "$(`. Same idiom as the
  orchestrate skill's pinned test.

#### B. The literal rules the skill must state

TEST-176: The non-negotiable commands appear verbatim
  Given: The new skill body
  When: Checked with `expect(body).toContain(rule)` for each
  Then: All of the following appear: `corpus thread show`, `corpus doc show`, `corpus doc edit`,
  `corpus doc create`, `corpus doc move`, `corpus doc archive`, `corpus thread reply`,
  `corpus thread resolve`, `corpus job log`, `--from agent`, `export CORPUS_FROM=agent`.

TEST-177: The read path is stated explicitly (sprint-012 Adjudication 21)
  Given: The Gather-context section
  When: Read
  Then: It states that **document content** may be read from `data/` markdown directly, and that
  **thread, queue and lock state** goes through the CLI — with `corpus thread show <id>` named as the
  way to read a thread and `corpus doc show <id>` as the way to read a document *with its anchor
  resolution*. It does not tell the agent to parse `.corpus/` files.

TEST-178: All three thread shapes have a stated read order
  Given: The Gather-context section
  When: Read
  Then: **Anchored** — the thread, the parent, and the anchor quote with surrounding context, noting
  that `corpus doc show` prints each anchor's resolved range **or its orphaned state and its quote**.
  **Whole-document** — thread plus parent, no anchor. **Standalone** (`parent: null`) — the thread is
  the whole context. Each names when to stop reading.

TEST-179: The standalone-title obligation is stated
  Given: The Gather-context or Reply section
  When: Read
  Then: It states that a standalone thread gets a real title after the first exchange, set through
  `corpus doc edit <threadId> --title "…" --from agent` (a thread is a document), and that this is an
  obligation rather than an option.

TEST-180: Routing reads the payload, not the prose
  Given: The routing/directives section
  When: Read
  Then: It names all six payload fields — `threadId`, `parentId`, `turnTs`, `mentions`, `skills`,
  `unresolved` — states that `@<subagent>` **routes** and `/<skill>` **applies** and the two combine,
  that generic `@agent` leaves routing to normal triage, and that the skill **does not re-parse the
  turn text** for sigils.

TEST-181: Missing and archived targets are distinguished and both handled
  Given: The routing section
  When: Read
  Then: It states that a **missing** target appears in `unresolved` and an **archived** one appears
  in `mentions`/`skills` with `status: "archived"`, that either way the agent does the useful thing
  anyway, and that the deviation is **named explicitly in the reply** — with a literal example in the
  worked examples (TEST-190).

TEST-182: Engagement semantics and their consequence are stated
  Given: The engagement/closure section
  When: Read
  Then: It states that the **server** flips `requested → engaged` on the agent's first turn (no CLI
  verb does it, and the skill never tries), that every later user turn then re-triggers the agent
  unless the thread is `resolved` or the turn was note-only, and the behavioral consequence: say when
  a matter is closed, suggest resolving, and do **not** resolve on the user's behalf unless asked.

TEST-183: The lock-deferral protocol is stated without naming a queue verb
  Given: The inherited-invariants or do-the-work section
  When: Read
  Then: It states that a `423` on a user-locked parent means **defer, not force**; that the agent
  **replies in the thread** saying the edit is queued behind the user's editing session; that it
  emits a `corpus job log <eventId> "deferred: …"` line with the `deferred:` prefix; and that it then
  **returns the event to the orchestrate skill**, which owns the terminal state. The words
  `corpus queue complete` and `corpus queue fail` do not appear (TEST-172). `corpus job retry` may be
  mentioned as the operator's re-entry path.

TEST-184: Reply mechanics are exact
  Given: The Reply section
  When: Read
  Then: It gives `corpus thread reply <id> --from agent <<'EOF' … EOF` as the form; states that the
  reply names any document changed, by `[[id]]`; gives guidance on length and tone; states that a
  reply is **always** posted, even when the outcome is "nothing to do", because a user is watching a
  pending indicator; and states that a reply is never posted by editing the thread file.

TEST-185: Inbox filing is concrete and names a convention
  Given: The Inbox-filing section
  When: Read
  Then: It covers, in order: read the capture (its id is the event's `parentId`), give it a real
  title, expand it, choose a destination, `corpus doc move <id> --folder <folder> --from agent`, tag
  it with `corpus doc edit <id> --add-tag …`, and reply with what it became and where it lives. The
  filing convention is stated: prefer a folder that already holds similar documents; create a new one
  only for a genuine category; when the right home is genuinely ambiguous, **leave it in `inbox/` and
  ask** — a form is the right instrument for a two-or-three-way choice. How the agent surveys
  existing folders is per Open Conflict 2's ruling.

TEST-186: Expansion never invents facts
  Given: The Inbox-filing section
  When: Read
  Then: It states that expanding a one-line capture adds **structure** (title, headings, an
  open-questions section) and **not content**, and that an unclear intent is asked about rather than
  guessed.

TEST-187: Form emission is specified with the exact grammar
  Given: The Forms section
  When: Read
  Then: It gives a literal ```` ```form ```` fenced block (backticks, not tildes) carrying a
  non-empty `prompt` and `options` with at least one entry, all non-empty and distinct; states that a
  turn carries **at most one** form; states single-select; and states **when** to raise one (a
  bounded choice that unblocks work — not an open question, which is just a reply). It notes that
  nothing validates the block at post time, so the shape is the author's responsibility.

TEST-188: `form.respond` is specified as a continuation
  Given: The Forms section
  When: Read
  Then: It names the payload's four fields (`threadId`, `formTs`, `option`, `note`), states that
  there is **no `parentId`** so the parent is re-derived with `corpus thread show`, and states that
  the agent resumes from where the form was raised rather than restarting the exchange.

TEST-189: Skill genesis states threshold, destination, mechanism, and announcement
  Given: The Skill-genesis section
  When: Read
  Then: It states what earns codification (a preference stated more than once, a correction repeated
  across threads, a workflow the user keeps describing) versus what is just a note in a document;
  where it goes; how it is written; that it is **announced in the reply**; and the conflict rule —
  a correction contradicting an existing skill becomes an **edit** to that skill, never a second
  skill saying the opposite. The creation-versus-extension scope is per Open Conflict 1's ruling.

TEST-190: Four worked examples with literal commands
  Given: The Worked-examples section
  When: Read
  Then: Four traces appear with runnable commands: (1) an anchored comment that edits the parent and
  replies naming the change; (2) a standalone Ask that gets titled and produces a created document;
  (3) an inbox Capture filed end to end; (4) a `form.respond` continuation. Every command in them
  passes TEST-174.

TEST-191: The plugin boundary rule is stated
  Given: The do-the-work or stewardship section
  When: Read
  Then: It states that where a thread's request falls into a plugin's domain, the agent invokes that
  plugin's skill rather than manipulating the plugin's document types directly — the rule PLUGINS-002
  builds on. **No plugin is named**, matching the orchestrate skill's
  `it("hardwires no plugin name and hedges nothing")`.

TEST-192: Stewardship-in-service-of-a-thread is stated and bounded
  Given: The stewardship section
  When: Read
  Then: It states the opportunistic half of §7's charter (fix what is obviously stale, misfiled, or
  duplicated while in a document, and say so in the reply) and the hard floor: **archive, never
  delete**; deletion is user-only.

TEST-193: The named edge cases are covered
  Given: The whole body
  When: Checked for each of the issue's edge cases
  Then: All are addressed somewhere: orphaned anchor (work from the thread; never hand-repair the
  `anchors` map); deleted parent (explain in the thread; do not recreate); attachment-only turn (the
  attachment is the request); trivial standalone (the reply may be the whole answer); long work
  spawned to a subagent (**acknowledge immediately**, do not go silent until `agent.done`); a thread
  about a skill document (legitimate; edit it, announce it, mention `corpus skill rollback` as the
  undo).

TEST-194: The comment skill does not duplicate the orchestrate skill
  Given: Both skill bodies
  When: Compared
  Then: The comment skill does not restate the loop, `claim-all`, concurrency/ordering rules, HALT,
  `.corpus/HALT`, `corpus queue idle`, or `reap-stale`. It refers to the orchestrate skill by name
  for the invariants it inherits. Assert `not.toMatch` on `/corpus queue (?:claim-all|idle|halt|resume|reap-stale)/`.

TEST-195: The orchestrate skill is unchanged, or changed only at the entry contract
  Given: `git diff` on `assets/workspace/claude/skills/orchestrate/SKILL.md`
  When: Inspected
  Then: Either empty, or confined to routing wording that names the comment skill's entry contract.
  **No comment-skill rule is added to it.** Any change is called out in the E2E log with its reason.

#### C. Live-session E2E — the real loop, all four entry shapes

Preconditions for TEST-196 onward: scratch workspace on `9132`, real server, board open in a real
browser, `claude` running `/orchestrate` with `--output-format stream-json --verbose --allowedTools "Bash(corpus *)"`,
**transcript redirected to a file in the scratch directory**.

TEST-196: The session claims and completes a real `comment.created`
  Given: The loop is parked on `corpus queue idle`
  When: An `@agent` comment is posted from the browser
  Then: `idle` returns within ~1 s, the event is claimed, and after handling it reaches
  `processed/`. The console drawer shows the job with its log lines.

TEST-197: Anchored comment — the agent reads context, edits the parent, and reports
  Given: A document with a factual claim, and text selected in the UI with a comment
  `@agent is this still right?`
  When: The loop handles it
  Then: The agent turn appears in the thread via SSE **without reload**; the file on disk changed;
  `git log -1` shows the edit authored by `agent`; the reply names the change with a `[[ref]]`; and
  **the anchor still resolves after the edit** (the highlight is intact; `corpus doc show` prints a
  range, not an orphan).

TEST-198: Whole-document comment producing a new document
  Given: A whole-document comment asking for something durable
  When: The loop handles it
  Then: A new document exists on disk with valid frontmatter, appears in the board, and is referenced
  from the reply by `[[id]]`.

TEST-199: Standalone Ask is answered and retitled
  Given: The global composer's **Ask** with an open question
  When: The loop handles it
  Then: A `parent: null` thread was created, answered, and **retitled** by the agent after the
  exchange — the new title is visible in the board row and changed on disk, and `git log` attributes
  the title edit to `agent`.

TEST-200: Capture is filed end to end
  Given: The composer's **Capture** with a one-line thought
  When: The loop handles it
  Then: The inbox document is retitled, **moved out of `data/docs/inbox/`** into a sensible folder,
  expanded, and tagged; the filing thread's reply says what it became and where it went. Confirmed
  via `GET /api/tree` and the file's new path on disk.

TEST-201: An ambiguous capture is asked about, not guessed
  Given: A capture whose destination is genuinely unclear
  When: The loop handles it
  Then: The agent **asks** — a form or a direct question — instead of guessing, and the document
  **stays in `inbox/`** meanwhile.

TEST-202: Form round trip resumes rather than restarts
  Given: TEST-201's form, answered in the UI
  When: The `form.respond` event is enqueued and handled
  Then: The agent resumes the same conversation — its reply references the earlier exchange and does
  not re-ask — and completes the filing. The answer turn and the continuation are both in the thread
  file, in order.

TEST-203: A targeted `@<subagent>` is routed
  Given: A subagent persona document created out-of-band at `.claude/agents/<name>.md` and indexed
  by the watcher (the agent has no verb that writes there — see Open Conflict 1)
  When: A comment `@<that-subagent>` is posted
  Then: The payload's `mentions` names it, the work is routed there, and the routing is visible in
  the job log.

TEST-204: A missing target is handled and named
  Given: A comment mentioning `@<nonexistent>` alongside a real request
  When: The loop handles it
  Then: The payload's `unresolved` carries the token, the agent **proceeds sensibly**, and the reply
  **says so explicitly**.

TEST-205: A `/<skill>` invocation applies that skill
  Given: A comment invoking `/<an installed skill>` on a document
  When: The loop handles it
  Then: The payload's `skills` names it and that skill is applied — visible in the job log.

TEST-206: Engaged re-trigger, and resolution stopping it
  Given: An engaged thread
  When: A plain reply with no `@agent` is posted, then the thread is resolved and another reply posted
  Then: The first re-triggers the agent (event enqueued, agent replies); the second enqueues nothing.
  `corpus thread show` reports `agent engaged` throughout.

TEST-207: A note-only turn produces no event
  Given: An engaged thread
  When: A turn is posted with the "note only" toggle
  Then: No `comment.created` is enqueued; the queue stays at its prior depth.

TEST-208: Lock deferral replies rather than going silent
  Given: The parent document's lock held by the UI editor
  When: An edit request is posted in a thread
  Then: The agent's reply says the edit is queued behind the user's session; a `deferred:`-prefixed
  job-log line exists; and after the lock clears and the job is retried, the edit lands. The reply is
  posted **before** the deferral, not after.

TEST-209: Archive, never delete
  Given: An obsolete document
  When: The agent is asked to "get rid of" it
  Then: It archives — `status: archived`, file present, restorable — and never deletes. `git log`
  shows an archive commit authored by `agent`; no deletion appears anywhere in the session.

TEST-210: Skill genesis produces a real, indexed change
  Given: The same preference stated across two threads
  When: The loop handles the second
  Then: A skill document under `.claude/skills/` is created **or extended** (per Open Conflict 1's
  ruling), it is indexed as `type: skill` and visible on the board, and **the reply announces it**.

TEST-211: `corpus skill rollback` undoes TEST-210
  Given: The skill change from TEST-210 is committed
  When: `corpus skill rollback <name>` runs
  Then: The skill's previous version is restored, the projection reflects it, and the rollback is a
  commit in the workspace's history.

TEST-212: The session made no direct mutation
  Given: The retained stream-json transcript
  When: Audited for `Write`/`Edit` tool calls into `data/`, `.corpus/`, or `.claude/`, and for any
  `curl`/`fetch` against the API
  Then: Zero. Every mutation went through a `corpus` command. Tool counts are recorded in the log.

TEST-213: The session used the stated read path
  Given: The transcript
  When: Audited
  Then: Thread and anchor context came from `corpus thread show` / `corpus doc show`; any direct
  reads are of `data/` markdown for **content** only, consistent with TEST-177.

TEST-214: The transcript is retained
  Given: The E2E run
  When: The E2E log is written
  Then: The stream-json transcript file lives in the issue's scratch directory, its path is recorded
  in the log, and the claims of TEST-212/TEST-213 cite it. (AGENT-002's evaluator had to score the
  equivalent claims EVIDENCE-ACCEPTED because the transcript was discarded; this closes that.)

TEST-215: The model actually used is recorded
  Given: The E2E Verification Log
  When: Read
  Then: It states `implemented on: opus | fable`, per CLAUDE.md's Record-actuals rule.

---

### AGENT-004: `↳` trace lines in agent turns

Same agent session, run **after** AGENT-003's skill text is written, so the trace rule lands in a
file that already exists in final form.

TEST-216: The spec dependency is satisfied, and recorded
  Given: `SPEC.md:183` ("**Trace lines.**") and AGENT-004's issue text, which still says the grammar
  is "proposed"
  When: Compared
  Then: The grammar **has landed** in §6 and §7 (§7's comment-skill paragraph now reads "closing it
  with a trace line (§6) reporting the actions taken"). The issue's stale "phase-3 spec pass
  proposes it" wording and its "if the spec pass rejects the grammar, close this" branch are struck,
  and the E2E log says so.

TEST-217: The grammar is stated in the comment skill, exactly
  Given: `assets/workspace/claude/skills/comment/SKILL.md`
  When: Read
  Then: It states that a turn that **performed writes** closes with a final line beginning `↳ `
  (arrow, space), that it is a **one-line, past-tense action report** of what changed, that it is the
  **final line and only the final line**, and that **a turn whose work changed nothing carries no
  trace**. The literal string `↳ ` appears in the skill.

TEST-218: The grammar is stated in the orchestrate skill
  Given: `assets/workspace/claude/skills/orchestrate/SKILL.md`
  When: Read
  Then: The trace convention is stated for turns the orchestrator itself posts (its deferral reply is
  the live case), or the skill explicitly delegates trace authorship to the comment skill. Whichever
  is chosen is stated, not left implicit. This is the **one** sanctioned edit to the orchestrate
  skill this sprint (with TEST-195's entry-contract carve-out).

TEST-219: The worked examples end with traces
  Given: Both skills' worked examples that perform writes
  When: Read
  Then: Each reply heredoc that follows a mutation ends with a `↳ ` line as its final line, and each
  reply that changed nothing does not.

TEST-220: The skills never claim the arrow is rendered from the text
  Given: Both skill bodies
  When: Read
  Then: Neither instructs the agent to omit the arrow or to add markup around it. The arrow is
  written into the turn body; the UI's `::before` is an implementation detail the skill does not
  depend on and must not contradict.

TEST-221: A template test pins the trace rule
  Given: `scripts/workspace-template.test.ts`
  When: Extended
  Then: It asserts the literal `↳ ` appears in the comment skill, asserts the past-tense/final-line
  wording is present, and asserts no `↳` appears in a **user**-authored example.

TEST-222: A real agent turn renders as a trace in the shipped UI
  Given: The live session from TEST-197 (an anchored comment that edited the parent)
  When: The resulting turn is viewed in the real browser
  Then: A `.turn-trace` element exists under that turn; its `textContent` **does not** contain `↳`;
  its `::before` computed `content` **does** contain `↳`. Read from the live DOM, not a fixture.

TEST-223: The trace is in the file's bytes
  Given: The same turn
  When: The thread file on disk is read
  Then: Its final line for that turn begins with the literal `↳ ` character sequence — the convention
  keeps turn files plain markdown, and the arrow **is** in the bytes (only the *rendering* strips it).

TEST-224: A no-write turn carries no trace
  Given: A thread exchange where the agent only answered a question
  When: The turn is inspected on disk and in the browser
  Then: No `↳` line, and no `.turn-trace` element.

TEST-225: A user turn with a `↳` line is not styled as a trace
  Given: A user turn posted whose last line begins `↳`
  When: Rendered
  Then: No `.turn-trace` element; the literal arrow shows as ordinary markdown text. (`splitTrace`
  short-circuits on `author !== "agent"`.) This is a **read-only observation** of existing behavior,
  not a change AGENT-004 makes.

TEST-226: A mid-body `↳` line is ordinary markdown
  Given: An agent turn with a `↳` line that is not last
  When: Rendered
  Then: It stays in the body and renders as text. Confirms the skill's "final line only" rule matters.

TEST-227: The renderer's known leniency is recorded, not silently relied on
  Given: `apps/ui/src/thread/Turn.tsx`'s `splitTrace`, which `.trim()`s the candidate line and checks
  `startsWith("↳")` **without** requiring the trailing space, and which runs on the
  attachment-stripped `prose` rather than the raw final line
  When: AGENT-004 writes the skill rule
  Then: The skill specifies the **strict** grammar (`↳ ` with the space, true final line). The
  renderer's leniency is `issues/ui/013-pr10-minor-findings.md` finding (11), status `todo`; AGENT-004
  does **not** fix it and does **not** depend on it. The E2E log records that the strict rule is
  written against a lenient reader, and that UI-013 is the home for tightening it.

TEST-228: No contract or UI change
  Given: `git diff`
  When: Inspected
  Then: AGENT-004 touches only `assets/workspace/**` and `scripts/workspace-template.test.ts`. There
  is no `trace` field on `Turn`, and none is added — the convention stays body text (SPEC §6: "no
  dedicated field or markup beyond the line itself").

---

### AGENT-003 rider: the template-manifest gitignore question (sprint-013 Adjudication 23)

Routed to this session by Adjudication 23. **Conditional on Open Conflict 7's ruling** — the analysis
below is the deliverable either way.

TEST-229: The analysis is recorded with a recommendation
  Given: `assets/workspace/gitignore`, `apps/cli/src/commands/workspace/upgrade.ts:185-215`, and
  `apps/cli/src/commands/init/{index,scaffold}.ts`
  When: The agent analyses whether the template should un-ignore `.corpus/template-manifest.json`
  Then: The E2E log records: (a) that the blanket `.corpus/*` rule's own comment enumerates
  *secret*, *derived*, *transient* — and the manifest is **none of the three**; (b) that
  `scaffoldWorkspace` writes the manifest **before** `commitAll`'s `git add --all`, so un-ignoring
  keeps a freshly initialised workspace clean; (c) that `upgrade.ts` already handles the tracked case
  with **no code change**, via `git check-ignore`; and (d) a clear recommendation.

TEST-230: The one-line change, if made
  Given: Open Conflict 7 ruled in favour
  When: `assets/workspace/gitignore` is edited
  Then: A single `!.corpus/template-manifest.json` negation is added after `.corpus/*`, with a
  comment in the file's existing voice explaining why this one file is provenance rather than runtime
  state. No other line changes.

TEST-231: A fresh workspace stays clean and tracks the manifest
  Given: The edited template
  When: `corpus init` runs into a scratch directory
  Then: `git status --porcelain` is **empty**; `git ls-files` under `.corpus` lists the five queue
  `.gitkeep`s **plus** `.corpus/template-manifest.json`; `git check-ignore .corpus/config.json` still
  matches.

TEST-232: The three pinned CLI tests are updated in lockstep
  Given: The edited template
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli/src/commands/init apps/cli/src/commands/workspace` runs
  Then: Green, with these three updated: `init/index.test.ts`'s
  `it("tracks the queue skeleton and nothing else under .corpus")` (its `toEqual` list gains the
  manifest; the manifest leaves its `check-ignore` loop); `upgrade.test.ts`'s "manifest stays out of
  the commit" test (premise inverts — it must now synthesize an *ignoring* template to keep testing
  that branch); and `upgrade.test.ts`'s `it("commits the manifest when the workspace does track it")`
  (its template override becomes redundant with the shipped default — keep the branch covered, do not
  delete it). **Both branches of `isIgnored` remain covered.**

TEST-233: An upgrade commit carries the manifest
  Given: A workspace initialised from the edited template
  When: `corpus workspace upgrade` runs after a template file changes
  Then: `manifestCommitted` is `true` and `git show --name-only HEAD` lists
  `.corpus/template-manifest.json` alongside the changed template files — the manifest in the same
  commit as the files it describes.

---

### PLUGINS-002: Todos reference plugin

Stage B, after AGENT-003 lands. Everything under `plugins/todos/` plus two INFRA riders.

#### A. Manifest, types, and discovery

TEST-234: The manifest is valid and complete
  Given: `plugins/todos/manifest.ts`
  When: Loaded
  Then: It default-exports `definePlugin({...})` imported from **`@corpus/kit/plugin`** with
  `id: "todos"`, `name: "Todos"`, an `icon`, an `order`, one `docTypes` entry for `todo` carrying
  `View`, `ListItem`, `DocPanel` and `validate`, and one `columns` entry for the `todos` column type.

TEST-235: `types.yaml` agrees with the manifest, both directions
  Given: `plugins/todos/types.yaml` and the manifest
  When: The PLUGINS-001 parity check runs against todos
  Then: Every manifest `docTypes` entry is declared in `types.yaml` and vice versa. Drilled both
  directions: adding a ghost type to either side fails with the naming assertion.

TEST-236: Todos is **not** excluded as an underscore plugin
  Given: Adjudication 9's exclusion filters (UI glob, CLI registry, server discovery, docs generator)
  When: Each is exercised in production mode
  Then: `todos` passes every one. This is the first real subject for the non-underscore path;
  `_fixture` remains excluded in the same run, proving the filter still discriminates.

TEST-237: The UI discovers the manifest with zero core edits
  Given: `git diff` over `apps/`, `packages/`
  When: Inspected after PLUGINS-002
  Then: No core file enumerates `todos`. The plugin is picked up by `import.meta.glob` alone.

TEST-238: The server mounts the routes at `/api/x/todos`
  Given: A real server on `9142`
  When: Started
  Then: The boot log lists `todos` discovered and mounted; `GET /api/x/todos/...` is reachable behind
  the bearer guard; an unauthenticated request is rejected like any `/api/*` route.

TEST-239: Dist-first resolution is exercised for real
  Given: `npm run build` has produced `plugins/todos/dist/`
  When: The server resolves the routes module
  Then: It loads `dist/server/routes.js`, not `server/routes.ts` — proven by editing the `.ts` source
  and observing the **unchanged** behavior until a rebuild. (This is the trap that fooled the
  PLUGINS-001 evaluator; record the drill.)

#### B. Server routes and the items module

TEST-240: `server/items.ts` is the sole owner of the format
  Given: `plugins/todos/**`
  When: Grepped for `items`
  Then: Only `server/items.ts` reads or writes the `items` array structurally. The routes call it; the
  CLI never parses frontmatter; the UI reads already-parsed frontmatter and never writes it directly.

TEST-241: Append adds an item with a creation timestamp
  Given: A `todo` document
  When: `POST /api/x/todos/:docId/items` with `{text}`
  Then: `201`; the file on disk gains `{text, done: false, ts}` with `ts` an ISO-8601 **creation**
  time; a git commit exists; the projection reflects it.

TEST-242: Toggle flips `done` and never mutates `ts`
  Given: An item at index `i`
  When: `PUT /api/x/todos/:docId/items/:index` toggles it
  Then: `done` flips; `ts` is byte-identical to before. A second toggle returns it, `ts` still
  unchanged.

TEST-243: The text-mismatch guard returns 409
  Given: A request carrying an expected current `text` that no longer matches the item at that index
  When: `PUT` is issued
  Then: `409` with a readable message; **nothing is written** — file unchanged, no commit.

TEST-244: Out-of-range and unknown-document errors
  Given: An index beyond the array, and an unknown `docId`
  When: Each route is called
  Then: `400` for the index, `404` for the document, each with a readable message and no write.

TEST-245: Delete removes exactly one item
  Given: A three-item document
  When: `DELETE /api/x/todos/:docId/items/:index`
  Then: The named item is gone, the other two keep their `text`/`done`/`ts` verbatim, and a commit
  exists.

TEST-246: Every write goes through the core write path
  Given: Any of the four mutating routes
  When: Called
  Then: The file on disk changed, a **git auto-commit** exists with the right author (per
  `ACTOR_HEADER`), and the projection updated — because the route used `PluginServerContext`, never
  the filesystem. Assert no `node:fs` write import exists anywhere under `plugins/todos/server/`.

TEST-247: SSE invalidation is namespaced and core keys are refused
  Given: A live SSE stream
  When: An item is toggled
  Then: An `invalidate` frame arrives whose key begins `["x","todos",…]`. Separately, a deliberate
  `broadcastInvalidate([["docs"]])` is **rejected** with the namespacing message and **no frame is
  emitted** — the plugin does not attempt to invalidate core keys, because the core write path
  already does.

TEST-248: Malformed items are rejected with a readable message
  Given: A document whose `items` is a non-array, or has an entry missing `text`/`done`/`ts`, or has
  wrong types
  When: `validate` runs and when a route touches it
  Then: A readable, specific message naming the offending field; no write proceeds on a mutation.

#### C. UI — View, ListItem, DocPanel, Column

TEST-249: The View renders a checkbox list
  Given: A `type: todo` document with mixed items
  When: Opened in a column reader and in focus mode
  Then: One row per item; done items visually distinguished (line-through, muted, `☑`); an inline
  "add item" affordance; item labels text-editable. Matches `design/index.html`'s `.check` treatment
  — spacing, type scale, and the due chip come from **kit tokens**, with zero hard-coded colors.

TEST-250: Toggling is optimistic and persists
  Given: The View
  When: A checkbox is clicked
  Then: The box flips **immediately** (optimistic update), a `PUT` is issued, and the state reconciles
  on the invalidation. The file on disk shows the change and `git log -1` shows the commit.

TEST-251: A 409 surfaces rather than silently writing
  Given: An item deleted concurrently
  When: The stale View toggles it
  Then: The mutation 409s, the UI refetches, and a toast/notice appears. No silent overwrite.

TEST-252: The View degrades on malformed items
  Given: A document whose `items` fails `validate` (hand-edited)
  When: Rendered
  Then: A non-blocking notice plus the raw markdown fallback — **it does not crash**, the DocPanel
  hides, and the document remains editable so the user can fix it.

TEST-253: A locked todo document renders read-only
  Given: The document's edit lock held by the other party
  When: Rendered
  Then: The core lock banner appears, toggles are disabled, and the plugin makes no attempt to bypass
  the lock.

TEST-254: Empty items render an empty state
  Given: `items: []` (or the key absent — see Open Conflict 9)
  When: Rendered
  Then: An empty state with the add affordance; DocPanel shows `0` open / `0` done; the document does
  **not** appear in the Todos column.

TEST-255: `ListItem` shows title, first items, and a due count
  Given: A todo document with due and non-due items
  When: Its row renders in any column
  Then: Title, the first items truncated (matching the design's three-item `.todo-items` preview with
  `☐`/`☑`), and a **due count** badge. Long item text truncates with an ellipsis.

TEST-256: Overdue treatment is applied
  Given: An item with `due` in the past
  When: The row and the column render
  Then: The overdue treatment from the design applies (`--signal` for open, `--ink-3` once done), via
  kit tokens. No new notification machinery.

TEST-257: `DocPanel` derives counts and never stores them
  Given: Open/all-done/all-open/mixed/empty documents
  When: The panel renders, and when items toggle
  Then: Open and done counts are correct in every case and update **live** with the same invalidation
  that updates the list — they can never disagree with it. The panel renders above the document in
  both the column reader and focus mode.

TEST-258: The Todos column aggregates open items across documents
  Given: Several `todo` documents with open and done items
  When: The Todos column renders
  Then: Only **open** items appear, grouped by source document, each row linking to its document.
  Checking an item elsewhere removes it from the column **live**, without reload.

TEST-259: Archived todo documents are excluded
  Given: A `todo` document with `status: archived` holding open items
  When: The column renders
  Then: Its items do not appear, matching core's default exclusion.

TEST-260: The column is a single query
  Given: `TodosColumn`
  When: Its network traffic is observed
  Then: One `useDocs({ type: "todo" })` call; items come from each row's `extra`, flattened
  client-side. No N+1, no bespoke endpoint. If per-document item counts grow large, a "+N more"
  affordance truncates rather than adding an endpoint.

TEST-261: The column is kit-only
  Given: `plugins/todos/**`
  When: Imports are audited by grep and by `npm run lint`
  Then: Only `@corpus/kit`, `@corpus/kit/**`, `@corpus/contract`, `@corpus/contract/plugin`, node
  builtins, and its own files. **Zero** imports of `apps/ui/src`, and zero of
  `@corpus/contract/client`.

TEST-262: The kit-only rule fires when violated
  Given: A deliberate `apps/ui/src` import added to `TodosColumn.tsx`
  When: `npm run lint` runs
  Then: It **fails**, naming the kit-only rule ("Plugins may import only @corpus/kit and
  @corpus/contract (SPEC.md §10) — never a workspace's internals by path"). Reverted, lint passes.
  **The rule needs no config edit** to cover `plugins/todos/**`.

TEST-263: A crashing column shows an error card and the board survives
  Given: `TodosColumn` made to throw deliberately on render
  When: The board loads
  Then: An error card appears **in that column** reading `Plugin error — todos`; every other column
  renders, scrolls, and opens readers normally. Reverted, the column recovers.

TEST-264: Adding the column creates a pinned view document
  Given: The board's "＋ New list" picker
  When: "Todos" is chosen
  Then: A pinned `type: view` document exists on disk with `column: "todos/todos"` in its
  frontmatter, and the column appears in board order like any other.

#### D. CLI verbs

TEST-265: The three verbs exist and are registered
  Given: A real server and the from-source binary
  When: `corpus todos --help` runs
  Then: `add`, `check`, and `list` are listed. `corpus --help` lists the `todos` topic. Each verb
  appears at all three `--help` levels.

TEST-266: Registry validation passes for each verb
  Given: `validateRegistry` at module load
  When: The CLI starts
  Then: Each spec has a kebab-case name, a non-empty summary, ≥1 example whose `command` starts with
  `"corpus "` and carries a non-empty description, no duplicate arg names, no required arg after an
  optional one, and **no flag shadowing a global** — notably not `--from`.

TEST-267: `corpus todos add` round-trips
  Given: An existing todo document
  When: `corpus todos add "<doc title>" "follow up on X" --from agent`
  Then: The item lands on disk, a commit is authored by `agent`, and the open browser tab updates
  **live** without reload.

TEST-268: `corpus todos check` accepts an index or a text match
  Given: A document with distinct items
  When: `corpus todos check <doc> 2` and `corpus todos check <doc> "follow up on X"`
  Then: Both check the intended item. Text matching is case-insensitive.

TEST-269: Ambiguous text errors with candidates
  Given: A document with duplicate item text
  When: `corpus todos check <doc> "<duplicated text>"`
  Then: A usage error naming the ambiguity and **listing the candidate indices**; nothing is written.

TEST-270: `corpus todos list` renders a table and clean JSON
  Given: Todo documents
  When: `corpus todos list` and `corpus todos list --json`
  Then: Human mode prints a table; `--json` emits **exactly one** JSON value (`jq -e` proves it) with
  a stable shape, and the example's `description` in the registry inlines that literal shape (house
  style — the string lands verbatim in `docs/cli.md`).

TEST-271: Documents resolve by id **or** title
  Given: A todo document titled "Shopping list"
  When: A verb is given the title instead of the id
  Then: It resolves through the core docs API before hitting the plugin route — so the agent can say
  "the shopping list". An unresolvable name errors clearly.

TEST-272: The verbs are thin clients
  Given: `plugins/todos/cli/commands/*.ts`
  When: Read
  Then: Each is a `PluginCommandSpec` doing its own `fetch` against `context.workspace.baseUrl` with
  the bearer token and `ACTOR_HEADER`, following `plugins/_fixture/cli/commands/add.ts`. No
  filesystem access, no frontmatter parsing, no `@corpus/contract/client`.

TEST-273: The verbs reach `docs/cli.md`
  Given: `npm run docs:cli -w apps/cli`
  When: Regenerated
  Then: `corpus todos add|check|list` appear, each with its example; `_fixture` does **not**. The
  artifact-drift check is red inside the worktree until the orchestrator commits — record that output
  verbatim with its reason, per the accepted pattern.

#### E. Skill, template, and the M6 subtractive check

TEST-274: The plugin skill exists and is CLI-only
  Given: `plugins/todos/skills/todos/SKILL.md`
  When: Read
  Then: It instructs the agent to use `corpus todos …` and core `corpus doc …` verbs only — never
  direct file writes. It covers creating a todo document when none exists, adding items from a thread
  request, checking items off, and reporting back in the thread. It is short and behavioral.

TEST-275: The skill installs into a workspace
  Given: A fresh `corpus init`
  When: The workspace is inspected
  Then: `<workspace>/.claude/skills/todos/SKILL.md` exists, and
  `.corpus/template-manifest.json` records it with `source: "plugin:todos"`.

TEST-276: The skill cannot collide with a core skill
  Given: A hypothetical plugin skill named `comment` or `orchestrate`
  When: `corpus init` runs
  Then: It is **skipped with a warning naming the collision** — a plugin can never replace the loop
  (Adjudication 11(i)). Verified against `todos` not colliding, and against a synthetic colliding
  name.

TEST-277: Orchestrate routes `todos.*` with no todos-specific text
  Given: The orchestrate skill
  When: Grepped
  Then: The word `todos` does not appear. Routing works purely through the
  `<plugin>.<action>` → skill-named-`<plugin>` convention (Adjudication 1, and the orchestrate
  skill's pinned `it("hardwires no plugin name")`).

TEST-278: The agent manages todos from a thread
  Given: A running loop and an `@agent` comment "add a todo to follow up on X"
  When: The loop handles it
  Then: The comment skill routes into the todos skill (per AGENT-003's plugin-boundary rule,
  TEST-191), the agent creates or updates a todo document **through `corpus todos`**, and replies in
  the thread saying so.

TEST-279: The seed template ships and is a valid template document
  Given: `plugins/todos/seeds/todo-template.md`
  When: Parsed
  Then: It is a valid `type: template` document with `for: todo`. What it may and may not seed is per
  Open Conflict 9's ruling.

TEST-280: Creating a todo from the picker produces a valid document
  Given: The board's ＋ on a todos column, or the omnibox picker
  When: A todo document is created
  Then: It lands in `data/docs/` with `type: todo`, opens title-selected, and the View renders it
  without error — including its `items` state, whatever Open Conflict 9 rules.

TEST-281: §15 M6 — deleting the plugin leaves the core fully functional
  Given: A running system with todo documents and a Todos column
  When: `rm -rf plugins/todos` and the whole system restarts
  Then: The app **boots**; existing todo documents render as **plain markdown** (data intact, nothing
  lost); the Todos column shows a **"plugin missing"** card while every other column works;
  `/api/x/todos/*` **404s**; `corpus todos` is gone from `--help`.

TEST-282: §15 M6 — restoring brings everything back
  Given: The directory restored and the system restarted
  When: Inspected
  Then: The custom renderer, the DocPanel, and the Todos column all return, with the todo documents'
  data intact and unchanged on disk.

TEST-283: The projection stays clean throughout
  Given: All of the above
  When: `corpus db rebuild && corpus db doctor` runs
  Then: Clean — the standing invariant, unaffected by a plugin's writes.

#### F. INFRA riders — the two packaged-plugin gaps (INFRA-008 escalation 3)

TEST-284: A dist-only packaged plugin currently exposes no CLI verbs — reproduced first
  Given: `plugins/todos` staged into a packed tarball, whose `cli/commands/*.ts` sources are absent
  When: The **installed** binary runs `corpus --help` **before** the fix
  Then: No `todos` topic appears, because `discoverPluginTopics` enumerates `.ts` sources. Recorded as
  the pre-fix reproduction.

TEST-285: The enumeration is fixed in `apps/cli`
  Given: `apps/cli/src/registry/plugins.ts`
  When: Changed to prefer `dist/cli/commands/*.js` when it exists, falling back to
  `cli/commands/*.ts`
  Then: Both layouts discover verbs. Shipping `.ts` sources purely as a name list is **not** the
  answer and is not done.

TEST-286: The installed tool exposes `corpus todos` after the fix
  Given: A freshly packed and installed tarball
  When: `corpus todos --help` runs from the install prefix
  Then: `add`, `check`, `list` appear, and `corpus todos list` succeeds against a workspace created by
  the installed binary.

TEST-287: A packaged plugin's `dist` currently fails to resolve `@corpus/contract` — reproduced first
  Given: The installed tarball before the fix
  When: The server boots and attempts to mount `todos`
  Then: The routes **do not mount**; discovery logs the contained failure naming the module. Recorded
  as the pre-fix reproduction, with the exact error.

TEST-288: `stagePlugins` bundles plugin entry points
  Given: `scripts/package-staging.ts`
  When: Changed per its own comment — bundle each plugin's entry points at staging with the **same
  first-party-inlined boundary** the tool's own bundles use
  Then: The staged `dist/server/routes.js` and `dist/cli/commands/*.js` carry no bare `@corpus/*`
  specifier. The existing `pack-audit` assertions are extended to prove it.

TEST-289: The installed tool mounts the plugin's routes
  Given: The fixed tarball installed into a scratch prefix
  When: The installed `corpus server start` runs and the plugin route is called
  Then: `/api/x/todos/...` responds; a `corpus todos add` through the installed binary lands on disk
  with a commit. **This is the live proof INFRA-008 deferred here.**

TEST-290: `_fixture` stays out of the tarball
  Given: The same packed tarball
  When: Its contents are listed
  Then: `plugins/todos` is present with `dist/`, `skills/`, `types.yaml`, `README.md`; `plugins/_fixture`
  is **absent** (Adjudication 9). Both directions of Adjudication 12's rule now have a real subject.

---

## Cross-Issue Tests

TEST-291: The workspace template test suite is green as a whole
  Given: All of stage A
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts`
  Then: Green, with the comment-skill assertions added and the orchestrate ones unchanged.

TEST-292: The two skills do not contradict each other
  Given: Both skill bodies after AGENT-003 and AGENT-004
  When: Compared
  Then: Exactly one of them owns queue terminal state (orchestrate); exactly one owns thread context,
  mentions, inbox filing, reply content and skill genesis (comment); the trace-line grammar is stated
  consistently in both; and neither hardwires a plugin name.

TEST-293: The plugin skill and the comment skill compose
  Given: All three issues landed
  When: A thread asks for something in the todos domain
  Then: The comment skill's plugin-boundary rule (TEST-191) routes into the todos skill (TEST-274),
  which uses only `corpus todos` and core doc verbs. Neither skill names the other's internals.

TEST-294: `docs/cli.md` regenerates cleanly on the merged tree
  Given: Every stage merged
  When: The orchestrator runs `npm run docs:cli -w apps/cli` and the artifact-drift check
  Then: `todos add|check|list` are documented; `_fixture` is not; the check is green after commit.
  Every `corpus …` invocation in every template markdown file still resolves (TEST-174) — including
  any the todos skill names.

TEST-295: The repo-wide gate passes at harvest
  Given: The merged tree
  When: The orchestrator runs the single repo-wide `npm run coverage`
  Then: Lint, format, typecheck, unit tests, e2e and the **≥90% four-metric merged gate** all pass,
  with `plugins/todos/**` inside the include glob and no per-plugin exemption added.

TEST-296: No agent ran a state-changing git command
  Given: Every agent's transcript and the repository's reflog
  When: Audited
  Then: No `git commit`, `push`, `checkout`, `reset`, `stash`, `mv`, or `rm` by an implementing agent.
  (Sprint-012 Adjudication 20 and sprint-013 Adjudication 24 both recorded breaches; the prohibition
  is restated in every brief.)

TEST-297: Ports and processes are clean
  Given: The end of each session
  When: `lsof -nP -iTCP:<port> -sTCP:LISTEN` is run for each allocated port, and `8765`
  Then: Nothing bound that the agent started; `8765` unbound; no orphaned vitest workers
  (`ps aux | grep vitest`).

---

## Out of Scope

- **Any change to `packages/contract`.** CONTRACT-015 and CONTRACT-016 shipped the plugin-facing
  surface; PLUGINS-002 consumes it as-is. A genuinely wrong shape escalates for a rider issue rather
  than being edited in place (§9.3, restated since sprint-008).
- **A `trace` field on `Turn`.** SPEC §6 is explicit: "no dedicated field or markup beyond the line
  itself". AGENT-004 adds none.
- **Fixing `splitTrace`'s leniency.** The trailing-space and true-final-line tightening is
  `issues/ui/013-pr10-minor-findings.md` finding (11), status `todo`, ui domain. AGENT-004 writes the
  strict rule and records the mismatch (TEST-227).
- **UI-014 (editor ownership of non-core bodies).** `todo` documents render through the plugin's
  `View`, and a `View` wins over the editor. UI-014 is `todo`, P2, and is the gate on Open Conflict 8.
- **SERVER-030's honest defer/requeue transition.** Until it lands, the deferral protocol is
  reply → `job log "deferred: …"` → the orchestrator's terminal call (sprint-012 Adjudication 6).
  §7's "the work stays queued" wording remains a SPEC amendment candidate for the phase PR.
- **Scoped template keys.** Whether a plugin may declare frontmatter-carrying template keys stays
  **open** (sprint-012 Adjudication 3). PLUGINS-002 implements **without** the mechanism. Building it
  is a fail; dropping the question silently is also a fail — it is re-filed verbatim in the E2E log.
- **A CLI enumeration verb** (`corpus doc list` / `search` / `tree`) and **a skill-creation verb**.
  Both are Open Conflicts below; if the ruling is to file them, they are **next-wave issues**, not
  in-sprint work.
- **Publishing to npm.** Still `DEFERRED → user` with the package name (sprint-013 Adjudications 9
  and 10). PLUGINS-002's packaging riders use `npm pack` and a local install only.
- **The `~~~form` correction in `docs/cli.md`** beyond a one-line prose fix, if Open Conflict 5 is
  ruled in scope. No behavior changes either way.
- **Attachments on agent turns.** The skill reads attachment-only turns (TEST-193); it does not
  learn to post attachments — no CLI verb does.

---

## Integration Points

- **Server → comment skill (`comment.created`).** The payload is a contract, stated in
  `apps/server/src/threads/events.ts`: `{threadId, parentId, turnTs, mentions[], skills[], unresolved[]}`
  where each target is `{name, docId, status}`. The skill reads these fields and does not re-parse
  turn text. **Producer**: server (shipped). **Consumer**: AGENT-003.

- **Server → comment skill (`form.respond`).** `{threadId, formTs, option, note|null}`. No
  `parentId` — the parent is re-derived through `corpus thread show`. **Producer**: server (shipped).
  **Consumer**: AGENT-003.

- **Orchestrate skill → comment skill.** The orchestrate skill routes `comment.created` and
  `form.respond` to the comment skill and **retains** queue terminal state, concurrency, locks,
  logging, HALT, and the charter. The comment skill is entered with the event already claimed and
  exits leaving the terminal call to the orchestrator. Neither duplicates the other (TEST-194,
  TEST-292). **Producer**: AGENT-002 (shipped). **Consumer**: AGENT-003.

- **Comment skill → plugin skills.** A thread request in a plugin's domain is routed to that plugin's
  skill by the `<plugin>.<action>` → skill-named-`<plugin>` convention, with **no plugin named** in
  either core skill. **Producer**: AGENT-003 (the rule). **Consumer**: PLUGINS-002 (the todos skill).

- **Comment/orchestrate skills → UI turn renderer.** The trace convention is `↳ ` as the final line
  of an agent turn. Written into the turn's bytes by the skill; stripped and re-supplied via CSS
  `::before` by `apps/ui/src/thread/Turn.tsx`. No field, no markup. **Producer**: AGENT-004.
  **Consumer**: UI-008 (shipped).

- **`@corpus/kit/plugin` → the todos manifest.** `PluginManifest`, `PluginDocType`,
  `PluginColumnType`, `DocViewProps`, `ListItemProps`, `DocPanelProps`, `ColumnComponentProps`, and
  `definePlugin`. React-bearing types live in the **kit**, not the contract. **Producer**:
  PLUGINS-001/CONTRACT-015 (shipped). **Consumer**: PLUGINS-002.

- **`@corpus/contract/plugin` → the todos server and CLI.** `PluginServerContext` (with
  `listDocs`, `getDoc`, `createDoc`, `updateDoc`, `broadcastInvalidate`, `logger`, `now`) and
  `PluginCommandSpec`/`PluginCommandContext` (with a `{baseUrl}`-thin `client`).
  `@corpus/contract/client` stays lint-banned. **Producer**: CONTRACT-015/016 (shipped).
  **Consumer**: PLUGINS-002.

- **Todos routes → the board.** Writes go through `PluginServerContext`, so the core write path
  broadcasts `["docs"]` itself; the plugin broadcasts only its own `["x","todos",…]` keys and is
  **refused** if it tries a core key. **Producer**: PLUGINS-002. **Consumer**: the kit's
  `usePluginQuery`/`useDocs` invalidation.

- **`useDocs({type:"todo"})` → `TodosColumn`.** Each list row carries `extra`, so `items` arrive with
  the list — one query, no N+1. This is what makes the aggregate column a kit-only component.
  **Producer**: CONTRACT-011 + the docs list route (shipped). **Consumer**: PLUGINS-002.

- **`plugins/todos` → packaging.** Adjudication 9 must **not** exclude it; Adjudication 12 must
  include its built `dist`. The two INFRA riders (CLI enumeration, staging bundle) are what make that
  true in an installed tool. **Producer**: PLUGINS-002 (riders). **Consumer**: INFRA-008's shipped
  packaging.

---

## Merge order (recommendation)

1. **Stage A, one agent-runtime session, sequential**: AGENT-003 first (the skill body), then
   AGENT-004 (the trace rule into the finished body), then the gitignore rider if Open Conflict 7 is
   ruled in favour. One live-session E2E run covers both AGENT issues — do not start a second session.
   Commit as three commits (`[AGENT-003]`, `[AGENT-004]`, `[AGENT-003]` for the rider) so the PR shows
   the division of labor.
2. **Stage B, one plugins session**: PLUGINS-002, after AGENT-003 is committed (its plugin-boundary
   rule is a real dependency for TEST-278/TEST-293). Within it: the plugin proper first, then the two
   INFRA riders — the riders need a real non-underscore plugin to exist before they can be proven.
3. **Harvest**: orchestrator regenerates `docs/cli.md` on the merged tree, runs the single repo-wide
   gate, then `/audit` (PLUGINS-002 qualifies: cross-domain and >5 files) and the evaluator.

Stage A and stage B are **not** parallel. Two concurrent agents is the cap and stage B's dependency
makes it one at a time anyway.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. Skill genesis cannot create a new skill (**blocking AGENT-003, P0**)

AGENT-003's acceptance criterion — *"recurring patterns … get codified into a new skill document or
an extension of an existing one, created/edited through the CLI"* — and its E2E step 11 (*"confirm the
agent creates or extends a skill document under `.claude/skills/`"*) describe a capability that does
not exist.

`corpus doc create` calls `POST /api/docs`, whose folder handling is
`apps/server/src/core/paths.ts`'s `normalizeDocFolder`: it unconditionally prefixes `DOCS_ROOT`
(`data/docs`) and throws `PathTraversalError` for anything that would land elsewhere;
`write.ts:347`'s `resolveFolder` turns that into a 400 reading *"folder must be a path under
data/docs"*. The generated reference agrees: `--folder` is *"Folder under `data/docs/`"*.
`corpus doc move` cannot help either — its own prose says *"skills inside their own folder, so
neither can be moved"*. There is no `corpus skill create`; `apps/cli/src/commands/skill/` holds only
`rollback.ts`. The **only** write path that touches `.claude/skills/` is archive, and only for a
document that already exists there.

So: **extending an existing skill works** (`corpus doc edit <doc_skill…>` resolves the path from the
projection and the write path accepts skill roots, with the `synthesizeId` frontmatter leniency). But
**creating a new one is structurally impossible through the CLI**, and the CLI-only invariant forbids
the agent writing the file itself. The empty extractor allowlist means the skill cannot even *name* an
aspirational verb.

The same gap applies to `.claude/agents/` — the agent cannot create a subagent persona either, which
is why TEST-203 creates one out-of-band.

**Options**: (a) Scope AGENT-003's skill genesis to **extend-only** — the skill states that
codification lands as an edit to an existing skill (including `comment` itself, which §7 explicitly
sanctions), and that a genuinely new skill is proposed to the user in the reply rather than created;
file a CLI/SERVER issue for a creation verb, next wave. (b) File and implement a `corpus skill create`
rider inside this sprint — a new server write path (a second document root accepting creates) plus a
CLI verb; realistically a SERVER issue and a CLI issue, not a rider. (c) Let the skill instruct a
direct file write for this one case — **rejects the CLI-only invariant**; not recommended at any price.

**Recommendation: (a).** It is honest about what ships, keeps the extractor green, and preserves the
§7 feedback loop that matters most in practice — the agent revising its **own** skills, which is
editing. §7's "creating a new skill or extending an existing one" becomes a SPEC amendment candidate
for the phase PR (same treatment as §7's "stays queued" under Adjudication 6): either the creation
verb lands and §7 is literally true, or §7 is reworded to extend-plus-propose. Note that (a) also
means E2E step 11 and TEST-210 verify the **extension** path, and TEST-211's `corpus skill rollback`
still applies to it.

### 2. "Check the tree" has no CLI verb behind it (**blocking AGENT-003's inbox filing, P1**)

AGENT-003 requires a filing convention that *"prefer[s] an existing folder that already holds similar
documents (check the tree)"*. Nothing in the CLI enumerates documents or folders. `docs/cli.md`
documents 37 commands; the only `list`s are `job list` and `lock list`. `GET /api/tree` exists
(SERVER-011) but has **no CLI wrapper**, and per SERVER-018 it counts `data/docs/` only — skills are
counted nowhere. There is also no filed issue proposing one.

Related: skill genesis's *"extend an existing skill when one fits"* has the same discovery problem —
the agent needs to know what skills exist before it can pick one to extend.

**Options**: (a) The skill reads the folder tree from the **filesystem** (`ls data/docs/`), which is
a read, not a mutation, and is exactly consistent with sprint-013 Adjudication 21's ruling that
document content may be read from `data/` markdown while thread/queue/lock **state** goes through the
CLI. Zero new surface; the skill states the boundary explicitly. (b) File a `corpus doc list` /
`corpus tree` CLI rider and block AGENT-003 on it — cleanest architecturally, costs a wave.
(c) Give the skill a fixed filing convention with no enumeration at all — it guesses a folder name
from the content. Poor: it will fragment `finance/` and `Finance/` and `money/`.

**Recommendation: (a) now, (b) filed for next wave.** (a) is defensible on the invariant's own terms
— the invariant is about *mutation*, and Adjudication 21 already drew this exact line for document
content. It also matches what AGENT-002's live session actually did when it found no read verbs. But
it is a real ergonomic gap for a CLI-first agent, and `corpus doc list --type skill` would improve
both this and Open Conflict 1's discovery problem, so file it. If the user prefers (b) as a blocker,
stage A slips a wave and AGENT-003 waits.

### 3. AGENT-003 and AGENT-004 both own the Reply section (**blocking the staging, low cost to fix**)

SPEC §7's comment-skill paragraph now reads: *"If the work changed any document, say so in the reply
— closing it with a trace line (§6) reporting the actions taken."* The trace is therefore **part of
the comment skill's reply contract** as the spec stands today. But AGENT-003's issue text predates
the amendment: its Required section 7 ("Reply") says only *"the answer, then what changed, with
`[[id]]` refs"*, and AGENT-004 is separately chartered to *"teach the orchestrate/comment skills to
end action-taking turns with such a line"*.

Run sequentially in one session, the second issue will rewrite the first's Reply section, and the two
commits will contradict each other in review.

**Options**: (a) Pin the boundary: **AGENT-003 writes the Reply section with the trace line already
in it** (because §7 requires it), and **AGENT-004 owns the grammar statement, the orchestrate skill's
half, the worked-example traces, and the template tests** — its commit adds the *rule*, not the
reply's prose. (b) Fold AGENT-004 into AGENT-003 entirely and close it as done-by. (c) Run AGENT-004
first, so the grammar exists before the reply prose is written.

**Recommendation: (a).** It keeps two commits with honest, separable diffs, and it matches what the
issues actually charter. TEST-217 through TEST-221 are written against this split. If the orchestrator
prefers (b), TEST-216–TEST-228 fold into AGENT-003's block and AGENT-004 is closed citing this
adjudication.

### 4. The comment skill cannot name the queue verbs its own deferral protocol uses (**non-blocking, needs pinning**)

`scripts/workspace-template.test.ts` pins
`expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)` — *"leaves queue terminal-state
handling to the orchestrate skill"*. But sprint-012 Adjudication 6's deferral protocol **is**
`corpus queue fail <id> --reason "deferred: …"`, and AGENT-003's acceptance criteria require the
skill to restate *"defer on user-locked documents rather than forcing"*.

These are compatible only if the comment skill describes the deferral as: reply in the thread → emit
a `deferred:`-prefixed `corpus job log` line → **hand the event back to the orchestrator**, which
makes the terminal call. That is also what the issue text already says the skill does (*"exits leaving
the terminal-state call to the orchestrator"*) — but it is not written down anywhere as the resolution
of this specific tension, and an implementing agent that reads Adjudication 6 literally will paste
`corpus queue fail` into the skill and fail its own test.

**Options**: (a) Pin the split as described — the guard test stands untouched, and TEST-183 asserts
the shape. (b) Relax the guard test to permit the deferral mention.

**Recommendation: (a).** The guard exists precisely so the two skills cannot drift on who completes
events, and relaxing it to admit one phrase would reopen that. TEST-172 and TEST-183 are written
against (a).

### 5. `docs/cli.md` documents a form fence the server does not recognize (**non-blocking, small, worth fixing**)

`corpus thread reply`'s generated description reads: *"The body is passed through unchanged — fenced
blocks, `~~~form` blocks and interior newlines all survive verbatim."* But
`packages/contract/src/schemas/form.ts:50`'s `FORM_FENCE_PATTERN` matches ```` ```form ```` only, and
the info string is matched **whole**. A tilde fence is an ordinary code block; a form written that way
posts fine, renders as nothing, and is undiscoverable until a user tries to answer it.

AGENT-003's own instruction is to *"read `docs/cli.md` before writing any command"* — so this is a
live trap for exactly the agent this sprint spawns.

**Options**: (a) Fix the description's prose in the CLI command's registry entry (a one-line
`apps/cli` change, regenerated into `docs/cli.md`) as a rider in stage A. (b) Leave it and rely on the
contract to pin the skill's fence (TEST-187). (c) File a CLI issue for next wave.

**Recommendation: (a) if the orchestrator is willing to let an agent-runtime session touch one string
in `apps/cli`; otherwise (c).** Either way TEST-187 pins the skill to backticks, so the sprint is safe
regardless — this is about not leaving a documented lie in the reference. Note (a) makes `docs/cli.md`
regenerate, which is the orchestrator's harvest job anyway.

### 6. Nothing validates a form at post time (**non-blocking, informational — pin it in the skill**)

`extractFormSource` is called only from `requireForm`, i.e. when a form is **answered**.
`corpus thread reply` passes the body through verbatim and the server checks nothing on the way in. A
form with a missing `prompt`, an empty `options`, or duplicate option texts is accepted, stored, and
fails only when the user clicks an answer.

This is defensible design (a turn is markdown; the server does not police prose), but it means the
skill is the **only** place the grammar is enforced, and a vague instruction produces silently broken
forms in production.

**Options**: (a) TEST-187 requires the skill to state the exact shape with a literal example — no code
change. (b) File a SERVER issue to validate form blocks on append.

**Recommendation: (a) in-sprint, and note (b) for the user at the phase PR.** (b) has a real
counter-argument — the server refusing a turn because its fenced block is malformed is a new class of
write rejection, and §6 does not ask for it — so it deserves a decision rather than a reflex.

### 7. The template-manifest un-ignore is not a one-line change (**needs a scope ruling**)

Sprint-013 Adjudication 23 routed the question *"should the template un-ignore
`.corpus/template-manifest.json`?"* to AGENT-003's session as *"one line in
`assets/workspace/gitignore`"*. The analysis supports un-ignoring: the blanket `.corpus/*` rule's own
comment enumerates *secret* (config.json), *derived* (cache.db), and *transient* (pid/log/jobs/locks/
attachments/seen/HALT) — and install provenance carrying a `toolVersion` is none of the three;
`scaffoldWorkspace` writes the manifest **before** `commitAll`'s `git add --all`, so a fresh workspace
stays clean; and `upgrade.ts` already handles the tracked case through `git check-ignore` with no code
change. A workspace clone would then carry its own upgrade baseline instead of degrading to the
`withoutBaseline` path.

But it is **not one line**. Three tests in `apps/cli` pin the current behavior and invert:

- `apps/cli/src/commands/init/index.test.ts:69` — `it("tracks the queue skeleton and nothing else
  under .corpus")` asserts an exact `toEqual` of five `.gitkeep` paths and runs `check-ignore` over a
  list including the manifest.
- `apps/cli/src/commands/workspace/upgrade.test.ts:206` — asserts the upgrade commit touches only
  template paths *"exactly as `corpus init` leaves it"*, plus a `check-ignore` assertion on the
  manifest.
- `apps/cli/src/commands/workspace/upgrade.test.ts:215` — `it("commits the manifest when the
  workspace does track it")` gets its "tracked" state by **overriding** the template's gitignore; if
  the shipped template already tracks it, this test and its sibling swap roles and both need
  rewriting to keep both branches of `isIgnored` covered.

That is an agent-runtime session editing `apps/cli` tests — cross-domain, and the sort of thing that
surprises a reviewer.

**Options**: (a) Authorize the agent-runtime session to make the one-line template change **and** the
three test updates, explicitly noted in the commit and the E2E log. (b) Split: agent-runtime delivers
the analysis and recommendation only (TEST-229), and a **cli-dev rider** makes the change plus the
test updates. (c) Rule against un-ignoring and close the question — record why.

**Recommendation: (a).** The change is small, entirely mechanical, and the three tests are *about the
template's gitignore*, so the domain boundary is thinner than it looks. TEST-229–TEST-233 are written
for (a). If the orchestrator prefers a clean boundary, (b) costs one small extra agent and the tests
land in their own domain. What should not happen is the template changing without the tests, which
turns the harvest gate red.

### 8. PLUGINS-002's item-level anchored commenting is unreachable (**blocking a P1 acceptance criterion**)

The issue's acceptance criterion is: *"selecting an item's text in the rendered view opens the core
comment composer and creates a thread anchored to that text through the **unmodified core anchor
mechanism**"*, and its Technical Design forbids the plugin implementing anchoring (*"if it needs to,
something is wrong"*). Two independent facts make this impossible:

1. **Anchors resolve against the body.** `apps/server/src/anchors/resolve.ts:25` is
   `resolveAnchorExact(body, selector)` and the whole §6 ladder takes `body: string`. With the issue's
   pinned format (`items` in **frontmatter**), item text is not in the body — an anchor created on it
   resolves to `null` immediately and the thread is **born orphaned**, permanently.
2. **The selection→selector path is an editor affordance.**
   `apps/ui/src/anchors/selectorFromSelection.ts` maps a ProseMirror range through the serializer's
   emission trace and slices `exact` out of `source.markdown` — *"The quote comes from the markdown
   source, never from the DOM's text."* It exists only inside `DocEditor`. A plugin `View` **replaces**
   the editor for types that declare one — `issues/ui/014-editor-owns-noncore-bodies.md` confirms
   *"A plugin `View` still wins for types that declare one"* — so `TodoView` gets no selection
   toolbar and no `DocumentTrace`.

Fact 2 is the deeper one: **it holds regardless of the format choice.** Even with items as body
markdown checkboxes (SPEC §12's other "builder's choice"), a custom `View` still bypasses the editor
that provides commenting. Item-level anchored commenting needs *both* items-in-body *and* the editor
owning the body — i.e. UI-014, which is `todo`, P2, and not in this sprint.

SPEC §12 does ask for it: *"each item can be commented on (anchored to the item text — the core anchor
mechanism, unchanged)"*.

**Options**: (a) **Defer the criterion.** PLUGINS-002 ships everything else; item-level commenting is
filed as a follow-up gated on UI-014, and whole-document comments on a todo document (which need no
anchor) work today and are tested instead. §12's sentence goes to the user at the phase PR as an
amendment candidate. (b) Reverse the format decision to body checkboxes and *also* drop the custom
`View` in favour of the editor — abandons the issue's pinned rationale, the server route design, the
`validate` extension point and the cheap projection, and still needs UI-014. (c) Let the plugin
implement its own selection capture and anchoring — explicitly forbidden by the issue and by §10's
"the plugin does not implement anchoring"; it would also produce anchors the server cannot resolve.

**Recommendation: (a).** It is the only option that does not either invalidate the issue's own pinned
decision or build forbidden machinery. Concretely: strike the item-commenting acceptance criterion and
E2E step 5, replace with a whole-document-comment test on a todo document, file
`PLUGINS-003 — item-level anchored commenting` depending on UI-014, and record the §12 wording for
user sign-off. The format decision itself (frontmatter) survives untouched — its rationale never
depended on commenting.

### 9. The seed template cannot supply `items: []` (**blocking a P1 acceptance criterion, small**)

The issue requires: *"a `type: template` document with `for: todo` ships as a seed document … so
creating a todo from the picker or a column's ＋ starts with valid empty `items: []` frontmatter."*

Template pre-fill is **body-only**. SPEC §11: *"Template pre-fill is body-only: the new document's
frontmatter comes from the create request (§9.2), never from the template — a template's own
housekeeping fields … do not bleed into documents created from it."* That is the SERVER-005
template-bleed fix, and the PLUGINS-001 evaluator confirmed `seedTemplate` is *"documented as
supplying a BODY only … no code path moves template frontmatter onto instances."*

Making it work would mean a mechanism that carries declared frontmatter keys from a plugin's template
to created instances — which is **exactly** the scoped-template-keys question sprint-012
Adjudication 3 left open and forbade implementing.

**Options**: (a) **Absent `items` means empty.** `validate`, the `View`, the `DocPanel` and the column
all treat a missing `items` key as `[]`. The seed template still ships (it supplies a useful *body* —
a heading, a hint) and TEST-279 checks it parses; `items: []` is never seeded because it is never
needed. (b) Have the plugin's create path POST `extra: {items: []}` explicitly — possible
(`CreateDocRequest` carries `extra`), but only for creations the plugin controls, and the board's ＋
and the omnibox are **core** create paths the plugin does not own. (c) Build the scoped-template-keys
mechanism — forbidden by Adjudication 3.

**Recommendation: (a), with (b) as a bonus where the plugin does own the create call.** (a) is
strictly more robust: it also handles a hand-written todo document and a document whose `items` key
was deleted, which is a real state the `validate`/fallback path has to survive anyway (TEST-252). The
acceptance criterion is reworded from *"starts with valid empty `items: []` frontmatter"* to *"renders
as a valid empty todo list"*, and TEST-254's "or the key absent" clause is what proves it.

### 10. Both AGENT-003 and PLUGINS-002 cite the wrong milestone (**trivial, bookkeeping**)

AGENT-003's Spec References cite *"SPEC.md §15 M4 — the executable check the loop plus this skill must
satisfy"*, but M4 is **UI core**; the agent loop and skills-as-documents are **M5**. PLUGINS-002 cites
*"SPEC.md §15 M5 — plugin system + todos plugin"* and says its E2E *"runs its check verbatim"*, but the
plugin milestone is **M6**. Both issue files were written before the milestone list settled.

Every M-reference in PLUGINS-002's E2E plan (steps 8–11, labelled "§15 M5") is really M6, and this
contract's TEST-281/TEST-282 are written against M6's actual text.

**Options**: (a) Correct both issue files' Spec References and E2E headings to M5 and M6 respectively.
(b) Leave them and note the mapping here.

**Recommendation: (a).** Costs a minute, and an issue that cites the wrong executable check is exactly
the kind of thing an implementing agent verifies against and gets wrong. The orchestrator makes the
edit as bookkeeping, as it did for sprint-012 Conflicts 3/9/10 and sprint-013 Conflicts 13/14.

### 11. PLUGINS-002 carries a full coverage burden that its issue never mentions (**not a conflict — a scope warning**)

`COVERAGE_INCLUDE` is `["apps/*/src/**", "packages/*/src/**", "plugins/*/**"]` with only
`plugins/_*/**` excluded (sprint-012 Adjudication 10). **`plugins/todos/**` is therefore inside the
≥90% four-metric merged gate** — lines, statements, functions *and* branches — with no per-plugin
exemption available. That covers the manifest, four React components, a CSS-adjacent query module, the
items module, the routes, three CLI verbs, and the seed.

The issue's Testing Strategy lists ten test files, which is roughly right, but nothing in the issue
says the gate applies, and an agent that treats plugin tests as optional will fail the harvest run
after everything else is green.

**No decision needed** — recorded so the implementing brief states it and the agent budgets for it. If
coverage proves genuinely unreachable on some surface (the error-boundary throw path is the usual
suspect), that is an escalation at implementation time, not a silent exclusion added to the config.

---

## Deferred verification is recorded, not skipped

Every criterion above that cannot be executed is marked `STRUCK → Adjudication N`,
`STRUCK → Open Conflict N`, or `DEFERRED → <reason>` in the issue's E2E Verification Log, **with the
reason and the substitute evidence supplied**. Silent omission is a fail.

Known candidates before implementation starts:

- TEST-210/TEST-211's "creates" half, under Open Conflict 1's ruling.
- TEST-273's artifact-drift check, which cannot be green inside a worktree — record the red output
  verbatim with its reason, per the accepted pattern.
- PLUGINS-002's item-commenting tests, under Open Conflict 8's ruling.
- TEST-279/TEST-280's `items: []` seeding, under Open Conflict 9's ruling.
- Anything gated on a Vite or browser step that the machine's port state blocks — say which port and
  why, and supply the CLI/API equivalent.

Each implementing agent also states which model it ran on in the E2E log (`implemented on: opus |
fable`), per CLAUDE.md's Record-actuals rule.

---

## Orchestrator Adjudications (2026-07-28)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

### Pre-ruled at contract time

1. **Worktree agents run SCOPED tests only.** `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run
   <path>` during development; at most one workspace-scoped run at the end of a session. Never the
   repo-wide suite, never `npm run coverage`, never `npm run test:coverage`, never `npm run e2e`. The
   orchestrator runs the **single** repo-wide gate at harvest. (Carried forward from sprint-012
   Adjudication 4 and sprint-013 Adjudication 1.)

2. **Real-app verification only, and the from-source CLI is
   `node --import tsx apps/cli/src/bin/corpus.ts` — never `npx`.** PLUGINS-002's two packaging riders
   (TEST-284–TEST-290) are the sole exception and the exception is their point: they must drive the
   **installed** binary out of a packed tarball.

3. **No agent amends `packages/contract` this sprint.** PLUGINS-002 consumes CONTRACT-015/016 as
   shipped; a genuinely wrong shape escalates to the orchestrator for a rider issue rather than being
   edited in place. §9.3, restated from sprints 008–013.

4. **`docs/cli.md` is never hand-edited, and is regenerated once per harvest on the merged tree.**
   PLUGINS-002 adds three verbs; it regenerates in its own worktree to verify its own entries, and the
   authoritative regeneration is the orchestrator's after the merge.

5. **The template extractor's allowlist stays empty.** `CLI_COMMANDS_PENDING_CLI_006` is `[]` and no
   entry is added this sprint. A skill that needs a verb which does not exist escalates (Open
   Conflicts 1 and 2) rather than allowlisting it.

6. **AGENT-003 owns `assets/workspace/claude/skills/comment/SKILL.md` exclusively**, and the
   orchestrate skill is touched only per Open Conflict 3's ruling and TEST-195/TEST-218. PLUGINS-002
   must not modify either core skill — `todos.*` routing is satisfied by AGENT-002's existing
   `<plugin>.<action>` convention (sprint-012 Adjudication 1, carried forward), and PLUGINS-002 cites
   TEST-277 in its log instead of editing the file.

7. **Stage A and stage B do not run concurrently.** PLUGINS-002 starts after AGENT-003 is committed.

_(Rulings 8+ are added by the orchestrator before each stage starts, resolving the Open Conflicts
above.)_

### Ruled before stage A (orchestrator, 2026-07-28)

8. **Conflict 1 → extend-plus-propose.** Skill *genesis* this sprint means: extend an existing
   skill through the CLI when the pattern fits one, and otherwise **propose** the new skill — a
   reply stating the recurring pattern plus an inbox/document write-up the operator can act on.
   The skill never attempts `doc create` outside `data/docs/` and never `doc move`s into
   `.claude/`. **CLI-011 is filed** (skill-creation write path + `corpus skill create`, with a
   `corpus doc list` rider — next phase); §7's genesis wording joins the phase-PR amendment set.
9. **Conflict 2 → filesystem reads are the tree view.** "Check the tree" is a read of `data/docs/`
   (directory listing + frontmatter), squarely on the read side of sprint-013 Adjudication 21's
   line (content reads legal; thread/queue/lock state via CLI). `corpus doc list` rides CLI-011.
10. **Conflict 3 → temporal ownership inside one session.** AGENT-003 writes the comment skill's
    Reply section complete except the trace-line rule; the AGENT-004 half of the same session adds
    the trace rule to BOTH skills and owns the grammar statement and tests. Commit boundary stays
    per-issue: the Reply section's trace edit lands in the `[AGENT-004]` commit.
11. **Conflict 4 → the comment skill never names queue verbs.** Deferral from the comment skill's
    side is "reply to the waiting user, report the deferral back to the loop" — orchestrate alone
    owns `corpus queue fail --reason "deferred:…"` (sprint-012 Adjudication 6). Division of labor
    holds; the extractor only checks named commands.
12. **Conflict 5 → skills use the ``` form fence only.** `docs/cli.md`'s `~~~form` mention is a
    docs bug routed to **CONTRACT-014** (form-fence grammar edges — noted in its issue file); no
    template markdown uses `~~~`.
13. **Conflict 6 → the skill is the v1 enforcement point for form shape.** Post-time validation is
    noted in CONTRACT-014's file as a candidate; not built this sprint.
14. **Conflict 7 → agent-runtime makes the three test inversions.** The manifest un-ignore
    (`assets/workspace/gitignore`) is the template change sprint-013 Adjudication 23 routed here;
    the three directly-caused `apps/cli` test inversions (`init/index.test.ts`, two in
    `upgrade.test.ts`) are in the same commit — a cli-dev rider for three mechanical lines is
    overhead. pr-reviewer sees it in the phase diff.
15. **Conflict 10 → issue files corrected** (milestone citations: AGENT-003 → §15 M5,
    PLUGINS-002 → §15 M6) by the orchestrator before the agents read them.

### Ruled before stage B (orchestrator, 2026-07-28)

16. **Conflict 8 → item-level anchored commenting struck from PLUGINS-002.** Unreachable under
    either format choice (anchors are body-range; a plugin View replaces the selection affordance).
    **PLUGINS-003 is filed** (item-level commenting, deps UI-014 + PLUGINS-002, P2). PLUGINS-002's
    AC is satisfied by document-level commenting on todo docs; the struck half cites this ruling.
17. **Conflict 9 → absent `items` ≡ empty list.** The seed template ships no `items` key; every
    reader treats absence as empty. No scoped-template-keys mechanism (sprint-012 Adjudication 3
    stands).
18. **Conflict 11 → carried into the brief.** `plugins/todos/**` is inside the ≥90% four-metric
    gate; the agent budgets tests for it, and an unreachable surface is an escalation, never a
    silent config exclusion.
