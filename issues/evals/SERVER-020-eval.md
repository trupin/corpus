# Evaluation: SERVER-020

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PASS

Branch `phase-3-ui` @ `4ea3e4b`. Real workspace at `/tmp/corpus-e008-s020-Qa1hW8/ws`
(`corpus init --port 8974`), real server daemon (`corpus server start`, pids 47330 then 25846),
persistent `curl -N /events?token=…` subscriber attached throughout (pids 47780 / 26115).
Entry point `node --import tsx apps/cli/src/bin/corpus.ts`. **Every scenario below reads
`GET /api/tree` immediately before and immediately after the edit and diffs the two bodies**,
then reads the frame — the biconditional is measured on both sides, never inferred from the
frame alone. All edits are out of band on real files (`sed -i ''`, `printf >>`, `python3` file
writes, `mv`, `rm`, `git checkout`); the API is used only for fixture setup and for the
TEST-96 mutation-path control.

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | `issues/server/020-watcher-tree-key.md:146-315`. Substantial: reproduction section, post-implementation section, symmetry table, finding-10 measurement tables, `db doctor` output, per-file test inventory. |
| Commands are specific and concrete | PASS | Workspace path, port, entry point, instrumentation all named. Frames quoted verbatim as `data: {"keys":[…]}`. Tree bodies quoted as JSON. Doc ids given (`doc_jwbimevv`, `doc_probeskill`, `doc_skill6b48b45c`). `db doctor --json` output pasted in full. |
| Real E2E (not mocked) | PASS | Real `corpus init` workspace, real daemon, real SSE stream, real out-of-band file edits. The one seam-based artefact (`flush-budget.test.ts` standing in `readHead` for `execFileSync`) is disclosed as such in the log and is a *unit* test, not offered as the E2E evidence — the E2E evidence for finding 10 is the 100-file batch with a real health poller and a real counting `git` shim. |
| Scenarios cover acceptance criteria | PASS | All five ACs exercised: signature-compare (behaviourally, via TEST-87/88/89/95b), both regression directions, no new key names, the rebuild decision, and the reassigned flush bound. |
| Application restarted after changes | PASS | "Server restarted on the fixed build, same workspace, same instrumentation" (`:218`). |
| Actual model recorded | PASS | `implemented on: opus` at `:148`. Also cross-referenced from SERVER-022's log. |
| Reproduction logged before fix (bugs) | PASS | `:155-214`. Both directions, "reproduced **before any code was written**, against the shipped `structural` heuristic", each with **both** tree bodies and **both** frames quoted verbatim, plus a cause-by-inspection line citing `watcher.ts:175`. Finding 10 also has a pre-fix measurement table (N=25 / N=100, with and without the counting shim). This is the genuine article, not a retrospective assertion. |

---

## Log Honesty Re-derivation

Nine falsifiable claims picked from the log and re-derived independently on a fresh workspace.

