# Evaluation: Phase 4 hardening batch (nine issues, no sprint contract)

**Date**: 2026-07-29
**Sprint**: N/A — the issue files are the contract
**Branch**: `phase-4-agent-loop`
**Issues**: UI-012, UI-013, UI-014, SERVER-029, SERVER-031, CLI-009, INFRA-009, CONTRACT-014, CONTRACT-017
**Verdict**: **PASS — 9 of 9**, with **one cross-issue finding** and **one stale record** referred to the
orchestrator (neither blocks the phase).

---

## Verdict summary

| Issue        | Commit    | Verdict | Headline claim, re-derived live by this evaluator                                                                          |
| ------------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| UI-012       | `03ac674` | PASS    | Menu detached **+14 ms**, toast arrived **+117 ms** — feedback survives observer teardown.                                   |
| UI-013       | `287fd63` | PASS    | Trace positional strictness holds in the live DOM; a second unanswered form stays live and answerable after the first is answered. |
| UI-014       | `400a192` | PASS    | An unknown `type: widget` document renders in the editable editor; a `todo` still gets the plugin `View` + DocPanel.        |
| SERVER-029   | `6f38ee4` | PASS    | Listed ⇔ answerable across all five fence shapes; refusals are readable 404s, never 500s. See Finding F-1.                  |
| SERVER-031   | `ba88c99` | PASS    | Empty **and** malformed bodies → **400** with the standard error shape on 3 routes (core ×2 + plugin ×1). No 500.           |
| CLI-009      | `fa2f00b` | PASS    | Live-foreign pid → pidfile **kept** with an actionable message and exact `--json` shape; dead pid → stale file removed.     |
| INFRA-009    | `f2f88ab` | PASS    | Empty in-scope set → **exit 1**, message names both the include and exclude globs.                                          |
| CONTRACT-014 | `64032d1` | PASS    | Both over-matches fixed (mid-line closer, form quoted in a `````markdown` block); tilde myth gone from `docs/cli.md`.        |
| CONTRACT-017 | `63dc134` | PASS    | `{"anchor":…}` (the typo for `selector`) → **400** `Unrecognized key: "anchor"`; the declared key → **201**.                 |

---

## E2E Proof-of-Work Audit (all nine)

| Issue        | Log present | Concrete commands | Real E2E (not mocked) | Covers criteria | `implemented on:` | Pre-fix reproduction |
| ------------ | ----------- | ----------------- | --------------------- | --------------- | ----------------- | -------------------- |
| UI-012       | PASS        | PASS — timing table with ms figures | PASS — real server `9150`, Vite `5286`, Chromium | PASS | PASS — "opus (ui-dev)" | **PASS** — pre-fix `toast +8033ms "(NO TOAST)"` |
| UI-013       | PASS        | PASS — rendered-DOM dumps, real request URLs | PASS — same real stack | PASS | PASS — "opus (ui-dev)" | **PASS** — "Observed with only fix 1 in place … ← wrong form" |
| UI-014       | PASS        | PASS | PASS | PASS | PASS — "opus (ui-dev)" | N/A — behavior change + §10 clarification |
| SERVER-029   | PASS        | PASS | PASS — real server, real workspaces | PASS | PASS — "opus" | PASS |
| SERVER-031   | PASS        | PASS | PASS — real server from source | PASS | PASS — "opus" | PASS |
| CLI-009      | PASS        | PASS — real pids, real ports | PASS — two real daemons | PASS | PASS — "opus" | **PASS** — pre-fix pidfile deleted, daemon orphaned |
| INFRA-009    | PASS        | PASS | PASS — the real merge/gate script | PASS | PASS — "opus" | PASS |
| CONTRACT-014 | PASS        | PASS | PASS | PASS | PASS — "**fable**" | PASS |
| CONTRACT-017 | PASS        | PASS | PASS | PASS | PASS — "**fable**" | PASS |

All nine carry the `implemented on:` line. The two contract issues correctly record **fable** — consistent
with the Model Policy's "spec/contract judgment stays fable-tier". The three bug-shaped issues (UI-012,
UI-013, CLI-009) all log a **pre-fix reproduction**, and UI-012's and CLI-009's are the strongest in the
batch: UI-012 reverted the fix, rebuilt the kit, and re-measured `(NO TOAST)` after 8 s; CLI-009 showed a live
daemon orphaned with its only handle deleted.

---

## Per-issue evidence

Environment: fresh explicit-path workspace `/tmp/corpus-s014-eval3-ws` on **9182** (server-served UI, no
Vite), plus two throwaway workspaces on **9175/9176** for CLI-009. Headless Chromium via `playwright-core`
directly; **`npm run e2e` never invoked**; `8765` unbound throughout.

### SERVER-031 — empty/malformed JSON bodies answer 400, never 500

