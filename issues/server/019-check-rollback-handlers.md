# [SERVER-019] Mount validation + skill-rollback handlers

## Domain

server

## Status

in_progress

## Priority

P1

## Model

opus — the validator exists; rollback is a targeted git revert through the existing git module.

## Dependencies

- Depends on: CONTRACT-008
- Blocks: CLI-006

## Spec References

- SPEC.md §14 — validation; §7 — skill rollback loop safety
- `issues/contract/008-check-rollback-routes.md`

## Summary

Server half of the CLI-003 deferral (2026-07-27 adjudication): attach handlers to CONTRACT-008's routes. Validation reuses `apps/server/src/core/check.ts` — the same implementation the write path runs, per §14. Rollback restores a skill document's last-known-good version via the git module (revert of the file to a prior commit, authored per the acting party, through the standard mutation pipeline so projection and SSE stay consistent).

## Acceptance Criteria

- [x] Validation handler: ids resolve through the projection; `(path, content)` pairs validate without touching disk; findings shape per contract; one validator implementation shared with the write path.
- [x] Rollback handler: restores the skill file at its last-known-good (or `--to` ref), commits through the auto-committer with correct author, re-projects, invalidates; 404 unknown skill.
- [x] Colocated tests + E2E evidence (real workspace, real curl).

## Technical Design

As implemented (sprint-013 Adjudications 6, 7, 8 + sprint-012 Adjudication 23).

**`POST /api/check` — `apps/server/src/check/routes.ts`.** `checkCorpus(documents, checkSeams(projection))`, no `LOCAL_CHECK_CODES` filter, `ok` derived as `errors.length === 0`, never a throw. `{ids}` de-duplicates, resolves each id through `findDocumentRow` and reads the real file on every call (an unreadable file becomes a `{ok:false}` `CheckDocument`, i.e. `frontmatter-unparseable`, rather than a 500); unknown ids contribute nothing. `{documents}` maps straight onto `toCheckDocument(path, content)` and touches no disk.

**One option/filter, two call sites (Adjudications 6 and 7).** `docs/write.ts` now exports `checkSeams(projection)` — the single expression producing `{resolveAnchor: resolveAnchorExact, documentExists: (id) => isIdTaken(projection, id)}` — and `isSkillFrontmatterException(finding)`, the §7 leniency as a predicate over a finding rather than a flag computed at a call site. `validateBeforeWrite` was split: `checkSave(projection, path, text)` is the non-throwing core (`{blocking, findings, warnings}`) and `validateBeforeWrite` is the throwing wrapper over it. The check handler imports both shared pieces from `../docs/index.js`. `documentExists` is supplied on both branches: `checkCorpus` only asks it about ids the submitted set lacks, so it is the union for `{documents}` and the live corpus for `{ids}` **by construction** — one code path, Adjudication 7's option (a).

**`POST /api/skills/{name}/rollback` — `apps/server/src/skills/rollback.ts`.** New primitive `apps/server/src/git/show.ts`: `resolveRevision`, `readVersionAt`, `listFileRevisions`, all async over the existing `Git` command builder, all non-throwing, all resolving a ref to a sha before interpolating it (an option-shaped `to` is refused without invoking git). `watcher/git-head.ts`'s `readHeadVersion` stays as it is — synchronous, HEAD-pinned, and the thing `WATCH_FLUSH_BUDGET_MS` measures — with a comment saying why the two coexist.

Flow: 404 if `.claude/skills/<name>/SKILL.md` is absent (archived skills live elsewhere, so they are 404 too) → resolve the revision **inside `AutoCommitter.withGitLock`** → `validateBeforeWrite` → derive `docId` → `mutex.run(docId, () => runMutation(...))` with a `MutationPlan{kind:"write"}`. The reads and the commit take the lock separately: `withGitLock` is a promise chain, so nesting `runMutation` inside it deadlocks; correctness does not need one span, because the revision is an immutable sha by then.

Four decisions worth naming:

