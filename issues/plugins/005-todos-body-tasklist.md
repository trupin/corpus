# [PLUGINS-005] Todos items move into the body as GFM task-lists

## Domain
plugins

## Status
in_progress

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-005
- Blocks: PLUGINS-006, PLUGINS-007

## Spec References
- SPEC.md §12 as amended by SHARED-005 (pending sign-off)

## Summary
First implementation leg of the PLUGINS-003 design (full analysis in
issues/plugins/003-item-level-commenting.md): `plugins/todos/server/items.ts` becomes a
body task-list parser/serializer (GFM `- [ ]` / `- [x]` lines) replacing the
`extra.items` array; the plugin routes recompute the body under the existing atomic
`mutateDoc` seam; CLI surfaces (`corpus todos …`) unchanged in shape; migration for
existing `extra.items` documents (policy decided at implementation per the design's
open question 4: bulk `corpus todos migrate` vs migrate-on-first-write — decide,
justify) plus tolerant reads mid-transition; seed template updated. Per-item `due` and
`ts` handling per SHARED-005's signed answers (design open questions 1 and 5).

## Acceptance Criteria
- [x] Parser/serializer round-trips the body byte-stably for untouched lines
- [x] All existing todos routes/CLI verbs behave identically against body-backed items (parity tests updated, not deleted)
- [x] Migration policy implemented + tested; mixed-format reads tolerated per the design
- [x] Lost-update protections preserved (mutateDoc; expectedText guards against body lines)

## Technical Design
See issues/plugins/003-item-level-commenting.md — Candidate 3 (chosen).

## Testing Strategy
plugins/todos scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (job tmp dir, subshell-cd/--workspace from outside the repo, ports 9180-9199, never 8765): full CLI round-trip on body-backed lists; migration drill.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M). 2026-07-30. Scratch prefix
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins005-*`; server port `9180`; every
command run from `.../s017-plugins005-ws-uMFoCC`, a cwd **outside** this repository.

### The migration decision (TEST-486, Adjudication 4)

**Chosen: a bulk `corpus todos migrate` verb *plus* automatic conversion on the first plugin write,
with tolerant reads until both have converged.** Rejected: migrate-on-first-write alone, and
read-both-forever (which the contract forbids outright).

- **What a user with existing todo documents experiences.** Nothing, until they look. Every read
  path — `corpus todos list`, `GET /lists`, the DocPanel, the routes — answers from the legacy
  `extra.items` key for as long as it is there, so no list ever appears empty or duplicated
  (drilled below: two body-backed and three legacy documents listed side by side, correct counts,
  no duplication).
- **Why not migrate-on-first-write alone.** It converges only for documents someone writes to
  again. After PLUGINS-006 the todo document renders in the **core editor, which renders the
  body** — so a legacy document nobody writes to would show a blank list forever while its items
  sit invisibly in frontmatter. That is silent data hiding, and it is exactly the "permanently
  ambiguous aggregate surface" harm the design names. A verb the user can run once, that says what
  it changed, removes that state deterministically.
- **Why also on first write.** The verb alone leaves a window in which a document can be written
  while still legacy. Folding the legacy list into the body *inside the same `mutateDoc` patch* as
  the write means a written document is never in a state where the two representations exist
  together — one patch, one commit, no half state (`items.ts`'s `planWrite` + `routes.ts`'s
  `mutateItems`).
- **When convergence completes.** At the first `corpus todos migrate`, for every todo document in
  the workspace **including archived ones** (the migrate route pages `includeArchived=true`;
  `GET /lists` deliberately keeps core's default exclusion). Before that, per document, at its
  first write.
- **Residual keys (TEST-489).** None: a migrated document carries `extra: {items: null}` in the
  same patch, which is the server's RFC 7386 removal. Proven on disk below —
  `/usr/bin/grep -rn "^items:" data/docs/` finds nothing after migration.
- **Two states nothing can convert safely are refused, never guessed.** A legacy key that does not
  parse (a hand-edit) and a document carrying items in **both** places. Both are refused with a
  message naming the fix; `migrate` reports them as conflicts with the reason and leaves the file
  byte-identical. Drilled below.
- **Idempotence.** A second `corpus todos migrate` writes nothing and prints
  `nothing to migrate — 5 todo lists already store items in the body.`

### Drill (real server on 9180, real workspace outside the repo)

```
$ cd /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins005-ws-uMFoCC && pwd
/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins005-ws-uMFoCC
$ node $REPO/apps/cli/dist/bin/corpus.js init --port 9180
Initialized Corpus workspace at …  port 9180, token in .corpus/config.json (mode 600)
  installed 1 plugin seed template into data/docs/templates/