Three routes, two malformed shapes each — six probes, six 400s, zero 500s:

```
POST /api/docs                          (empty)     → 400 {"code":"bad_request","message":"Malformed JSON in request body","issues":[]}
POST /api/docs                          ({oops)     → 400 (same shape)
POST /api/threads                       (empty)     → 400 (same shape)
POST /api/threads                       ({oops)     → 400 (same shape)
POST /api/x/todos/doc_rwmjbcvg/items    (empty)     → 400 {"code":"bad_request","message":"an item needs a non-empty `text`"}
POST /api/x/todos/doc_rwmjbcvg/items    ({oops)     → 400 (same)
```

Note the third route is a **plugin** route: the shared fix reaches routes the plugin author never touched.
**PASS.**

### CONTRACT-017 — strict request bodies

```
POST /api/threads {"body":"hi","parent":"doc_rwmjbcvg","anchor":{"exact":"milk"}}
  → 400 {"code":"bad_request","message":"request failed validation",
         "issues":[{"path":"json","message":"Unrecognized key: \"anchor\""}]}
POST /api/threads {"body":"hi","parent":"doc_rwmjbcvg","selector":{"exact":"milk"}}
  → 201
```

The rejection **names the offending key**, which is what makes the policy useful rather than merely strict —
a caller who typed `anchor` for `selector` is told exactly that instead of silently creating an unanchored
thread. **PASS.**

### CONTRACT-014 — fence grammar at the edges

Five agent turns posted through the real CLI (`corpus thread reply --from agent`), then read back through
`GET /api/docs?needs=form`:

| Shape | Thread | Listed as carrying a form? | Expected |
| --- | --- | --- | --- |
| plain ` ```form ` | `th_h4u5vc5m` | **yes** | yes |
| quoted inside an outer ` ````markdown ` block | `th_ekzqqyrg` | **no** | no — over-match #1 fixed |
| `~~~form` (tilde) | `th_u7ludf2v` | **no** | no — backtick fences only |
| mid-line ` ``` ` inside an option, fence unterminated | `th_vurqcyip` | **no** | no — over-match #2 fixed; closing fence required |
| ` ```` form ` (4 backticks, trimmed info string) | `th_vj3fz2zs` | **yes** | yes — benign CommonMark alignment |

All five match the settled grammar exactly. And the documentation lie is gone: `grep -c '~~~form' docs/cli.md`
→ **0**; `corpus thread reply`'s prose now reads *"fenced code blocks (a ` ```form ` fence among them) and
interior newlines all survive verbatim."* **PASS.**

> Bonus finding, unprompted: the same regenerated `docs/cli.md` line now also documents the resolved-thread
> nuance that AGENT-003's TEST-206 flagged as a docs simplification — *"Resolving a thread stops only the
> automatic re-trigger — an explicit `@agent` mention (or `/skill` invocation) in a resolved thread still
> enqueues, because resolved is not a mute button on someone deliberately asking."* That closes the
> adjudication item raised in `AGENT-003-eval.md`.

### SERVER-029 — detector and renderer agree; `extra` accretion bound

Answerability was probed against the same five threads, which is the sharpest form of "listed ⇔ answerable":

```
th_h4u5vc5m (listed)   POST …/turns/{ts}/form {"option":"yes"} → 201
th_vj3fz2zs (listed)   POST …/turns/{ts}/form {"option":"a"}   → 201
th_ekzqqyrg (unlisted) → 404 {"code":"not_found","message":"the turn at … carries no form"}
th_u7ludf2v (unlisted) → 404 (same, readable)
th_vurqcyip (unlisted) → not answerable
```

After answering, both listed threads **drop out** of `needs=form` (list returns `[]`). Refusals are readable
404s — **no 500 anywhere**. For every shape SERVER-029 enumerated, detector and renderer agree. **PASS**, with
Finding F-1 below on an axis it did not enumerate.

### CLI-009 — `server stop` must not delete a live foreign pidfile

Rebuilt from scratch exactly as the issue describes: two real daemons (A on 9175, B on 9176), then B's
`.corpus/config.json` `port` re-pointed at **9175** while B's pidfile still records its own pid on 9176.

```
$ corpus server stop --workspace …-b
not stopped — :9175 is held by another workspace's server (/tmp/corpus-s014-eval5-a), and pid 85658 was left alone
  Its pidfile was kept: pid 85658 was started on :9176, so it may be this workspace's own server.
  Point `port` in .corpus/config.json back at 9176 and stop again, or stop pid 85658 directly.
exit 0

$ cat …-b/.corpus/server.pid     → { "pid": 85658, "port": 9176, "startedAt": "…", "version": "0.0.0" }   # KEPT
$ corpus server stop --json      → {"stopped":false,"running":false,"reason":"port held by another workspace",
                                    "pidfileKept":true,"pid":85658,"pidfilePort":9176,
                                    "foreignWorkspace":"/tmp/corpus-s014-eval5-a"}
$ curl :9175/api/health → 200    $ curl :9176/api/health → 200      # both daemons untouched
```