- **Last-known-good** = the newest revision of the path that (a) is not what the file already holds and (b) passes `checkSave`. Rule (a) is what makes both directions right: a bad edit saved through the API is committed, so `HEAD`'s blob is the current file and the answer is the revision before it; a bad edit by an outside editor is uncommitted, so `HEAD` is already the good version. `REVISION_SEARCH_LIMIT = 50`.
- **TEST-24's outcome is a `404`** — `"no earlier committed version of <path> to restore"`. `WARNING_CODES` is a closed four-member enum with nothing that means "nothing to restore", so a 200-with-warning could not say it in a typed way.
- **`squash: false`**, a new optional field on `MutationPlan["commit"]`. Without it, a rollback following an edit to the same skill by the same actor inside §4's idle window **amends that edit away** — deleting the history the restoration just read. Proven load-bearing below.
- **`commit: null` always explains itself.** CONTRACT-016's rider is honoured (`null`, never `""`, never a foreign sha). `runMutation` emits no warning for "nothing to commit", which for a rollback is reachable two real ways, so the handler appends a `commit_skipped` warning when the commit produced no sha and nothing else already said why.

## E2E Verification Log

**Implemented on: opus** (server-dev, worktree `agent-a3469e72b770110e6`, based on phase HEAD `01c997d`), 2026-07-28.

### Post-Implementation Verification

Real `corpus init` workspace at `/tmp/corpus-s013-server019-tt3ynC/ws`, real server on **9092** started with the from-source CLI (`node --import tsx apps/cli/src/bin/corpus.ts server start`, pid 70489, then 78196 after one restart), driven by real `curl`. Every claim is checked against the file on disk, `git -C <ws> log`, `GET /api/docs/{id}`, `GET /api/db/doctor`, or the SSE stream.

#### Mounting and scope

**TEST-1** — the route is served. `POST /api/check {"ids":[]}` → **200** `{"ok":true,"errors":[],"warnings":[]}`. The CONTRACT-008 evaluator recorded **404** for the same request on `9080` when no handler existed; that is the before-state this replaces.

**TEST-2** — `POST /api/skills/orchestrate/rollback` reaches the handler. Its first live answer was a **404 `not_found`** carrying the handler's own message (`"no earlier committed version … to restore"`) — a handler answer, not a routing miss; a routing miss reads `"no route matches POST /api/…"`.

**TEST-3** — `apps/server/src/app.ts`: `mountCheckRoutes` at **:393**, `mountSkillRoutes` at **:397**, both inside `if (deps.projection !== undefined)` (**:298**) and before `mountPluginRoutes` (**:403**). `getHealth` (**:258**) remains the only inline registration.

**TEST-4 / TEST-30** — `git status --porcelain` for this issue lists ten paths, all under `apps/server/`:

```
 M apps/server/src/app.ts          M apps/server/src/git/index.ts
 M apps/server/src/docs/index.ts   M apps/server/src/watcher/git-head.ts
 M apps/server/src/docs/read.ts   ?? apps/server/src/check/
 M apps/server/src/docs/write.ts  ?? apps/server/src/git/show.ts, show.test.ts
                                  ?? apps/server/src/skills/
```

Zero files under `packages/contract`, `apps/cli`, `apps/ui`, `packages/kit`, `plugins/`.

**TEST-5** — with no `Authorization` header: `check: 401`, `rollbk: 401`.

#### The validation handler

**TEST-14** — `{"ids":[]}` and `{"documents":[]}` are both `200 {"ok":true,"errors":[],"warnings":[]}`.

**TEST-15** — the XOR is the schema's. `{"ids":[],"documents":[]}`, `{}` and `{"foo":1}` each returned **400** with exactly one issue at path `json` carrying `CHECK_REQUEST_XOR_MESSAGE` verbatim. That the *handler* never runs is pinned by a unit test that mounts the shipped `contractRoutes.checkDocuments` on a bare `OpenAPIHono` with a counting handler: `entered === 0` after all three malformed bodies, `entered === 1` after a well-formed one.

**TEST-13** — `{"ids":["doc_zzzzzz"]}` → `200 {"ok":true,"errors":[],"warnings":[]}`. No 404, no synthetic finding.

