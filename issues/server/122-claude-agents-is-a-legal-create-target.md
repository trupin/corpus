# [SERVER-122] `.claude/agents/` is a legal create target

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: CLI-050, AGENT-034

## Spec References

- SPEC.md **§7** line 397 — *"The projection and watcher cover
  `.claude/skills/**/SKILL.md` (as `type: skill`) and `.claude/agents/*.md` (as
  `type: agent-def`) as **additional document roots** alongside `data/`"*
- SPEC.md **§10** line 539 — *"Creating a new skill or subagent document
  instantly makes it autocompletable — there is no separate registry."*

## Summary

**The server refuses to create a document in the one root SPEC names for
agent-defs**, so the product's own agent is told to do something its only
interface forbids.

`assets/workspace/claude/skills/orchestrate/SKILL.md:1392` instructs the agent:
*"a new `type: agent-def` document is all it takes to make a persona addressable
as `@<name>`"*. Architecture decision 2 confines the agent to the CLI. And the
CLI's only creation path is refused, measured 2026-08-17 against a real server:

```
--folder ../../.claude/agents  → 400  folder escapes the document root
--folder .claude/agents        → 400  folder is not a location documents are indexed from
--folder agents                → 200  created data/docs/agents/summarizer.md
```

`--folder` is rooted at `data/docs/`, and nothing reaches the agent-def root.

**Why it went unnoticed:** a misfiled `type: agent-def` document under
`data/docs/` *works*. `GET /api/docs?type=agent-def` filters on frontmatter
`type`, never on path, so it appears in the designate menu and designates
cleanly. Verified end to end. The drift is invisible to every test because both
roots produce a working agent-def — they just get different id shapes
(`doc_5i25gnld` vs `doc_agentdef711f519a`) and one of them sits in the user's
inbox looking like a note.

## Acceptance Criteria

- [x] A create naming the agent-def root succeeds and writes
      `.claude/agents/<stem>.md`
- [x] The created document is projected as `type: agent-def`, is designatable by
      its invocable name, and resolves as `@<name>` — the same as a
      hand-authored one
