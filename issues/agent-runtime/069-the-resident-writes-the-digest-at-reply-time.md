# [AGENT-069] The resident writes the digest at reply time

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CLI-077 (the verb), SERVER-164 (the behaviour)
- Related: AGENT-065 (touches the same converse sections — sequence, do not race)

## Spec References

- SPEC.md **§6** — the digest rider: written at reply time, digests orient

## Summary

The digest exists only if the converse skill writes it. Amend `converse`:

- **After settling each event, before parking**: update the digest with
  `corpus thread digest set <id>` — the turns are already in context, so the
  write is nearly free. One digest, rewritten whole each time, ≤ the contract's
  length bound. Body via `--file` or stdin, never argv (CLI-074).
- **On rehydration** (Starting up): read digest + index + last turns before
  reaching for the whole thread; a `stale` digest is distrusted and rewritten
  on the next reply.
- **The invariant, verbatim in the skill**: digests orient — quote and patch
  only from turns read verbatim (`--turn <n>`), never from the digest.
- `comment` and `orchestrate` state the invariant where they read threads; they
  never write digests (no designation, no right).

## Acceptance Criteria

- [x] converse writes the digest in its settle step and reads it at startup
      _(The loop's step 4 — old steps 3 and 4 merged, so steps 5–8 and every
      cross-reference keep their numbers; Starting up's step 4 reads digest +
      `--index` + `--last` before any whole read, and distrusts STALE.)_
- [x] The invariant appears in converse, comment, orchestrate at their thread
      reads, one sentence each _(the CLI's exact spelling: converse carries
      `DIGEST_ORIENTS_HELP` whole, pinned by import; comment and orchestrate
      carry its opening sentence **Summaries orient, they never act.** plus a
      never-write pointer to converse, registered in `SINGLE_OWNER_RULES`.)_
- [x] Net size change of the three skills recorded (INFRA-038 budgets apply)
      _(converse 64,111 → 64,099 B, 16,028 → 16,025 tokens; comment 41,108 →
      41,106 B, 10,277 → 10,277; orchestrate 50,082 → 50,079 B, 12,521 →
      12,520. None grew; baseline regenerated once, at session end.)_
- [x] `workspace-template.test.ts` guards updated _(new AGENT-069 describe;
      `DIGEST_ORIENTS_HELP` and `DIGEST_MAX_CHARS` imported so skill and tool
      cannot drift; digest rule added to `SINGLE_OWNER_RULES` with converse as
      owner; the converse pointer-formula clause recorded in `STATED_TWICE`;
      one AGENT-032 bridge pin retargeted to the rewrapped sentence — its
      substance, both answers on the example's own ids, stays pinned.)_
- [x] E2E: one designated conversation driven through two replies on a real
      workspace; the thread file shows the digest advancing its watermark

## E2E Verification Log

**2026-09-05 — implementing agent (model: Fable, per the issue's recommendation).**

Real workspace, real server, port 8978, worktree-built contract/kit/cli
(`node apps/cli/dist/bin/corpus.js`):

1. `corpus init --port 8978` → 36 template files installed; the installed
   `converse/SKILL.md` is 64,099 B and carries the new loop step 4.
2. As user: `thread create` → `th_m5sey2vh` (standalone), `thread designate
   th_m5sey2vh` → "designated a general resident". A plain user turn enqueued
   nothing (participation `none` — the known lane rule); an `@agent` turn
   queued `evt_tscd3r4ogran` and the parked `queue idle --thread` returned
   naming it.
3. **Cycle 1, following the amended skill literally**: claim →
   `{"events":[evt_tscd3r4ogran],…}` → job log → `doc create` (doc_psdsrszw,
   `CORPUS_JOB` set) → reply `--model "Sonnet"` (accepted: tier-table word) →
   `queue complete` → **loop step 4**: `thread digest set th_m5sey2vh` via
   heredoc → `set digest of th_m5sey2vh — covers turns through
   2026-09-06T00:33:16Z`.
4. Rehydration read: `thread show --index` prints the digest **above the map**
   — `digest · covers turns through 2026-09-06T00:33:16Z` then the body, then
   the turn rows — exactly the surface Starting up's step 4 now describes.
5. **Cycle 2**: second `@agent` turn → `evt_i2fpgjevn5vg` off the park → reply
   → `queue complete` → `thread digest set` (whole rewrite) → `covers turns
   through 2026-09-06T00:34:06Z`. **Watermark advanced between the two
   replies: 00:33:16Z → 00:34:06Z.**
6. `cat data/threads/th_m5sey2vh.md` shows the frontmatter:
   `digest: { body: |…, watermark: 2026-09-06T00:34:06Z, stale: false }`.
7. Server stopped (`server stop`, pid 78047); port 8978 verified free.

Tests: `VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts
scripts/skill-budget.test.ts` → **677 passed, 0 failed**. `npm run
skills:check` → green (converse and orchestrate baselines lowered by the run's
one `--update-baseline`). Prettier and eslint clean on every touched file.

Deviation noted: the per-pass digest write is once per **pass** (after all the
batch's settles, before the park), not once per event — the issue's "after
settling each event, before parking" read at the pass level, which is where
"before parking" places it; a quiet pass skips the write, stated in the step.
