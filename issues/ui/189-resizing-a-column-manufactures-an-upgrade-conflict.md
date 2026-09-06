# [UI-189] Resizing a column manufactures a template conflict by clicking

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CONTRACT-098** (the importable presentation-key set)
- Related: CLI-081 (deliberate divergence — the general mechanism; this issue
  removes one systemic source of accidental divergence)

## Spec References

- SPEC.md **§10** — boards and views; **§4** — the workspace

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06).

Resizing a board column writes `width:` into the view's own document —
`apps/ui/src/board/useColumnWidth.ts:98` PUTs `{ extra: { width } }` onto the
view doc. `views/attention.md` got `width: 686`, `views/inbox.md` got
`width: 418`. The user never edited those files, yet the workspace is now in
permanent conflict with every future template upgrade of them. **Any user who
resizes a column manufactures this conflict by clicking.**

## What to build

**Orchestrator decision, 2026-09-06 (v0.34.0 run): direction 2.** The
comparison ignores declared presentation keys, riding CLI-083's ignored-key
mechanism and CONTRACT-098's declaration. Direction 1 was rejected because it
moves storage across contract, server, and UI to solve what is a comparison
defect, and forfeits the width surviving in the document for no gain a
single-user product can see. Consequence (sprint-024 P1/E2): this issue
changes no file in `apps/ui` — cli-dev implements it beside CLI-083, and the
`ui` label stands only because the defect was found there. Sprint-024's P5
hazard binds: the `update` verdict's write must preserve the ignored keys it
enabled (TEST-1094, TEST-1099).

The two directions considered were:

1. **Presentation state moves out of template-tracked documents.** Per-viewer
   runtime state lives under `.corpus/` (never committed, never compared).
   Cost: the width no longer travels with the document, and a second viewer
   does not inherit it — which for a single-user product is no cost today.
2. **The template comparison ignores designated keys.** `width` (and any
   future presentation key) is declared presentation-state and excluded from
   the manifest comparison. Cost: the list of ignored keys is a second place
   the meaning of frontmatter lives, and a key on it can never become
   load-bearing content.

Whichever wins: an upgrade over a workspace whose only change to a view is a
resize reports **no conflict**, and existing workspaces with stamped widths
stop conflicting (migration or comparison-side fix — state which).

## Acceptance Criteria

- [ ] The decision recorded here with the rejected direction argued
- [ ] Resize → upgrade reports no conflict for that file (E2E, real upgrade)
- [ ] Existing stamped-width workspaces stop conflicting on upgrade
- [ ] Resize still persists across a reload

## E2E Verification Log

**Model: Fable 5 (claude-fable-5).** Implemented by cli-dev beside CLI-083
(sprint-024 P1/E2: one mechanism, one worktree, one agent), 2026-09-06. **No
file under `apps/ui` or `packages/kit` changed** — `useColumnWidth.ts` keeps its
PUT exactly as it stands; the `ui` label records who found the defect, not who
fixed it.

### Decision (TEST-1097)

**Direction 2, as ruled.** `width` is declared a presentation key in
`packages/contract` (CONTRACT-098), and the template comparison ignores the
declared presentation keys through CLI-083's one mechanism
(`apps/cli/src/template/ignored-keys.ts`). Direction 1 — moving presentation
state under `.corpus/` — is rejected because it moves storage across contract,
server, and UI to solve what is a **comparison** defect, forfeits the width
travelling with the document (a real, if currently single-user, property), and
touches a write path that is not broken. The one cost direction 2 carries —
a second place the meaning of frontmatter lives — was already paid by
SERVER-096's server-side `PRESENTATION_KEYS`, and CONTRACT-098 collapsed the
two places into one declaration rather than adding a third (sprint-024 P2/P3).

**The migration criterion is met comparison-side, with no file rewritten**:
`normalized(workspace) === normalized(incoming)` never consults the baseline,
so a pre-fix workspace with a stamped width stops conflicting the moment the
fixed tool compares it. No manifest is rewritten to make that true (verified —
see the legacy test below, and CLI-083's log for the residual-case rule).

### E2E, real workspace, built CLI (tool 0.33.0, scratch workspace on port 8767)

1. **The real resize write**: with the server running,
   `corpus doc edit doc_seedattention --extra width=686` — the same
   `{ extra: { width } }` write `useColumnWidth.ts:98` PUTs. The file gained
   exactly one line, `width: 686`, and — SERVER-096 holding — its `updated:`
   did **not** move (`updated: 2026-07-26T00:00:00Z` before and after).
2. `corpus workspace diff data/docs/views/attention.md` → one line, exit 0:
   `differs from the copy corpus 0.33.0 ships only in width — server-stamped and presentation frontmatter, not an edit. …`
3. **Resize → upgrade, template changed** (TEST-1098): with the tool's template
   copy of `attention.md` changed (body sentence appended),
   `corpus workspace upgrade` reported
   `update  data/docs/views/attention.md` — **no conflict**, nothing
   `unresolved` for that path.
4. **The width survives the write** (TEST-1099, P5): the written file carries
   the new template body **and** `width: 686` (appended before the closing
   fence — quoted from disk after the run). A second upgrade run reports
   nothing for the file: the merged bytes were recorded in the manifest.
5. **A real content edit still conflicts** (TEST-1101 shape): the view edited
   through `corpus doc edit` (body line added) with the template also changed
   reads `keep`, is reported `unresolved`, and the file is untouched — run
   live on `open-threads.md` in the same upgrade, and pinned by
   `upgrade.test.ts` ("still keeps and reports a stamped delta that carries a
   real edit").
6. **Existing stamped-width workspaces, no migration** (TEST-1100):
   `upgrade.test.ts` "reads a stamp-only file as current under a LEGACY
   manifest, with no migration" builds a pre-fix manifest (normalized shas
   stripped), adds `width: 686` to the view, runs the fixed upgrade: output is
   `already up to date.`, the manifest file is **byte-identical** before and
   after, and the width stays.
7. **Resize persists across a reload** (TEST-1102): a regression check on
   untouched UI code — no `apps/ui` file changed in this issue, so the
   behaviour is the shipped one; left to the evaluator's browser pass.

### Checks

Shared with CLI-083: `apps/cli` typecheck clean, full `apps/cli` suite green
(114 files, 2400 tests, `VITEST_MAX_THREADS=4`), eslint + prettier clean on
every changed file, `docs/cli.md` regenerated with no leftover diff.