| # | Claim in log | Re-derived? | Actual observation |
| --- | --- | --- | --- |
| 1 | Skill-file appearance projects as `doc_skill6b48b45c` | **CONFIRMED** | My frame, different workspace, same content-derived id: `data: {"keys":[["docs"],["docs","doc_skill6b48b45c"]]}` |
| 2 | Post-fix skill-file frame is `[["docs"],["docs","doc_skill…"]]` with no `["tree"]`, on a byte-identical tree | **CONFIRMED** | Tree before == tree after byte-for-byte (`templates` 1, `views` 3); frame exactly as quoted. |
| 3 | Post-fix archive-on-disk: tree loses the folder, frame is `[["docs"],["docs",id],["tree"]]` | **CONFIRMED** | `solo` present (count 1) → absent; frame `{"keys":[["docs"],["docs","doc_2lzfz55b"],["tree"]]}` — same shape, my id. |
| 4 | Post-fix tree contains `{"path":"bulk",…,"count":200}` | **CONFIRMED** | After 100 docs each with one parented anchored thread, my tree reads `{"path":"bulk","name":"bulk","count":200,"totalCount":200,"children":[]}` — the same 2× accounting. |
| 5 | Post-fix N=100 still costs exactly **100** `git show` invocations ("the fix bounds *when* the reads happen, not how many") | **CONFIRMED** | Counting `git` shim on the daemon's `PATH` (verified live: a `POST /api/docs` produced 8 shim-logged git calls). Three separate N=100 batches → **100, 100, 100**. N=25 batch → **25**. |
| 6 | Post-fix N=100 worst `GET /api/health` latency = **110 ms / 125 ms** (no shim) and **117 ms** (shim) | **CONTRADICTED** | Five N=100 runs on this machine: worst = **210.2, 238.2, 205.5, 233.5, 212.4 ms**. The *per-flush* window is indeed ~101–113 ms (dozens of windows measured, all in that band), but consecutive deferred flushes repeatedly run back-to-back without the pending request being served between them, so the **client-visible** worst case is ~2× the budget. The log reports the modal window as if it were the worst case. See MINOR-1. |
| 7 | `db doctor` reports zero drift after a deferred 100-file batch — nothing the bound stopped short of was lost | **CONFIRMED** | After a 100-file `git checkout` batch and a separate 100-file body-rewrite batch: `{"ok":false,…}` with the **only** finding being `unparseable: data/docs/solo/broken.md` — the file I deliberately corrupted for TEST-94. Stats `{"files":216,"documents":215}`. All 100 deferred paths reconciled and projected. |
| 8 | Colocated tests: `tree-key.test.ts` 8 cases, `flush-budget.test.ts` 4 cases, `routes.test.ts` pinned by _"names the tree even when the rebuild leaves it byte-identical, by design"_ | **CONFIRMED** | `npx vitest run` → tree-key 8/8, flush-budget 4/4, and the routes case name is verbatim as quoted. |
| 9 | `npm test`: 3428 passed / 203 files | **NOT CONTRADICTED (moved on)** | At tip `4ea3e4b`: **3818 passed / 214 files, 0 failures**. Three commits landed after `ca7bd27`; the count is expected to have grown. No regression. |
| 10 | "Verified to fail against the pre-fix `flush()` — 5 of the 8 fail" | **NOT RE-DERIVABLE** | Reproducing this requires reverting `documentKeys`'s `structural` parameter, i.e. editing application code, which this evaluation is forbidden to do. See TEST-98 for the honest assessment. |

---

## Criteria Results

