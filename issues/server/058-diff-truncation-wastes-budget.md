# [SERVER-058] Diff truncation keeps the frontmatter and drops the change

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028, SERVER-052
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/docs/:id/diff` — "truncated at a hunk boundary with a
  `truncated` flag and the full size, never refused"

## Summary
Found by CLI-026's E2E, measured against a real server: a diff of a 93 486-character
change returned **401 characters of an allowed 16 000**.

This is the second bite of the same bug. SERVER-052 already fixed truncation
cutting at the *first* hunk header (which returned 166 of 16 000). The remaining
case is subtler and hits the **normal** edit shape:

`truncateDiff` picks the last hunk boundary ≤ cap. A typical document edit
produces a tiny `updated:` frontmatter hunk followed by one oversized body hunk,
so the only admissible boundary sits at ~401 characters. The route therefore
keeps the frontmatter timestamp, drops the entire substantive change, and leaves
~15 600 characters of budget unspent.

The consequence is worse than a short answer: the agent receives a diff that
says a document's `updated:` field changed and nothing else — a confident,
well-formed, useless answer to "what changed here". It then reasons about a
change it never saw.

SERVER-052's line-boundary fallback exists but only fires when there is **no**
admissible hunk boundary at all, which is not this case.

**The rule CLI-026 proposes, and it satisfies the contract's own stated
exception:** take the **larger** of the hunk-boundary cut and the last line
boundary ≤ cap. A line boundary inside a hunk still yields a readable unified
diff, and the contract already permits the line-boundary exception.

## Acceptance Criteria
- [x] A diff whose only hunk boundary is early uses the budget — measured, with
      the before/after character counts recorded
- [x] The result is still a valid unified diff that a reader can parse
- [x] `truncated` and `totalChars` remain honest
- [x] The frontmatter-only outcome is impossible when there is body change within
      budget — assert exactly that shape, since it is the reported one
- [x] SERVER-052's first-hunk-header fix is not regressed (it has tests)
- [x] A test at the shape level: tiny leading hunk, oversized following hunk

## Technical Design
### Files to Create/Modify
- `apps/server/src/edit/diff.ts` (`truncateDiff`) + tests

## Testing Strategy
Fixture-driven at the hunk shapes that matter (tiny-then-huge, one huge, many
small), asserting bytes returned against the cap.

## E2E Verification Log

**Model: Opus 5 (1M context)**, server-dev agent, 2026-08-04.

### The rule, after checking the proposed one

The proposal — "take the **larger** of the hunk-boundary cut and the last line
boundary ≤ cap" — is **degenerate, and was not implemented as stated.** Every
hunk boundary is also a line boundary, and the last line boundary ≤ cap is by
construction the largest line-start offset ≤ cap; so it is never smaller than the
last hunk boundary ≤ cap, and `max(hunk, line)` is *always* the line one. That
rule abolishes hunk alignment entirely — it would cut mid-hunk even where whole
hunks fit — and would contradict the published contract text
(`DocDiffSchema.truncated`: "whole hunks are dropped from the end"), i.e. it
would need a contract change rather than being an application of the contract's
exception.

What was implemented is the contract's **own stated exception**, applied wherever
the over-sized hunk sits rather than only when it is the first:

> Drop whole hunks from the end. When the hunk that would then be dropped is
> itself **larger than the whole bound**, cut inside it at the last line boundary
> ≤ cap instead — no cut anywhere can ever show that hunk whole, so the
> alternative to a prefix of it is nothing of it.

This needs no new constant (the comparison is against the cap itself) and no
contract change — `DocDiffSchema.truncated` already reads "A single hunk larger
than the whole bound is the one exception — it is cut at a line boundary, never
mid-line." A hunk that *could* have fitted the bound is still dropped whole, so
the unspent budget is bounded by that one hunk's size and every hunk returned is
complete.

### Measured, before and after

Real `corpus init` workspace at `/tmp/s057-ws`, real server (`corpus 0.3.0`,
127.0.0.1:8766), real `git`. Created `doc_6dglpzpe`, waited past §4's 30 s squash
window so the rewrite was its own commit, then `PUT` a 79 290-character body as
`user` — producing exactly the reported shape.

Git's own output for the range (`git diff --no-ext-diff --no-textconv HEAD~1 HEAD -- <path>`):

```
full diff chars    81014
hunk header offsets [ 233, 441 ]      ← frontmatter hunk, then one body hunk
```

**Before** (SERVER-052's rule, replayed over the identical git output):

```
OLD rule would return 441 chars of 16000
OLD tail: "…-updated: 2026-08-05T06:22:23Z\n+updated: 2026-08-05T06:23:13Z\n tags: []\n status: open\n anchors: {}\n"
```

441 of 16 000 — the timestamp and nothing else, 15 559 characters of budget
unspent. The reported failure, reproduced.

**After** (`GET /api/docs/doc_6dglpzpe/diff` from the running server):

```
{ truncated: true, totalChars: 81014, stats: { commits: 1, insertions: 1201, deletions: 2 } }
NEW rule returned 15958 chars of 16000
body change lines present: 232
ends on a line boundary: true
```

**441 → 15 958 characters of 16 000.** The answer now carries the frontmatter
hunk, the body hunk's header, and 232 lines of the actual rewrite. `truncated`
and `totalChars` are unchanged and honest (81 014, of which 15 958 shown).

Through the agent-facing surface (`corpus doc diff doc_6dglpzpe`):

```
1 commit · +1201 -2 · showing 15958 of 81014 characters
```

### The other two shapes, on the same live server

- **Many small hunks — hunk alignment preserved.** `doc_fuf2iye4`, 300 paragraphs
  with every tenth revised (spacers keep git's 3 context lines from merging them):
  returned **15 826 of 16 000, 24 whole hunks**, a byte prefix of git's output,
  and the text immediately after the cut is `"@@ -491,7 +491,7 @@ Pa"` — the cut
  lands *exactly* on a hunk header. Unspent budget 174 characters, less than one
  hunk's size, which is the bound the rule promises.
- **One huge hunk (SERVER-052's case) — not regressed.** `doc_lgqsqwrz`, whole body
  rewritten with no surviving context: 35 650 total, returned 15 946 of 16 000,
  ending on a line boundary. The first-hunk-header rule still holds — its tests
  (`never cuts at the *first* hunk header`, `cuts a single over-sized hunk at a
  line boundary`) pass unchanged.

### Tests

3 new cases in `apps/server/src/edit/diff.test.ts` (`truncateDiff` 7 → 10 cases;
the file now runs 15 with `parseShortstat`): the reported
tiny-hunk-then-over-sized shape, asserting the frontmatter-only outcome is
impossible; the straddling-hunk-that-fits case, asserting a hunk-aligned cut with
waste bounded by that hunk; and the rule's own `dropped <= max` boundary. All
seven pre-existing `truncateDiff` cases pass unmodified.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
