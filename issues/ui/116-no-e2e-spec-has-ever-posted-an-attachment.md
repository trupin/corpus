# [UI-116] No e2e spec has ever posted an attachment, on any surface

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-070, UI-111, UI-112, PLUGINS-012 (the attachment work this release
  ships), INFRA-028 (the other way the e2e suite tests the wrong thing)

## Spec References

- SPEC.md **§11** — *"Every composer takes attachments"* (rider signed
  2026-08-05)
- SPEC.md **§6** — attachments, chips, and what a comment may carry

## Summary

`apps/ui/e2e/stubCorpus.ts:889` records every request with
`JSON.parse(request.postData())`. That throws on `multipart/form-data`.

The consequence, found by PLUGINS-012 and stated in its own words:

> **No spec in the suite has ever posted an attachment on any surface** — not
> the reply box, not the comment popover, not the global composer.

So this release ships §11's rider made true across five composers, and **CI
checks none of the send path**. Every proof that attachments actually reach the
server in this phase — UI-111's four drills, UI-112's, PLUGINS-012's md5-verified
bytes on disk — came from a human-driven browser drill that runs once, by hand,
and then never again. The specs stop at the chips.

That is a real asymmetry and worth being blunt about: the chips are the easy
half. A chip is a local object URL and a bit of DOM. The part that breaks is the
part after — the multipart body, the server's parse, the bytes on disk, the
markdown link, and the restore-on-failure path when the post is refused. None of
it has a regression test that runs on a push.

## Acceptance Criteria

- [ ] `stubCorpus` records multipart requests without throwing, and exposes
      enough of the body that a spec can assert **which files** were sent and
      with what field names — not merely that the request was multipart
- [ ] At least one spec posts a real attachment through a composer and asserts
      it arrived; it must fail if the files are dropped from the request
- [ ] The **attachment-only** case (no text) is covered, since §6 allows it and
      it is the one most likely to be broken by a `canSend` regression
- [ ] The **restore-on-failure** path is covered: a refused post returns the
      words *and* the chips. UI-111's issue says why this matters — "a comment
      that loses its screenshot because the post failed is worse than one that
      could never take it" — and it is currently proven only by hand
- [ ] Whatever is added is checked red against the unfixed behaviour: a spec
      that passes against a composer sending no files proves nothing

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/stubCorpus.ts` — the request recorder
- `apps/ui/e2e/` — the spec(s)

### Notes

The stub is shared fixture code that every spec depends on, so a change to how
it records requests can break specs that have nothing to do with attachments.
Make the multipart path additive rather than replacing the JSON path.

Do not reach for a fully general multipart parser if a narrow one will do — what
the assertions need is the file parts' names and filenames, and possibly their
sizes. Parsing bodies the suite will never send is scope this issue does not
have.

## Testing Strategy

The specs are the deliverable. The check on the fixture itself is that the
existing suite still passes unchanged.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-116]` prefix