Tree bodies are abbreviated to the folder/count set; every pair was diffed byte-for-byte by the harness.

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| TEST-86 | Both directions reproduced BEFORE the fix, on a real server | **PASS** (audit) | Not independently reproducible without reverting code. Audited instead: the log's Reproduction section states the reproduction predates any code, names the real workspace/port/entry point, and quotes **both tree bodies and both frames verbatim** for both directions — (i) `solo` present → absent with frame `{"keys":[["docs"],["docs","doc_jwbimevv"]]}` and **no** `["tree"]`; (ii) tree byte-identical with frame `{"keys":[["docs"],["docs","doc_probeskill"],["tree"]]}`. Both sides of the biconditional are measured in each. This is a genuine pre-fix reproduction, not an assertion. |
| TEST-87 | The fix measures rather than guesses | **PASS** (behavioural) | Source not read (constraint). Proven behaviourally in **both** directions of the old heuristic: a pre-fix-`structural=true` event (`add` of `.claude/skills/probe/SKILL.md`) now emits **no** `["tree"]`, and a pre-fix-`structural=false` event (`change` setting `status: archived`) now **does**. Decisively, TEST-95b'' shows a batch **containing an `add`** (a rename, unlink+add in one flush) emit no `["tree"]` because the *net* tree was unchanged — a `structural`-driven decision cannot produce that outcome. |
| TEST-88 | Archive-on-disk satisfies the invariant | **PASS** | `sed -i '' 's/^status: open$/status: archived/'` on the lone doc in `data/docs/solo/`. Tree: `solo(1),templates(1),views(3)` → `templates(1),views(3)` — **CHANGED**. Frame: `{"keys":[["docs"],["docs","doc_2lzfz55b"],["tree"]]}` — **carries `["tree"]`**. |
| TEST-89 | Skill file satisfies the invariant | **PASS** | `.claude/skills/probe/SKILL.md` created out of band. Tree: `templates(1),views(3)` → `templates(1),views(3)` — **byte-identical**. Frame: `{"keys":[["docs"],["docs","doc_skill6b48b45c"]]}` — **no `["tree"]`**, and the skill is still projected and still announced. |
| TEST-90 | Unarchiving is symmetric | **PASS** | `sed -i '' 's/^status: archived$/status: open/'`. Tree: `templates,views` → `solo(1),templates,views` — **CHANGED**. Frame: `{"keys":[["docs"],["docs","doc_2lzfz55b"],["tree"]]}` — **carries `["tree"]`**. Perfect mirror of TEST-88. |
| TEST-91 | Body-only edit emits no tree key but keeps its others | **PASS** | `printf '\nmore text\n' >> data/docs/solo/solo-doc.md`. Tree **byte-identical**. Frame: `{"keys":[["docs"],["docs","doc_2lzfz55b"]]}` — no `["tree"]`, **both** `["docs"]` and `["docs", id]` still present. The fix costs the frame nothing. |
| TEST-92 | Appearance and disappearance still emit it when the tree really changed | **PASS** | New `.md` in a brand-new `research/`: tree gains `research(1)` — **CHANGED**; frame `{"keys":[["docs"],["docs","doc_res00001"],["tree"]]}`. `rm` of the same file: tree loses `research` — **CHANGED**; frame `{"keys":[["docs"],["docs","doc_res00001"],["tree"]]}`. Signature-compare does not miss real structural change. |
| TEST-93 | Thread folder accounting respected | **PASS** | Parented thread (`parent: doc_2lzfz55b`, which lives in `solo/`) written out of band: `solo` 2 → 3 — **CHANGED**; frame `{"keys":[["docs"],["docs","th_oob00001"],["threads","th_oob00001"],["tree"]]}`. Standalone thread (`parent: null`) written out of band: tree **byte-identical**; frame `{"keys":[["docs"],["docs","th_oob00002"],["threads","th_oob00002"]]}` — **no `["tree"]`**. Both directions correct, and the `["threads", id]` key survives in both. |
| TEST-94 | Unparseable / out-of-root file changes nothing | **PASS** | Three files in one batch: `data/docs/solo/broken.md` (malformed YAML), `<ws>/outside-root.md`, `<ws>/notaroot/ghost.md` (well-formed but outside every root). Tree **byte-identical**. **Zero frames emitted** — no `["tree"]`, no phantom document keys. Projection unchanged: `GET /api/docs` returns the same 11 ids before and after. Server logged `watcher skipped a document … invalid YAML frontmatter` and carried on. |
| TEST-95 | A mixed batch emits ONE correct verdict | **PASS** | (a) One structural (new doc in new `batch2/`) + three body appends, written by a single process in one burst → **one** frame: `{"keys":[["docs"],["docs","doc_seedinbox"],["docs","doc_batch0002"],["docs","doc_seedopenthreads"],["docs","doc_seedattention"],["tree"]]}`. Tree gained `batch2(1)` — CHANGED. `["tree"]` appears **exactly once**, all four doc keys present, first-seen order preserved. (b) **The net-zero trap, constructed:** `mv batch1/b1b.md batch1/b1c.md` — an unlink and an `add` (pre-fix `structural === true`) inside one flush, with the tree byte-identical either side. Frame: `{"keys":[["docs"],["docs","doc_batch0003"]]}` — **no `["tree"]`**. The batch is not allowed to announce because one member looked structural. |
| TEST-96 | No new key names; mutation path untouched | **PASS** | `git diff abb6b48..4ea3e4b -- packages/contract/src/query-keys.ts apps/server/src/events/` is **empty** — not one byte changed in the key vocabulary or the event layer. Mutation-path control re-run live against sprint-007's recorded frames: `POST /api/docs` into a new folder → tree gains `mutcheck(1)`, frame `{"keys":[["docs"],["docs","doc_ewd34vmy"],["tree"]]}` (sprint-007 hop 1 shape ✓); `PUT /api/docs/{id}` body-only → tree byte-identical, frame `{"keys":[["docs"],["docs","doc_ewd34vmy"]]}` (hop 8 shape ✓); `POST /api/docs/{id}/archive` → tree CHANGED, frame `{"keys":[["docs"],["docs","doc_ewd34vmy"],["tree"]]}` (hop 10b shape ✓). Byte-identical to what SERVER-018's evaluation recorded. |
| TEST-97 | The `db rebuild` coarseness is DECIDED | **PASS** | **The rationale is genuinely written**, not merely blessed: `020-watcher-tree-key.md:101-137` — 37 lines under an explicit heading, arguing (a) a rebuild is a resynchronization instruction rather than a mutation frame, (b) folding it in is *technically trivial and was rejected on the merits* because the case the route exists for is precisely the one where both signatures match, (c) the failure modes are asymmetric, (d) a corollary explaining why the other four keys are unconditional for a different reason, and (e) a restatement of the invariant with the exception named. Silence would have been a fail; this is the opposite of silence. Behaviour verified live and matches the decision: rebuild on a provably byte-identical tree (both bodies quoted, identical) emitted `{"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}`. Pinned by `routes.test.ts` → _"names the tree even when the rebuild leaves it byte-identical, by design"_ (passes). Per the orchestrator's adjudication this coarseness is correct by decision and is not scored as a defect. |
| TEST-98 | Both directions become regression tests | **PASS**, with one caveat | `apps/server/src/watcher/tree-key.test.ts` exists, colocated, **8/8 pass**, and covers both reproduced directions by name: _"announces the tree when an on-disk archive empties a folder"_ and _"says nothing about the tree when a skill file appears"_, plus unarchive symmetry, body-only key retention, folder appear/disappear, parented-vs-standalone threads, unparseable/out-of-root, and the mixed batch. `flush-budget.test.ts` 4/4. Repo-wide `npm test`: **3818 passed / 214 files, 0 failures**. **Caveat:** the "fails against the pre-fix `flush()`" half is **ASSERTED, not demonstrated** — the log states "5 of the 8 fail" and quotes two assertion messages (`expected false to be true`, `expected true to be false`) but pastes no run output. Re-deriving it requires reverting application code, which this evaluation may not do. The claim is specific and internally consistent (5/8 is exactly the subset a `structural`-driven `documentKeys` would break), and the tests are demonstrably sensitive to the right thing — but the criterion's "they fail against the pre-fix `flush()`" rests on the implementer's word. See MINOR-2. |
| TEST-123 | A batch of anchored files does not block the event loop unboundedly | **PASS**, numbers restated | Measured on the real server with a real counting `git` shim and a serial `GET /api/health` poller (~5 700 req/s idle; idle baseline n=36 398, max 13.3 ms, p99 0.3 ms, mean 0.16 ms). Fixture: 100 documents in `data/docs/bulk/`, each carrying one parented anchored thread, all committed to git HEAD. Full numbers below. **The bound is real and size-independent at the per-flush level** (~101–113 ms at N=25 and at N=100, identically), and `db doctor` proves nothing is dropped. The log's *stated* bound — "one flush blocks for at most `WATCH_FLUSH_BUDGET_MS` plus the cost of the single entry in flight" — is confirmed. The log's *reported worst-case latency* is not: see MINOR-1. |
| TEST-124 | Out-of-band reconciliation still uses git HEAD as the pre-edit body | **PASS** | 100-file batch inserting `PREAMBLE LINE INSERTED BEFORE THE ANCHOR.` into the **body** of every anchored doc, ahead of the anchored text. All 100 reconciled: `exact` preserved as `ANCHORTEXT<nn>` in 100/100 files, and `prefix` correctly **remapped** from `""` to the newly inserted preamble (`GET /api/docs/doc_36nph72e` → `"prefix":"NE INSERTED BEFORE THE ANCHOR.\n\n"`, `"suffix":" is the q…"`, anchor still resolving in the `anchors[]` array). Same result via the criterion's own named mechanism, a `git checkout -- data/docs/bulk/` rewriting all 100 at once. `db doctor`: 216 files / 215 documents, only drift the TEST-94 file I broke on purpose. The bound costs no correctness. |