**TEST-11** — the id branch reads the real file, live. A document created through the API (`doc_d35zvazr`, `data/docs/inbox/ledger.md`) checked clean; its body was then rewritten **on disk** to contain `[[doc_nowhere]]`, and the very next check — no restart — returned `ref-unresolved` at `path: data/docs/inbox/ledger.md`, `docId: doc_d35zvazr`.

**TEST-12** — the pair branch touches nothing. `{"documents":[{"path":"data/docs/nope.md","content":"---\nbad: [\n---\n"}]}` → `200`, one `frontmatter-unparseable` at that path; `ls data/docs/nope.md` → *No such file or directory*; `git -C <ws> status --porcelain` byte-identical before and after.

**Staged-union ref resolution (Adjudication 7), live.** A submitted pair at `data/docs/staged.md` referencing both `[[doc_d35zvazr]]` (a live document **not** in the submitted set) and `[[doc_nobody]]` produced **exactly one** warning — for `doc_nobody`. Without the `documentExists` seam the live reference would have warned too, which is the false-warning storm the adjudication exists to prevent.

**TEST-7** — the whole-corpus rules are not filtered. Two submitted pairs sharing `id: doc_dupe01` → `ok:false` with `duplicate-id` (`"id \`doc_dupe01\` is also used by data/docs/one.md"`). `duplicate-id` is not in `LOCAL_CHECK_CODES`, so a handler that reused the save-path filter would have answered `ok:true`. *Noted for CLI-006:* the `{ids}` form cannot reach this case, because the projection keeps one row per id — a duplicate-id corpus is reported by `db doctor`, and by `/api/check` through the pair form. That is a property of Adjudication 22's enumerate-then-post shape, not of this handler.

**TEST-8 / TEST-9** — a drifted corpus is a `200`. Three pairs (two duplicate ids + one unparseable) → `200`, `ok:false`, `errors` carrying `duplicate-id` and `frontmatter-unparseable`. `ok === (errors.length === 0)` held on every response observed, including warning-only ones where `warnings` was non-empty and `ok` stayed `true`.

**TEST-10** — the two §14 carve-outs. Live runs produced `ref-unresolved` (above) and, in the colocated suite, `anchor-unresolved` alongside it; both only ever in `warnings`, never in `errors`, and no other code ever appeared in `warnings`.

**Adjudication 6, on a real hand-written `SKILL.md`.** `.claude/skills/hand-written/SKILL.md` written by hand with only Claude Code's `name`/`description` and no Corpus frontmatter at all. The watcher indexed it as `doc_skill5959ccdb`. The whole-workspace check a `corpus doc check` will perform — paginate `GET /api/docs?limit=200&includeArchived=true`, post the 9 ids — returned:

```
9 ids: doc_d35zvazr doc_skillorchestrate doc_seedattention doc_seedinbox doc_seedopenthreads
       doc_seedtemplatenote doc_skillcomment doc_skill138ec106 doc_skill5959ccdb
{"ok": true, "errors": [], "warnings": []}
```

A freshly `corpus init`-ed workspace plus a hand-written skill is **clean**, which is the property that keeps the workspace-side exit-6 hook from blocking every commit in every workspace. The same file was then edited through `PUT /api/docs/doc_skill5959ccdb` → **200**, and re-checked → `ok:true`: what the write path accepts, the check accepts. The leniency is narrow — the same request shape at `data/docs/no-frontmatter.md` returned five `frontmatter-invalid` errors, and a skill carrying `anchors: {not-an-anchor-id: …}` returned `anchor-malformed`.

#### The rollback handler

**TEST-21** — `POST /api/skills/never-installed/rollback` → **404** `{"code":"not_found","message":"no skill named \`never-installed\` is installed (.claude/skills/never-installed/SKILL.md does not exist)"}` — `NotFoundErrorSchema`, no new shape.

**TEST-23** — `POST /api/skills/Orchestrate/rollback` → **400** from `SkillNameSchema` (`param.name`, `must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/`). `POST /api/skills/a/b/rollback` → **404**, not routed here. *Limitation, named and not fixed (sprint Out of Scope):* the `skill-tree` root indexes `SKILL.md` at any depth, so a nested skill is indexable but unaddressable by this route.

