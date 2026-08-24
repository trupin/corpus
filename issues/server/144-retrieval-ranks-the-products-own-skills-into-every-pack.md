## Unblocked 2026-08-24 — Rider A signed, with one change

The user signed the §7 rider this issue was withdrawn for. **It is ready to be
re-implemented, and the implementation must change in one place.**

**`template` documents always rank.** The withdrawn implementation excluded
`skill`, `agent-def` **and** `template`. The signed rider excludes the first two
only, and says why: excluding what a person wrote from their own search is a
different thing from excluding what the tool installed. This issue's own text
called that loss "the accepted cost" — the user did not accept it.

So the exclusion set is:

- **`corpus search`** — `skill`, `agent-def`. Naming any `type` lifts it
  entirely. `template` is not in the set.
- **`corpus doc related`** and **the context pack** — the same two, plus `view`
  and `board`, which the signed rider keeps.

Everything else stands: the measurements, the design, the falsifications, the
`--type` gate, and the parent-block guard for a thread whose parent is a skill.
Start from the withdrawn diff (`3f5d7b47`, reverted in `05a2de9d`) rather than
from scratch, and remove `template` from `UNRANKED_DOC_TYPES`.

**The CLI help has to come back too**, and it must describe the signed rule
rather than the withdrawn one — six blocks were deleted in `05a2de9d`, and
`template` must not reappear in any of them.

# [SERVER-144] Retrieval ranks the product's own skills into every pack

## Withdrawn from v0.21.0 — 2026-08-23

**This issue was implemented, reviewed, and then withdrawn. The code is out of
the release. The diagnosis is not withdrawn, and neither is a single
measurement below.**

The implementation shipped in commit `3f5d7b47` and was removed by a surgical
revert on the same branch, `phase-44-reach-and-size`. Every file it touched is
byte-identical to its state before that commit. The `git revert` route was not
available: `3f5d7b47` carries six issues.

**Why it was withdrawn.** PR #60's reviewer found that the exclusion contradicts
SPEC.md §7 in three places, and the user confirmed each by reading the text:

- **§7 line 393** — `corpus search` is *"ranked retrieval over the whole corpus
  (documents, threads, **skills alike**)"*.
- **§7 line 402** — the context pack carries *"the most-related excerpts from
  **across the corpus**"*.
- **§7 line 406** — skills *"surface like any documents — **via search**,
  `type: skill` / `type: agent-def` filters, and a pinnable seed view"*.

Two further costs the reviewer named, both real:

- The board's ⌘K calls `GET /api/search` with no `type`. A person searching for
  words that live in their own skill got silence, and nothing on that surface
  said a default had filtered the answer.
- A `template` document is the **user's own**, not the tool's. The issue's own
  Edge Cases section called that an accepted cost. Nobody accepted it.

**The withdrawal is procedural, not technical.** SERVER-144 changed a rule
SPEC.md §7 states, and this repo's standing rule is that SPEC.md does not move
without the user's signature. The issue file carries no user decision. All
three surfaces are covered by a §7 sentence, so the exclusion was removed from
all three rather than narrowed — choosing which contradiction to tolerate is
exactly the judgment that needs the signature.