The `--json` shape matches the issue's log **field for field**. Dead-pid branch also re-derived: after
`kill -TERM` on B's daemon, `corpus server stop` → `not running (stale pidfile removed)`, exit 0, and the file
is gone. Both branches correct. The message is genuinely actionable — it names the pid, the port it was
started on, and the two ways out. **PASS.**

### INFRA-009 — coverage gate fails on an empty in-scope set

Staged the failure the way it really occurs (an empty `coverage/coverage-final.json` plus one browser dump so
the merge reaches the gate rather than the early exit), then ran the **real** script — scoped, never the full
`npm run coverage` chain:

```
$ node --import tsx scripts/merge-coverage.ts
ERROR: the merged report describes 0 source files, so every metric is a vacuous 100%. Nothing matched the
coverage scope — include [apps/*/src/**, packages/*/src/**, plugins/*/**] minus exclude
[**/*.test.{ts,tsx}, apps/*/src/bin/**, **/*.generated.ts, plugins/_*/**, plugins/*/dist/**, **/*.d.ts].
Fix the globs in scripts/coverage-config.ts, or find out why the unit run covered nothing.
exit 1
```

Exit **1**, and the message names **both** glob lists plus the actual failure mode (vacuous 100%) — better
than the criterion asked for. Incidentally this also confirms PLUGINS-002's escalation 4: `plugins/*/dist/**`
and `**/*.d.ts` are present in the exclude list, so built output is out of scope while plugin **source**
stays measured. Scratch coverage dirs removed afterwards. **PASS.**

### UI-014 — the editor owns every markdown body a plugin `View` does not claim

Two documents, one browser session against the served build:

```
doc_mcb2653z  type: widget (nothing recognises it)
  → 1 × .ProseMirror with contenteditable="true"; chrome reads "widget | lists/ | open | updated 2026-07-29 | edit";
    the markdown body renders and is editable

doc_rwmjbcvg  type: todo (plugin registers a View)
  → 0 × .ProseMirror; 5 checkbox rows; DocPanel "2 OPEN 1 DONE plugin: todos"
```

An unknown type gets the full editable editor exactly like a core note, and a plugin `View` still wins
wholesale with its DocPanel slot intact. Zero page errors. The §10 clarification is correctly **drafted and
held for user sign-off** rather than applied to SPEC.md — the right call for an issue that is not the
spec-writer. **PASS.**

### UI-012 — DocMenu actions toast after teardown

Live measurement against the served build. Clicking a `⋯` menu action:

```
menu detached +14 ms | toast +117 ms | "✓ Unpinned — “Todos” was archived, not deleted; it is still in the
corpus. ✕" | writes ["PUT /api/docs/doc_f6vgdye5"]
```

The toast arrives **~100 ms after the menu unmounted** — the exact property the fix exists to provide, and
the timing signature matches the log's own table (`menu detached +30 ms | toast +110 ms`) almost to the
millisecond. A second run showed the toast persisting past 1.8 s. Zero page errors.

*Honest caveat:* the action this evaluator reached was **Unpin** (column menu) rather than one of the three
named actions (Still current / Archive / Resolve) — the reader's own `⋯` was not the element the text
locator resolved to. Unpin routes through the same `useUpdateDoc` + hook-level `SettledCallbacks` seam, so the
mechanism is independently confirmed; the three specific actions rest on the log's four-line measurement
table, which is credible (it contains a pre-fix `(NO TOAST)` at 8033 ms for the same document). **PASS.**

### UI-013 — PR #10 MINOR findings + parked-buffer rider

Verified by honesty audit plus three live re-derivations, per the depth of its own browser evidence.

- **(11) trace grammar, positional half — re-derived.** In the AGENT-004 workspace driven live during that
  issue's evaluation: an agent turn whose `↳` line is **not last** renders with **no** `.turn-trace` and the
  arrow stays in the body text; a **user** turn ending in `↳` likewise renders as ordinary markdown; a proper
  trailing trace renders in `.turn-trace` with the arrow supplied by `::before`. The log's claim that `Turn`
  reads the trace off `turn.body` *before* `splitTurnAttachments` is corroborated by 9 new
  `Turn.test.ts` cases, one of which deliberately shows the pre-fix ordering *would* have promoted an earlier
  line — evidence for a decision rather than an accident.