**Score: 15 / 15 criteria PASS** (TEST-86…98 = 13, plus TEST-123 and TEST-124).

---

## TEST-123 — the flush budget, in numbers

Idle baseline: n = 36 398 requests over 6 s, max **13.3 ms**, p99 **0.3 ms**, mean **0.16 ms**.

| Run | N | Trigger | `git show` | Flushes (frames) | Per-flush blocking window | **Worst client-visible latency** | Total flush span |
| --- | --: | --- | --: | --: | --- | --: | --: |
| 1 | 25 | body append, one process | 25 | 2 | 101, 46 ms | **101.4 ms** | ~147 ms |
| 2 | 100 | body append, one process | — | 6 | 105, 210, 205, 94 ms | **210.2 ms** | 615 ms |
| 3 | 100 | body append, one process | — | 11 | 110, 106, 216, 238, 103, 104, 102, 108, 109, 105, 38 ms | **238.2 ms** | ~1 460 ms |
| 4 | 100 | body append, one process | — | 6 | 103, 206, 107, 102, 105, 103 ms | **205.5 ms** | 726 ms |
| 5 | 100 | **`git checkout -- data/docs/bulk/`** | **100** | 15 | 111, 234, 105, 135, 213, 101, 118, 101, 218, 103, 230 … | **233.5 ms** | ~1 670 ms |
| 6 | 100 | body insertion before anchors | **100** | 8 | 101, 214, 205, 208, 58 ms | **213.7 ms** | ~960 ms |
| 7 | 25 | body append, one process | **25** | 3 | 112, 110, 111 ms | **111.7 ms** | ~330 ms |
| 8 | 100 | body append, one process | **100** | 13 | 113, 205, 109, 107, 102, 101, 109, 108, 106, 101, 109, 212 … | **212.4 ms** | ~1 700 ms |

