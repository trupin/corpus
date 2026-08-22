# [UI-123] The autocomplete offers what the server now refuses

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-125
- Blocks: — (but v0.12.0 must not ship without it)
- Related: UI-122 (the designate menu), AGENT-036

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root
- SPEC.md **§8** — `@<subagent-name>` is a directive routed to that persona
- SPEC.md **§10** line 539 — the `@` autocomplete, backed by `GET /api/docs`

## Summary

SERVER-125 stopped indexing an off-root `type: agent-def` (and `type: skill`)
document as a mention target. `targetIndex` now skips any row whose
`invocableName` is null, the title alias included. That is the right call and its
reasoning is in that issue.

**It leaves both client surfaces one release behind the server.** The client
never asked the server what resolves. It computes the same two aliases again,
independently, in two places:

| Surface | The code | What it does now |
| --- | --- | --- |
| `@` autocomplete | `packages/kit/src/components/Autocomplete/useAutocomplete.ts:63` — `invocableName(row.path) ?? row.title` | Offers an off-root agent-def under its title. Picking it inserts a mention the server resolves to nothing |
| Designate menu | `apps/ui/src/thread/residentActions.ts:92` — `name: row.title.trim()` | Offers an off-root agent-def. Designating it now gets a 404 that SERVER-125 rewrote to name the file |

**This is a regression that SERVER-125 introduced**, not pre-existing debt. Before
it, both surfaces were right: the title alias did resolve. The server changed and
the clients did not.

SERVER-125's own acceptance criterion states the standard: *"The autocomplete and
the resolver must agree: offering what will not resolve is worse than either."*
That criterion is not met until this issue lands, which is why this is P0 and in
v0.12.0 rather than filed for later.

## What must not break

**`GET /api/docs?type=agent-def` must keep returning every agent-def.** The
board's `type:` filter and the seeded "Skills & agents" view both read that
endpoint, and a document about a persona is a legitimate document that must stay
listed, readable and editable. **The filter belongs in the client, at the point
where a row becomes an offer** — not in the query.

That is the same shape SERVER-125 chose: the document stays, and only its
addressability goes.

## Acceptance Criteria

- [x] The `@` autocomplete offers an agent-def only when `invocableName(row.path)`
      is non-null, and offers it under that name
- [x] The designate menu offers the same set, by the same rule
- [x] A row dropped from the offers is still listed by the board and still
      readable and editable — nothing about the document changes, only whether it
      is offered
- [x] `type: skill` rows follow the identical rule, because SERVER-125 gated both
- [x] **The kit and the UI do not each grow a third copy of this rule.** One
      exported predicate, used by both surfaces
- [x] A test proves client and server agree on the same row: the same off-root
      fixture is absent from the offers and unresolved by the server

## Technical Design

### Files to Create/Modify

- `packages/kit/src/components/Autocomplete/useAutocomplete.ts` — `rowToken`
- `apps/ui/src/thread/residentActions.ts` — the designate list
- `packages/kit/src/index.ts` — the export, if the predicate is new
- Tests beside each

### Key Implementation Details

`invocableName` already lives in the kit and already returns null off-root. The
change is to stop falling back to the title, and to drop the row instead.

**Read `residentActions.ts:80-92` before editing it.** Its docblock explains that
the title is a *spelling* and not an identity, and that the server stores the name
it resolved to. That reasoning stays true. What changes is which rows are offered
at all, not how a designation is spelled.

**`useWeightLevels.ts:109` also calls `invocableName`** and is not part of this
bug — it looks up the orchestrate skill by its invocable name, which is exactly
right. Do not change it.

### Edge Cases

- An on-root agent-def whose title differs from its file stem. This is the
  **common** case since SERVER-122, and it must keep working. Designation sends
  the title today and the server resolves it
- An agent-def with a blank title, already dropped by `residentActions`
- An archived agent-def
- A `type: skill` document under `data/docs/`, which is a document *about* a
  skill

## Testing Strategy

Unit tests on both surfaces with an on-root and an off-root fixture. The pair
that matters asserts the client's offer set and the server's resolution agree on
the same fixture, so the two cannot drift apart again silently.

Falsify by restoring the `?? row.title` fallback and confirming the off-root
cases go red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Create an on-root agent-def and an off-root one with a one-word title
3. In a real thread composer, type `@` — only the on-root persona is offered
4. Open the designate menu — same set
5. Confirm the off-root document is still listed on the board and still opens
6. Stop the server; confirm the port is free

