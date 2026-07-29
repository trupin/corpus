# [CONTRACT-014] Form-fence grammar edges + SSE token transport decision

## Domain

contract

## Status

done

## Priority

P2

## Model

fable — one grammar decision with cross-component blast radius, one security posture decision.

## Dependencies

- Depends on: CONTRACT-007, CONTRACT-013
- Blocks: SERVER-029 (detector alignment consumes the settled grammar)

## Spec References

- PR #10 review (2026-07-28), findings 9/10

## Summary

- (9) `schemas/form.ts:50` — `FORM_FENCE_PATTERN` diverges from CommonMark at edges (closing
  fence need not start a line; matches inside an outer 4-backtick block), so renderer and
  detector can disagree on "carries a form". Settle the grammar (document the chosen subset or
  align to CommonMark), then SERVER-029 aligns the SQL detector.
- (10) `client/events.ts:53-55` — the SSE bearer token travels as `?token=` (EventSource
  limitation): request logs + `currentUrl()` exposure. Localhost-bound today; make the
  documented decision (accept with rationale, or move to cookie/header transport) BEFORE
  remote-server setups arrive.
- _(added 2026-07-28, sprint-014 Adjudications 12/13)_ `docs/cli.md` documents a `~~~form` fence
  that `FORM_FENCE_PATTERN` does not recognize — a docs/grammar divergence to settle with (9);
  and nothing validates a form's shape at post time (the comment skill is the v1 enforcement
  point) — decide whether post-time validation joins the settled grammar.
- _(added 2026-07-29, UI-013 finding-12 residual)_ an answer turn on disk names an option but not
  the form it answers, so after a reload the UI's form↔answer pairing falls back to an order rule
  (multi-form threads can mis-attribute). Closing it fully needs a field on the answer turn
  (`formTs` or equivalent) — a contract+server rider to decide alongside the grammar. Note:
  SERVER-029 removed the SQL fence translation (projected `has_form` column reads the one TS
  grammar), so a grammar change now costs only a projection rebuild.

## Acceptance Criteria

- [x] Fence grammar settled, documented, tested at the edges; consumers referenced.
- [x] SSE token transport decision recorded in the schema docblock (and SPEC if user-visible).

## E2E Verification Log

Implemented on: **fable** (contract-dev, worktree `agent-a19316a653ad13254`, base `c48a4c6`).

**Decision (9) — fence grammar settled: a CommonMark subset, restrictions only.**
`FORM_FENCE_PATTERN` (regex) is replaced by `findFormFence` (line scanner) in
`packages/contract/src/schemas/form.ts`. The settled rule: a form fence is what CommonMark would
render as a fenced code block with info string `form`, under three documented restrictions, each of
which only ever *declines* what CommonMark accepts (safe degrade to an ordinary code block in every
consumer at once): (1) column-0 fences only — no indent, no container blocks; (2) backtick fences
only — `~~~form` opens a plain code block (§6 spells the fence with backticks); (3) the closing
fence is required — an unterminated fence is a mangled file, not a form (keeps SERVER-029's settled
answer; CommonMark's EOF-close is deliberately not taken). Within those bounds CommonMark holds
exactly, which **fixes the two over-matches the review flagged**: a mid-line ``` no longer closes a
fence, and a form quoted inside an outer ````markdown (or tilde) block is content, not a form. Two
benign alignments ride along: 3+-backtick openers with ≥-length closers, and a trimmed info string
(`` ``` form `` now matches, as CommonMark reads it).

- Consumers: server reads the grammar through `core/form.ts` (unchanged code); UI's
  `splitFormFence` moved from `FORM_FENCE_PATTERN.exec` to `findFormFence` (offsets in
  `FormFenceMatch`); the regex export is deleted so no consumer can keep the old grammar.
- **SCHEMA_VERSION bumped 4 → 5** (`apps/server/src/projection/schema.ts`): DDL unchanged, but
  `turns.has_form` values computed under the old regex can be stale — exactly the rebuild the
  SERVER-029 design promised a grammar change would cost.
