# [CONTRACT-064] The designate schema still states the pre-SERVER-125 resolution rule

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-125
- Blocks: — (but PR #50 should not merge with it open)
- Related: MAJOR 2 of PR #50's review, whose sweep found this

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root
- SPEC.md **§8** — `@<subagent-name>` resolution
- SPEC.md **§9.3** — contract-first: the OpenAPI document is generated from the
  route definitions

## Summary

SERVER-125 made an off-root `type: agent-def` document addressable under no
spelling. MAJOR 2 of PR #50's review found the CLI's help text still stating the
old rule, and that fix's sweep found **two more statements of it in the
contract** — which is worse, because these reach the generated OpenAPI document
and the generated client, so they are the wire's own description of the field.

| Location | What it says | Verdict |
| --- | --- | --- |
| `packages/contract/src/schemas/agents.ts:415` — `DesignateResidentRequestSchema.name` | *"a `type: agent-def` document's own name, or its title, matched case-insensitively"* | **Wrong.** No root qualifier at all |
| `packages/contract/src/schemas/agents.ts:63-68` — `AgentNameSchema` | *"the stem of its file name **under `.claude/agents/`** … and by its title"* | **Half wrong.** The stem clause carries the root; the title clause reads as unrestricted |

The first is copied verbatim into
`packages/contract/src/client/schema.generated.ts:5399` and into
`packages/contract/openapi.json`.

## Why this is P1 and not a documentation nit

**Half the sentence is still true, and that is what makes it dangerous.** For a
document in `.claude/agents/`, the stem *and* the title both still resolve,
case-insensitively — and since SERVER-122 a created persona's title routinely
differs from its slugged filename (`Legacy Analyst` is written to
`legacy-analyst.md`), so the title clause is load-bearing for the common case.

A reader cannot tell from this text which half survived. The correction must keep
the in-root title behaviour and qualify it, exactly as the CLI's help text now
does. **Do not overcorrect into saying titles do not resolve.**

## Acceptance Criteria

- [x] Both descriptions state the root gate, and keep the in-root stem-or-title
      rule
- [x] `openapi.json` and `schema.generated.ts` are **regenerated**, never
      hand-edited (committing is the orchestrator's)
- [x] `node --import tsx scripts/check-generated-artifacts.ts` — the API
      contract passes the regeneration gate; its `git diff HEAD` gate cannot be
      clean until the change is committed (see the log)
- [x] The sweep is finished: two further sites were found and fixed (the route
      description and `Resident.docId`); nothing else in `packages/contract`
      states the pre-SERVER-125 rule
- [x] The wording agrees with `apps/cli/src/commands/thread/designate.ts` and
      with the server's `404` in `apps/server/src/threads/resident.ts`

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — the two descriptions
- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`
  — regenerated output, committed

### Key Implementation Details

Read `apps/server/src/threads/resident.ts` for the 404 the server now returns. It
names the file and what is wrong with it, and the description should be
consistent with that message rather than inventing a second wording.

Read the corrected CLI help text before writing, and match it.

## Testing Strategy

Whatever pins the contract already has for these descriptions. The behavioural
check is the drift check plus reading the regenerated `openapi.json`.

## E2E Verification Plan

### Verification Steps

1. Regenerate and confirm the drift check is clean
2. Read the description out of `openapi.json`, not out of the source
3. Confirm an in-root persona still designates by title with the wrong case

## E2E Verification Log

Run by **contract-dev on opus** (claude-opus-5[1m]), 2026-08-18, branch
`phase-34-loose-ends`, working tree (nothing committed — the orchestrator owns
git).

### What changed, and the sweep

Four sites, not the two the issue names. The two extra were found by sweeping
`packages/contract` for every statement of the rule rather than only the reported
lines:

| Site | Before | After |
| --- | --- | --- |
| `schemas/agents.ts` — `DesignateResidentRequest.name` (published) | "a `type: agent-def` document's own name, or its title, matched case-insensitively" | root-gated; keeps the in-root stem-**or**-title pair, cites `Legacy Analyst` → `legacy-analyst.md`, and says an off-root `agent-def` "answers to neither spelling" and that the `404` names its path |
| `schemas/agents.ts` — `AgentNameSchema` JSDoc (source only) | "invocable by the stem of its file name under `.claude/agents/`, and by its title" | the root is stated as **the gate on the whole row** (SERVER-125), not as a qualifier on the stem clause |
| `routes/thread-resident.ts` — `POST /api/threads/{id}/resident` description (published) | "`404` when the name resolves to no `type: agent-def` document in this workspace" — reads as *any* agent-def resolving | names the root in the `name` clause, and says an off-root `agent-def` is one of those misses, with the refusal naming its path |
| `schemas/agents.ts` — `Resident.docId` (published) | null "because the one that was named has since been renamed or archived" + "a **moved** agent-def shows its current id here rather than a stale one" — false since SERVER-125 for a move out of the root | adds "moved out of `.claude/agents/`, the root a persona has to live in to be addressable at all"; the closing clause now says "the document the name answers to now, never a stale id" |

Everything else the sweep turned up states no resolution rule and was left alone:
`Resident.name` ("the invocable name `@<subagent>` mentions use", no root claim),
`residentField`, `CREATE_FOLDER_DESCRIPTION` and `createDoc`'s description (both
already correct since CONTRACT-062/063 — `folder: "inbox"` files an `agent-def`
under `data/docs/` "as a document *about* a persona"), and every `mention`
reference in `schemas/{capture,thread,error,form}.ts`, which describe enqueueing,
not resolution.

### 1. Regeneration and the drift check

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
```

Idempotent — a second run leaves the tree byte-identical:

```
$ git diff --stat -- packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 6 +++---
 packages/contract/src/client/schema.generated.ts | 6 +++---
$ npm run generate -w packages/contract && git diff --stat -- <same two paths>
 packages/contract/openapi.json                   | 6 +++---
 packages/contract/src/client/schema.generated.ts | 6 +++---
```

Exactly three lines per file: `Resident.docId`, `DesignateResidentRequest.name`
and the route description. No hand edit — both files are only ever written by
`scripts/generate.ts`.

```
$ node --import tsx scripts/check-generated-artifacts.ts ; echo exit=$?
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 6 +++---
 packages/contract/src/client/schema.generated.ts | 6 +++---
✗ CLI reference is stale: docs/cli.md
 docs/cli.md | 10 +++++-----
exit=1
```

**Read this against `scripts/generated-artifacts.ts`, which gates in two steps.**
The first gate hashes the artifacts across a regeneration — that is the "artifact
matches its source" check, and the API contract **passed** it: a failure there
returns before printing a diff summary, and a summary was printed. The second
gate is `git diff HEAD`, which cannot be clean for an uncommitted source change:
the artifacts differ from HEAD precisely because `schemas/agents.ts` and
`routes/thread-resident.ts` do. The orchestrator's commit clears it, which is
what `Fix: … && git add …` says. The `docs/cli.md` line is CLI-051's uncommitted
work in this tree, not this issue's.

### 2. The correction, read out of the regenerated `openapi.json`

Not out of the source (`node -e` over `packages/contract/openapi.json`):

- `components.schemas.DesignateResidentRequest.properties.name.description` —
  "…for a `type: agent-def` document **under `.claude/agents/`**, its filename
  stem or its title, matched case-insensitively — and the two routinely differ,
  since a persona created with the title `Legacy Analyst` is written to
  `legacy-analyst.md`. **Not a document id, and not an `agent-def` filed outside
  that root**: one under `data/docs/` is a document *about* a persona, nothing
  loads it as a subagent, and it answers to neither spelling. … where an off-root
  `agent-def` is titled the name given, that `404` names its path, because moving
  the file into `.claude/agents/` is what makes it designatable."
- `paths["/api/threads/{id}/resident"].post.description` — same rule, same words
  for the load-bearing clauses.
- `components.schemas.Resident.properties.docId.description` — "…renamed,
  archived, or moved out of `.claude/agents/`, the root a persona has to live in
  to be addressable at all."

`grep` confirms both descriptions reached the generated client
(`src/client/schema.generated.ts:2195` and `:5399`).

### 3. Against the real server — every clause of the new prose

Scratch workspace `/tmp/c064ws`, port **8798** (never 8765, never 5173), CLI run
from source via `tsx`; server stopped and the workspace removed afterwards.

```
$ corpus doc create --type agent-def --title "Legacy Analyst" --file …
created doc_on3nsuu5 — .claude/agents/legacy-analyst.md          # stem ≠ title, SERVER-122
$ corpus doc create --type agent-def --title "Bookkeeper" --folder inbox --file …
created doc_zhlql6t3 — data/docs/inbox/bookkeeper.md

# The half that survived: in-root, the TITLE resolves, in the wrong case
$ corpus thread designate th_sfdmvhqe --agent "lEgAcY aNaLyst"
designated legacy-analyst (doc_on3nsuu5) on th_sfdmvhqe

# The half that did not: off-root answers to NEITHER spelling
$ corpus thread designate th_sfdmvhqe --agent "Bookkeeper"
corpus: 404 not_found: no agent named Bookkeeper in this workspace — data/docs/inbox/bookkeeper.md
declares `type: agent-def` but is not under `.claude/agents/`, so nothing loads it as a subagent
and nothing resolves `@Bookkeeper` to it; a persona has to live in that root
$ corpus thread designate th_sfdmvhqe --agent "bookkeeper"
corpus: 404 not_found: … data/docs/inbox/bookkeeper.md declares `type: agent-def` but is not
under `.claude/agents/` …
```

So the published description now says exactly what the server does, in the
server's own terms, and the CLI's help text (uncommitted here) says the same.

The `Resident.docId` clause I added was verified too, in both directions. An API
`doc move` cannot take a persona out of the root at all
(`.claude/agents/legacy-analyst.md is not under data/docs/ and cannot be moved`),
so the move that matters is a hand move on disk, which §5 makes as real as
anything the server writes:

```
resident before                      {'name': 'legacy-analyst', 'docId': 'doc_on3nsuu5'}
mv .claude/agents/legacy-analyst.md data/docs/inbox/   →  {'name': 'legacy-analyst', 'docId': None}
mv it back into .claude/agents/                        →  {'name': 'legacy-analyst', 'docId': 'doc_on3nsuu5'}
```

### 4. Checks

- `VITEST_MAX_THREADS=4 vitest run packages/contract` — **65 files, 2620 tests,
  all passing**, 5.08s.
- New pin, `openapi.test.ts` → "gates the designation name on `.claude/agents/`,
  keeping the in-root stem-or-title pair": asserts against the **generated**
  document that the request field and the route description each carry the root,
  the surviving in-root pair (`stem or its title`, `case-insensitively`) *and*
  the correction (`neither spelling`), and that `Resident.docId` states the move
  out of the root. Written against the document rather than the schema source
  because a half-correction hand-copied into one of the two sites is only visible
  there.
- `npm run lint` — exit 0. `npm run build` then `npm run typecheck` — exit 0
  (whole repo, other agents' uncommitted work included).
- `prettier --check` on all five touched files — clean.

### Server on 8798 stopped, port free

```
stopped (pid 61194)
port 8798 holders:            # empty
pid 61194 gone
```

## PR #50 second review — MINOR 5, and the fuller sweep

Run by **contract-dev on opus** (claude-opus-5[1m]), 2026-08-18, branch
`phase-34-loose-ends`, working tree (nothing committed).

### The finding

`CreateDocRequest.folder` was the **seventh** wording of the SERVER-125 rule and
the one the first sweep missed, because the first sweep looked for statements
about *resolution* and this one is a statement about *placement* that carries a
resolution consequence. It said an explicit folder still files an `agent-def`
under `data/docs/` "as a document _about_ a persona" — what the document **is**,
never what it **answers to** — while the CLI's parallel site
(`apps/cli/src/commands/doc/create.ts`, and `docs/cli.md` generated from it) had
gained the cost clause.

### The correction, read out of the regenerated `openapi.json`

`components.schemas.CreateDocRequest.properties.folder.description`, final
clause (the rest of the field is unchanged):

> An explicit folder always wins over that default, which is what keeps a
> document _about_ a persona expressible: `type: agent-def` with
> `folder: "inbox"` still files under `data/docs/`. **What that costs is
> addressability, and it costs all of it**: a persona is loaded and resolved
> from `.claude/agents/` alone, so an `agent-def` written anywhere else answers
> to neither `@<name>` nor `POST /api/threads/{id}/resident`, under its filename
> stem or its title alike — it is a note about a persona rather than one.

The CLI's sentence with the flags replaced by routes (`corpus thread designate
--agent` → `POST /api/threads/{id}/resident`) and nothing else re-worded — the
brief was to match the parallel site, not to write an eighth wording. The
`@<name>` half is spelled the same at both surfaces because a mention is a
mention whichever client writes it.

`grep` confirms it reached the generated client
(`src/client/schema.generated.ts:4426`).

### The fuller sweep — every published description touching folders, agent-def naming, skill naming or addressability

Enumerated **mechanically** this time, by walking every `description` and
`summary` in the generated `openapi.json` against
`/agent-def|\.claude\/agents|\.claude\/skills|SKILL\.md|addressab|@<|folder|persona|subagent/i`
— 63 hits, of which 43 are shared boilerplate (`warnings`, `type`, `tag`
descriptions repeated across components). The 20 substantive ones, each read
against the code rather than against memory:

| Published site | Claim | Checked against | Verdict |
| --- | --- | --- | --- |
| `CreateDocRequest.folder` | placement grammar + the "about a persona" clause | `resolveFolder`/`rootForType`/`admitRoot` (`apps/server/src/docs/write.ts`), `allocatePath` (`create.ts`) | **fixed here** — placement half was already right, the addressability half was missing |
| `POST /api/docs` (route) | inbox-first, the two roots an omitted `folder` reaches, `type: skill` not among them, thread checked-then-ignored, title can be refused | same | correct; deliberately carries **no** resolution clause — it says "See `folder` for that grammar in full", and `openapi.test.ts` asserts it does not repeat "An explicit folder always wins" |
| `CreateDocRequest.title` | `.claude/agents/analyst.md` is what makes `@analyst` resolve; `400` on a taken name; dedupe under `data/docs/` | `allocatePath` + the `already taken in` validation error (`create.ts:79-84`) | correct, and post-SERVER-125 still correct — the root is stated as the condition |
| `DesignateResidentRequest.name` | root-gated stem-or-title | `apps/server/src/threads/resident.ts:185-206` | correct (CONTRACT-064) |
| `POST /api/threads/{id}/resident` (route) | same rule | same | correct (CONTRACT-064) |
| `Resident.docId` | null when renamed, archived, **or moved out of `.claude/agents/`** | same | correct (CONTRACT-064); test coverage — see below |
| `Resident.name` | "the invocable name `@<subagent>` mentions use", null = general resident | `ResidentSchema` | no root claim, nothing to correct |
| `Thread.resident`, `ThreadSummary.resident`, `AgentLane.resident` | one shared `residentField` description; designation semantics only | `residentField` | no resolution claim |
| `MoveDocRequest.folder` | destination under `data/docs/`; naming a root (`.claude/agents`) is a `400`; no default; no overwrite | `resolveFolder(folder)` with no type; `move.ts` | correct as far as it goes — **see the gap below** |
| `POST /api/docs/{id}/move` (route) + `BulkStagedEntry.action[move].folder` | path rewrite, id preserved, same spelling as the single route | `move.ts` | correct |
| `SkillCreateRequest.name` | directory name under `.claude/skills/`, lowercase/digits/single hyphens, ≤ 64 | `SKILL_NAME_PATTERN`, `SKILL_NAME_MAX_LENGTH` | correct, and the numeral is interpolated from the constant |
| `POST /api/skills` | genesis-only route, both frontmatter vocabularies, name is the traversal guard, `409` on a taken name, `.claude/skills-archived` | `schemas/skill.ts`, routes | correct |
| `POST /api/docs/{id}/archive` / `unarchive` | a skill's folder moves to/from `.claude/skills-archived/`; location is enablement (§7); carried nested skills warned | `Warning.code`, SERVER-078 | correct |
| `Warning.code` (`carried_skill`, `carried_reconciliation`) | skill enablement is where the folder lives | same | correct |
| `GET /api/docs` / `GET /api/search` `folder`, `type` params; `GET /api/tree`; `FolderTree`/`FolderNode`; `tags[3]` | `data/docs/` prefix filtering and counts | projection | correct — all scoped to `data/docs/`, none claims anything about the other roots |
| `CreateThreadRequest.requestsAgent` / `MultipartCreateThreadRequest.requestsAgent` | `@<subagent>` mention enqueues | enqueue path | describes enqueueing, not resolution — untouched, as in the first sweep |

**One gap the sweep found and did not fix — escalating rather than deciding.**
`move.ts:53-54` refuses a move whose *source* is outside `data/docs/`
(``${loaded.path} is not under data/docs/ and cannot be moved``, and the separate
"threads are flat under data/threads/ and cannot be moved"). Nothing published
says so: `MoveDocRequest.folder` and the move route both describe only the
**destination** side. So a caller who reads the new `folder` sentence, files a
persona in the inbox and then tries `POST /api/docs/{id}/move` to put it back
gets an undeclared-in-prose `400`. That is a new claim on a route this issue was
not asked to touch, and verifying it E2E needs a server build while
`apps/server` is being edited concurrently — so it is reported, not written.

### Checks

- `VITEST_MAX_THREADS=4 vitest run packages/contract` — **65 files, 2621 tests,
  all passing** (2620 before; one new pin).
- New pin, `openapi.test.ts` → "states what filing an agent-def outside its root
  costs, not only what it is", in the CONTRACT-062 folder-grammar block:
  asserts against the **generated** document that `CreateDocRequest.folder`
  carries both halves — what the document is (`a document *about* a persona`)
  and what it answers to (`costs is addressability`, `` `.claude/agents/` alone ``,
  `` `@<name>` ``, `POST /api/threads/{id}/resident`, `filename stem or its title
  alike`).
- **Falsified**, not assumed: reverting the clause to its pre-fix wording,
  regenerating, and running that test alone gives
  `AssertionError: expected 'Folder under \`data/docs/\`, accepted e…' to contain
  'costs is addressability'` — 1 failed. Restored and re-verified green.
- Regeneration is idempotent: `sha256` of both artifacts is byte-identical
  across a second `npm run generate` (`a4cbc24c…` / `c24c207a…`), and unchanged
  again after `prettier --write` re-quoted the source string.
- `node --import tsx scripts/check-generated-artifacts.ts` — **the API contract
  passes the regeneration gate**: `scripts/generated-artifacts.ts` returns
  *before* printing a diff summary when the hash gate fails, and a summary was
  printed (`openapi.json | 2 +-`, `schema.generated.ts | 2 +-` — exactly the one
  description). What is left failing is the second gate, `git diff HEAD`, which
  cannot be clean for an uncommitted source change; the orchestrator's commit
  clears it. `✓ CLI reference is up to date (docs/cli.md)` this run.
- `npm run build -w packages/contract` — exit 0. `npm run lint` — exit 0.
  `npm run typecheck -w packages/contract` — exit 0. `prettier --check` on all
  four touched files — clean.
- Repo-wide `npm run typecheck` is **red on one line that is not mine**:
  `apps/server/src/threads/resident.test.ts(814,12): error TS2571: Object is of
  type 'unknown'` — another agent's uncommitted work in this tree.

### `Resident.docId`'s move-out-of-root claim: not coverable from the contract side

The reviewer's separate MINOR. The claim is behavioural — the server re-resolves
`docId` on every response through the root gate — and `packages/contract` has no
resolution code at all to exercise (`schemas/agents.ts` exports schemas and two
presence helpers; nothing that maps a name to a document). The contract side can
only pin the **prose**, which CONTRACT-064 already did
(`openapi.test.ts` → "gates the designation name on `.claude/agents/`…" asserts
`Resident.docId` contains "moved out of `.claude/agents/`"). So the answer is
no.

`apps/server/src/threads/resident.test.ts` already covers the other two arms of
the sentence — a rename (`re-reads the document id from the name, so a moved
agent-def is not stale`, an in-root rewrite) and a removal (`reports a gone
agent-def as a null docId…`, an `rm` + reproject) — and the move-out arm is
genuinely absent. It is one test in that file's `describe("reading a resident
back")`: designate `researcher`, move `.claude/agents/researcher.md` to
`data/docs/inbox/researcher.md` on disk, `ws.reproject()`, expect
`{ name: "researcher", docId: null }` from `readThread`, and expect the thread's
frontmatter still holds `docId: doc_researcher` — the same shape the two
neighbouring tests use. Routing that to server-dev is the orchestrator's call;
that file is another agent's right now.

## PR #50 third review — MINOR 3, and the route half of MINOR 5

Run on **opus** (`claude-opus-5[1m]`). Scope: `packages/contract/` only —
`apps/cli/` and `apps/ui/` were held by other agents and were read, never
written.

### MINOR 3 — the archived clause is false, and here is the proof

`ResidentSchema.docId` said the field is null when the named profile "has since
been renamed, **archived**, or moved out of `.claude/agents/`". The archived
third of that is false. Established two ways.

**By code.** `targetRows` (`apps/server/src/threads/mentions.ts:153-156`) is
`SELECT id, path, title, status FROM documents WHERE type = ? ORDER BY id` —
**no status filter**. `targetIndex` (`:204-217`) skips a row on exactly one
condition, `invocableName(row.path) === null`, which is the off-root gate;
`status` is carried onto the `ResolvedTarget` and **read by nobody** (the only
occurrence in the file is the assignment at `:209`). `resolveMentionTarget`
(`:302-309`) is a lookup in that index, and `currentResident`
(`apps/server/src/threads/read.ts:100-108`) is `target?.docId ?? null` over it.
And archiving does not move an `agent-def`: `folderMove`
(`apps/server/src/docs/archive.ts:124-138`) only ever moves a path already under
`SKILLS_ROOT`/`SKILLS_ARCHIVED_ROOT`, so for every other type archiving is a
`status: archived` frontmatter write and the path — the one input to the gate —
is unchanged. `apps/server/src/threads/resident.ts:229-233` says the same thing
in prose: *"An **archived** agent-def designates rather than being refused."*

**Against a real server.** Scratch workspace at `/tmp/c64ws/ws`, real
`apps/server/src/main.ts` on **port 8805** (never 8765, never 5173), stopped
afterwards and the port confirmed free. All four arms of the sentence, run on the
one workspace:

| act on the profile                                | `resident` on the next `GET /api/threads/{id}` |
| ------------------------------------------------- | ---------------------------------------------- |
| `POST /api/docs/{id}/archive` (stays in root)     | `{"name":"scratch-persona","docId":"doc_5g4njtsp"}` — **unchanged** |
| file moved to `data/docs/inbox/` by hand          | `{"name":"scratch-persona","docId":null}`      |
| file renamed to `.claude/agents/renamed-persona.md` | `{"name":"scratch-persona","docId":null}`    |
| `DELETE /api/docs/{id}`                           | `{"name":"renamed-persona","docId":null}`      |

The archive response itself shows the path surviving:
`archived .claude/agents/scratch-persona.md`. And an already-archived profile is
still **designatable** — created `Archived Persona`, archived it, then
`POST /api/threads/{id}/resident {"name":"archived-persona"}` answered
`{"name":"archived-persona","docId":"doc_jz4ttnil"}` — which is the second half
of the new wording, verified rather than inferred from
`resident.ts`'s comment.

Incidentally confirmed while setting the scenario up: `POST
/api/docs/{id}/move` refuses an in-root `agent-def` outright — *"`.claude/agents/scratch-persona.md` is not under `data/docs/` and cannot be
moved"* — so the move-out arm is reachable only by hand, exactly as this file's
previous section predicted.

**The fix.** `docId`'s description now lists **renamed, deleted, or moved out of
`.claude/agents/`** (deleted was never listed and is one of the real ways in,
covered by the server's own `rm`-and-reproject test), and states the corrected
fact positively rather than by omission, because four other surfaces carry the
false claim and this is the document they would be read against:

> **Archiving a profile does not empty this field**: an archived `agent-def`
> still under that root resolves exactly as before, and is still designatable, so
> what stands here is its id and `name (profile missing)` is the wrong thing to
> show for it. Archived-ness is not carried on a `Resident` at all — it is the
> document's own `status`, on the document this id names, for the caller that
> cares.

The module docblock's third state (`schemas/agents.ts:117-123`) was rewritten to
match.

### MINOR 5 (route half) — the unconditional promise, reproduced then removed

Reproduced on the same server. `POST /api/docs` with
`{"type":"agent-def","title":"Legacy Analyst","folder":"inbox"}` →
`data/docs/inbox/legacy-analyst.md`. Then, on a thread:

- `{"name":"Legacy Analyst"}` → `404` *"…`data/docs/inbox/legacy-analyst.md`
  declares `type: agent-def` but is not under `.claude/agents/`…"* — the path is
  named.
- `{"name":"legacy-analyst"}` → `404` *"no agent named legacy-analyst in this
  workspace — a designation names an agent-def the way a mention does"* — the
  **bare** refusal, from the stem the same paragraph told the reader to try.

`unaddressableTarget` (`mentions.ts:272-287`) matches `aliasKey(row.title)`
alone, by design: off root there is no invocable name, so the title is the only
alias such a row ever had.

The route now carries `DesignateResidentRequestSchema`'s existing qualifier
**verbatim** — "where an off-root `agent-def` is titled the name given, that
`404` names its path, because moving the file into `.claude/agents/` is what
makes it designatable" — rather than an eighth phrasing, plus the asymmetry the
route is the site that has to state, because it is the site that offers both
spellings: *"**Only the title reaches that refusal**: off root there is no
filename stem to answer to, so `legacy-analyst` for a document titled
`Legacy Analyst` in the inbox is the bare `404` — its title is the spelling that
says where it is."*

### Pins, and falsifying them

Two tests in `openapi.test.ts`, both against `buildOpenApiDocument()`:

- **"qualifies the path-naming 404 identically wherever it is promised"** —
  asserts the one qualifier string appears in `DesignateResidentRequest.name`
  **and** in the route description. Not two hand-copied prose checks: the same
  literal, so the next edit to either is a failing test.
- **"does not list archiving among the ways a profile stops resolving"** — the
  corrected list, the positive archived sentence, and then a **sentence-level
  sweep**: every sentence mentioning archiving that also mentions
  null/no-longer/gone/missing must be the one saying it changes nothing. Pinning
  the absence of the old spelling would have let the claim back in new words,
  which is precisely how it survived the CONTRACT-064 sweep.

Falsified, each separately, by injecting the defect into the **source** (the test
builds the document, so editing `openapi.json` proves nothing — that was the
first attempt and it passed):

- restore the route's old unconditional sentence → *"expected 'Gives a
  **standalone** thread a resid…' to contain 'where an off-root `agent-def` is
  titl…'"*, exit 1.
- re-word the null-causes list as "renamed **or put away into the archive**, or
  moved out of…" → exit 1 on the corrected-list assertion.
- keep the corrected list and smuggle the claim back as a fresh sentence, *"An
  agent-def put away into the archive stops resolving and leaves this null."* →
  the sweep fails with that exact sentence printed as the offender. This is the
  arm that matters; the first two would have been caught by a naive pin.

Sources restored and `openapi.json` regenerated afterwards; the committed
document contains the corrected prose.

### Checks

`npm run generate -w packages/contract` (never hand-edited) — exit 0, both
artifacts rewritten. `VITEST_MAX_THREADS=4 npx vitest run packages/contract` —
**2623 passed, 65 files**, exit 0. `npm run build -w packages/contract` — exit 0.
`npm run typecheck -w packages/contract` — exit 0. `npm run lint` — exit 0.
`prettier --check` on the five touched files — clean. Scratch server killed, 8805
free, the user's 8765 untouched (a different pid throughout).

### What the sweep turned up, now that one clause is known to have survived it

The false claim is not confined to this package. **Not touched — reported for
routing:**

- `packages/kit/src/recipient/laneRows.ts:154` —
  `MISSING_PROFILE_NOTE = "its profile is gone — renamed or archived since"`.
  This is **user-visible text**, not a comment: a picker tells a person their
  archived-but-working profile is gone. The worst instance of the four.
  (ui-dev's domain.)
- `apps/cli/src/commands/thread/designate.ts:60`, `:132`, `:182` — help text and
  a comment; `:132` prints the claim in `--help`. Generated into `docs/cli.md:120`
  ("renamed or archived since"), which is why the doc must not be hand-edited.
  (cli-dev's domain, held concurrently.)
- `apps/ui/src/thread/ResidentBadge.test.tsx:208`,
  `ThreadPanel.test.tsx:588`, `residentActions.test.ts:41`/`:347`, and
  `packages/kit/src/recipient/RecipientPicker.tsx:56`,
  `useComposerRecipient.test.tsx:533` — comments repeating it.
- `apps/server/src/threads/resident.test.ts:805` quotes the **old** `docId`
  sentence verbatim ("renamed, archived, or moved out of…") as a comment; it is
  now a stale quotation of a string that no longer exists.

Two notes for whoever picks those up. First, the CLI's copy of the MINOR 5
qualifier (`designate.ts:123-125`) bolds `**titled**` where both contract sites
have it plain; the strings are otherwise identical. Harmless, but it means the
three cannot be pinned as one literal. Second, **SPEC.md §7's rider is the root
of this**: *"A profile that is renamed or archived after designation does not end
the designation: the resident goes on owning its scope, and the missing profile
is reported rather than silently substituted."* The first clause is true of
archiving (the designation stands) and the second is not (nothing is missing).
Every downstream site read the sentence as one claim. The contract now states the
distinction; the spec sentence still invites the misreading, and tightening it is
a SHARED issue and the user's call, not this agent's.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-064]` prefix