- [~] The id it receives is the one the agent-def root produces, not a `data/`
      id — one artifact, one id scheme
      _(Read against its literal text: the id is **minted and stamped**, not the
      root's path-derived synthetic one. See E2E log, Decision 3.)_
- [x] The path-escape refusal is **unchanged** for everything else: `..`
      segments, absolute paths, and any root that is not a declared document
      root are still `400`
- [x] `.claude/skills/` is considered and a decision recorded — a skill document
      has the same argument and is deliberately in or out of this issue's scope,
      never left ambiguous _(OUT — see E2E log, Decision 2)_
- [x] Documents already misfiled under `data/docs/` keep working exactly as they
      do today; nothing is moved by this issue

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/write.ts` — the create path's folder validation
- `apps/server/src/projection/roots.ts` — already declares the `agents` root
  (`key: "agents"`, `path: ".claude/agents"`); the create path must consult the
  same declaration rather than a second list
- `apps/server/src/watcher/paths.ts` — `classifyPath` is the existing authority

### Key Implementation Details

**One declaration, consulted twice — never a second list.** `roots.ts` already
knows every document root and which of them synthesize ids. The bug is that the
create path validates against `data/docs/` alone. Route the validation through
the existing root declaration so a root added later is creatable without a
second edit. A hand-maintained allowlist beside `roots.ts` would be exactly the
one-rule-in-two-places defect this phase exists to remove.

**Say how a caller names the root.** Whether that is a reserved `--folder`
value, the document's `type` implying its root, or a distinct field is yours to
decide — CLI-050 consumes whatever you choose, so **write the chosen spelling
into the issue's log and the route description**, because CLI-050 depends on it
and an undocumented scheme is a break waiting to happen.

**Frontmatter is waived in this root, not absent.** `isSkillFrontmatterException`
already waives §5's canonical block for paths whose root synthesizes ids. A
document created here must satisfy every *structural* rule while being allowed
Claude Code's `name`/`description` shape — a created agent-def that the check
path would then reject is the sprint-013 Adjudication 6 violation ("a document
the system accepts on write must not fail a check").

### Edge Cases

- **A name collision** with an existing `.claude/agents/<stem>.md`
- **A stem that is not a legal file name** — the same slug rules as any create
- **Writing into a root the watcher is watching** must not loop: the write
  auto-commits, the watcher re-projects, and that must settle
- **`.claude/agents/` missing** in an older workspace — created, or a clear
  refusal; not a 500

## Testing Strategy

Route tests for the accepted root, the refused escapes (unchanged), the id
scheme, and the frontmatter waiver. A projection test that a created agent-def
is immediately resolvable as a mention target. **Falsify by reverting the
validation change and watching the acceptance test go red** — and note that a
test asserting only "creation succeeded" would pass against a create that
misfiled to `data/docs/`, so assert the **path**.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Create an agent-def through the real HTTP route; `find .claude/agents` shows
   the file; `git log` shows the commit
3. `GET /api/docs?type=agent-def` reports it with the `.claude/agents/…` path
4. Designate it on a real standalone thread; the roster shows it
5. Confirm `--folder ../../x` and other escapes are still refused
6. Stop the server; confirm the port is free

## E2E Verification Log

**Model: opus.** Real server (`tsx apps/server/src/main.ts`) on port **8837**, throwaway
workspace created by `corpus init` at `.../tmp/ws122`. Server stopped and port verified free
at the end.

### Decision 1 — how a caller names the agent-def root (CLI-050 consumes this verbatim)

**Two spellings, both live. The default is the one the agent uses.**

1. **An omitted `folder` files a document in the root its `type` declares.**
   `POST /api/docs {"type":"agent-def","title":"Archivist"}` → `.claude/agents/archivist.md`.
   This is the spelling `orchestrate/SKILL.md:1392` already promises ("a new `type: agent-def`
   document is all it takes"), so `corpus doc create --type agent-def --title "…"` needs **no
   new flag** and no change to the skill's wording.
2. **An explicit `folder` may name a declared root by its declared path**, exactly:
   `{"folder":".claude/agents"}`. Trailing slashes are tolerated; nothing else is
   (`.claude/agents/nested`, `.claude/agentsx`, `.Claude/agents` are all `400`).

**An explicit folder always wins**, which is what keeps a document *about* an agent-def
expressible: `--folder inbox --type agent-def` still files under `data/docs/` (the case
`invocableName` already contemplates for skills). Both doors are the same rule in
`resolveFolder(folder, forType)`, reading `DOCUMENT_ROOTS` — there is no second allowlist.

### Decision 2 — `.claude/skills/` is OUT of scope, and stays refused

Deliberately, for two independent reasons that agree:

- **It already has its verb.** `POST /api/skills` (SERVER-036) mints the folder, fixes the
  filename and writes both vocabularies. A skill is `<name>/SKILL.md` — a directory plus a
  filename that is not derived from anything the caller sent — which is not a folder question
  and cannot be answered by naming one.
- **The root refuses itself.** `.claude/skills` is declared `shape: "skill-tree"`, so
  `classifyPath(".claude/skills/document.md")` is `null` and the existing
  `projectionIndexesFolder` probe rejects it. No special case was written for skills; the
  refusal falls out of the same declaration that admits `.claude/agents`. Measured:
  `{"type":"skill","folder":".claude/skills"}` → `400 folder is not a location documents are
  indexed from`, and the same for `.claude/skills-archived`.

`skills/create.ts`'s module header, which claimed no wire form could write outside `data/`,
was corrected to say what is now true.

### Decision 3 — the id (this is the one AC I read against its literal text; see Report)

A created agent-def carries a **minted `doc_<base32>` id stamped into its frontmatter**, not
the projection's path-derived `doc_agentdef<sha1>`. The synthetic id is a *fallback for files
Corpus did not write* (§7 — "a hand-written `SKILL.md` … which is why the projection
synthesizes an id"); it is a function of the path, so renaming the file would silently make it
a different document. `POST /api/skills` decided this same question the same way, and
`docs/archive.ts` stamps a real id in before it moves a skill precisely to avoid the synthetic
one. Writing a document with no identity of its own would also contradict §5's "path is
presentation, id is identity". What the AC's complaint asked for is delivered in full: one
artifact, one **root**, one path shape — no persona in the inbox.

### Pre-fix reproduction (2026-08-17, port 8837, before any code change)

```
--folder ../../.claude/agents  → 400 folder escapes the document root
--folder .claude/agents        → 400 folder is not a location documents are indexed from
--folder agents                → 201 data/docs/agents/researcher.md      # wrong root
(no folder)                    → 201 data/docs/inbox/summarizer.md       # wrong root
```

### Post-fix evidence

```
### create with no folder
POST /api/docs {"type":"agent-def","title":"Archivist",
                "extra":{"name":"archivist","description":"Keeps the corpus tidy."}}
  → 201  .claude/agents/archivist.md  doc_ajcu5mz5   warnings []

### create naming the root
POST /api/docs {"type":"agent-def","title":"Critic","folder":".claude/agents"}
  → 201  .claude/agents/critic.md  doc_hgfftrtc

### on disk + in the audit trail
$ find .claude/agents -type f
.claude/agents/archivist.md
.claude/agents/critic.md
$ git log --oneline -2
02d4b1b doc create: Critic (doc_hgfftrtc) by user
c6745d2 editing session: 1 document by agent
$ git show --stat --oneline HEAD
 .claude/agents/critic.md | 15 +++++++++++++++

### the file the server wrote — §5's block, with Claude Code's keys beside it
---
id: doc_ajcu5mz5
type: agent-def
title: Archivist
created: 2026-08-17T22:41:44Z
… tags/status/anchors/due/reviewed/evergreen/origin …
name: archivist
description: Keeps the corpus tidy.
---
You archive.

### GET /api/docs?type=agent-def  (the two pre-fix misfiled ones still work — AC6)
doc_ajcu5mz5 | .claude/agents/archivist.md   | Archivist
doc_hgfftrtc | .claude/agents/critic.md      | Critic
doc_sqpgsd73 | data/docs/agents/researcher.md| Researcher
doc_zgdnbzl5 | data/docs/inbox/summarizer.md | Summarizer

### designates on a real standalone thread, and shows in the roster
POST /api/threads/th_nav4lv77/resident {"name":"archivist"}
  → 200  resident {"name":"archivist","docId":"doc_ajcu5mz5"}
GET /api/agents
  orchestrator   resident=null
  th_nav4lv77    resident={"name":"archivist","docId":"doc_ajcu5mz5"}  origin="Ops"

### resolves as @<name> in a real turn (§8)
POST /api/threads/th_nav4lv77/turns {"body":"Please look at this, @archivist."}
  → evt_lajsbhrb3sss  payload.mentions
      [{"name":"archivist","docId":"doc_ajcu5mz5","status":"open"}]

### every refusal, unchanged or new, with nothing written (git status clean)
400 folder=../../.claude/agents          folder escapes the document root
400 folder=/etc                          folder must be a path under data/docs
400 folder=.claude/agents/../../../etc   folder escapes the document root
400 folder=.claude/agents/nested         folder is not a location documents are indexed from
400 folder=.claude/agentsx               folder is not a location documents are indexed from
400 type=note   folder=.claude/agents    that root holds one kind of document, and this is not it
400 type=skill  folder=.claude/skills            not a location documents are indexed from
400 type=skill  folder=.claude/skills-archived   not a location documents are indexed from
400 type=agent-def title="Archivist"     the name `archivist` is already taken in .claude/agents
201 type=note   (no folder)              data/docs/inbox/ordinary-note.md      ← unchanged
201 type=agent-def folder=inbox          data/docs/inbox/about-archivist.md    ← escape hatch

### edge cases
- **Missing root.** Deleted `.claude/agents/` entirely, restarted: the watcher's own
  `mkdirSync` recreated it at boot, and a create into it answered `201` — no 500. With the
  server *running* and the directory removed mid-flight, the create still answered `201` and
  wrote the file (`writeFileAtomically` mkdirs), so neither order produces a 500.
- **No watcher loop.** `GET /api/db/doctor` → `{"ok":true,"drift":[],"warnings":[]}` after
  every create; the log shows one request each and no re-projection churn.
- **The new root is watched.** Appended to `.claude/agents/scout.md` by hand out of band →
  the watcher re-projected (excerpt updated), auto-committed
  `doc edit: Scout (doc_jlzjfflk) by user`, and doctor stayed clean.

### Tests

- `apps/server` suite: **191 files, 4044 tests, all passing** (`vitest run apps/server`).
- **Falsification**: reverting the one-line validation change
  (`resolveFolder(input.folder, input.type)` → `resolveFolder(input.folder)`) turns **4** of
  the new tests red, and the tests describing pre-existing behaviour stay green. The new
  tests assert the **path**, not merely that the create succeeded.
- `eslint` and `prettier --check` clean on every touched file. `tsc --noEmit` reports the two
  pre-existing `Resident.name`-nullable errors in `threads/read.ts` and `threads/resident.ts`
  and **nothing from this change** — see Report.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Open for the orchestrator

1. **The route description is contract-owned.** `FOLDER_DESCRIPTION`
   (`packages/contract/src/schemas/doc.ts:49`) is shared by `CreateDocRequest.folder`
   **and** `MoveDocRequest.folder`, and move deliberately did **not** gain the new
   grammar — so documenting the spelling means splitting that constant, which is a
   contract-dev edit plus an `openapi.json` regeneration. Proposed create-side wording:

   > Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the
   > full prefix (`data/docs/finance`). Defaults to `inbox` — creation is inbox-first
   > (SPEC.md §10) — **except for a type that SPEC.md §7 gives its own document root**,
   > which is where an omitted `folder` files it: a `type: agent-def` document lands in
   > `.claude/agents/`. Such a root may also be named outright, by its exact declared
   > path (`.claude/agents`), and a root named that way must match the type it holds.
   > An explicit folder always wins, so `folder: "inbox"` still files an `agent-def`
   > under `data/docs/` as a document *about* a persona.

   The move-side wording is today's text unchanged.

2. **Pre-existing red typecheck, not from this issue.** `npm run typecheck -w apps/server`
   fails on `src/threads/read.ts:94` and `src/threads/resident.ts:179` — the contract now
   models a *general resident* (`Resident.name: string | null`, request `name` optional,
   `routes/thread-resident.ts`) and the server has not consumed it. `apps/cli` fails the
   same way at `src/commands/agents.ts:154`, which breaks `npm run build`. Both were
   present before this change and are untouched by it.

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-122]` prefix
