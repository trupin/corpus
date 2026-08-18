# [SERVER-127] A bare `.claude/skills/SKILL.md` is addressable and loaded by nothing

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-125
- Blocks: — (pinned in the meantime, see below)
- Related: UI-123, whose derived parity fixture found it

## Spec References

- SPEC.md **§7** line 399 — the skill root, `.claude/skills/<name>/SKILL.md`
- SPEC.md **§8** — `/<skill-name>` applies that skill to the context

## Summary

SERVER-125 removed off-root agent-defs and skills from the mention index, on the
principle that **a document Claude Code cannot load must not be addressable**.
One shape slips through that gate: a `SKILL.md` sitting directly in
`.claude/skills/`, named by no directory.

Found by UI-123's PR #50 review response, when the parity fixture was rederived
from `DOCUMENT_ROOTS` instead of being hand-written. The hand-written fixture had
not contained this shape. That is the finding behind the finding: the derived
fixture immediately produced a case nobody had thought of.

## Why the kit is right and the server is wrong

Claude Code names a skill by **the directory holding it**. A `SKILL.md` named by
no directory is loaded by nothing — which is SERVER-125's own gate condition. The
server's own docblock spells the shape as `.claude/skills/<name>/SKILL.md`.

The kit's regex requires a directory segment and answers `null`. The server's
`invocableName` returns `"SKILL.md"`, so `targetIndex` indexes the row as
addressable.

## It is not cosmetic, and the reason is the title alias

`SKILL.md` is untypeable — the mention token charset excludes `.` — so the
invocable alias alone would be harmless. **The title alias is not.**
`titleFromPath` falls back to the parent directory, so an untitled bare
`SKILL.md` indexes under the title `skills`.

Measured in the parity test: `parseMentions(db, "/<title>")` returns that
document as a **resolved skill**. So the server wakes the agent for a directive
naming a skill nothing loads.

And ties break by `doc_*` id order, which is random. **A bare `SKILL.md` can take
a real skill's key** — the same name-theft SERVER-125 was chosen to close, in a
shape that change did not reach.

## Acceptance Criteria

- [x] `invocableName` returns `null` when the `skill-tree` remainder carries no
      directory segment
- [x] The document stays **projected** — listed, readable, editable. Only its
      addressability goes, exactly as SERVER-125 decided
- [x] `parseMentions` resolves neither the invocable name nor the title alias for
      such a row
- [x] The pin UI-123 left behind is **deleted by whoever fixes this**, not worked
      around. `BARE_SKILL_PATHS` in `scripts/mention-offer-parity.test.ts`, its
      two describing blocks, and the agreement test's exclusion all come out
      together
- [x] The derived fixture then covers the shape with no exclusion, so a
      regression fails

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/mentions.ts` — `invocableName`
- `scripts/mention-offer-parity.test.ts` — remove the pin and its exclusion

### Key Implementation Details

**The pin is designed to fail when you fix this.** UI-123 left two tests that
assert the *current, wrong* behaviour, plus an exclusion in the agreement test.
Its author verified that temporarily fixing the server turns 5 tests red. That is
the pin working, not a regression — delete it rather than adapting it.

Read SERVER-125's reasoning before changing the gate. The principle it settled is
that addressability follows what a reader can load, and this is the same
principle applied to a shape it missed.

### Edge Cases

- `.claude/skills-archived/SKILL.md` — the same shape under the archived root
- A bare `SKILL.md` **with** a real `title:` in its frontmatter, so the fallback
  never fires. It is still loaded by nothing
- A legitimate `.claude/skills/<name>/SKILL.md` must keep working — this is the
  ordinary case and the whole skill surface depends on it

## Testing Strategy

The derived parity fixture already generates the shape. Falsify by restoring the
old `invocableName` and confirming the specific bare-`SKILL.md` cases go red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Hand-write `.claude/skills/SKILL.md` with no `title:`
3. Post `/skills` in a real thread; confirm the queue event resolves it to
   nothing and reports it unresolved
4. Confirm a real `.claude/skills/<name>/SKILL.md` still resolves
5. Confirm the bare file is still listed and readable
6. Stop the server; confirm the port is free

## E2E Verification Log

Model: **Opus 5 (1M context)**, `server-dev`, 2026-08-18.

### The change

`apps/server/src/threads/mentions.ts` — `invocableName`'s `skill-tree` branch
now requires a directory segment before the filename:

```ts
if (root.shape === "skill-tree") {
  const segments = rest.split("/");
  const directory = segments.length > 1 ? segments[0] : undefined;
  return directory === undefined || directory === "" ? null : directory;
}
```

That is the whole fix. `targetIndex` already skips a row whose invocable name is
`null` *whole*, title alias included (SERVER-125), so nothing else moved; the
projector is untouched, so the row is still listed, readable and editable.

### Throwaway workspace, real server, port 8799

```
$ corpus init /tmp/s127ws
Initialized Corpus workspace at /tmp/s127ws
  installed 2 plugin skill files into .claude/skills/
