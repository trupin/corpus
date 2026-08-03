# Evaluation: UI-038

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Production UI served by the real server at `http://127.0.0.1:8891/` (workspace
`/tmp/eval-dogfood-ws`), real Chromium via Playwright, real pointer drags on the
`.col-resizer` handles. Six columns of three kinds created through the CLI:
folder (`Inbox`, `folder=inbox`), plugin (`Todos`, `column: todos/todos`), and
views (`Attention`, `Open threads`, `Conversations`, `Just todos`).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Verification log present                | PASS   |                                                                             |
| Commands are specific and concrete      | PASS   | Measured px values per column, per width, with the probe width alongside     |
| Real E2E (not mocked)                   | PASS   | Real browser, real drags; transport stubbed but this issue writes nothing    |
| Scenarios cover acceptance criteria     | PASS   | A numbered drill per criterion                                              |
| Application restarted after changes     | PASS   | Named port per run                                                          |
| Actual model recorded (implemented on:) | PASS   | "Model: opus"                                                               |
| Reproduction logged before fix (bugs)   | PASS   | Pre-fix measurement: row offers 306 px, chips+label need 308.3 px           |

## Criteria Results

| #   | Criterion                                                | Result | Notes                                                                        |
| --- | -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| 1   | Chips + sort share one row at all widths; never wraps    | PASS   | `.chips` box height **23 px** at 240 / 336 / 640 / 736 / 740 px, every column |
| 2   | Degrades to "last ↓"; glyph always visible               | PASS   | Exact text `last ↓`; label's right edge == row's right edge, never clipped    |
| 3   | Width-driven, reversible, no ellipsis, no chip overlap   | PASS   | Restores on widening; gap after last chip stays **+5 px**; no ellipsis        |
| 4   | Applies to every column type                             | PASS   | Folder, plugin and view columns all degrade and restore                       |

### Measurements (all with the hidden `.chips-probe` read in the same frame)

Default 336 px columns, one board load:

| column        | kind   | chips                                | row px | probe px | rendered label    |
| ------------- | ------ | ------------------------------------ | ------ | -------- | ----------------- |
| Attention     | view   | `needs: me`                          | 306    | 184.0    | `last activity ↓` |
| Inbox         | folder | `folder: inbox/`                     | 306    | 217.1    | `last activity ↓` |
| Open threads  | view   | `type: thread` `status: open`        | 306    | 308.3    | `last ↓`          |
| Todos         | plugin | `type: todo`                         | 306    | 190.6    | `last activity ↓` |
| Conversations | view   | `type: thread` `status: open`        | 306    | 308.3    | `last ↓`          |
| Just todos    | view   | `type: todo`                         | 306    | 190.6    | `last activity ↓` |

**Criterion 3's "fit, not a breakpoint" is decided here**: at the *identical*
336 px width, `Just todos` (one chip) keeps the full label while `Conversations`
(two chips) does not. A width breakpoint could not produce that.

Real drags (`Resize <column>` handles, 12-step pointer moves):

```
Just todos    336 → 240 : rowH 23, "last activity ↓", compact=false  (probe 190.6 < row 210)
Just todos    240 → 640 : rowH 23, "last activity ↓"
Conversations 336 → 736 : rowH 23, "last activity ↓", compact=false
Conversations 736 → 336 : rowH 23, "last ↓",          compact=true    ← reversible
Todos(plugin, 3 chips) 240 : rowH 23, "last ↓", compact=true
Todos(plugin, 3 chips) 740 : rowH 23, "last activity ↓", compact=false
Inbox(folder)          240 : rowH 23, "last ↓", compact=true
```

At the 240 px floor with the short label still not fitting, the **chips clip and
the label does not**:

```
Conversations @240: chips ["type: thread"(clipped) "status: open"(clipped)]
                    gapAfterLastChip +5   sortRight 579 == rowRight 579
Todos @340 (3 chips): all three chips clipped
                    gapAfterLastChip +5   sortRight 325 == rowRight 325
```

No `…` anywhere; `text-overflow` is not `ellipsis` on the label.

The probe is invisible and out of the a11y tree: `position: absolute`,
`aria-hidden="true"`, and it is a child of `.chips` (worth knowing — a naive
`.chips .chip` query counts its chips too).

## Failures

None.

## Summary

4 of 4 criteria passed, measured rather than eyeballed, across three column
kinds and five widths including the 240 px floor. The mechanism is demonstrably
fit-driven, not a breakpoint.