$ corpus server start
corpus 0.0.0 listening on http://127.0.0.1:9180 (pid 35168)
```

**TEST-490 — the seed template ships starter items, and `doc create` uses them.**

```
$ corpus doc create --type todo --title "Week of Jul 20" --folder todos
created doc_5mfkq5jq — data/docs/todos/week-of-jul-20.md
$ cat data/docs/todos/week-of-jul-20.md
… evergreen: false
---

## What this list is for

- [ ] First thing to do
- [ ] Something with a deadline (due: 2026-12-31)

## Notes
```

**TEST-475 / TEST-479 — the format is what the spec says, and `--due` round-trips.**

```
$ corpus todos add "Week" "Renew passport" --due 2026-08-01 --from agent
added item 3 to Week of Jul 20 [doc_5mfkq5jq] — Renew passport
# on disk:  - [ ] Renew passport (due: 2026-08-01)
$ corpus todos list "Week" --json
{"lists":[{"docId":"doc_5mfkq5jq",…,"items":[{"text":"First thing to do","done":false},
{"text":"Something with a deadline","done":false,"due":"2026-12-31"},
{"text":"Renew passport","done":false,"due":"2026-08-01"}]}]}
$ corpus todos add "Week" "Nope" --due nonsense
corpus: item.due: must be an ISO calendar date (YYYY-MM-DD)          # exit 1
```

*One deliberate message change*: the shipped refusal read `items[0].due: …`. The `items` key no
longer exists, so naming it would be a lie; the rule, the pattern (`ISO_DATE_PATTERN`), the status
and the exit code are unchanged. Recorded here rather than filed, per TEST-485's "identical in
shape".

**TEST-476 — everything the plugin did not touch is byte-identical.** A document with prose
carrying trailing spaces, two groups of items, a heading, and a fenced block containing a
task-item lookalike; one item checked *as a different actor* so §4's 30 s squash window cannot fold
the commits:

```
$ corpus todos check "Rich" 1 --from agent
$ git diff HEAD~1 HEAD -- data/docs/todos/rich-list.md
-updated: 2026-07-30T20:58:21Z
+updated: 2026-07-30T20:58:29Z
-- [ ] Book the passport appointment (due: 2026-08-01)
+- [x] Book the passport appointment (due: 2026-08-01)
```

Exactly one body line, plus core's own `updated` stamp. Proven byte-exactly rather than by eye:

```
$ git show HEAD~1:…/rich-list.md | grep -v '^updated:' | perl -pe 's/^- \[ \] Book/- [x] Book/' | md5
726b5ff1d3f3094ac3bcddf85ab9e2a2
$ /usr/bin/grep -v '^updated:' data/docs/todos/rich-list.md | md5
726b5ff1d3f3094ac3bcddf85ab9e2a2
$ /usr/bin/grep -n ' $' data/docs/todos/rich-list.md
14:Some prose before the list, with trailing spaces.
$ tail -c 20 …/rich-list.md | od -c   →  … s   e   .  \n     (final newline intact)
```

**TEST-477 — the fenced lookalike is not an item.**

```
$ corpus todos list "Rich" --json
… "items":[{"text":"Book the passport appointment",…},{"text":"Send the signed form","done":true},
{"text":"Call the plumber","done":false}]      # "this is an example, not an item" absent
```

**TEST-488 — a mixed workspace reads correctly.** Three legacy documents written straight to disk
(the shape a pre-PLUGINS-005 workspace has), picked up by the watcher, beside two body-backed ones:

```
$ corpus todos list
Rich list [doc_ayhp2wop] — 1 open · 2 done
Week of Jul 20 [doc_5mfkq5jq] — 2 open · 1 done
Legacy with a done item [doc_legacydone1] — 1 open · 1 done
Legacy with a due date [doc_legacydue01] — 2 open · 0 done
Legacy with checkbox-like text [doc_legacytrick] — 1 open · 1 done
```

**TEST-487 / TEST-489 — migration loses nothing, and leaves no residue.**

```
$ corpus todos migrate --from user
migrated Legacy with a done item [doc_legacydone1] — 2 items moved into the body
migrated Legacy with a due date [doc_legacydue01] — 2 items moved into the body
migrated Legacy with checkbox-like text [doc_legacytrick] — 2 items moved into the body
3 migrated · 0 skipped · 2 already migrated
$ corpus todos migrate --from user
nothing to migrate — 5 todo lists already store items in the body.