**What the numbers say.**

- **Per-flush blocking is bounded and size-independent.** Across ~70 measured windows the flush blocks for **101–113 ms** at N = 25 and **101–113 ms** at N = 100 — the same band, four times the work. That is exactly `WATCH_FLUSH_BUDGET_MS = 100` plus one entry, and it is the bound the issue states.
- **`git show` count is unchanged, as documented.** Exactly N invocations (25 → 25, 100 → 100, three independent N = 100 runs). The fix bounds *when*, not *how many*; the issue says so explicitly and rejects `cat-file --batch` with a reason.
- **The client-visible worst case is ~2× the budget, not 1×.** Consecutive deferred flushes (`schedule(0)` continuations) repeatedly run back-to-back with the pending HTTP request still queued, producing uninterrupted blocks of **205–238 ms**. Still bounded by a small constant and still independent of N (N = 25 also produced compounding, at 3 × ~110 ms windows with no pairing; N = 100 pairs more often simply because there are more flushes) — but not the ~110 ms the log reports.
- **Nothing is lost.** 15 flushes, 100 files, `db doctor` clean apart from the file I corrupted on purpose. Every deferred path was reconciled and projected.
- **Pre-fix is not re-derivable** (it would require reverting code). The log's pre-fix figures (575 ms at N = 100 without the shim, 1 630 ms with it) are consistent with what I measure as the *total* flush span (615–1 700 ms) — which is what an unbounded flush would present to a client as a single block, and what the budget now slices into ~110 ms pieces.

---

## Failures

None. Two MINOR observations, neither of which fails a criterion.

### MINOR-1: the log's reported worst-case flush latency is the modal window, not the worst

- **Criterion**: TEST-123 (recorded, and passing — the bound is stated and confirmed)
- **Claim**: `020-watcher-tree-key.md:265-267` — post-fix N = 100 worst `GET /api/health` latency **117 ms** (shim) and **110 ms / 125 ms** (no shim), presented as "the remaining number is the budget".
- **Observed**: five independent N = 100 runs give a worst of **205.5, 210.2, 212.4, 233.5, 238.2 ms**. The ~110 ms figure is the *modal* per-flush window (which I confirm, dozens of times over) but not the worst a client sees, because consecutive deferred flushes run back-to-back without yielding to a request already in the queue.
- **Why it is not a failure**: the criterion asks for the numbers to be recorded and the per-batch bound stated. The bound the issue actually states — "one flush blocks for at most `WATCH_FLUSH_BUDGET_MS` plus the cost of the single entry already in flight … independently of the batch size" — is precisely what I measured and it holds at both N = 25 and N = 100. The headline latency figure understates the client-visible worst by ~2×; that is a reporting inaccuracy in the evidence table, not a broken bound.
- **Reproduce**: create 100 docs each with one anchored parented thread in `data/docs/bulk/`, commit; run a serial `GET /api/health` poller; rewrite all 100 in one process (or `git checkout -- data/docs/bulk/`); take the max sample latency. ~2 of every 6–15 flushes pair up into a ~210 ms block.