$ # port forced to 8799 in .corpus/config.json (8765 is the user's live server, 5173 an ssh tunnel)
$ printf -- '---\ndescription: a loose file no directory names\n---\n\nThis skill is loaded by nothing.\n' \
    > .claude/skills/SKILL.md          # no title: — the fallback fires
$ printf -- '---\ndescription: a loose archived file\ntype: skill\ntitle: Stray\n---\n...' \
    > .claude/skills-archived/SKILL.md # a real title: — the fallback never fires
$ corpus server start
corpus 0.11.0 listening on http://127.0.0.1:8799 (pid 50783)
```

**Both are projected, and the untitled one is titled `skills` exactly as
predicted** (`GET /api/docs?type=skill&includeArchived=true`):

```
doc_skillcomment      .claude/skills/comment/SKILL.md    title="Comment"  status=open
doc_skill61c2325d     .claude/skills/todos/SKILL.md      title="todos"    status=open
doc_skill3be130a8     .claude/skills/SKILL.md            title="skills"   status=open
doc_skill8ad2c2ac     .claude/skills-archived/SKILL.md   title="Stray"    status=archived
   (8 skill rows in total)
```

**Step 3 — `/skills` resolves to nothing and wakes nobody.** A thread created
with `requestsAgent: false` (`agent: none`), then one turn per probe:

```
turn "Try /skills on this."       → 201  eventId: null           agent: none
turn "Now try /comment on this."  → 201  eventId: evt_i3cvarfcpfkc  agent: requested
```

And on an engaged thread, where the event is written whatever else is in the
body, the payload names the loose files as unresolved
(`.corpus/queue/pending/evt_jvu4xrwy2jk7.json`):

```
body       : "Real: /comment /orchestrate /converse /profile /todos — loose: /skills /Stray."
skills     : comment(doc_skillcomment), orchestrate(doc_skillorchestrate),
             converse(doc_skillconverse), profile(doc_skillprofile), todos(doc_skill61c2325d)
unresolved : /skills, /Stray
```

**Step 4 — every real `.claude/skills/<name>/SKILL.md` still resolves**: the
five above, by the name their directory encodes, including `comment` whose
Corpus title is spelled differently.

**Step 5 — the loose files are still documents.** Read and written through the
server, with the write path committing as usual:

```
GET /api/docs/doc_skill3be130a8 → 200  path=.claude/skills/SKILL.md   title="skills"
GET /api/docs/doc_skill8ad2c2ac → 200  path=.claude/skills-archived/SKILL.md  title="Stray"
PUT /api/docs/doc_skill3be130a8 → 200
  body now: "This skill is loaded by nothing.\n\nEdited through the server."
$ corpus db doctor
projection is clean — 25 documents from 25 files (4ms)
```

…and still unaddressable after the edit (a standalone thread naming `/skills`
and `/Stray`: `eventId: null`, `agent: none`).

**Step 6 — server stopped, port free:**

```
$ corpus server stop
stopped (pid 53384)
$ lsof -nP -iTCP:8799 -sTCP:LISTEN   # no output, exit 1
```

### Falsification — E2E

The rule was reverted to `rest.split("/")[0] ?? null`, the server restarted
against the *same* workspace, and the same quiet-thread probe repeated:

```
turn "Try /skills on this."  → 201  eventId: evt_b75s6wyidzu2  agent: requested
payload.skills : [{ "name": "SKILL.md", "docId": "doc_skill3be130a8", "status": "open" }]
payload.unresolved : []
```

That is the defect in one frame: a directive naming a skill nothing loads woke
the agent, and the target it named was reported as `SKILL.md`. The fix was
restored, the server restarted, and the probe returned `eventId: null`.

### Falsification — unit

With the old `invocableName` in place, **11 tests go red** across the two files
(`vitest run apps/server/src/threads/mentions.test.ts scripts/mention-offer-parity.test.ts`):

```
× the name each side derives from a path > is the same name on both sides for .claude/skills/SKILL.md
    → expected null to be 'SKILL.md'
