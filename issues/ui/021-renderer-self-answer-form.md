# [UI-021] Renderer: a form-carrying answer turn leaves its own form unanswerable-forever

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-008
- Blocks: —

## Spec References
- SPEC.md §6 — forms; §11 — needs=form

## Summary
SERVER-032's audit fix round (FIX 10, 2026-07-30): the server now counts a turn that
both answers a form and carries one as BOTH — it closes the earliest open form offering
its option, then opens its own. The UI's `mapFormAnswers`
(`apps/ui/src/thread/parseFormBlock.ts`) still `continue`s past its own registration,
leaving such a form rendered live forever and now disagreeing with the detector the
server pinned. One-line change per the server's docblock; add the paired test mirroring
the server's named case. Only hand-edited files produce the turn — low urgency, but the
divergence is documented server-side and should not outlive the phase after this one.

## Acceptance Criteria
- [x] Renderer and server detector agree on the both-answer-and-form turn (paired test)
- [x] Answering the newly-opened form clears it in the UI

## Technical Design
### Files to Create/Modify
- apps/ui/src/thread/parseFormBlock.ts (+ test)

## Testing Strategy
apps/ui scoped.

## E2E Verification Plan
Hand-edited fixture thread; renderer count matches `needs=form`.

## E2E Verification Log

**implemented on: opus** (`claude-opus-5[1m]`), 2026-07-31. Sprint contract: `issues/sprints/sprint-018.md`
(TEST-627–632, Adjudication 8). Ports: server `8798` **not used** — see TEST-632 below; the fixture
path needs no server and the live half was run against the UI-020 workspace already standing on
`8797`. Scratch: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/021-<suffix>`.

### Pre-fix reproduction (SDLC bug rule)

The `continue` at `parseFormBlock.ts:163` was temporarily restored and the new block run against it.
Three of the four cases pass either way — the renderer has no tri-state, so "open-forever" and
"open-and-clearable" look identical at the instant the turn arrives — and the fourth is the bug:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui/src/thread/parseFormBlock.test.ts \
    -t "a turn that both answers a form and carries one"
 ✓ closes the earlier form and opens its own
 × can then be answered like any other form, so the reason clears
   → expected undefined to be 'F2-no' // Object.is equality
 ✓ never answers itself, however its own options read
 ✓ opens its form even when its answer matches nothing
 Tests  1 failed | 3 passed | 18 skipped (22)
```

`answers.get(stamp(1))` is `undefined` pre-fix: the turn's own form was never registered in `open`,
so the later `**Answered:** F2-no` had nothing to pair with and the form stayed live forever. The
`continue` was then removed again and the same run is green (below).

### TEST-627 · the renderer registers the turn's own form — **PASS**

`[form(0,1), answeringForm(1,"F1-yes",2)]`, the server's `form.test.ts:180` fixture, transcribed to UI
turns. `mapFormAnswers(...).get(stamp(0)) === "F1-yes"` and the live-form list is exactly `[stamp(1)]`
— controls for the new form, none for the closed one. "Live" is not asserted as an internal flag: the
test derives it with `liveForms()`, from `mapFormAnswers` + `parseFormBlock`, the same two functions
the thread view itself uses, so it cannot claim a state the rendered thread does not have.

### TEST-628 · answering the newly-opened form clears it — **PASS**

