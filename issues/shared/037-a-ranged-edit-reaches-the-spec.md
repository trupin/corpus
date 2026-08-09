# [SHARED-037] The patch operation reaches §9.2 before it reaches the code

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

todo — **DRAFTED, awaiting sign-off**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: CONTRACT-046, SERVER-079, CLI-035

## Spec References

- SPEC.md §9.2 — the API surface (documents `PUT /api/docs/:id` whole-body
  replacement only)
- SPEC.md §6 — anchors reconciled on every write; §4 — attribution and commit
  granularity; §14 — validation before writing
- Precedent: the reattach route (CONTRACT-041) reached §9.2 through a signed
  rider before implementation

## Summary

PR #36's review caught the gap: CONTRACT-046 / SERVER-079 / CLI-035 file a new
public API operation and CLI verb while §9.2 is silent about both — SERVER-079
even cited "the patch operation" as spec text, which did not exist. Every
user-observable behavior reaches SPEC.md through a signed rider first; this is
that rider. The motivation is recorded in CONTRACT-046: the agent's only body
edit is whole-body replacement, which is why using Corpus has been token-
expensive, and the native Edit-tool contract (anchored exact-string
replacement) is the proven shape.

## Drafted rider text

To be added to §9.2's route list, after `PUT /api/docs/:id`:

> - `POST /api/docs/:id/patch` — edit a document's body by **anchored exact
>   string replacement**: the request carries `old` (an excerpt of the body),
>   `new` (its replacement, possibly empty), and `all` (default false). `old`
>   must match the body **exactly and uniquely** — zero matches and multiple
>   matches are refusals that **name the count**, because the two have
>   different recoveries (re-read the document; quote more context) — unless
>   `all`, which replaces every occurrence left-to-right without overlap.
>   Matching is byte-exact against the body as stored: no normalisation, no
>   trimming, so what a caller read is what a caller quotes. A patch is an
>   **ordinary write once applied** — validated before writing (§14), anchors
>   reconciled with remaps and orphans reported (§6), one attributed commit
>   (§4), locks respected (§7) — and a patch whose result is the unchanged
>   body is a no-op that writes nothing. The operation exists because the
>   write path's unit was the whole body, which priced a one-line edit at the
>   length of the document; the CLI exposes it as `corpus doc patch`, and the
>   agent's skills prefer it over whole-body edit for bounded changes.

## Acceptance Criteria

- [ ] Read aloud to the user on its own, per the one-at-a-time rule
- [ ] User signs off, or amends
- [ ] Applied to §9.2 with the `_(Rider signed YYYY-MM-DD.)_` marker
- [ ] Contradiction sweep recorded: §9.2's PUT description, §4 (squashing — does
      a patch squash with adjacent autosaves? the drafted text is silent; the
      existing §4 rule should simply apply, confirm it reads that way), §7
      (locks), §2.3 (the CLI verb registers like any verb)
- [ ] CONTRACT-046 / SERVER-079 / CLI-035 unblock only on the signed text

## Technical Design

None — spec text. Implementation is the already-filed chain.

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Read aloud verbatim, separately from the other held riders
- [ ] Signed by user
- [ ] Applied to SPEC.md §9.2 with signature marker
- [ ] Contradiction sweep recorded here
- [ ] Committed with `[SHARED-037]` prefix
