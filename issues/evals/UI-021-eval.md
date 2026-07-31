# Evaluation: UI-021

**Date**: 2026-07-31
**Sprint**: sprint-018 (TEST-627–632)
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059), Vite `:5280`,
real Chromium. Fixture built independently: a real thread created through the CLI,
then **hand-edited on disk** into the both-answer-and-form shape, committed, and the
projection caught up with `corpus db rebuild`.

## E2E Proof-of-Work Audit

| Check                                   | Result       | Notes                                                                                              |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS         | TEST-627 → TEST-632 plus a diff of the two comment edits.                                           |
| Commands are specific and concrete      | PASS         | Fixture file verbatim, per-block `{ts, prompt, live, answered}` before and after.                    |
| Real E2E (not mocked)                   | PASS         | TEST-632 is a real hand-edited file, a real rebuild, a real browser answering the form.              |
| Scenarios cover acceptance criteria     | PASS         | Both criteria have both a unit and a live-app leg.                                                   |
| Application restarted after changes     | PASS         | `corpus db rebuild` after the hand edit; live half against the standing dev server.                  |
| Actual model recorded (implemented on:) | PASS         | "**implemented on: opus** (`claude-opus-5[1m]`), 2026-07-31."                                        |
| Reproduction logged before fix (bugs)   | PASS (noted) | The `continue` was restored and the failure observed — a genuine reproduction, but at **unit** level. |

**Note on the reproduction leg.** The pre-fix observation was made by putting the
`continue` back and running `parseFormBlock.test.ts` — one case failed
(`answers.get(stamp(1))` was `undefined`), three passed either way, and the log says
so plainly. That is a real reproduction of real pre-fix code, not a mocked one, but
it is not an E2E reproduction: the live leg (TEST-632) was run post-fix only. I
accept it here because the divergence lives in one pure function whose two readers
are the thing under test, and because I independently verified the **post-fix**
behaviour end-to-end below, which is what the criteria assert. Recorded so the
pattern is not read as a precedent for bugs with real runtime surface.

## Criteria Results

| #   | Criterion                                                              | Result | Notes                                                          |
| --- | ---------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| 1   | Renderer and server detector agree on the both-answer-and-form turn     | PASS   | Renderer live-count 1 == `needs=form` 1, before answering.     |
| 2   | Answering the newly-opened form clears it in the UI                     | PASS   | Renderer live-count 0 == `needs=form` 0, after answering.      |

## Evidence

### The fixture — the shape only a hand edit produces

`data/threads/th_qizz33dr.md`, below the frontmatter:

```
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
```

The second turn both answers the first form **and** carries its own — the case the
server's detector counts as both.

```
$ corpus db rebuild
rebuilt the projection in 11ms — 25 documents, 8 threads, 9 turns, …
```

### Before answering — the two numbers agree

```
server:    GET /api/docs?type=thread&needs=form  →  count 1   ids ['th_qizz33dr']

renderer:  .form-comment blocks = 2
           [{prompt:"F1?", live:false, answered:"Answered — F1-yes"},
            {prompt:"F2?", live:true,  answered:null}]
           liveCount = 1
           controls: ["F1-yes","F1-no","F2-yes","F2-no", INPUT, "Answer"]
```

The earlier form is closed by the carrying turn, and the carrying turn's **own** form
is live and offering controls — which is the whole point: pre-fix it was live and
*unanswerable*.

### After answering F2-no in the browser

Real clicks: the `F2-no` option button, then `.form-submit`.

```
renderer:  [{prompt:"F1?", live:false, answered:"Answered — F1-yes"},
            {prompt:"F2?", live:false, answered:"Answered — F2-no"}]
           liveCount = 0

server:    GET /api/docs?type=thread&needs=form  →  count 0   ids []
```

And the answer reached disk through the real route:

```
## user · 2026-07-31T10:03:14Z
**Answered:** F2-no
```

### The agreement, stated as the numbers

| observation                        | before | after |
| ---------------------------------- | ------ | ----- |
| `needs=form` count                 | 1      | 0     |
| renderer live-form count           | 1      | 0     |

They move together. Pre-fix they would not have: the server would have gone 1 → 0
while the renderer stayed at 1, because the turn's own form was never registered and
no answer could ever pair with it.

## Failures

None.

## Summary

2 of 2 criteria passed. The renderer and the server's `needs=form` detector agree on
the both-answer-and-form turn in both states, and the form the carrying turn opens is
answerable and clears when answered — verified on a hand-edited fixture built
independently of the implementer's, in a real browser against a real server.