# on disk, after (prose preserved, order preserved, `due` inline, `done` preserved):
- [ ] Renew passport (due: 2026-08-01)          - [x] Send the signed form
- [ ] Call plumber                              - [ ] Still open
- [ ] explain - [ ] and - [x] syntax
- [x] - [ ] leading lookalike

$ /usr/bin/grep -rn "^items:" data/docs/
(no hits — the key is gone everywhere)
$ corpus todos list "Legacy with checkbox-like text" --json
… "items":[{"text":"explain - [ ] and - [x] syntax","done":false},
{"text":"- [ ] leading lookalike","done":true}]     # round-trips, never split or escaped away
$ corpus db doctor
projection is clean — 14 documents from 14 files (1ms)
$ corpus doc check
checked 14 documents — no findings.
```

**The two refusals, live.**

```
$ corpus todos check "Items in both places" 1
corpus: doc_bothplaces1 carries items in its body *and* in its `items` frontmatter, and was not
written — remove whichever list is stale before writing to it            # exit 1
$ corpus todos migrate --from user
skipped Items in both places [doc_bothplaces1] — … not written — remove whichever list is stale …
0 migrated · 1 skipped · 5 already migrated
$ /usr/bin/grep -c "from frontmatter" data/docs/todos/both.md
1                                                    # the file is untouched
```

**TEST-482 / TEST-483 — the five shipped routes, unchanged in shape, guard intact.**

```
$ curl … /api/x/todos/lists/doc_legacydue01
{"docId":"doc_legacydue01",…,"open":2,"done":0,"items":[{"text":"Renew passport","done":false,"due":"2026-08-01"},…]}
$ curl -X PUT … -d '{"done":true,"expectedText":"Something else"}' …/items/0
status=409  {"code":"conflict","message":"item 0 is now “Renew passport”, not “Something else” — it
changed under you; nothing was written"}
$ curl -X PUT … -d '{"done":true,"expectedText":"Call plumber"}' …/items/1
{"docId":"doc_legacydue01","index":1,"item":{"text":"Call plumber","done":true}}
$ curl -X POST … -d '{"text":"temporary"}' …/items      →  201 {"…","index":2,"item":{…}}
$ curl -X DELETE … -d '{"expectedText":"temporary"}' …/items/2  →  {"…","removed":{"text":"temporary","done":false}}
```

**TEST-481 — order is body order and a toggle cannot move it.** `check` → `uncheck` restores the
document byte-for-byte (asserted in `routes.test.ts`, "flips `done` and leaves the body otherwise
byte-identical"), and live: `corpus todos check "…" 1 --uncheck` left both items in their original
positions.

**TEST-484 — the lost-update property.** Re-proved against body storage in
`server/routes.test.ts`'s "interleaved mutations of one list": four concurrent appends each land at
their own index, two concurrent toggles both survive, and a toggle racing a delete 409s instead of
resurrecting the deleted item. The fake context still models the write lane and the git-commit
window, which is what makes those interleavings reachable at all.

### TRANSITIONAL → PLUGINS-007 (Adjudication 8 — the named exception)

Bodies do not ride list rows, so both row surfaces read an empty item list for a **migrated**
document. No test was deleted or weakened; the transitional behavior is asserted explicitly, in two
new blocks named `… (TRANSITIONAL → PLUGINS-007)`, so PLUGINS-007 has a one-for-one list:

1. `plugins/todos/ui/TodosColumn.test.tsx` → `"shows its empty state for a workspace whose lists
   are full"` and `"groups nothing for a row that carries no extra.items"`.
   **Originals to restore, verbatim from the block above them:**
   `expect(groups()).toEqual(["doc_week", "doc_house"])` and
   `expect(itemTexts()).toEqual(["Renew passport", "Pull credit reports"])` (from *"aggregates open
   items across documents, grouped by their list"*), and `groupOpenItems` answering
   `[{ docId: "doc_a", title: "A", items: [{ text: "open", done: false }] }]` (from *"keeps only
   open items and drops documents with none"*) — for documents whose items are in the **body**.
2. `plugins/todos/ui/TodoListItem.test.tsx` → `"renders no item preview and no due badge for a
   migrated document"`.
   **Originals to restore:** `expect(previews()).toEqual(["one", "two", "three"])` plus the
   `+1 more` count (from *"previews the first three items with their checkboxes"*), and the `N due`
   badge (from *"badges the number of open items carrying a deadline"*) — for a body-backed
   document.

Both source files carry a `TRANSITIONAL → PLUGINS-007` paragraph in their docstring pointing here.
The existing legacy-fixture tests in both files stay green **unchanged** — they now cover the
pre-migration read path, which is still real.

### Blast radius (TEST-493) and generated artifacts

```
$ git status --porcelain | grep -v '^ M apps/\|^ M packages/\|^ M assets/\|^ M issues/'
 M plugins/todos/**  (25 files)          ?? plugins/todos/cli/commands/migrate.ts
$ git diff --stat -- SPEC.md packages/contract packages/kit apps/ui
(empty)
```

`apps/server`, `apps/cli`, `assets/` and `package-lock.json` are dirty from the **other agents**
working this branch concurrently (SERVER-032/037, CLI-012/016/017) — nothing in them is mine.

**`docs/cli.md` is NOT regenerated in this commit, deliberately — orchestrator action required.**
`corpus todos migrate` is a new verb, so the file must move (TEST-485/489). Regeneration was run and
verified (`npm run docs:cli -w apps/cli` → `generated ../../docs/cli.md`) and the todos section came
out exactly right — the full section is captured at
`…/s017-plugins005-ypzePm/cli-md-migrate-section.txt`, the whole diff at `…/cli-md-regen.diff`.
**But this branch's working tree already carries CLI-016's `--extra` and CLI-017's `doc unarchive`**,
so the regenerated file contained their documentation too. Committing that would be a hand-merged
generated file by another name (Adjudication 20 forbids exactly this), so `docs/cli.md` was restored
byte-for-byte from a pre-run copy (`git diff --stat docs/cli.md` → empty) and the regeneration is
left to the harvest run TEST-579 already schedules.

### Machine hygiene

```
$ corpus server stop                         → stopped (pid 35168)
$ lsof -nP -iTCP:9180 -sTCP:LISTEN           → (free)
$ lsof -nP -iTCP:8765 -sTCP:LISTEN           → (nothing bound — as at contract time; never proxied)
$ ls -d /Users/theophanerupin/code/corpus/.corpus
ls: /Users/theophanerupin/code/corpus/.corpus: No such file or directory
```

No `git` state-changing command was run in this repository. No Vite dev server was started by this
issue. Ports `9192`/`9194` stayed bound throughout — they are SERVER-032's and SERVER-037's, and
were left alone.

### Tests

`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run plugins/todos` → **10 files, 232 tests, all
passing** (was 220). `npm run build`, `npm run typecheck` and `npm run lint` green;
`npx prettier --check plugins/todos` clean.

### Notes for the reviewer

- **`ts` is gone** (TEST-480). `/usr/bin/grep -rnE "(^|[^a-zA-Z])ts:" plugins/todos --include="*.ts"
  --include="*.tsx" | grep -v dist/ | grep -v '\.test\.'` → **no hits**. The 13 remaining hits are
  all test fixtures that deliberately build *pre-migration* documents. React keys are now
  `index:text`.
- **TEST-491**: `validate` reads the whole `Doc` through `docSource(doc)`; `git diff packages/kit`
  is empty and the kit signature `(doc: Doc) => readonly string[]` was not touched.
- **TEST-492**: `imports.test.ts` is **unmodified** (`git diff --stat` empty) and green;
  `TextQuoteSelector`, `resolveAnchor` and `selectorFromSelection` appear in no non-test plugin
  file (`/usr/bin/grep -rln` per symbol → nowhere).
- **One route and one verb added**, both migration-only: `POST /api/x/todos/migrate` and
  `corpus todos migrate`. The five shipped routes and the three shipped verbs are unchanged.
- **`TodoDocPanel` was re-pointed at the body** here rather than in stage B: it is named by neither
  Adjudication 6 list, and TEST-496 requires the panel to survive PLUGINS-006 intact.
- **Deleted with the code they tested**, not to reach green: `serializeItems`' test (the function no
  longer exists — nothing serializes to frontmatter) and the `items[0].ts` validation cases (the
  field no longer exists). Everything else was rewritten fixture-by-fixture, per TEST-482.
- **Known and accepted**: an item whose *text* ends in something that parses as the due marker
  (`corpus todos add "…" "call (due: 2026-08-01)"`) comes back with that as its `due`. Inherent to
  the inline convention the user signed off; the reverse — a marker that does not parse — is
  ordinary text, which is the direction SPEC.md:403 makes a promise about.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
