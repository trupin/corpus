# [UI-106] A carried effect is not an error, and the UI renders every warning as one

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-047 (added the codes), SERVER-088 (emits them)
- Blocks: —

## Spec References

- SPEC.md **§11** — warnings are the non-fatal channel
- SPEC.md **§7** — a skill folder move is ordinary, specified behaviour

## Summary

Flagged by CONTRACT-047's implementing agent. Several sites in `apps/ui` render
warnings with `tone: "error"`. That was defensible while every `WarningCode`
described something wrong with a document; CONTRACT-047 widened the channel to
carry **effects on documents the request did not name**, and a `carried_skill`
warning describes §7 working exactly as specified.

Rendering "archiving this skill also disabled the nested one" in the same red as
a validation failure teaches people to dismiss the channel — which is how the
one that *is* a problem gets missed.

## Acceptance Criteria

- [x] `carried_skill` and `carried_reconciliation` render as **information**, not
      as errors
- [x] The distinction is driven by the code, not by a string match on `detail` —
      the contract forbids parsing `detail`, and a tone chosen from prose is a
      parse
- [x] Every other `WarningCode` keeps the tone it has today; this is not a
      re-theming of the channel
- [x] Adding a `WarningCode` later forces a tone decision rather than defaulting
      silently to error. An exhaustive mapping is what makes that true — note
      that no exhaustive `switch` over `WarningCode` exists anywhere today
- [x] The carried warnings are legible about *which* document they name: a person
      reading one is being told about a document they did not act on

## Technical Design

### Files to Create/Modify

- Wherever `apps/ui` maps a warning to a tone; check `packages/kit` too, because
  the row and notice components live there and render the same channel.
  (**Amended 2026-08-22 by SHARED-065, Phase 41**: the original reason for
  checking the kit was that a plugin surface might render the channel. SHARED-067
  removed plugins, but the kit is kept — SHARED-067 amendment 3 rewords it as
  *"the shared UI kit — the components and data hooks `apps/ui` is built from"* —
  so the instruction survives its cause and keeps its reason restated.)

### Notes

- Do not widen this into a general warnings redesign. The narrow fact is that two
  new codes describe specified behaviour rather than a problem.

## Testing Strategy

A response carrying each new code renders as information; a response carrying an
existing code is unchanged. Plus the exhaustiveness check — a new code with no
tone mapping should fail to typecheck rather than render red.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context), 2026-08-24.

### What changed

`packages/kit/src/warnings/warningNotice.ts` — one decision per code, in a
`Record<WarningCode, {tone, lead?}>`. The kit and not `apps/ui`, for the reason
this issue's amended Technical Design gives: the notice type (`RowNotice`) is the
kit's, and the kit itself renders the channel (see below).

`warningNotice(warning)` returns a `RowNotice`. Five call sites in `apps/ui` that
built `{ tone: "error", message: \`\${code} — \${detail}\` }` by hand now call it:
`NewCommentComposer`, `useCompose` (×2 branches), `useTurnComments`,
`ThreadComposer`, `useAnchorLayer`. `FrontmatterForm` takes its `stage_status`
tone from the same map rather than from a literal, so no site decides a tone
alone any more.

### The channel was not only mis-toned — it was dropped

Three sites received `carried_skill` and rendered **nothing**: `useRowActions`'
Archive (the kit's own quick action), `docActions`' Unarchive, and `Board`'s `e`.
Each narrated the act and threw `response.warnings` away, so a person who
archived a skill folder was never told which nested skills it disabled.
Criterion 5 cannot be met by a notice nobody shows, so all three now emit
`warningNotices(response.warnings)`.

### The decisions taken

| code | tone | why |
| --- | --- | --- |
| `commit_failed`, `commit_skipped` | error | the write is uncommitted |
| `orphaned_anchor`, `unresolved_ref` | error | the document carries a fault |
| `validation_error` | error | a §11 error the save tolerated |
| `carried_skill`, `carried_reconciliation` | **info** | §7 working as specified |
| `stage_status` | info | §5's coupling rule reporting itself |
| `default_open_cleared` | info | §10 rider 2 working as specified |

**No warning changes tone anywhere it is rendered today except the carried
pair.** `stage_status` already had `info` at the one surface that showed it
(`FrontmatterForm`), and it keeps that tone *and* its bare wording — its lead is
`null`, because the server's sentence already names the board that decided.
`default_open_cleared` reached no surface at all, so it had no tone to keep;
placing it is a first decision rather than a re-theming.

Every failure code keeps `code — detail`, character for character. The carried
pair leads with **"Also changed"**, which is criterion 5: `detail` carries the id
and the path, and the lead-in says the document was not the one you acted on.

### Exhaustiveness, falsified

`Record<WarningCode, …>` is the mechanism. Deleting one entry:

```
src/warnings/warningNotice.ts(68,14): error TS2741: Property 'validation_error' is
missing in type '{ … }' but required in type 'Record<"commit_failed" | … , WarningPresentation>'
```

`validation_error` is itself the proof this is not theoretical: it is
CONTRACT-084's code, added in this same release, and it arrived as a compile
error here rather than as a silent red toast. A runtime test also asserts the map
places every member of `WARNING_CODES` **and no others**, because the type cannot
see a member *removed* from the enum.

And a code this build has never seen — a client older than its server — is shown
rather than swallowed, in the shape every warning had before this map existed
(`code — detail`, error tone). An unrecognised report is not evidence that
nothing is wrong.

### Browser verification — `apps/ui/e2e/warnings.spec.ts` (new)

The tone is a computed style, so a jsdom test can assert `data-tone` and nothing
about what a person sees. `StubOptions.archiveWarnings` seeds §11's channel on
`POST …/archive`, and `e` archives the highlighted skill row.

```
CORPUS_UI_PORT=5391 ./node_modules/.bin/playwright test … apps/ui/e2e/warnings.spec.ts
✓ archiving a skill that carried another one with it
    › reports the carried effects as information, beside the act's own notice (1.2s)
✓ a warning that reports something wrong › is still an error, with the code on the line (981ms)
✓ a warning that reports something wrong
    › is drawn differently from a carried effect sent on the same response (1.0s)
3 passed (4.7s)
```

The first: three toasts, `[data-tone="error"]` count **0**, and the two carried
messages read `Also changed — doc_skill_nested at …/nested/SKILL.md — disabled`.
Before this issue two of those three were red.

The third is the argument for the split, measured: a `commit_failed` and a
`carried_skill` on one response, and the leading mark's computed `color` differs
between the two toasts in the same frame.

The disk half — the folder move §7 makes a skill's enablement — stays the
real-app drill's: this suite runs no workspace server (INFRA-028), which the
spec's docblock says in as many words.

### Checks

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `vitest run packages/kit apps/ui`: 4712 passed.
- Full Playwright suite `--workers=2`: 640 passed, 0 failed.

### Not done, deliberately

`FrontmatterForm` still renders **only** `stage_status` and drops every other
warning from its save response. That is a second defect (a dropped channel, not a
mis-toned one) and widening this issue to it was declined — see the Notes. It is
not reachable for the carried pair, since the form cannot cross the archive
boundary (UI-020), so nothing this issue is about is lost there. Worth its own
issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