**What the next attempt should start from.** The numbers below, not a repeat of
the audit. The measurements stand: 52% of output tokens across seven retrieval
calls, the top hit for `corpus search "rate assumption 6.1%"` being the comment
skill's worked example, `doc_skillorchestrate` as the #1 neighbour of a mortgage
note, and 4 of 5 pack excerpt rows naming the agent's own instructions. The
implementation notes stand too, including the views-and-boards split and its
second argument (§9.2's filter-parity table), so a signed rider can be
implemented against a known design rather than rediscovered.

**The next attempt needs a signed §7 rider first.** The rider has to say what §7
now promises about the product's own machinery in ranked retrieval, on each of
the three surfaces, and what the board's ⌘K tells a person when a default has
narrowed their answer.

**One consequence for another domain.** `apps/cli`'s help text for `search`,
`doc related` and `thread context` describes the exclusion as shipped behaviour.
That prose is false as of this withdrawal. It is listed in the E2E Verification
Log, under *"CLI help text left false by the withdrawal"*, and is a cli-dev
change.

## Domain
server

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 9.1 — search and the semantic index
- SPEC.md Section 6 — the context pack
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Measured in the SHARED-070 audit (2026-08-23, fresh workspace, 5 user notes +
the installed template): across 7 retrieval calls (`thread context`,
`corpus search`, `doc related`), **52% of the output tokens (1,746 of 3,355)
were rows pointing at the product's own skill documents**. Concretely:

- `corpus search "rate assumption 6.1%" --limit 5` — the **top hit** was the
  comment skill's worked example (which contains that exact sentence); 3 of 5
  hits were skill documents; the actually-relevant user note ranked last.
- `corpus doc related doc_<mortgage-note> --limit 5` — the #1 related document
  for a user's mortgage note was `doc_skillorchestrate`.
- `corpus thread context` packs carried 4 of 11 excerpt rows naming
  `doc_skillcomment`, `doc_skillorchestrate`, `doc_skillconverse`,
  `doc_skillb8a2308c`.

Two costs. The token cost: ~580 tok/event of excerpts the agent must read past.
The relevance cost is worse: the skills' worked examples use realistic domain
prose (mortgages, rates, insurance, filing), so they are **honeypots** for
exactly the queries a real corpus produces, and they displace the row the agent
needed — which forces a second search. The effect is worst on small corpora,
which is every new workspace's first week.

## Acceptance Criteria

*Every box below was met by `3f5d7b47` and then unmet by the withdrawal.
They are unchecked because the code is out of the release, not because the
implementation failed them. A signed §7 rider may also change what they ask
for — the third one, on views and boards, is the decision the rider has to
make.*

- [ ] Documents of type `skill`, `agent-def` and `template` are excluded from
      default ranking in `corpus search`, `corpus doc related`, and the context
      pack's related-excerpts section.
- [ ] They remain fully retrievable when asked for: `corpus search --type skill`
      (already the skill-genesis path in the comment skill) still finds them,
      and `doc show`/`doc related` on a skill id still works.
- [ ] A thread whose **parent** is a skill document still gets that skill as
      its parent block in the pack — the exclusion is about ranking neighbours,
      never about the document the conversation is on.
- [ ] Whether seed views/boards (`type: view`, `type: board`) join the
      exclusion is decided and stated — **they join it on the two neighbour
      surfaces and not on `corpus search`.** See below.
- [ ] Re-run the audit's probe in a fresh workspace: the three calls above
      return user documents only, and the pack for an anchored comment on a
      mortgage note carries no `doc_skill*` row.

## Technical Design

### Files to Create/Modify
- `apps/server/src/` — ranking/query layer for search, related, and the pack
  builder (locate via the SPEC §9.1 implementation; likely shared candidate
  filtering)

### Key Implementation Details
Prefer one shared exclusion predicate over three copies. This is a ranking
default, not an index change — the documents stay indexed so `--type skill`
costs nothing extra. If the pack builder and search share candidate generation,
one filter covers all three verbs.

### Edge Cases
- `corpus search --type skill` and any explicit `--type` naming an excluded
  type bypasses the exclusion entirely.
- A workspace where the *user* writes documents of type `template` — the
  exclusion is by type, and that is the accepted cost; state it in the help
  text of `search` if help mentions ranking.
- The comment skill's genesis flow (`corpus search "<pattern>" --type skill`)
  must keep working unchanged.

## Testing Strategy
Server unit tests on the ranking layer: a corpus with one skill doc and one
note sharing a phrase ranks the note only by default, both under `--type`.
Pack-builder test: excerpt rows never name excluded types.

## E2E Verification Plan
Fresh `corpus init` workspace, seed one mortgage note, `corpus search "rate
assumption"` — expect no `doc_skill*` row without `--type skill`, and the note
first.

### Reproduction Steps (bugs only)
1. `corpus init` scratch workspace; `corpus server start`
2. Create a note containing "The working rate assumption is 6.1%"
3. `corpus search "rate assumption 6.1%" --limit 5`
4. Expected: the note first, no skill rows
5. Actual (2026-08-23, v0.19.0): `doc_skillcomment` first, 3/5 rows are skills

### Verification Steps
1. Restart server after the change, re-run the reproduction
2. Expected: user documents only; `corpus search "rate" --type skill` still
   returns the skills

## E2E Verification Log

**Model: Opus 5 (1M context).**

### Reproduction (bugs only)

Real server, fresh `corpus init` workspace at `scratchpad/ws142` on port 8791,
the installed template plus a note reading *"The working rate assumption is 6.1%
for the refinance."* — the audit's own sentence.

```
$ corpus search "rate assumption 6.1%" --limit 5
doc_skillcomment      Worked examples            …Rates > 6.1% ## Rates The working rate assumption is 6.1% as…
doc_vtqkgiud          Refinance                  The working rate assumption is 6.1% for the refinance. We should…
doc_skillorchestrate  Reflecting on a user edit  …6.1% for the whole term corpus search "rate assumption 6.1…
doc_skillconverse     Worked example             …doc_5c8b2f]] with the 6.4% rate assumption CORPUS_EOF corpus queue…

$ corpus doc related doc_vtqkgiud --limit 5
doc_skillorchestrate  similar  ## Purpose and when to run You are this workspace's **general** agent…
doc_skillcomment      similar  ## When this runs The orchestrate skill invokes you for two event types…
doc_ccogoxhj          similar  Base. Plain out-of-band edit, twice.
doc_skillb8a2308c     similar  # Simplified Technical English (ASD-STE100)…
```

The top hit is the comment skill's worked example, 3 of 4 search rows are
machinery, and the #1 related document for a mortgage note is
`doc_skillorchestrate`. Exactly as filed.

**And the pack**, on an anchored comment on that note, captured from the running
server with the fix's SQL fragment temporarily neutered:

```
# related excerpts
doc_skillcomment      Worked examples          similar  ## Worked examples **1 — Anchored comment that edits the parent.** …
doc_skillorchestrate  Reflecting on a user edit similar  ```bash corpus doc show doc_a1b2c3 …
doc_skillb8a2308c     Simplified Technical English (ASD-STE100) similar  ## When to Use This Skill …
doc_skillconverse     Worked example           similar  Nothing is held, so there is nothing to reconcile …
doc_ccogoxhj          Mortgage                 similar  Base. Plain out-of-band edit, twice.
```

**4 of 5 excerpt rows are the agent's own instructions, quoted back to it at
length.** The audit measured 4 of 11 on a bigger corpus.

### The change — one fragment, three surfaces

`apps/server/src/docs/filters.ts` gains `UNRANKED_DOC_TYPES`,
`UNRANKED_NEIGHBOUR_DOC_TYPES` and the two fragments `rankableSql` /
`rankableNeighbourSql`, written beside `notArchivedSql` for the reason that file
already argues: the three surfaces reach `documents` three different ways and
must exclude the same rows.

- **`GET /api/search`** — one line in `searchCorpus`, pushed onto
  `compiled.conditions` **after** `compileFilters` returns. Not inside
  `compileFilters`, because that builder also serves `GET /api/docs`, where a
  board that stopped listing its own views would be a worse bug. Pushing it
  before `whereClause` and `scopeOf` are read means it reaches the lexical
  statement and the vector scan from one line, so §9.2's "the same set, with the
  same semantics" still holds across the hybrid.
- **`GET /api/docs/{id}/related`** — folded into the fragment that already
  carried the archived default, so both halves stay one set.
- **The context pack** — the same, in `relatedExcerpts`'s two coordinated sites.

The gate on search is **"did the caller name a type at all"**, not "did they name
an excluded one": naming a type is the caller saying what they are after, and a
default underneath it could only subtract from the answer. `--type skill` — the
comment skill's genesis path — is untouched.

### The decision the issue asked for: views and boards

**They join the exclusion on `doc related` and the context pack. They do not on
`corpus search`.** The difference is the difference between the two questions:

- `corpus search` asks **"where is this said?"** A board or a view the user named
  and can open is a real answer to a lookup, so search keeps them.
- `doc related` and the pack ask **"what else bears on this?"** A stored query
  bears on nothing — it has no prose — so a hit on one is a title collision
  dressed as a neighbour. The audit's `doc_seedattention` / `doc_seedinbox`
  complaint was specifically about them ranking *into packs*.

`skill`, `agent-def` and `template` are excluded on all three, which is the set
the issue required.

Two things this deliberately does **not** do. The documents stay **indexed** —
this is a ranking default, not an index change, so `--type skill` costs nothing
extra. And nothing was added to the contract: `doc related` and the pack take no
`type` parameter, so their exclusion is unconditional. Giving `related` an
override would be a contract change and is not asked for here.

### Post-Implementation Verification — same server, restarted

```
$ corpus search "rate assumption 6.1%" --limit 5
doc_vtqkgiud  Refinance  The working rate assumption is 6.1% for the refinance. We should…

$ corpus search "rate assumption" --type skill --limit 5
doc_skillcomment      Worked examples            …"Mortgage rates?" becomes "Mortgage rate assumptions…
doc_skillorchestrate  Reflecting on a user edit  …where the rate assumption…
doc_skillconverse     Worked example             …the rate assumption to be written down where…

$ corpus doc related doc_vtqkgiud --limit 5
doc_ccogoxhj  similar  Base. Plain out-of-band edit, twice.

$ corpus doc show doc_skillcomment
Comment
doc_skillcomment · skill · open

$ corpus thread context th_tpqpwqgo
parent doc_vtqkgiud · Refinance · Refinance
> rate assumption is 6.1%
…
# related excerpts
doc_ccogoxhj  Mortgage  similar  Base. Plain out-of-band edit, twice.
```

One user row where there were five, four of them machinery. `--type skill` and
`doc show` on a skill are unchanged.

### Tests, and every one of them falsified

Eight new tests across the three surfaces. Each was broken on purpose and watched
to fail, restoring the source afterwards:

| mutation | red |
| --- | --- |
| `excludesTypes` returns `1 = 1` | the three exclusion assertions, one per surface |
| the `query.type === undefined` gate dropped from search | `returns them all when a type is named`, `defers to any explicit type` |
| search switched to the **neighbour** list | `ranks the note and drops the skill…`, `keeps a view…` |

Two are guard tests — `doc related` on a skill as the **subject**, and a thread
whose **parent** is a skill still getting its parent block — and they pass under
every mutation above by design: they assert what must not regress, and both are
reached by id rather than through the candidate query.

### Scoped runs

```
VITEST_MAX_THREADS=4 vitest run \
  apps/server/src/search apps/server/src/docs/related.test.ts \
  apps/server/src/docs/query.test.ts apps/server/src/docs/write-fixture.test.ts \
  apps/server/src/threads/context.test.ts apps/server/src/git \
  apps/server/src/watcher/commit-out-of-band.test.ts \
  apps/server/src/queue/routes.test.ts apps/server/src/json-body.test.ts \
  apps/server/src/semantic
  Test Files  46 passed (46)
       Tests  921 passed (921)     exit 0
```

**The full `apps/server` run is red for a reason that is not this issue**, and it
must not be read as one: `packages/contract` gained `Resident.designationId`
(CONTRACT-071) from another agent mid-session, and `apps/server` has no matching
change yet. 110 failures across nine files, every one of them resident- or
roster-shaped, and `tsc` reports it directly — `designationId is missing in type`
in `core/resident.test.ts`. Escalated to the orchestrator.

### An intermediate decision worth recording

The first attempt excluded `view` and `board` on **all three** surfaces. That
turned 13 tests red in `search.test.ts` — the §9.2 filter-parity table
(TEST-674), which asserts `/api/search` and `GET /api/docs` select the same
documents for a filter, and the Phase A byte-stability snapshots. Every failure
named `doc_view`. Splitting the lists made those tests correct again without
weakening anything the issue required, which is a second argument for the split
beyond the one about questions: it keeps §9.2's parity promise intact.

### For another domain

`apps/cli/src/commands/search.ts`'s help text discusses ranking at length
(lines 72, 81–84, 118) and now under-describes it: it does not say that
retrieval's default ranking omits the workspace's own machinery. That is a
cli-dev change and is not made here.

### The withdrawal — 2026-08-23, same branch, same model (Opus 5, 1M context)

Everything above this heading is the record of the implementation. Everything
below is the record of taking it out.

**What was removed.** Eight files, back to their pre-`3f5d7b47` bytes:

| file | what came out |
| --- | --- |
| `apps/server/src/docs/filters.ts` | `UNRANKED_DOC_TYPES`, `UNRANKED_NEIGHBOUR_DOC_TYPES`, `excludesTypes`, `rankableSql`, `rankableNeighbourSql` (-63 lines) |
| `apps/server/src/docs/index.ts` | the four re-exports of those symbols |
| `apps/server/src/docs/related.ts` | the `rankable` fragment, both call sites back to `notArchivedSql` alone, and the import |
| `apps/server/src/search/search.ts` | the `query.type === undefined` condition push, its comment block, and the import |
| `apps/server/src/threads/context.ts` | `rankableNeighbourSql` from the semantic scope and from `LINKED_SQL`, its doc paragraph, and the import |
| `apps/server/src/search/search.test.ts` | the 4-test describe (-81 lines) |
| `apps/server/src/docs/related.test.ts` | the 2-test describe (-58 lines) |
| `apps/server/src/threads/context.test.ts` | the 2-test describe, and `afterAll`/`beforeAll` back out of the vitest import (-75 lines) |

No test was weakened to keep it alive. The eight tests were deleted whole,
because each asserted the exclusion and would have asserted nothing without it.
No dead code and no orphaned export remain: `git diff 3f5d7b47^` over all eight
files is empty, and `grep` for `UNRANKED`, `rankable` and `excludesTypes` across
`apps/`, `packages/` returns nothing.

**Nothing needed restoring.** The §9.2 filter-parity table was *not* adjusted
around the exclusion. Its 13 tests went red against the first attempt, which
excluded `view` and `board` on all three surfaces, and the shipped split made
them green again without editing them — the commit's numstat shows
`search.test.ts` at `81 insertions, 0 deletions`. The single deletion anywhere
in the three test files was `context.test.ts`'s vitest import line, restored
above.

**Verification.**

```
npm run build                                      exit 0
npm run typecheck                                  exit 0   (5 workspaces)
npm run lint                                       exit 0   (no rule disabled)
prettier --check <the 8 files>                     all match

VITEST_MAX_THREADS=4 vitest run apps/server
  before   Test Files 204 passed (204)   Tests 4611 passed (4611)   exit 0
  after    Test Files 204 passed (204)   Tests 4603 passed (4603)   exit 0
```

4611 - 4603 = 8, exactly the eight tests SERVER-144 added. No file count moved,
so nothing was orphaned into an empty suite, and no other test changed verdict.

**E2E, real server, real workspace.** Fresh `corpus init` at `scratchpad/ws144`
on port 8793 (never 8765), the installed template plus the audit's own note.
All three surfaces are back to the behaviour §7 describes:

```
$ corpus search "rate assumption 6.1%" --limit 5
doc_skillorchestrate  Reflecting on a user edit  …6.1% for the whole term corpus search "rate assumption 6.1…
doc_rtpqdhz5          Refinance                  The working rate assumption is 6.1% for the refinance. We should…
doc_skillcomment      Reply                      …edited [[doc_a1b2c3]] — rate assumption 6.1% to 6.4%"], ["thread","reply…
doc_skillconverse     Worked example             …doc_5c8b2f]] with the 6.4% rate assumption CORPUS_EOF corpus queue…

