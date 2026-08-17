# [UI-117] `anchor-layer.spec.ts:475` reads between two generations of highlight

_(Retitled on completion: the original title asserted an `innerText`/layout race. The evidence disproved that — see the log.)_

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-116 (which surfaced it by adding load), INFRA-028

## Summary

`apps/ui/e2e/anchor-layer.spec.ts:475` intermittently fails with
`allInnerTexts()` returning `""` **after** `toHaveCount(2)` has already passed —
`innerText` read before layout flushed.

**Pre-existing and load-sensitive, not caused by UI-116.** The evidence, from
UI-116's four full Playwright runs: baseline `HEAD` was 382/0; the fixture change
alone was 383/0; the full tree ran 391/1, 391/1, 392/0. Running the two
implicated files with `--repeat-each=3` (63 tests) was clean. So nine extra tests
on four workers tipped over an existing sensitivity rather than introducing one.

CI's `retries: 2` covers it, which is why it has not been noticed. That is also
the argument for fixing it rather than leaving it: a spec that passes on retry is
indistinguishable from one that passes, and the next real flake in that file will
be read as this one.

**UI-116's agent deliberately did not touch it** — editing an unrelated spec to
make its own change look clean is how a real regression gets buried. That was the
right call and this issue is the consequence of it.

## Acceptance Criteria

- [x] The spec reads `textContent` (or otherwise waits for the text) rather than
      `innerText`, which forces layout and is what makes the read racy
- [x] The fix is justified against the actual failure mode, not applied by
      superstition: say why `toHaveCount` passing does not imply the text is
      readable
- [x] Verified under load — the conditions that produced it — not in isolation,
      where it already passes. `--repeat-each` on a quiet machine is not the
      reproduction