### MINOR-2: "the regression tests fail against the pre-fix `flush()`" is asserted, not demonstrated

- **Criterion**: TEST-98 (passing on its other two clauses — tests exist, cover both directions, and `npm test` is green)
- **Claim**: `020-watcher-tree-key.md:295-298` — "with `documentKeys`'s `structural` parameter and the signature compare temporarily reverted, 5 of the 8 fail — both reproduced directions among them (`expected false to be true`, `expected true to be false`)".
- **Observed**: no run output is pasted; only the count and two assertion strings. This evaluation cannot re-derive it without editing application code, which it is forbidden to do. Stating it plainly: **this clause of TEST-98 rests on the implementer's word.** The surrounding evidence is corroborating rather than confirming — the two assertion messages are the right shape for the two directions, 5/8 is exactly the subset a `structural`-driven `documentKeys` would break, and my own live TEST-95b'' (a batch containing an `add` that emits no `["tree"]`) is an outcome the pre-fix code provably cannot produce.

---

## Summary

**PASS — 15 / 15 criteria.** SERVER-020 does what it says: the watcher's `flush()` now decides
`["tree"]` by measuring `GET /api/tree`'s signature across the re-projection, and SERVER-018's
biconditional holds on the out-of-band path in every case I could construct.

Eight out-of-band scenarios were run against a real server with the tree read and diffed on both
sides of every edit and the SSE frame read from a persistent subscriber. Both originally-reported
directions are fixed and symmetric; a body-only edit keeps `["docs"]` and `["docs", id]` while
losing the tree key; a folder appearing and vanishing still announces both times; parented and
standalone threads are correctly distinguished; unparseable and out-of-root files produce no frame
at all and leave the projection untouched. The sharpest test — a rename inside one flush, which
contains an `add` (`structural === true` under the old heuristic) but leaves the tree
byte-identical — emits **no** `["tree"]`. That single result is the clearest possible evidence
that the heuristic no longer decides anything.

`git diff abb6b48..4ea3e4b` over `query-keys.ts` and `events/` is empty, and three live
mutation-path frames reproduce sprint-007's recorded shapes byte-for-byte. The `db rebuild`
decision is blessed *with* the written rationale the criterion demanded — 37 lines that argue the
merits, name the rejected alternative, and restate the invariant with its exception — pinned by a
test whose name says the same thing.

The reassigned finding 10 lands here, in SERVER-020's issue file and its `flush()`, exactly where
Open Conflict 9 put it (SERVER-022's log confirms `watcher/watcher.ts` is untouched by that issue).
The bound is real: per-flush blocking is 101–113 ms at N = 25 and at N = 100 — the same band for
four times the work — where an unbounded flush would present 615–1 700 ms as one block. `git show`
is still called once per anchored file, as the issue says it is and explains why. `db doctor`
confirms all 100 deferred paths were reconciled and projected, and anchors remap correctly across
the split, including under the criterion's own named trigger (`git checkout` rewriting 100 files).

Two caveats worth carrying forward, neither disqualifying: the log's post-fix worst-case latency
(~110 ms) is the modal per-flush window rather than the worst a client sees (~205–238 ms, from
back-to-back deferred flushes), and the "these tests fail against the pre-fix `flush()`" clause is
asserted rather than shown with output.

**Environment**: ports 8974, 8975 and 8765 all confirmed with **zero listeners** at close; server
daemons 47330 and 25846 stopped by recorded pid; SSE subscribers 47780 and 26115 killed by captured
pid. Scratch workspace `/tmp/corpus-e008-s020-Qa1hW8` left in place. No state-changing git was run
in the corpus repo.