`[form(0,1), answeringForm(1,"F1-yes",2), answer(2,"F2-no")]` (`form.test.ts:211`'s fixture): both
`stamp(0)` and `stamp(1)` are in the answers map and `liveForms(...)` is `[]`. This is the assertion
that failed pre-fix.

### TEST-629 · the paired block mirrors the server case for case — **PASS**

`apps/ui/src/thread/parseFormBlock.test.ts` gains a nested `describe` under `describe("answers")`
carrying the **same block name** — `"a turn that both answers a form and carries one"` — and the
**same four case names**, in the file's lowercase-behavioural voice:

| case | server (`apps/server/src/core/form.test.ts`) | renderer (`apps/ui/src/thread/parseFormBlock.test.ts`) |
| --- | --- | --- |
| `closes the earlier form and opens its own` | `:180` | ✅ added |
| `can then be answered like any other form, so the reason clears` | `:189` | ✅ added |
| `never answers itself, however its own options read` | `:194` | ✅ added |
| `opens its form even when its answer matches nothing` | `:201` | ✅ added |

The fixture helpers are transcribed too — `stamp(index)`, `formTurn`, `answeringForm(index, option,
label)` with the same `F<n>-yes` / `F<n>-no` option scheme — so the two blocks read alike rather than
merely testing alike.

### TEST-630 · no existing pairing rule regressed — **PASS**

The seven cases under `describe("two unanswered forms")` and the three under `describe("answers")`
are **unmodified** — the only edits to that file are the added import line
(`FORM_ANSWER_LABEL`, `type AnswerableTurn`) and the appended `describe`. In particular *"credits the
form the session actually answered, not the earlier one"*, *"leaves a known pairing's form alone when
a later answer could also fit it"*, *"still answers the earlier one after the later one has been
answered"* and *"keys every answer by the carrying turn's ts, never by the option's prose"* all pass
untouched. The change is the removal of one `continue`; the three-tier `open.find` precedence above
it is byte-identical, and so is the `turn.author !== "agent"` guard the fall-through now reaches.

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run \
    apps/ui/src/thread/parseFormBlock.test.ts apps/server/src/core/form.test.ts
 ✓ apps/ui/src/thread/parseFormBlock.test.ts (22 tests)
 ✓ apps/server/src/core/form.test.ts (29 tests)
 Test Files  2 passed (2)      Tests  51 passed (51)
```

(22 = the 15 that were there plus the 4 new cases plus 3 pre-existing in the same file's other
blocks — no case was removed.)

### TEST-631 · the docblock and the pinned test stop describing a divergence — **PASS**, bounded by Adjudication 8

**`apps/server/src/core/form.ts`** — the closing paragraph of `readThreadForms`'s docblock, comment
lines only:

```diff
- * This is the single point where the rule is deliberately *wider* than the
- * renderer's `mapFormAnswers`, which `continue`s past its own registration on
- * that turn and therefore leaves such a form live forever: after answering it
- * the board goes quiet and the controls stay. The divergence is pinned by a
- * test below and reported for a UI follow-up; it is reachable only from a
- * hand-edited thread file, and of the two behaviours the clearable one is the
- * one to converge on.
+ * The renderer's `mapFormAnswers` (`apps/ui/src/thread/parseFormBlock.ts`) read
+ * this shape differently until UI-021: it `continue`d past its own registration
+ * on such a turn, so the form stayed live forever — after answering it the board
+ * went quiet and the controls stayed. It now falls through and registers, which
+ * is the clearable behaviour of the two, so the badge and the controls agree
+ * here as they do everywhere else. The test below pins the agreement rather than
+ * the divergence.
```

**`apps/server/src/core/form.test.ts`** — the preceding comment block and **the `it` name string**,
which Adjudication 8 permits by name. The body is byte-identical:

```diff
-    // The one place this reader is deliberately wider than the renderer's
-    // `mapFormAnswers`, which `continue`s past its own registration on such a
-    // turn and so leaves the form live forever. Pinned so the divergence is a
-    // decision rather than a surprise; the UI follow-up converges on this side,
-    // because §10's reasons have to be clearable (SERVER-022 finding 3).
-    it("diverges from the renderer, which would leave that form unanswerable", () => {
+    // Pinned as the *agreement* it now is: the renderer's `mapFormAnswers`
+    // used to `continue` past its own registration on such a turn and leave the
+    // form live forever, and UI-021 converged it on this side, because §10's
+    // reasons have to be clearable (SERVER-022 finding 3). Its paired block —
+    // `apps/ui/src/thread/parseFormBlock.test.ts`, same name, same four cases —
+    // is what keeps the two readers from drifting apart again.
+    it("agrees with the renderer, which now clears that form too", () => {
       const turns = [form(0, 1), answeringForm(1, "F1-yes", 2), answer(2, "F2-no")];
       expect(readThreadForms(turns)[1]).toEqual({ hasForm: true, answered: true });
     });
```

**No executable-line change in `apps/server`.** I never run git, so this is stated from the edits
themselves: the two edits above are the *only* ones I made under `apps/server`, one is a comment
block inside a `/** … */`, the other is a comment block plus the string literal naming a test. Every
assertion, every fixture and every expression is untouched, and `apps/server/src/core/form.test.ts`
still passes with 29 tests (same count as before).

**Orchestrator, scope the check.** `git diff apps/server` on this branch is **not** all mine —
SERVER-033 ran concurrently in the same tree and its changes (`apps/server/package.json`, the two new
`*.real-listener.test.ts` files, and whatever the v2 adapter forced) are in the same working copy.
Adjudication 8's "no executable-line change" claim applies to
`git diff apps/server/src/core/form.ts apps/server/src/core/form.test.ts` — exactly the two hunks
quoted above, and nothing else under `apps/server` was touched by UI-020 or UI-021.

The **renderer's own docblock** (`parseFormBlock.ts`, the `mapFormAnswers` header) listed two pairing
rules; it now lists three, the new one naming the server's `readThreadForms` as the reader it agrees
with and the reason the clearable behaviour was the one to converge on (§10's reasons must have an
action that clears them, SERVER-022 finding 3). Its "Two rules" lead-in became "Three rules".

### TEST-632 · the fixture round-trips against the real detector — **PASS**

A real thread was created on the workspace standing on `8797`, then **hand-edited on disk** into the
shape only a hand edit produces (the answer route writes the label and the note and nothing else),
committed, and the projection caught up with `corpus db rebuild` — `rebuilt the projection in 9ms —
14 documents, 1 thread, 2 turns`. The file, `data/threads/th_a4zcghnw.md`, verbatim below the
frontmatter:

    ## agent · 2026-07-31T08:04:00Z
    Which one?

    ```form
    prompt: F1?
    options:
      - F1-yes
      - F1-no
    ```

    ## agent · 2026-07-31T08:05:00Z
    **Answered:** F1-yes

    And now the next one.

    ```form
    prompt: F2?
    options:
      - F2-yes
      - F2-no
    ```

The renderer's side was read in a real Chromium against the dev server on `5276` (proxying to
`8797` — proxy proof in UI-020's log, same session), surveying `.form-comment` blocks for a live
`.form-submit`:

| observation | before answering | after answering F2-no in the browser |
| --- | --- | --- |
| `GET /api/docs?type=thread&needs=form` | `count = 1`, `ids = ["th_a4zcghnw"]` | `count = 0`, `ids = []` |
| renderer's live-form count for that thread | `live count = 1` | `live count = 0` |

Per-block, before: `{ts: 08:04:00Z, prompt: "F1?", live: false, answered: "Answered — F1-yes"}` and
`{ts: 08:05:00Z, prompt: "F2?", live: true, answered: null}` — the earlier form closed by the
carrying turn, the carrying turn's **own** form live and offering controls (TEST-627 in the real
app). After clicking `F2-no` and submitting: `{08:05:00Z, live: false, answered: "Answered — F2-no"}`
and `live count = 0` (TEST-628 in the real app), with the route's answer turn appended to the file —
`## user · 2026-07-31T08:05:01Z` / `**Answered:** F2-no`.

The two numbers agree in both states, which is the whole content of this issue. Pre-fix they did not:
`needs=form` would have gone 1 → 0 while the renderer stayed at 1, because the second form was never
registered and no answer could ever be paired with it.

### Scope, ports and cleanliness

- Files changed: `apps/ui/src/thread/parseFormBlock.ts` (one `continue` removed, docblock third
  rule), `apps/ui/src/thread/parseFormBlock.test.ts` (import line + appended `describe`), and the two
  comment/test-name edits in `apps/server` above. Nothing else.
- `git diff packages/kit`, `git diff packages/contract` and `git diff SPEC.md` are **empty for
  UI-021** (UI-020's kit diff is that issue's, by Adjudication 6).
- Port `8798` was allocated to this issue and **never bound** — the fixture path needs no server and
  the live half reused the UI-020 workspace on `8797`, which is this agent's own. `8765` was never
  bound, never killed and never proxied into; see UI-020's log for the `lsof` evidence, taken in the
  same session.
- No state-changing git command was run in this repository by me. The commits inside the scratch
  workspace are the server's own auto-commit.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