- [x] Sweep `apps/ui/e2e/` for other `allInnerTexts`/`innerText` reads that
      follow a count assertion; if the pattern appears elsewhere it is the same
      latent flake, and the sweep's extent should be reported either way

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/anchor-layer.spec.ts`

## Testing Strategy

The spec is the test. Reproduction is the difficulty — it needs the whole suite
on a loaded machine.

## E2E Verification Log

Model: **Opus 5 (1M context)** (`claude-opus-5[1m]`), ui-dev.

Invocation throughout: `CORPUS_UI_PORT=5373
CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799` (INFRA-028 — a dead origin, so Vite
cannot proxy to the live server on 8765). Ports 5173 and 8765 never bound.

### The mechanism, established before the fix

The issue's premise — `innerText` forces layout, and that is what makes the read
racy — is **not** what breaks this line. The real cause is that `.anchor-hl` has
**two generations** across a send, and the read is taken between them.

`anchorDecorations.ts` paints `.anchor-hl` from two independent sources: the
composer's **provisional** range (`data-provisional="true"`, no thread id), lit
from the moment the composer opens, and the **server's** anchors
(`data-thread`/`data-anchor`). A selection crossing the `**` splits into two
inline decoration spans in *either* generation, so the count is 2 in both.
`useAnchorLayer`'s `post` drops the provisional range in the mutation's
`onSuccess`; the server's anchors land only once the invalidated document read
resolves and `applyAnchors` runs. Between those two the body carries **zero**
`.anchor-hl`.

Proven, not assumed. A temporary probe sampled
`.reader .doc-body .anchor-hl` every animation frame through this exact flow,
recording count, `innerText`, `textContent` and the `data-provisional` count.
With the document refetch delayed 600 ms:

```
t=18ms   count 0
t=219ms  count 2   provisional 2   ["Moushmi Verma", " wrote it up on Monday."]
t=306ms  count 0                   []          <- the hole
t=962ms  count 2   provisional 0   ["Moushmi Verma", " wrote it up on Monday."]
```

`innerText` and `textContent` agreed at every sample, including reading nothing
together. There is no observed layout-timing effect here at all.

So: **`toHaveCount(2)` passing does not imply the text is readable** because a
count assertion says only that two nodes matched at *some* instant — not which
generation they belonged to, and not that they are still attached when the next
call runs. `toHaveCount` retries and returns at the first satisfying sample,
which can be the provisional pair. And `allInnerTexts()` / `allTextContents()`
are both implemented as `frame.$$eval(selector, ee => ee.map(...))`
(`playwright-core` `Locator`): one atomic in-page evaluation with **no waiting
at all**, returning `[]` when nothing matches — and `[].join("")` is `""`, the
exact value the live failure reported. (The single-element `locator.innerText()`
goes through the waiting selector path and cannot silently read nothing; only
the `all*` forms can.)

`innerText` remains the more fragile read *on principle* — it is defined over
rendered text, so it answers for layout and computed visibility, where
`textContent` is a pure tree read — and the spec now says so. But swapping the
read alone would not have fixed this line, and the reproduction below shows it
does not.

### Reproduction

1. **Full suite, pre-fix, unmodified spec** —
   `npm run e2e` → **395 passed (3.5m)**. Did not fire on this machine; the live
   failure is stochastic and load-dependent, so a single run is not a reliable
   trigger.
2. **Deterministic reproduction** — a temporary spec running the *same* code
   path with only the two things load stretches dialled up: the empty window
   (document refetch delayed 600 ms) and the gap between the count assertion and
   the read (250 ms, the CDP stall a busy machine imposes). Three variants, one
   run, `--workers=1`:
   - `OLD form` (unscoped count → `allInnerTexts()`): **FAIL** —
     `Expected: "Moushmi Verma wrote it up on Monday." / Received: ""`, character
     for character the error carried by the live failure's `error-context.md`,
     which was on disk in `apps/ui/test-results/` at the start of this session.
     (Playwright clears its output directory on every run, so that artifact is
     gone; its `Received: ""` and its page snapshot — which showed the anchor,
     the chip and the pip all correctly present — were read before the first
     run overwrote it, and are what pointed at an empty *array* rather than
     empty *text*.)
   - `OLD form, textContent instead` (unscoped count → `allTextContents()`):
     **FAIL**, identical error. This is the evidence that a bare
     `innerText → textContent` swap is not a fix.
   - `NEW form` (count scoped to `[data-thread]` → polled `allTextContents()`):
     **PASS**.

   Both temporary specs (`zz-ui117-probe.spec.ts`, `zz-ui117-repro.spec.ts`)
   were deleted afterwards; nothing of them remains in `apps/ui/e2e/`.

### The fix

`anchor-layer.spec.ts:485` ("leaves the thread anchored to the words, not
orphaned at birth"):

- the count is taken on `.reader .doc-body .anchor-hl[data-thread]`, which is
  the **server's** generation. This is not cosmetic scoping: the test's own
  comment already claimed "a highlight here is the server's answer, not the
  optimistic decoration", and before this the unscoped `toHaveCount(2)` could be
  satisfied entirely by the optimistic pair — the test did not enforce what it
  said. Scoping makes the assertion true *and* makes the awaited state terminal,
  so there is no later generation change to race with.
- the text is asserted with `expect.poll(...allTextContents().join(""))` — it
  **waits for the text** instead of reading it once, and reads `textContent`.
  Both, deliberately: scoping alone leaves a one-shot read, polling alone leaves
  the read pointed at a generation that changes.

`anchor-layer.spec.ts:366` ("highlights the selected words, and none of the
markup") carried the same one-shot `allInnerTexts()` read. No composer opens
there — the document arrives with its anchor resolved — so there is only one
generation and no hole. But the read backed a *negative* claim
(`not.toContain("*")`), which an empty array satisfies while proving nothing.
Now read via `allTextContents()` and asserted **positively** as well, so an
empty read fails instead of passing.

### Verification

Full suite, post-fix, twice — matching the two-for-two the failure scored:

- run 1 → **395 passed (3.9m)**, exit 0
- run 2 → **395 passed (4.7m)**, exit 0

Zero failures, zero flaky, zero retries in either (local config has
`retries: 0`, so nothing was masked). All 12 `anchor-layer.spec.ts` tests green
in both, including `:485` and `:366`.

Checks on the changed file: `prettier --check` clean, `eslint` clean,
`tsc --noEmit -p apps/ui/tsconfig.json` exit 0 with zero `error TS` (scope
confirmed via `--listFiles` through `rtk proxy`, since the proxy prints a
success line regardless).

### The sweep

`apps/ui/e2e/` in full — 51 files — grepped for `innerText`, `allInnerTexts`,
`textContent`, `allTextContents`. Every hit classified:

| Site | Form | Verdict |
| --- | --- | --- |
| `anchor-layer.spec.ts:374` | `allInnerTexts()` after `toHaveCount(2)` | **Fixed** (vacuous negative assertion) |
| `anchor-layer.spec.ts:491` | `allInnerTexts()` after `toHaveCount(2)` | **Fixed** (the reported failure) |
| `weight.spec.ts:106` | `allInnerTexts()` after `toBeVisible()` | Left. Same non-waiting form, but no count assertion, one generation (a static picker rendered in one commit), and a **positive** `toEqual([...])` — an empty read fails loudly rather than passing. |
| `render-fixes.spec.ts:128,135,136,148` | `locator.innerText()` after `toHaveCount()` | Left. Singular `innerText()` resolves through the *waiting* selector path, so it cannot silently read nothing; and 135/136/148 are positive `toContain`. `innerText` is also load-bearing there (it is asserting what was painted). |
| `todos-legacy.spec.ts:201,210` | `locator.innerText()` | Left — waiting form, positive `toBe`. |
| `soft-wrap.spec.ts:119,159,170`, `turn-breaks.spec.ts:171,189` | `evaluate(e => e.innerText)` | Left. `innerText` is the **point** of these tests — they assert soft wraps and `<br>`s as *drawn*; `textContent` would be the wrong read. `turn-breaks.spec.ts:171` already wraps it in `expect.poll`. |
| `autocomplete-keys.spec.ts:184`, `fences.spec.ts:255`, `reattach.spec.ts:127`, `thread.spec.ts:168`, `compose-keyboard.spec.ts:458`, `comment-move.spec.ts:291`, `plugin-late-arrival.spec.ts:173`, `todos.spec.ts:157,271`, `turn-comment.spec.ts:81` | `textContent` reads | Left — not layout-dependent; several are in-page DOM walks, not assertions. |

**The pattern named by this issue — a non-waiting `all*` read following a count
assertion — appears exactly twice, and both are in this file.** Both are fixed.
The distinction that makes the sweep decidable, and worth keeping: only
`allInnerTexts()`/`allTextContents()` can silently return `[]`; every singular
`locator.innerText()` waits for its element first.

### Not fixed here

`useAnchorLayer` leaves a real window in which a document that *has* an anchor
shows no highlight at all — the provisional mark is dropped on `onSuccess` and
the server's anchors only arrive with the refetch. On the stub that is tens of
milliseconds; against the real server it is a round trip. It is a visible blink,
not just a test hazard. Out of scope for a spec fix, and flagged rather than
silently absorbed.

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-117]` prefix