- Edge tests: `form.test.ts` "the fence grammar at its edges" (12 cases: offsets, unterminated,
  mid-line closer, outer 4-backtick block, tilde outer, unclosed-fence shadowing, longer/4-backtick
  closers, tilde/indent/backtick-in-info declines, leading-space info, CRLF).

**Decision (10) — SSE token-in-query: accepted for v1, with a hard localhost boundary.**
Recorded on the `/events` route docblock and query-param description
(`packages/contract/src/routes/events.ts`) and in `client/events.ts`: acceptable because the server
binds 127.0.0.1 in a single-user system, the observers of the URL are the same user's own processes
(which could read the token from `.corpus/` anyway), and no Referer/proxy/history vector applies on
loopback. Hardening applied where the client itself creates a persistence channel: error messages
now carry `redactedUrl(url)` (`token=REDACTED`), tested; `EventStream.url` stays exact (same info as
the browser's network tab) with a "redact before logging" doc note. Boundary: remote deployments
must swap to a short-lived single-use ticket (or cookie) behind `createEventStream` before leaving
loopback. **Held SPEC draft (§9.2, NOT applied — needs user sign-off):** "The `/events` stream
authenticates via a `token` query parameter (EventSource cannot set request headers). This
transport is acceptable only under the localhost bind (§2.1); a remote-server deployment must
replace it with a short-lived, single-use ticket minted over an authenticated request (or a
cookie) before the server is exposed beyond loopback."

**(~~~form + resolved-reply prose)** `apps/cli/src/commands/thread/reply.ts` and
`apps/cli/src/input.ts` no longer present `~~~form` as a form fence, and the reply description now
states sprint-006 Adjudication 5 correctly: resolving stops only the automatic re-trigger — an
explicit `@agent`/`/skill`/`requestsAgent: true` still enqueues (verified against
`apps/server/src/threads/participation.ts:55-60`, where the explicit checks precede the resolved
check). `docs/cli.md` regenerated (`npm run docs:cli -w apps/cli`), Prettier-stable.

**(formTs pairing) — deliberate deferral, recorded.** The answer turn keeps naming only its option.
Closing the pairing gap needs the form's `ts` written into the answer turn, and the turn format has
nowhere to put it but the prose — which §6 keeps deliberately plain ("no form id") and the
contract's own answer-as-prose rationale keeps markup-free; a change there is a SPEC revision, not
a silent format change. The failure it buys is narrow (≥2 forms open at once sharing an option
string, answered across a reload), presentation-only, and self-healing (answering again is legal
and re-pairs). Recorded in the `FORM_ANSWER_LABEL` docblock with the revisit trigger. No rider
issue filed — filing one would schedule work the rationale argues against; the docblock is the
durable record.

**Evidence**

- Scanner + edges: `vitest run packages/contract/src/schemas/form.test.ts` → 57 passed.
- Full contract suite: 39 files, **1211 passed** (post-CONTRACT-017 count).
- Consumers: `apps/server` suite 120 files / 2361 tests passed (after the one CONTRACT-017 test
  update, see 017's log); `apps/ui/src/thread` 9 files / 87 passed; `packages/kit/src/events`
  31 passed; `apps/cli` thread commands + input 47 passed.
- E2E (built dist, real listening stub on **port 9165**, generated client): grammar checks all
  PASS — plain fence true, quoted-in-4-backtick false, mid-line closer false, unterminated false,
  tilde false, longer closer true, extraction exact. Port freed on exit (script `server.close()` +
  exit; scratch script deleted).
- Drift check twice (`node --import tsx scripts/check-generated-artifacts.ts`): both runs
  identical; regeneration arm a no-op both times (no hash-mismatch failure); only the
  diff-against-HEAD arm fires, as it must on an uncommitted tree (openapi.json +51/−20,
  schema.generated.ts +2/−2, docs/cli.md 1 line).
- Gates: `npm run lint` ✓, `npm run format:check` ✓, `npm run typecheck` ✓ (all workspaces).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