**TEST-24** — on the untouched workspace, where `orchestrate/SKILL.md` has exactly the `corpus init` commit: **404**, `"no earlier committed version of .claude/skills/orchestrate/SKILL.md to restore — its history holds nothing that differs from the file on disk and validates"`. `git log --oneline -- <path>` still showed exactly one commit afterwards: nothing rewritten, nothing silently succeeded.

Two committed edits were then built through the API (author `user`, then author `agent`, so each got its own commit):

```
4c4e483 doc edit: Orchestrate (doc_skillorchestrate) by agent    <- the BAD edit
056f32c doc edit: Orchestrate (doc_skillorchestrate) by user
211f500 workspace: initialize corpus workspace by user
```

**TEST-16** — `POST /api/skills/orchestrate/rollback` with `x-corpus-author: agent` and **no body** → `200`:

```json
{"name":"orchestrate","docId":"doc_skillorchestrate",
 "commit":"a646c83606298d1b1b7ea43d54a3d47a61006c1b",
 "path":".claude/skills/orchestrate/SKILL.md","warnings":[]}
```

`diff <(git show 056f32c:./.claude/skills/orchestrate/SKILL.md) <file>` → **identical**. `git log -1 --format='%an <%ae> %s'` → `agent <agent@corpus.local> skill rollback: orchestrate (doc_skillorchestrate) to 056f32c by agent`, with the standard `Corpus-Doc` / `Corpus-Actor` trailers. `git log --oneline -- <path>` gained a fourth line on top; the bad edit `4c4e483` is still reachable (`git cat-file -t` → `commit`, still on `git log`). A new commit, not a rewritten history.

**TEST-17** — `response.commit` = `a646c83…` = `git rev-parse HEAD`, and ≠ the source revision `056f32c…`.

**TEST-19** — `docId` was `doc_skillorchestrate` before and after, and `GET /api/docs?type=skill` reports the same id after the rollback. *Correction to the criterion's wording:* the shipped `orchestrate/SKILL.md` carries a real `id:` in its frontmatter (AGENT-001 pinned that shape), so its id is the declared one, not the `doc_skill<8 hex>` synthetic form. The synthetic form is what a skill carrying **no** id gets, and the hand-written skill above shows it: `doc_skill5959ccdb`. Both satisfy `DocIdSchema`, and neither changes across a rollback, because neither is derived from anything a rollback moves.

