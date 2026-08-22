# Evaluation: UI-020

**Date**: 2026-07-31
**Sprint**: sprint-018 (TEST-615–626)
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Same as UI-027: workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059),
Vite `:5280`, real Chromium. Port 8765 untouched.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Structured per sprint test id, TEST-615 → TEST-626.                                                        |
| Commands are specific and concrete      | PASS   | Wire traces, `ls` output, `grep '^status:'`, both 409 message bodies, `git log --format`.                   |
| Real E2E (not mocked)                   | PASS   | Browser half on a real dev server, disk/git half on a real workspace; proxy target proved, not assumed.     |
| Scenarios cover acceptance criteria     | PASS   | All three criteria mapped onto TEST-615/618/619-620.                                                        |
| Application restarted after changes     | PASS   | Fresh workspace on 8797 created for the drill.                                                              |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (`claude-opus-5[1m]`), 2026-07-31."                                               |
| Reproduction logged before fix (bugs)   | N/A    | Feature + scope correction, not a bug. The pre-state is nonetheless evidenced (`grep -rn "unarchive"` → 0). |

The log is unusually honest in two places I checked and confirmed: it flags the
**Unpin** path as deliberately left on the `PUT` (I confirmed Unpin still works and
is a `view`, so no folder move exists to miss), and it declares the scoped
Playwright run **deferred** rather than claiming it. Neither is padding.

## Criteria Results

| #   | Criterion                                                                              | Result | Notes                                                                     |
| --- | -------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| 1   | Archived doc's ⋯ menu and context menu offer Unarchive; non-archived don't              | PASS   | Both presentations checked on both states.                                 |
| 2   | Skill docs: folder moves back, name freed (SERVER-036's 409 recoverable from the UI)    | PASS   | Full round trip, both 409 branches observed.                               |
| 3   | SERVER-039's refusal unreachable from the frontmatter form                              | PASS   | Control disabled on archived; `archived` removed as a destination on live. |
| 4   | TEST-616/617 — both transitions go through the routes that own them                     | PASS   | Exactly one `POST`, zero `PUT`s, on every surface exercised.               |
| 5   | TEST-620 — the exit flush cannot carry `status`                                          | PASS   | Unmount flush body was `{"title":"…"}` and nothing else.                   |
| 6   | TEST-621 — the server guard is still the enforcement                                     | PASS   | Direct `PUT` → HTTP 400, message byte-compatible with SERVER-039's.        |

## Evidence

### Menu contents, both presentations, both states

Reader ⋯ sheet on the same skill document (`doc_gdh3dstu`, `weekly-review`):

```
live      ["review:Still current…", "archive:Archive reversible — hidden from default lists", "delete:Delete…"]
archived  ["review:Still current…", "unarchive:Unarchive restores it — a skill's folder moves back too", "delete:Delete…"]
```

Right-click context menu, on rows:

```
ARCHIVED row  ["open","open-focus","unarchive","delete"]
LIVE row      ["open","open-focus","archive","delete"]
```

Never both, never neither, and the row surface adds only its two openers — the
parity the issue claims, observed in the browser rather than inferred from a unit
test.

### The wire

Recorded off the page (all non-GET requests, SSE excluded):

```
Archive from reader ⋯   writes: ["POST /api/docs/doc_gdh3dstu/archive"]
                        toast:  ✓ Archived "weekly-review" — committed. Archiving is reversible.
Unarchive from reader ⋯ writes: ["POST /api/docs/doc_gdh3dstu/unarchive"]
                        toast:  ✓ Restored "weekly-review" — committed. It is back in the default lists.
```

One write each, and it is the `POST`. **Zero `PUT`s** in either direction.

The `e` shortcut (§10), both entry points:

```
e with the reader open        → POST /api/docs/doc_hffvakmq/archive
e on the j/k-highlighted row  → POST /api/docs/doc_jq7szwg6/archive
```

### The skill round trip — the gate

```
created   .claude/skills/weekly-review/          skill create → 409 "already installed"

after Archive from the reader's ⋯ menu:
  .claude/skills/            comment/ fixture-notes/ orchestrate/ todos/     (gone)
  .claude/skills-archived/   weekly-review/
  status:                    archived
  corpus skill create weekly-review
    → 409 conflict: the name `weekly-review` belongs to an archived skill
      (.claude/skills-archived/weekly-review exists) — unarchive it to bring it back…

after Unarchive from the reader's ⋯ menu:
  .claude/skills/            … weekly-review/     (back)
  .claude/skills-archived/   (empty)
  status:                    open
  corpus skill create weekly-review
    → 409 conflict: a skill named `weekly-review` is already installed …
```

The 409 flipped branches and flipped back. Auto-commits:

```
d138413 user doc unarchive: weekly-review (doc_gdh3dstu) by user
967a111 user doc archive:   weekly-review (doc_gdh3dstu) by user
```

### The frontmatter form cannot produce the half-state

Archived document, form in edit mode:

```
select fm-input   disabled: true   value: "archived"
hint              "archived — Unarchive in the ⋯ menu brings it back"
```

Live document:

```
select fm-input   disabled: false  options: ["open","resolved"]     ← no archived destination
hint              "archive from the ⋯ menu — a status flip would not move a skill's folder"
```

Exit-flush path (TEST-620): title drafted on an **archived** document, reader closed
without touching Save. The only write that left the page:

```
PUT /api/docs/doc_hffvakmq :: {"title":"Renamed while archived"}
toast: ✓ Saved — title updated and committed.
```

No `status` key, no 400.

### The server guard, unweakened

```
$ curl -X PUT :8802/api/docs/doc_hffvakmq -d '{"status":"open"}'
HTTP 400
{"code":"bad_request","message":"request failed validation","issues":[{"path":"body.status",
 "message":"doc_hffvakmq is archived; `status: open` would set the frontmatter without bringing
  the document back. Use `POST /api/docs/doc_hffvakmq/unarchive` — …"}]}
```

### Non-skill: no folder move

`doc_hffvakmq` (`type: note`) archived and unarchived from the UI stayed at
`data/docs/inbox/mortgage-options.md` with the id unchanged, and left/re-entered the
default lists live over SSE (that is how the drill found the row to right-click in
each direction). Its row carries `data-row-status="archived"` while archived.

## Failures

None.

## Note on `e` (checked because the brief asked whether it toggles)

`e` **archives only**; on an already-archived open document it answers
`✓ "…" is already archived.` and sends nothing. That is SPEC.md §10 verbatim —
"`e` archive the open (or highlighted) document" — not a toggle, so this is correct
behaviour, not a gap. Recording it because the phrasing "`e` toggles" would
otherwise read as an unmet expectation.

## Summary

6 of 6 criteria passed. Both transitions run through the routes that own them from
every surface I could reach, the skill's folder and name round-trip cleanly, and the
half-state is closed at the control, at the exit flush, and still at the server.