× the name each side derives from a path > is the same name on both sides for .claude/skills-archived/SKILL.md
× the name each side derives from a path > disagrees about nothing at all, in either direction
    → expected [ '.claude/skills/SKILL.md', …(1) ] to deeply equal []
× an invocation row the menu drops > resolves under no spelling at all, its title included
    → expected { name: 'SKILL.md', …(2) } to be null
× an invocation row the menu drops > is the row the server reports as unaddressable, by name
× a SKILL.md the skills root holds directly > resolves under neither its path's fallback title nor a real one
× a SKILL.md the skills root holds directly > is an unresolved token that wakes nobody, under the archived root too
× a SKILL.md the skills root holds directly > is still a projected skill document, and says why it answers nothing
× a bare SKILL.md titled like a working skill > does not take `/comment` from the skill that answers it
× invocableName > has no invocable name for .claude/skills/SKILL.md
× invocableName > has no invocable name for .claude/skills-archived/SKILL.md
Tests  11 failed | 65 passed (76)
```

Note the two **derived** parity failures (`an invocation row the menu drops`):
those are the loop that carried the exclusion, now covering the shape with none.

### The pin, deleted rather than adapted

Out of `scripts/mention-offer-parity.test.ts`: `BARE_SKILL_PATHS`,
`isPinnedDivergence`, the whole `describe("the SKILL.md a skills root holds
directly")` with both its `it.each` blocks, the `.filter(...)` on the per-path
agreement test, and the `&& !isPinnedDivergence(row.path)` in `dropped()`. The
now-unused `parseMentions` import went with them. What remains is the derived
fixture, which asks about `${root.path}/SKILL.md` for every `skill-tree` root
(so a third such root is covered for free) and now runs it through the ordinary
dropped-row loop **with no exclusions**.

`grep -n 'BARE_SKILL\|isPinnedDivergence' scripts/mention-offer-parity.test.ts`
returns nothing.

### Edge cases

- **`.claude/skills-archived/SKILL.md`** — same shape, same answer, and the
  derivation covers it because `BARE_SKILL_PATHS`'s replacement is per-root.
  Its status is `archived`, so pre-fix it would have woken the agent *with a
  status attached* — §8's "missing or archived" path, for a skill that never
  existed.
- **A bare `SKILL.md` carrying a real `title:`** — `Stray` above. The directory
  fallback never fires, and it is still unaddressable: the gate is the path, not
  the title. Confirmed E2E (`/Stray` unresolved) and in
  `mentions.test.ts`.
- **A legitimate `.claude/skills/<name>/SKILL.md`** — unaffected, at any depth
  (`comment/reference/deep/SKILL.md` → `comment`). All five seeded skills
  resolve in the roll call above.
- **Name theft** — a new unit test seeds `.claude/skills/SKILL.md` with
  `id: doc_aaaaac`, `title: Comment` beside the real `comment` skill at
  `id: doc_zzzzzy`, so id order puts the impostor first. Pre-fix `/comment`
  answered `doc_aaaaac`; post-fix it answers `doc_zzzzzy`.
- **A degenerate `.claude/skills//SKILL.md`** — `classifyPath` admits it (the
  empty segment starts with no dot), and the pre-fix slice returned `""`, which
  `targetIndex` half-skipped. The new branch answers `null` outright. No
  enumeration produces such a path, but `invocableName` is a pure string
  function `docs/create.ts` also calls on candidate paths.

### Checks

```
vitest run apps/server scripts/mention-offer-parity.test.ts packages/kit/src/components/Autocomplete
  Test Files 196 passed (196)   Tests 4319 passed (4319)
vitest run scripts            → 17 files, 834 tests passed
npm run lint                  → clean
npm run format:check          → All matched files use Prettier code style!
npm run typecheck             → clean across all six workspaces
```

`apps/server` has no `test` script; the workspace suite was run as
`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-127]` prefix
