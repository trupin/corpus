# [UI-147] The mockup still draws the eased column open that UI-146 removed

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-146
- Related: UI-141 (the same class, filed and still open), UI-055 (the last time the mockup was stale and two agents read it)

## Spec References
- `design/index.html` — authoritative for look and feel (CLAUDE.md)
- SPEC.md **§10**

## Summary

Escalated by UI-146's implementer, 2026-08-22, against a file outside its own
tree.

UI-146 removed the eased width transition when a reader opens inside a column
(`.col.reading` now transitions `border-color` only). `design/index.html` still
draws the eased open, so the mockup and the app disagree on that transition.

The implementer's own note is the useful part: **the app's existing
`prefers-reduced-motion` branch is already the appearance we now ship for
everyone.** That branch is in `design/index.html` and `app/global.css` today, so
the mockup already contains the correct rendering — it just applies it
conditionally where the app now applies it always.

## Why it matters more than a stale drawing

CLAUDE.md makes `design/index.html` authoritative for look and feel, and this
repository has already paid for letting it drift. UI-055 was filed because the
mockup bound the pre-UI-052 composer keys, and **two agents in one release read
that contract before it was corrected**. UI-141 is open for the same reason
about the deleted `💬` popover.

Three stale claims in one authoritative file is a pattern, not three accidents.

## What to build

Bring the mockup's column-open behaviour in line with the app: the eased width
transition goes, `border-color` stays. Check whether the reduced-motion branch
can simply become the default there, since that is what the app now does.

**Consider fixing UI-141 in the same pass** — both are the same file and the
same kind of drift, and doing them apart means reading the mockup twice.

## Decisions to make and record

1. **Whether the mockup should carry a dated note of what it now matches**, so
   the next reader can tell drift from intent. There is no drift check on this
   file and no obvious way to build one — a mockup is not generated from
   anything — so the guard has to be human.
2. **Whether this warrants a check at all.** Three drifts in three releases
   suggests yes, but a checker for a hand-written HTML prototype is a hard thing
   to write well. If the honest answer is "no checker, just discipline", say so
   rather than filing a fourth issue later.

## Acceptance Criteria
- [ ] The mockup's column-open transition matches the app
- [ ] UI-141's stale `💬` popover is fixed in the same pass, or a reason is
      given for keeping them apart
- [ ] Decision 2 answered in writing

## Testing Strategy
None automatable today. The check is a person opening both and comparing.

## E2E Verification Log

**Log filled 2026-08-22 by the orchestrator (opus), during Phase 41 scoping.**
The work had landed and the row said `done`, but this log was left as its
template — which is what sent me to re-check it. Verified on `main` at
`583aa726`:

```
$ awk '/\.col\.reading/ {print FNR": "$0}' design/index.html | head -2
12:     - `.col.reading` no longer eases its width, matching UI-146
147:   .col.reading { width: 560px; transition: border-color 0.3s ease; }
```

The mockup transitions `border-color` only, which is what UI-146 shipped in the
app, and the changelog line at the top of the file records the change. No width
easing remains. Nothing to do.

**UI-141 stays open**, which answers this issue's second criterion: the stale
`💬` popover is a different surface and needs newly drawn UI, so it was not
folded into this pass.
