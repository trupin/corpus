# [INFRA-024] A prose-only commit pays the full ten-minute gate

## Domain

infra

## Status

closed — **superseded by INFRA-025** (2026-08-07)

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- —

## Why this is closed rather than done

INFRA-025 went further in a simpler direction. Rather than detecting which
changes are inert and skipping work for them, it removed the expensive work from
the hooks entirely: a check that can run on the diff runs locally, and a check
that needs the whole codebase is CI's.

Measured after that change, a prose-only commit is **~1-2 seconds** — the outcome
this issue was filed to buy. An allowlist of inert paths would now save a
fraction of a second, at the cost of a classification table that must be kept
correct forever, and whose failure mode is a gate that silently checks less than
it appears to. That trade is no longer worth making.

Kept rather than deleted for the analysis below, which stays true and is the
reason nobody should implement the naive version later: **"only markdown
changed" is not a safe predicate in this repo.**

## Summary

**Reported by the user, 2026-08-07**: *"committing and pushing takes a while even
for committing specs and markdown files. Let's speed things up by avoiding
running the checks when there's nothing substantial to check."*

Measured this session: a `SPEC.md`-only commit runs npm audit, a full build,
eslint, prettier, typecheck and **10,500 unit tests** — roughly ten minutes to
land a paragraph of prose. Pushing then adds the Playwright suite. Over one
working session that is well over an hour spent compiling TypeScript that did
not change.

## The trap: "markdown" is not the predicate

The obvious rule — skip when only `*.md` changed — is **wrong here**, and
checking is what the implementer must do first rather than assume:

- `assets/workspace/**/*.md` are the product's skill files, and
  `scripts/workspace-template.test.ts` enforces their exact section counts,
  minimum section lengths, banned prose, heredoc mechanics and an exhaustive
  file tree. A markdown-only change there breaks tests routinely — it happened
  twice this session.
- `docs/cli.md` is **generated** and drift-checked by
  `scripts/generated-artifacts.test.ts`.
- `README.md` participates in `scripts/pack-audit.test.ts`.
- Prettier formats markdown, so **format must run for every file**, always.

So the fast path has to be an **allowlist of paths that are genuinely inert**,
not a filetype rule.

## The design constraint that matters most

This project has been burned three times by guards that quietly check less than
they appear to — INFRA-022 (a bump that committed one manifest of nine),
`version-sources` (a glob form silently dropped, and an unreadable `ls-tree`
yielding zero workspaces and therefore zero problems). **A fast path is exactly
that shape of change**, so it must be built to fail loudly rather than quietly:

- **Allowlist, never denylist.** A new directory nobody classified must fall
  into the slow path, not out of the gate.
- **Per changeset, not per file.** If *any* changed path is outside the
  allowlist, everything runs. No partial skipping.
- **Announce what it skipped and why**, naming the rule that matched. A gate
  that silently does less reads as a gate that passed.
- **CI is unchanged and remains the backstop.** It always runs everything, so a
  misclassification costs a red PR, never a bad merge.

## Acceptance Criteria

- [ ] A commit touching only inert paths runs **format only**, and finishes in
      seconds rather than minutes
- [ ] Any changeset containing a non-allowlisted path runs the full gate,
      including a changeset that mixes prose and code
- [ ] `assets/workspace/**`, `docs/cli.md`, and every generated artifact are
      **not** inert — assert this with a test, since these are the cases that
      make the naive rule wrong
- [ ] The fast path prints what it skipped and which rule matched
- [ ] The same treatment is applied to **pre-push**, where the Playwright suite
      is the expensive part — and where the same allowlist logic applies
- [ ] CI is untouched and still runs everything on every commit
- [ ] The allowlist lives in **one** place, shared by both hooks, so they cannot
      drift into disagreeing about what is inert

## Technical Design

### Files to Create/Modify

- `.githooks/pre-commit`, `.githooks/pre-push`, and a small shared module under
  `scripts/` holding the allowlist and the classify-a-changeset function.

### The allowlist to start from

Verify each before trusting it — grep for anything that reads the path:

- `issues/**` — the SDD tracker; nothing reads it programmatically
- `SPEC.md` — confirm no test parses it
- `docs/**` **except** generated files (`docs/cli.md` at minimum)
- `.claude/**` — the dev harness, not shipped

`CLAUDE.md` and `README.md` need checking individually rather than being waved
through.

### Notes

- Use `git diff --cached --name-only` in pre-commit and the pushed range in
  pre-push. Be careful with the pre-push range when a branch is new — a wrong
  range that resolves to "no files" would classify a code push as inert, which
  is the one failure that matters. Default to the full gate whenever the range
  cannot be determined.
- Do not add an environment-variable override to force the fast path. The value
  here is that it is automatic and conservative; a manual switch is
  `--no-verify`, which already exists and is already documented.

## Testing Strategy

Unit-test the classifier directly: prose-only changesets, code-only, mixed,
`assets/workspace` markdown, `docs/cli.md`, an unclassified new top-level
directory (must be treated as substantial), and an empty/indeterminate range
(must be treated as substantial).

## E2E Verification Log

_Filled by the implementing agent; state the model. Include a timed before/after
for a `SPEC.md`-only commit._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-024]` prefix