$ corpus search "rate assumption" --type skill --limit 5
doc_skillorchestrate · doc_skillcomment · doc_skillconverse      (unchanged)

$ corpus doc related doc_rtpqdhz5 --limit 5
doc_skillorchestrate · doc_skillcomment · doc_skillb8a2308c · doc_skillconverse

$ corpus thread context th_gaguzdtn
# related excerpts
doc_skillorchestrate · doc_skillcomment · doc_skillconverse
```

This is the *pre-fix* reproduction reproducing again, which is the correct
outcome of a withdrawal and not a regression: it is the state v0.20.0 shipped,
and it is what §7 lines 393, 402 and 406 currently promise. The server was
stopped and port 8793 confirmed free afterwards.

### CLI help text left false by the withdrawal

A cli-dev agent documented the exclusion as shipped behaviour in three help
strings. Every line below is now false and belongs to cli-dev. This server
change touched none of them.

| file | lines | what is false |
| --- | --- | --- |
| `apps/cli/src/commands/search.ts` | 74-84 | *"The ranking hides the tool's own machinery by default"*, the three type names, the `3 of 5 hits` measurement, and *"Naming any `--type` turns that default off entirely"* |
| `apps/cli/src/commands/search.ts` | 85-89 | *"Views and boards are kept, deliberately"* — the whole paragraph, including its claim that the neighbour surfaces drop `view` and `board` |
| `apps/cli/src/commands/search.ts` | 135 | example description: *"Naming `--type` at all also lifts the default that hides `skill`, `agent-def` and `template` documents"* |
| `apps/cli/src/commands/search.ts` | 140 | example description: *"How to reach the installed skills, which the default ranking hides"* — the `--type skill` example itself stays valid, only the reason given for it is false |
| `apps/cli/src/commands/doc/related.ts` | 76-86 | *"Five document types are never neighbours"* — the whole paragraph |
| `apps/cli/src/commands/thread/context.ts` | 244-250 | *"The excerpts leave out five document types"* — the whole paragraph |

`docs/cli.md` carries the same three paragraphs at lines 360, 1254 and 2362. It
is generated (`npm run docs:cli -w apps/cli`), so it corrects itself once the
help strings are edited. Nothing in `assets/workspace/` describes the exclusion,
so the product agent's skills need no change.

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