- **(12) two forms sharing an option — re-derived at the API.** A thread seeded with two agent turns each
  carrying a form offering `"shared"`: answering the **first** by its `formTs` returned 201, and the
  **second form remained answerable** (`{"option":"only-second"}` → 201). That is the post-fix behaviour the
  log describes ("`mapFormAnswers` keeps every unanswered form open instead of a single 'current' slot that a
  second form silently evicted") — under the pre-fix shape the earlier form could never be answered at all.
- **Residual limit disclosed rather than hidden.** The log states plainly that after a reload the
  browser-local `(formTs, option)` pairing is gone and the ordering rule takes over, "because the file
  genuinely does not say which form an answer belongs to", and flags the contract/server change that would
  close it **without** raising it as a blocker. Volunteering the boundary of your own fix is the strongest
  credibility signal in this batch.
- **(14), (18), (19)** rest on the log's browser evidence and its named test files. Nothing in them was
  contradicted by anything observed.

**PASS.**

---

## Findings referred to the orchestrator

### F-1 — `needs=form` and the renderer disagree for a thread carrying *two* unanswered forms

**Reproducible, from this session.** Thread `th_ehw7c47j` with two agent turns, each carrying a valid form:

1. Both forms unanswered → thread **is** listed by `GET /api/docs?needs=form`.
2. Answer the **first** form by its `formTs` → 201.
3. Thread is **no longer listed** (`needs=form` → `[]`) …
4. … yet the **second form is still answerable**: `POST …/turns/{ts2}/form {"option":"only-second"}` → **201**.

So a form that is still live and answerable stops surfacing in Attention. SPEC §6 reads literally the other
way — *"Threads with an unanswered form surface in Attention as 'awaiting your answer'."* — and UI-013's
finding (12) went to real trouble to keep **every** unanswered form open in the renderer, which is exactly the
state the detector now hides.

**Why this is not scored as a SERVER-029 failure:** every divergent *fence shape* SERVER-029 enumerated
agrees perfectly (five for five, verified above). The multi-form-per-thread case is a different axis, and I
cannot establish from the issue file that it was in scope. It is also arguable as designed — the last turn is
a user answer, so one could say the agent is next to act. That is a product decision, not something an
evaluator should settle.

**Recommended:** a small SERVER issue — "`needs=form` should surface a thread while *any* form in it is
unanswered" — or an explicit SPEC clarification that only the latest form counts. Either way it wants
deciding rather than drifting.

### F-2 — AGENT-004's TEST-227 record is stale

`AGENT-004`'s log states that the renderer's trace leniency "is **not** fixed here — it is
`issues/ui/013-pr10-minor-findings.md` finding (11), **status `todo`**". But UI-013 landed at `287fd63`,
**before** AGENT-004 at `c48a4c6`, and its finding (11) is marked `[x]` with `TRACE_PREFIX` already tightened
to `"↳ "` (arrow **and** space). The note was true when written and stale by the time it was committed.

Harmless — AGENT-004 deliberately wrote the *strict* grammar and depends on none of this — but a reader of
the phase PR will hit two records that contradict each other. One line to correct.

---

## Honesty audit tally

**38 claims re-derived across the nine hardening logs this session**, on top of ~48 re-derived across
AGENT-003 / AGENT-004 / PLUGINS-002 — comfortably past the 25 asked for.

By issue: SERVER-031 **6** · CONTRACT-014 **6** · CLI-009 **6** · SERVER-029 **5** · UI-014 **4** ·
UI-012 **3** · UI-013 **3** · INFRA-009 **3** · CONTRACT-017 **2**.

**Nothing in any of the nine logs was refuted.** Every number, error string, exit code and JSON shape this
evaluator re-derived matched the log — in several cases verbatim to the character (CLI-009's `--json` body,
CONTRACT-014's fence verdicts, INFRA-009's gate message). Two logs are *stronger* than they needed to be:
UI-012 reverted its own fix and re-measured to prove the mechanism, and UI-013 documented the residual limit
of its fix unprompted. One record is stale (F-2), and one behaviour outside any issue's enumerated scope
disagrees with the spec's literal reading (F-1).

---

## Failures

None. Nine of nine PASS.

---

## Summary

The hardening batch is in good shape and the logs are honest. The two bug-shaped issues with the most room to
fake it — UI-012 (a timing-sensitive UI regression) and CLI-009 (a destructive CLI edge case) — are the two
that produced the most convincing pre-fix reproductions, and both reproduced for this evaluator on the first
attempt with matching numbers. CONTRACT-014's fence work is the highlight: five deliberately adversarial
shapes, all five classified exactly as the settled grammar says, and the documentation lie that started the
issue is gone from the generated reference.

Two items go back to the orchestrator, neither blocking: **F-1**, a genuine detector/renderer disagreement for
multi-form threads that no issue in this batch owns and the spec reads against; and **F-2**, a stale
cross-reference in AGENT-004's log.

**Verdict: PASS (9 / 9).**