**TEST-20** — with `curl -N /events?token=…` attached, the rollback produced exactly one frame:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_skillorchestrate"]]}
```

Keys only, no document payload. `GET /api/docs/doc_skillorchestrate` immediately afterwards already returned the restored body (`body tail: '…\n\n## Version one marker\n'`) — read-your-write, no refetch race.

**TEST-18** — `{"to":"211f500…"}` (the `corpus init` revision) → `200`; the file became byte-identical to that revision's blob (`diff` clean, both markers gone); a new commit authored `user <user@corpus.local> skill rollback: orchestrate (doc_skillorchestrate) to 211f500 by user`; `response.commit === git rev-parse HEAD`. An omitted body, `{}` and `{"to":null}` behave identically (live for the omitted form; all three in the colocated suite).

`--to` refusals: `{"to":"deadbeefdeadbeef"}` → **400** `{"issues":[{"path":"to","message":"\`deadbeefdeadbeef\` is not a revision in this workspace"}]}`; `{"to":"--git-dir=/etc"}` → the same **400**, and git is never invoked with it.

**`commit: null` (CONTRACT-016)** — repeating the same `--to` rollback returned `200` with `"commit": null` and `warnings: [{"code":"commit_skipped","detail":"the restored content is already what git records for this path, so there was nothing to commit; the file on disk holds it either way"}]`. Never `""`, never a foreign sha.

**TEST-22** — the hand-written skill was archived through `POST /api/docs/{id}/archive` (200), which moved its folder to `.claude/skills-archived/hand-written/`; `POST /api/skills/hand-written/rollback` → **404**.

**§7's actual scenario, end to end.** `.claude/skills/comment/SKILL.md` was overwritten out of band with `---\nname: [\n---` — unparseable — and `GET /api/db/doctor` reported `content_mismatch` for it. `POST /api/skills/comment/rollback` → `200`, file `diff`-identical to the committed good version, `commit: null` + the `commit_skipped` warning (the restored bytes are what `HEAD` already records, so there is nothing for a commit to say — the *file* changed, the repository's record did not), and `db doctor` clean afterwards:

```
{"ok":true,"drift":[],"stats":{"files":9,"documents":9,"hashed":0,"parsed":0,"durationMs":1}}
```

Followed by a whole-workspace check → `{"ok":true,"errors":[],"warnings":[]}`, and `git -C <ws> status --porcelain` **empty** — no stray staged file left by any of it.

#### The drift guard (Adjudication 23), made to fail

`apps/server/src/check/codes.test.ts`. Passing:

```
✓ apps/server/src/check/codes.test.ts (7 tests) 2ms      Tests  7 passed (7)
```

Renaming one server-side code (`duplicateId: "duplicate-id"` → `"duplicate-ids"`) in the agent's worktree:

```
FAIL  the validator's codes and the wire's > are the same thirteen, member for member, in declaration order
AssertionError: expected [ 'frontmatter-unparseable', …(12) ] to deeply equal [ 'frontmatter-unparseable', …(12) ]
-   "duplicate-id"
+   "duplicate-ids"
Tests  1 failed | 6 passed (7)
```

Reverted → 7 passed. The **severity half** (TEST-29) is guarded separately: flipping `report.warn(CHECK_CODES.anchorUnresolved, …)` to `report.error(…)` — a change the code-list assertion cannot see — fails two other tests:

```
× emits exactly the contract's two warning codes and nothing else as a warning
  → expected [ 'ref-unresolved' ] to deeply equal [ 'anchor-unresolved', …(1) ]
× never reports a warning code as an error
  → expected [ { code: 'anchor-unresolved', …(4) } ] to deeply equal []
Tests  2 failed | 5 passed (7)
```

Reverted → 7 passed. The assertions normalise between the two shapes (keyed object vs. string tuple); neither restates a literal list.

#### `squash: false` is load-bearing, made to fail

With the field removed from the rollback's plan, `does not fold into the edit that made it necessary` fails — the rollback amends the preceding edit instead of adding a commit:

```
× the restoration is an ordinary mutation > does not fold into the edit that made it necessary
  → expected [ …(4) ] to have a length of 5 but got 4
```

Restored → passes. (The scenario needs a `--to` reaching past `HEAD`'s parent: rolling back to the *immediately* previous version is already refused by the committer's own `amendWouldEmptyHead` check, so the shallow case would have proven nothing.)

#### One validator, reachable two ways (TEST-6, TEST-160)

```
$ grep -rn "checkCorpus(" apps/server/src | grep -v '\.test\.ts'
apps/server/src/docs/write.ts:301:  const report = checkCorpus([toCheckDocument(path, text)], checkSeams(projection));
apps/server/src/check/routes.ts:98:    const report = checkCorpus(documents, checkSeams(deps.projection));
```

Exactly two production call sites, both passing the same `checkSeams(projection)` — which is the one place the two seams are written down. Zero re-implementations; the thirteen codes exist only in `core/check.ts` and the contract's enum, pinned together by the guard above. Finding shapes are not translated: the server's `CheckFinding` is assigned to the wire's `CheckFinding` directly.

#### Checks

| Command                                                            | Result                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server`   | exit 0 — **118 files, 2307 tests** (2260 before this issue; +47)  |
| `npm run lint`                                                      | exit 0                                                            |
| `npm run format:check`                                              | exit 0 — "All matched files use Prettier code style!"             |
| `npm run typecheck` (all workspaces + `scripts/`)                   | exit 0                                                            |
| `npm run build`                                                     | exit 0                                                            |

New colocated suites: `apps/server/src/check/routes.test.ts` (21), `apps/server/src/check/codes.test.ts` (7), `apps/server/src/skills/rollback.test.ts` (24), `apps/server/src/git/show.test.ts` (10).

Ports: `9092` and `8765` both verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` after `corpus server stop` (pid-targeted; no `pkill`). No SSE `curl` left behind. The scratch tree `/tmp/corpus-s013-server019-tt3ynC` was created by `mktemp -d` and removed by its captured path; no `/tmp/corpus-*` glob was ever used. No git state-changing command was run in the Corpus repository.

#### Notes for the orchestrator

1. **`MutationPlan["commit"].squash` is a new optional field on the shared write pipeline** (`docs/write.ts`), defaulted-off, so no existing verb changes behaviour. It is the minimum needed to keep a rollback from amending away the edit it is undoing.
2. **`checkSave` / `checkSeams` / `isSkillFrontmatterException` are new exports of `docs/`**, and `findDocumentRowByPath` is a new export of `docs/read.ts` (a skill's identity is its path, so the rollback needs the by-path direction). `validateBeforeWrite`'s signature and behaviour are unchanged.
3. **`{ids}` cannot report `duplicate-id`** — one row per id. Worth a line in CLI-006's docs if `corpus doc check` claims to find every §14 problem; `db doctor` is the surface that reports duplicate ids today.
4. **Nested skills stay unaddressable** by `POST /api/skills/{name}/rollback` (`SkillNameSchema` forbids `/`). Named as a limitation, per Out of Scope.
5. This log was written into the **worktree's** copy of the issue file — the harness blocks a worktree-isolated agent from editing the shared checkout. Harvest it with the code.

### Fix round 1 — sprint-013 evaluation FAIL-1 (`anchor-unused` on subsets)

**Implemented on: opus** (server-dev, directly in the main repo, branch `phase-4-agent-loop` at `1125981`), 2026-07-28. Real workspace `/tmp/corpus-s013-fix019-R55iQi` (`mktemp -d`), real server on `9092` (pid `67751`), from-source CLI (`node --import tsx apps/cli/src/bin/corpus.ts`), real `curl`.

**Defect.** `anchor-unused` is a cross-document rule and was answered from the submitted set alone. `documentExists` unioned `[[ref]]` targets with the live corpus; nothing did the same for anchor→thread claims, so every subset request — `corpus doc check <id>` and **every** `--staged` run, which is a subset by construction — reported an *error* for any document that has been commented on. Adjudication 6 (write-path acceptance ⇒ check acceptance) makes that a bug by definition.

**Fix — the third seam, in the same one expression.** `CheckOptions` grows `anchorClaimants(docId, anchorId): readonly string[]`; `checkSeams(projection)` supplies it as `anchorClaimantIds(projection, …)` (`docs/read.ts`, `SELECT id FROM threads WHERE parent_id = ? AND anchor_id = ?`, beside `isIdTaken`). `checkCorpus` reports `anchor-unused` only when *neither* a submitted thread declares the claim *nor* a live claimant **outside the submitted set** exists.

It returns ids rather than a boolean deliberately: the submitted set is authoritative for what it contains, so a live claimant that is itself in the request contributes nothing — that is what keeps `--staged` able to catch an anchor the staged edit genuinely orphaned, and what makes whole-workspace behaviour *identical* to before (every thread is submitted, so every row is ignored). The seam is consulted only for anchors about to be reported, so clean documents pay one query per would-be error and none otherwise.

#### Reproduction, re-run verbatim (post-fix)

```
$ corpus doc create --type note --title "Anchored subject" -m "The quick brown fox jumps over the lazy dog."
created doc_xxjl3bel — data/docs/inbox/anchored-subject.md
$ curl -X POST http://127.0.0.1:9092/api/threads … -d '{"parent":"doc_xxjl3bel",…,"selector":{"exact":"quick brown fox"}}'
  → th_senisdvj / anc_33714313  (and th_na3myasx / anc_c7639160 — two real anchored threads)
$ curl http://127.0.0.1:9092/api/threads/th_senisdvj → parent doc_xxjl3bel anchor anc_33714313 status open
$ curl -X PUT http://127.0.0.1:9092/api/docs/doc_xxjl3bel …            → 200, warnings []
$ curl -X POST http://127.0.0.1:9092/api/check -d '{"ids":["doc_xxjl3bel"]}'
{"ok":true,"errors":[],"warnings":[]}                                   ← was ok:false + anchor-unused
$ corpus doc check doc_xxjl3bel   → checked 1 document — no findings.    exit=0   ← was exit 6
$ corpus doc check                → checked 10 documents — no findings.  exit=0   (unchanged)
$ git add -- data/docs/inbox/anchored-subject.md && corpus doc check --staged
                                   checked 1 document — no findings.     exit=0   ← was exit 6
$ corpus doc check --json doc_xxjl3bel → {"ok":true,"errors":[],"warnings":[]}
```

#### The rule still fires — three modes, one genuinely unused anchor

Added `anc_deadbee1: {exact: lazy dog}` to the same document's frontmatter out of band (no thread anywhere claims it), leaving the two thread-backed anchors in place:

```
$ corpus doc check doc_xxjl3bel
error anchor-unused data/docs/inbox/anchored-subject.md: anchor `anc_deadbee1` has no thread referencing it
corpus: 1 error in 1 document.                                            exit=6
$ corpus doc check
error anchor-unused … anchor `anc_deadbee1` has no thread referencing it
corpus: 1 error in 10 documents.                                          exit=6
$ git add -- data/docs/inbox/anchored-subject.md && corpus doc check --staged
error anchor-unused … anchor `anc_deadbee1` has no thread referencing it  exit=6
```

Exactly one finding in each mode — `anc_33714313` and `anc_c7639160` stay silent. Removing the entry returned all three modes to `exit=0`.

#### The union's other direction, live

`POST /api/check` with two `{documents}` pairs: the parent as it is on disk, and `th_senisdvj`'s content **with its `anchor:` line stripped** (the shape of a staged edit that orphans a highlight):

```json
{"ok":false,"errors":[{"code":"anchor-unused","severity":"error","docId":"doc_xxjl3bel",
  "path":"data/docs/inbox/anchored-subject.md",
  "detail":"anchor `anc_33714313` has no thread referencing it"}],"warnings":[]}
```

Only the anchor whose *submitted* thread dropped the claim is reported; `anc_c7639160`, whose thread was never submitted, is still vouched for by the projection. A stale row cannot overrule submitted bytes.

`corpus db doctor` → `projection is clean — 10 documents from 10 files (1ms)`, exit 0. `git log` shows the five expected workspace commits and nothing the check wrote.

#### Tests

- `apps/server/src/core/check.test.ts` — new `describe("the anchorClaimants seam")`: claimant outside the set accepts; no claimant still errors; a claimant **inside** the set is ignored (staged orphaning); the seam is never consulted for an anchor a submitted thread claims; absent seam changes nothing. 40 tests green.
- `apps/server/src/check/routes.test.ts` — new `describe("anchor-unused is answered against the live corpus, unioned with the request")`: the evaluator's exact reproduction through the real app (real `POST /api/threads`, `PUT` accepted, then `{ids:[doc]}` clean and `{ids:[doc,thread]}` clean); the same document through the `{documents}` pair form; a genuinely unused anchor reported in **both** subset and whole-workspace requests (whole-workspace errors: exactly one, and it is the dangling document's); init-time staged pairs whose thread exists only in the request; a staged edit that orphans an anchor still caught. 26 tests green.
- **Negative control**: with the `claimedOutsideCorpus` conjunct removed, exactly the three fix-dependent tests fail (`3 failed | 63 passed`); restored → all green. The two "still fires" tests pass in both states by design — they pin the absence of a regression, not the fix.
- Scoped run `VITEST_MAX_THREADS=4 vitest run apps/server/src/check apps/server/src/core apps/server/src/docs` → **34 files, 648 tests, all green**. `eslint` + `prettier` + `tsc --noEmit` clean on every touched file.

Files touched: `apps/server/src/core/check.ts`, `apps/server/src/docs/read.ts`, `apps/server/src/docs/write.ts`, `apps/server/src/docs/index.ts`, `apps/server/src/check/routes.ts` (comment), plus the two test files. No contract change — the wire shape, the thirteen codes and the severity split are untouched, so **CLI-006 needs no change** (its eval's FAIL-1 was this same defect).

Ports `9092` and `8765` verified free after `corpus server stop` (pid `67751`, pid-targeted). Scratch tree created by `mktemp -d` and referenced by its captured path only. No git state-changing command was run in the Corpus repository.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-019]` prefix