## E2E Verification Log

**Model: Opus 5 (1M context).** Date: 2026-08-18.

### The change

One exported rule, in a new dependency-free kit module
`packages/kit/src/components/Autocomplete/invocable.ts`: `invocableName`,
`rowToken` (now `string | null` — the `?? row.title` fallback is gone) and
`isAddressableTarget`, the predicate both offer surfaces apply. The `@` / `/`
menu drops a row with no token (`useAutocomplete.ts`'s `toItem` returns `null`);
the designate menu filters with `isAddressableTarget` and still *sends* the
title, which the server still resolves for an addressable row. No query changed.

### 1. Reproduction, in the real app (this is a regression)

Throwaway workspace `/tmp/corpus-ui123`, real server on **8793** (never 8765 —
the user's live server was left running and untouched — and never 5173, which
holds an ssh tunnel; Vite dev on **5273**). Real Chromium via Playwright against
`http://localhost:5273`.

```
$ corpus init /tmp/corpus-ui123 --port 8793
Initialized Corpus workspace at /tmp/corpus-ui123
$ corpus server start --workspace /tmp/corpus-ui123
corpus 0.11.0 listening on http://127.0.0.1:8793 (pid 20923)
$ corpus doc create --type agent-def --title "Researcher"
created doc_mb55mqui — .claude/agents/researcher.md
$ corpus doc create --type agent-def --title "Legacy" --folder data/docs/inbox
created doc_ulkvkk5q — data/docs/inbox/legacy.md
$ corpus thread create --title "Q3 planning" -m "Where did the forecast land?"
created th_nggtvvlz — standalone
```

With the `?? row.title` fallback restored in the kit (and `packages/kit/dist`
rebuilt, or the page keeps running the old copy):

```
`@` menu offers: ["agent — …", "Legacy — Legacy", "researcher — Researcher"]
  "@leg" -> ["Legacy"]   (menu open: true)
designate menu:
  resident-designate-general      :: Designate a resident
  resident-designate-doc_ulkvkk5q :: Designate Legacy
  resident-designate-doc_mb55mqui :: Designate Researcher
```

…and what the server does with that offer, on the same workspace:

```
$ curl -X POST …/api/threads/th_nggtvvlz/resident -d '{"name":"Legacy"}'
404 {"code":"not_found","message":"no agent named Legacy in this workspace —
 data/docs/inbox/legacy.md declares `type: agent-def` but is not under
 `.claude/agents/`, so nothing loads it as a subagent and nothing resolves
 `@Legacy` to it; a persona has to live in that root"}
```

Both surfaces offered a designation the server answers with a `404`.

### 2. After the fix, same workspace, same browser

```
rows on board:
  doc_ulkvkk5q :: agent-def Legacy inbox/ just now      ← still listed
  th_nggtvvlz  :: thread Q3 planning …
reader opened, title: Legacy                             ← still readable
`@` menu offers: ["agent — the agent — routing is its own triage",
                  "researcher — Researcher"]
  "@res" -> ["researcher"] (menu open: true)
  "@leg" -> []             (menu open: false)
designate menu:
  resident-designate-general      :: Designate a resident
  resident-designate-doc_mb55mqui :: Designate Researcher
```

Screenshots taken during the run: `/tmp/ui123-mention.png`,
`/tmp/ui123-designate.png` (throwaway, not committed).

### 3. The endpoint that must not change

```
$ curl …/api/docs?type=agent-def
total: 2
  doc_ulkvkk5q | Legacy     | data/docs/inbox/legacy.md
  doc_mb55mqui | Researcher | .claude/agents/researcher.md
```

Both rows still returned; the filter is in the client, at the point a row becomes
an offer. And the on-root persona still designates by its **title**:

```
$ curl -X POST …/resident -d '{"name":"Researcher"}'
200 {"thread":{…,"resident":{"name":"researcher","docId":"doc_mb55mqui"}}}
```

### 4. Automated tests

- `vitest run packages/kit` — **56 files, 885 tests, all pass**
- `vitest run apps/ui` — **148 files, 3143 tests, all pass**
  (`npm test -w <ws>` is not available: there is one root vitest config and no
  per-workspace `test` script)
- `vitest run scripts/mention-offer-parity.test.ts` — **11 tests, pass**
- `npm run lint` — clean. `npm run typecheck` — clean (all workspaces + `scripts`)
- `playwright test e2e/resident.spec.ts e2e/autocomplete-keys.spec.ts`
  (`CORPUS_UI_PORT=5273`) — **15 passed**, including the new
  `resident.spec.ts:254 › lists a document about a persona, and offers it in
  neither menu`

### 5. Falsification

Restored `invocableName(row.path) ?? row.title` in `invocable.ts` and rebuilt
`packages/kit/dist` (a source-only mutation cannot falsify anything that
resolves the kit through its `exports` map). **11 tests went red**, across all
three surfaces:

```
× scripts/mention-offer-parity.test.ts › holds rows on both sides of the gate…
× scripts/mention-offer-parity.test.ts › a mention … resolves on the server…
× scripts/mention-offer-parity.test.ts › an invocation … resolves on the server…
× scripts/mention-offer-parity.test.ts › a mention row the menu drops › resolves
    under no spelling at all, its title included
× scripts/mention-offer-parity.test.ts › an invocation row the menu drops › …
× scripts/mention-offer-parity.test.ts › the board's designate menu › offers only
    names a designation resolves…
× scripts/mention-offer-parity.test.ts › … does not offer the document about a
    persona, which the server refuses
× apps/ui … agentDefRows › does not offer a document *about* a persona…
× apps/ui … agentDefRows › drops the row without touching the list it came from
× packages/kit … useAutocomplete › does not offer an agent-def the server would
    resolve to nothing
× packages/kit … useAutocomplete › does not offer a document *about* a skill as
    an invocable one
```

The first pass of `invocable.test.ts` **survived** the mutation — its fixtures
carried no `title`, so `?? row.title` had nothing to fall back to and the test
could not tell the fix from the bug. It was rewritten onto `docRowFixture` rows
that carry titles and re-run under the mutation: **4 more failures**
(`rowToken › has no token for an off-root row…` and three `isAddressableTarget`
cases). Mutation reverted, `dist` rebuilt, all green again.

### 6. Teardown

Server stopped (`stopped (pid 20923)`), Vite killed, `/tmp/corpus-ui123` removed.
Ports 5273 and 8793 confirmed free; **8765 left listening — the user's server,
never touched**. No stray vitest/playwright/chromium/vite processes remain.

### Notes for the orchestrator

- **`packages/kit`'s public surface changed**: `rowToken` now returns
  `string | null` (was `string`), and `isAddressableTarget` is a new export.
  Nothing outside the kit called `rowToken`, and no plugin imports either, so no
  consumer breaks — but it is a kit-export change and is recorded here.
- **Two fixtures were wrong rather than the code**: `apps/ui/e2e/resident.spec.ts`
  seeded its one profile at `data/docs/agents/researcher.md`, and
  `ComposeOverlay` / `ThreadPanel` unit fixtures used `docRowFixture`'s default
  `data/docs/…` path for agent-defs. Those are paths the server no longer
  addresses, so they were moved under `.claude/agents/`.
- **`apps/ui/e2e/stubCorpus.ts` was one release behind too**: its
  `POST /resident` handler still applied the title alias to off-root rows, so a
  spec could have certified a designation the real server refuses. It now applies
  SERVER-125's gate, and its `AGENT_DEF_STEM` no longer matches a nested path
  (the server's agents root is `markdown-flat`).

## PR #50 review

**Model: Opus 5 (1M context).** Date: 2026-08-18. Three findings — MINOR 4,
MINOR 5, NIT 9 — addressed in `apps/ui/`, `packages/kit/` and
`scripts/mention-offer-parity.test.ts`. **NIT 9's correct fix is in the server
and is not made here** (see below).

### MINOR 4 — the gate moved, the sentence explaining the gate did not

**Decision: the text names the root; it does not distinguish the two causes.**

```
- "a resident does not need one — add a type: agent-def document to offer one here"
+ "a resident does not need one — add a type: agent-def document under .claude/agents/"
```

Why *stop being wrong* rather than *distinguish* — recorded in full in the
`NO_PROFILES_META` docblock:

- **One remedy.** Both absences — no agent-defs, and agent-defs none of which is
  addressable — are answered by the same act. A sentence keyed on the cause would
  vary the diagnosis while the instruction stayed put.
- **The ladder does not stop at two.** A blank-titled agent-def is dropped by
  this same branch for a third reason, an archived one for a fourth. To tell any
  of them apart the menu would have to carry the rows `agentDefRows` discarded
  and a reason each — and UI-122's whole lesson is that this item is *news beside
  an offer that works*, not a diagnostics panel.
- **The board already says it better**, and §10 is where "what does this
  workspace hold" belongs: the dropped document is listed, with its folder on the
  row and its path in the reader, one column away.

What the old wording cost is the part that had to go: it was advice that
*reproduces the second state* (`--folder data/docs/…` makes exactly such a
document), which is the finding's literal complaint.

New test — `residentActions.test.ts` › *"says where a profile has to live, so its
advice cannot reproduce this state"* — drives **both** causes through
`agentDefRows` into `residentActions` and asserts the one line they share names
`.claude/agents/`.

### MINOR 5 — the fixture is now derived from `DOCUMENT_ROOTS`

The suggestion works, and it took the docblock's claim with it. The file no
longer asks about five hand-written rows plus nothing:

- `shapePaths(root, stem)` generates, per root, the canonical path of the root's
  declared `shape`, that shape's edges, and the near-miss beside it. The `switch`
  is exhaustive over `RootShape` with a declared return type, so a **new shape**
  is a type error rather than a gap; a **new root** produces new questions with
  nobody editing the file.
- Two comparisons now, not one. The **pure-function** parity (server
  `invocableName` vs kit `invocableName`) runs over every derived path and needs
  no projection, so it covers paths no workspace holds — this is where a new root
  or a `markdown-flat` change bites. The **row-level** parity is unchanged in
  spirit: the real projector's rows, offered-vs-resolved, both types.
- The projected corpus is self-checking: *"projects exactly the derived paths the
  roots admit"* compares the projection against `classifyPath`, never against
  this file's expectations. The named rows (Researcher, Bookkeeper, comment /
  Comment, Legacy, Autopilot) stay — derivation is for coverage, the named ones
  carry the meaning.
- The docblock now states what is **not** derived, and therefore not claimed: the
  projector's non-shape exclusions (dot-prefixed segments, `node_modules`), which
  decide enumeration and never reach a `documents.path`; and the menus' other
  rules, each tested where it lives.

11 tests → **32**.

### NIT 9 — the divergence is real, and the **server** is the wrong half

`.claude/skills/SKILL.md` — a `SKILL.md` sitting directly in a skills root.

**The kit is right; do not change it.** Claude Code discovers a skill by the
directory that holds it, so a `SKILL.md` named by no directory is loaded by
nothing — exactly the condition SERVER-125 made the gate ("a document with no
invocable name resolves to nothing under any spelling"). The server's own
`invocableName` docblock states the shape as `.claude/skills/<name>/SKILL.md`;
`"SKILL.md"` is not a `<name>`.

**And it is not harmless.** `targetIndex` indexes the row *and its title alias*.
`SKILL.md` is not a typeable token — `[A-Za-z0-9_-]+` excludes the dot — but the
title is ordinary text, and `titleFromPath` falls back to the parent directory,
so an untitled one is indexed as `skills`. Pinned in the parity test and asserted
concretely: `parseMentions(db, "/<its title>")` returns that document as a
resolved skill, i.e. the server would wake the agent for a directive naming a
skill nothing loads. It can also *take* a name: ties break on id order and the
ids here are `sha1`-derived, so such a file's title alias can win a real skill's
key.

**The fix belongs in `apps/server/src/threads/mentions.ts`** — `invocableName`
should return `null` when the `skill-tree` remainder has no directory segment —
and `apps/server/` is not this agent's to edit. Please route it. The document
itself should stay projected, per SERVER-125's own shape: the document stays,
only its addressability goes.

Until then it is **pinned, not tolerated**: `BARE_SKILL_PATHS` is derived from
`DOCUMENT_ROOTS` (so a third skill-tree root is pinned too), the agreement test
excludes exactly those paths and nothing else — a *second* divergence fails — and
the two tests that describe this one **fail the day the server is fixed**, which
is the intended way to find out.

One divergence the derived fixture found *was* the kit's, and is fixed here: the
skills pattern matched on its **prefix** (`.claude/skills/<seg>/`), so it named
`comment` for a `notes.md` beside the `SKILL.md` — a path the server calls no
document at all. It now spells out the whole shape
(`([^/]+)/(?:[^/]+/)*SKILL\.md$`), which is `skill-tree` transcribed.

### Verification

- `vitest run packages/kit` — **56 files, 887 tests, pass**
- `vitest run apps/ui` — **148 files, 3144 tests, pass**
- `vitest run scripts/mention-offer-parity.test.ts` — **32 tests, pass**
- `npm run lint` (exit 0) · `npm run typecheck` (exit 0, all workspaces +
  `scripts`) · `prettier --check` clean
- `playwright test e2e/resident.spec.ts e2e/autocomplete-keys.spec.ts`
  (`CORPUS_UI_PORT=5274`) — **15 passed**
- `packages/kit/dist` rebuilt before the `apps/ui` and Playwright runs: those
  resolve `@corpus/kit` through the `exports` map, so a source-only kit change is
  invisible to them.

### Falsification

Each mutation reverted, and the reverts diff-verified.

| Mutation | Failures |
| --- | --- |
| Kit skills pattern back to prefix-only | **4** — `invocable.test.ts` › *names a skill by its directory…*, parity for both `…/notes.md` paths, and *disagrees about nothing beyond the pinned SKILL.md* |
| Kit agents pattern loosened to allow nesting (a `markdown-flat` drift) | **2** — parity for `.claude/agents/folder/agents-nested.md`, and the divergence-set test |
| **Server** `invocableName` made to return `null` for a bare `SKILL.md` (temporary, reverted) | **5** — the divergence-set test and all four pinned-divergence cases. This is the pin doing its job: fixing the server makes this file fail until the pin is removed |
| `NO_PROFILES_META` reverted to *"to offer one here"* | **1** — *says where a profile has to live…* |
| One root filtered out of the sample generation | **4** — *asks about every document root…*, plus the questions that root contributed |

### E2E, real app, real server

Throwaway workspace `/tmp/corpus-pr50`, real `corpus` server on **8794** (never
8765 — the user's live server, left listening and untouched), Vite on **5274**
(never 5173, an ssh tunnel), real Chromium via Playwright.

The workspace is the second cause of the empty state, the one the old text was
wrong about: `corpus doc create --type agent-def --title Legacy --folder
data/docs/inbox`, and `.claude/agents/` empty.

```
GET /api/docs?type=agent-def → doc_isqlr23z | Legacy | data/docs/inbox/legacy.md

board rows:
  doc_isqlr23z :: agent-def Legacy inbox/ just now      ← still listed
  th_vmbdzl4u  :: thread Q3 planning …

designate menu:
  resident-designate-general :: Designate a resident
      no profile — owns this conversation and everything that grows out of it
  resident-no-profiles       :: No profiles yet
      a resident does not need one — add a type: agent-def document under
      .claude/agents/                                    [disabled]

`@` menu offers: ["agent — the agent — routing is its own triage"]
  "@leg" -> menu closed
```

Screenshot `/tmp/pr50-no-profiles.png` (throwaway, not committed): the meta sits
on one line in a ~480px menu — no wrap, no overflow, `--ink-3` mono as every
other item's.

Teardown: server stopped (`stopped (pid 68131)`), Vite killed, workspace removed,
**5274 and 8794 confirmed free**, no stray vitest/playwright/chromium/vite
processes. 8765 still held by the user's server — never touched.

### For the orchestrator

- **One server issue to file** (NIT 9): `invocableName` in
  `apps/server/src/threads/mentions.ts` names a bare `.claude/skills/SKILL.md`
  `"SKILL.md"` and `targetIndex` indexes it, title alias included. Fixing it
  turns 5 currently-green tests in `scripts/mention-offer-parity.test.ts` red by
  design — the fixer removes `BARE_SKILL_PATHS` and its two `describe` blocks.
- **No kit export changed** in this round: `invocableName` is stricter for paths
  the projector never emits, and `rowToken` / `isAddressableTarget` are untouched.

## PR #50 third review

Model: **opus**. Two findings in `apps/ui` / `packages/kit`: MINOR 4 (fixed) and
NIT 8 (assessed, recommended out of this release). Nothing was touched in
`apps/cli` or `packages/contract` — two other agents held those.

### MINOR 4 — the stub was a third copy, disagreeing on the thing NIT 7 fixed

**The defect.** `stubCorpus.ts`'s resident handler computed
`name.trim().toLowerCase()` and compared it against `row.title.toLowerCase()`,
untrimmed, while the server keys **both sides** through one `aliasKey`
(`apps/server/src/threads/mentions.ts:244`). The projector carries a title
verbatim once it is non-blank (`asString`), so a row titled `"  Padded Persona  "`
answered only to `"  padded persona  "` in the browser — and the designate menu
sends the title **trimmed** (`residentActions.ts`). That designation `404`'d
against the stub and `200`'d against the real server.

**The fix, and where it went.** The rule is no longer written in the transport.
`apps/ui/e2e/serverParity.ts` — the module whose entire job is "the server's own
rules, for the browser stub, pinned by `scripts/stub-server-parity.test.ts`" —
now owns it as `aliasKey`, `invocableAgentName` and `resolveAgentDefName`, and
`stubCorpus.ts` calls it. Moving it was the point: the rule was unpinnable while
it sat inside a `page.route` closure, which is why it drifted twice with nothing
failing.

Three of the server's decisions are modelled, and each one is separately
falsifiable below: the invocable name is the **gate** and decides the whole row
(SERVER-125), a row that passes the gate answers to its **stem and its title**,
and a collision goes to the **first row in id order** (`targetIndex` builds from
`ORDER BY id`; the stub's store is a `Map` in seed order, so the resolver sorts).

**Where the class is caught now.** `scripts/stub-server-parity.test.ts`, extended
— it is the right home and no new file was needed: it is already the one place in
the repo that may look at `apps/ui` and `apps/server` at once, and it already
exists to stop exactly this. The new suite seeds a **real workspace**, projected
by the **real projector**, and puts every spelling of every row to
`resolveMentionTarget` *and* to `resolveAgentDefName`, asserting the two answers
are **equal** — not merely both non-null, since resolving to the wrong document
is what a collision produces.

The paths are **derived from `DOCUMENT_ROOTS`**, one per root per shape, for
`mention-offer-parity.test.ts`'s reason: a hand-written list only tests the
shapes whoever wrote it imagined. That derivation is also what lets the stub's
deliberate narrowing (it knows one root; the server knows five) be *demonstrated*
rather than asserted — an `agent-def` is seeded at every shape every root admits,
and the roots that override the frontmatter's type produce no agent-def row for
the two sides to disagree about.

Two directions are pinned, because one is not enough:

- **over the projected rows**, the two namings must be equal — that is the whole
  domain, since a path with no row is a path the rule is never handed;
- **over every derived path**, the stub may name *nothing the server does not
  name* — a regex widened to `.claude/agents/**` names a nested file that has no
  row, so the first test could never see it.

Non-vacuity is asserted first: the directory must hold rows on both sides of the
gate, and the question set must produce both resolutions and refusals.

**One browser-level case added** (`apps/ui/e2e/resident.spec.ts`): a persona
titled `"  Padded Persona  "`, designated through the real menu. No spec had ever
held a title of that shape, which is why the defect was invisible end to end.

### Falsification (MINOR 4)

Every mutation reverted afterwards; `serverParity.ts` restored from a
byte-for-byte backup and re-verified green.

| Mutation | Result |
| --- | --- |
| `aliasKey(alias)` → `alias.toLowerCase()` on the title alias — **the defect itself** | **2 red** in `stub-server-parity.test.ts`: *resolves every spelling…*, *resolves a padded title under the trimmed name…* |
| the same mutation, against Playwright | **1 red** — `resident.spec.ts` › *designates a persona whose title is padded, sending it trimmed* (badge never turns `profiled`) |
| gate removed (`invocableAgentName(path) ?? aliasKey(row.title)`, i.e. pre-SERVER-125) | **2 red**: *resolves every spelling…*, *refuses the document about a persona…* |
| id-order sort dropped from the resolver | **2 red**: *resolves every spelling…*, *breaks a collision by id order…* |
| `AGENT_DEF_STEM` widened to allow nesting (`(?:[^/]+\/)*`) | **1 red**: *names nothing the server does not name, over every derived path* — the test written for precisely this blind spot |

### Verification

- `vitest run scripts/stub-server-parity.test.ts` — **39 tests, pass** (was 24)
- `vitest run scripts/mention-offer-parity.test.ts` — **32 tests, pass**
- `vitest run apps/ui` — **148 files, 3144 tests, pass**
- `vitest run packages/kit` — **56 files, 887 tests, pass**
- `npm run lint` (exit 0) · `npm run typecheck` (exit 0, all workspaces +
  `scripts`) · `prettier --check` clean on the touched files
- `playwright test e2e/resident.spec.ts` (`CORPUS_UI_PORT=5473`) — **10 passed**
  (9 before; the padded case is the tenth)
- `packages/kit/dist` not rebuilt because **no kit source changed** this round —
  the trap only bites a cross-package mutation, and every file touched here
  (`apps/ui/e2e/*`, `scripts/*`) is compiled directly by its consumer.
- Ports: **5473** for Vite, freed afterwards. **5173** was never bound (an ssh
  tunnel holds it) and **8765** — the user's live server — was never touched.
  No stray vitest/playwright/chromium/vite processes; `test-results/` removed.

### NIT 8 — assessed: **does not belong in this release**

**The finding is real.** `useAutocomplete.ts` and `ThreadMenuItems.tsx` both read
`GET /api/docs?type=agent-def&limit=50` and apply the addressability gate to the
page they got back. `DEFAULT_DOC_SORT` is `-updated`, so the page is the 50
most-recently-touched rows; a workspace holding more than 50 `type: agent-def`
documents whose recent 50 are *all* off-root shows an empty `@` menu and
"No profiles yet" while real personas sit beyond the page.

**Why it is out of scope here, in order of weight:**

1. **UI-123 does not make this workspace worse — it makes it better.** Before
   the gate, that same workspace offered those off-root rows: every pick
   inserted a mention resolving to nobody, and every designation earned a `404`.
   After it, the menu under-offers. A menu that omits a reachable name is a
   discoverability gap the user can route around (typing `@bookkeeper` by hand
   still resolves — `parseMentions` never consults the menu); a menu that offers
   an unreachable one teaches a name that summons nobody and is the only place in
   the product claiming that persona exists. The widening the reviewer notes
   converts the worse failure into the milder one.
2. **The reachable-workspace bound is narrow.** It needs >50 `type: agent-def`
   documents, deliberately filed outside `.claude/agents/` (SERVER-122 keeps an
   explicit `--folder` winning, so this is never the default), *and* touched more
   recently than every real persona. §7's general designation is unaffected in
   any case — UI-122 made it independent of the directory precisely so the
   feature is reachable with no `agent-def` at all.
3. **Every honest fix is cross-domain and needs a decision this issue cannot
   make.** Filtering at the query was already rejected: it takes the board's
   `type:` filter and the seeded "Skills & agents" view with it. What is left is
   a new query concept — `addressable=true`, or a `folder=` filter on
   `GET /api/docs` — which is contract-dev's to shape, server-dev's to implement,
   and only then two client call sites. Whether "addressable" should exist as an
   API filter at all is an API-shape question SPEC.md does not answer, and
   guessing it in a loose-ends PR is how the *next* third copy of a rule gets
   written.
4. **The cheap hedge is not a fix.** Raising `DIRECTORY_LIMIT` /
   `AGENT_DIRECTORY_LIMIT` from 50 to the schema's max of 200 is one line and
   moves the cliff without removing it — a bigger magic number, and a claim in
   the code that 200 is enough when nothing knows that. Not recommended.

**Recommendation:** file it as a follow-up (contract → server → ui/kit), noting
that the same bound already governs the pre-existing typeable-token filter, so
one issue closes both. Not started here.

### The archived-profile false statement (same review round)

A third item, handed over mid-task: `MISSING_PROFILE_NOTE` told a person their
**working** archived profile was gone.

**Reproduced, against the code that produces the field.** `currentResident`
(`apps/server/src/threads/read.ts`) fills `Resident.docId` by re-resolving the
stored name through `resolveMentionTarget` on every read, so the four acts were
applied to a real workspace and re-projected by the real projector:

| act on the profile | `currentResident(...).docId` |
| --- | --- |
| **archived** (`status: archived`, path untouched) | `doc_scratch1` — **unchanged**, row really is `archived`, still resolvable under stem *and* title |
| renamed | `null` |
| deleted | `null` |
| moved out of `.claude/agents/` | `null` |

Matching what contract-dev measured live. Archiving cannot reach the state the
sentence blamed it for: `targetRows` selects on `type` with no status filter,
`targetIndex`'s only skip is the off-root gate, and `planSetArchived` computes a
folder move for `type: skill` alone — for every other type it patches
frontmatter and leaves the path, which is the gate's sole input.

**The fix: the sentence is no longer typed.**
`packages/kit/src/recipient/laneRows.ts` now exports
`MISSING_PROFILE_CAUSES = ["renamed", "deleted", "moved out of .claude/agents/"]`
and composes `MISSING_PROFILE_NOTE` from it. `deleted` was never listed anywhere
and is a real cause. The substance is `packages/contract/src/schemas/agents.ts`'s,
read and matched rather than re-invented — including stating the archived fact
**positively** (a sentence somebody has to delete) rather than by omission,
which is how it survived the previous sweep. `packages/contract` and `apps/cli`
were not touched.

**Swept in the same pass** — every comment repeating the false half, including
two the hand-off did not list: `RecipientPicker.tsx:56`,
`useComposerRecipient.test.tsx:533`, `ResidentBadge.test.tsx:208`,
`ThreadPanel.test.tsx:588`, `residentActions.test.ts:41` and `:347`,
`laneRows.ts`'s `LaneResidentKind` doc, **plus** `e2e/resident.spec.ts:366` and
`e2e/recipient.spec.ts:144`. `e2e/recipient.spec.ts` also carried the sentence as
two **string literals** (`:168`, `:170`) — the ninth and tenth typed copies; both
now read the kit's constant.

**The pin: `scripts/missing-profile-parity.test.ts`** (new, 9 tests). It pairs
each cause with a **workspace act** by identity — `Act.cause` is a
`MissingProfileCause | null`, checked by the type system, never by matching words
— applies the act to a real workspace, and asks `currentResident` what happened.
Then it asserts the causes the report names are *exactly* the acts that empty the
field. It lives in `scripts/` for `stub-server-parity.test.ts`'s reason:
`apps/server` and `packages/kit` are not on a dependency path, and this is the one
place that may look at both. The archived arm is stated positively and in three
parts (the row really is `archived`, the id survives, the name still resolves
under stem and title — the same lookup `POST .../resident` makes), so a fixture
that quietly archived nothing cannot pass by doing nothing.

### Falsification (archived claim)

| Mutation | Result |
| --- | --- |
| `"archived"` appended to `MISSING_PROFILE_CAUSES` | **3 red** — set equality (no act produces it), composition, and the spelling belt |
| note hand-written, derivation dropped, claim reworded (*"it was retired, or it is no longer where personas live"*) | **2 red** — composition, and the belt via `retired` |
| same, worded to dodge **every** word in the belt's vocabulary (*"…, or shelved since"*) | **1 red** — composition alone, which is the point: the pin holds without knowing the wrong words |
| the archive act declared as `cause: "deleted"` — i.e. claiming archiving empties the field | **3 red** — the per-act measurement first, so the four arms are measuring the code and not restating the fixture |

### Verification (archived claim)

- `vitest run scripts/` — **860 tests, pass** (includes the new file)
- `vitest run packages/kit` — **887 pass** · `vitest run apps/ui` — **3144 pass**
- `npm run lint` (exit 0) · `npm run typecheck` (exit 0, all workspaces) ·
  `prettier --check` clean
- `playwright test resident.spec.ts recipient.spec.ts` (`CORPUS_UI_PORT=5473`) —
  **15 passed**
- **`packages/kit/dist` rebuilt** before every run that resolves the kit through
  its exports map — `apps/ui`, Playwright, and each falsification round.

**Looked at in a browser, because the sentence is 30 characters longer.** A
throwaway spec rendered the `profile-gone` badge and menu and measured them, then
was deleted. The composer's statement — the surface the note is written for —
carries the whole corrected sentence and wraps cleanly to two lines. The board
badge's one-line note **truncates**, and measurement shows that is
**pre-existing**, not introduced: at a 1400px viewport the old string was already
`scrollWidth 310` against `clientWidth 227`, and the resident's name already
wrapped mid-word (`researche/r`). New string: `499` against `263`, same wrap. The
full sentence is on the badge's `title`, and `MISSING_PROFILE_MARK`
(*"profile gone"*) is what row-width surfaces show. **For the orchestrator:** the
badge's note truncating at this width predates this release and is worth its own
issue; not touched here.

**Root cause acknowledged:** SPEC §7's rider joins renamed and archived with one
verb (SHARED-053, unsigned). Not waited on — the string was false whatever the
spec says — but the fix will need re-reading against the signed rider.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-123]` prefix
