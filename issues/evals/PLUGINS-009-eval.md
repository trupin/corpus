# Evaluation: PLUGINS-009

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Production UI served by the real server at `http://127.0.0.1:8891/`, workspace
`/tmp/eval-dogfood-ws`, **no stub anywhere**. Real Chromium. Every write below
was confirmed on disk and, where relevant, re-read through the API.

Fixtures via the CLI: `doc_vyhr4yr2` "House chores" (17 items, three identical),
`doc_rp7tlqf4` "Deep backlog" (25 items), a pinned `column: todos/todos` view.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Verification log present                | PASS   |                                                                             |
| Commands are specific and concrete      | PASS   | Real workspace, real ports/pids, on-disk diff, git commit hashes            |
| Real E2E (not mocked)                   | PASS   | `corpus init` + real server + real Chromium, with the API-resolved anchor   |
| Scenarios cover acceptance criteria     | PASS   | All four, plus a keyboard pass                                              |
| Application restarted after changes     | PASS   | Server start/stop logged, ports verified free                               |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (`claude-opus-5[1m]`)"                                       |
| Reproduction logged before fix (bugs)   | PASS   | Dogfood report reproduced (right-click did nothing); a defect found in core is reported, not worked around |

## Criteria Results

| #   | Criterion                                                    | Result | Notes                                                                    |
| --- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| 1   | Menu with toggle / comment / open-thread (thread-gated)      | PASS   | Third item present only on the item that has a thread                    |
| 2   | Toggle through the atomic path; row refreshes without reload | PASS   | One `PUT`, **one character** changed on disk, 0 navigations              |
| 3   | Comment = the same anchored thread a reader selection makes  | PASS   | Byte-for-byte the same selector construction; anchor resolves            |
| 4   | Matches the board's context-menu look and keyboard behaviour | PASS   | Same `.ac-menu` surface, same tokens; ⇧F10 / arrows / ↵ / esc all correct |

### The menu

```
right-click item 1 → aria-label "Actions for Renew the car insurance"
                     native contextmenu defaultPrevented: true
                     items: ["Mark as done — checks the box in the list",
                             "Comment on item — opens a thread anchored to these words"]
                     [data-ctx-menu] painted by core: 0
```

Core paints **nothing** over the surface it handed the plugin, and the plugin's
frame wears the app's own chrome. Side by side with a core row's menu in the same
session:

|            | plugin menu               | core row menu             |
| ---------- | ------------------------- | ------------------------- |
| base class | `ac-menu open todo-menu`  | `ac-menu open ctx-menu`   |
| background | `rgb(255, 255, 255)`      | `rgb(255, 255, 255)`      |
| radius     | `9px`                     | `9px`                     |
| border     | `1px solid rgb(227,225,218)` | `1px solid rgb(227,225,218)` |
| z-index    | `60`                      | `60`                      |
| label form | "Actions for <item>"      | "Actions for <document>"  |

Thread gating, three items in one session:

```
item 4 (has a thread) : ["Mark as done","Comment on item","Open existing thread"]
item 0 (no thread)    : ["Mark as done","Comment on item"]
item 6 (no thread)    : ["Mark as done","Comment on item"]
```

### Toggle — one character, atomically

```
rows before: 0,1,3,4,5
click "Mark as done" on item 1
rows after : 0,3,4,5,6            ← item 1 gone, item 6 pulled in
write requests: PUT /x/todos/doc_vyhr4yr2/items/1
                {"done":true,"expectedText":"Renew the car insurance"}
page navigations: 0        menus open after the action: 0
```

`diff` of the file before and after:

```
6c6
< updated: 2026-08-03T01:00:50Z
---
> updated: 2026-08-03T01:16:04Z
19c19
< - [ ] Renew the car insurance (due: 2026-09-15)
---
> - [x] Renew the car insurance (due: 2026-09-15)
```

One body character, plus the ordinary `updated` stamp. Nothing else moved —
including the prose paragraph above the list.

**I attacked the "atomic" claim directly.** With the menu open on Deep backlog
item 21, I rewrote that item's text out from under it via
`corpus doc edit doc_rp7tlqf4 --file …` and *then* clicked "Mark as done":

```
409 /x/todos/doc_rp7tlqf4/items/21
visible notice: PUT /api/x/todos/doc_rp7tlqf4/items/21 failed (HTTP 409):
  item 21 is now "Compare the CONTENTS insurance quotes",
  not "Compare the home insurance quotes" — it changed under you; nothing was written
```

Refused, named, and nothing written — the disk still shows the item unchecked.
`expectedText` is doing real work, not decoration.

### Comment — indistinguishable from a reader selection

Plugin menu, "Comment on item" on `Descale the kettle`:

```json
{"parent":"doc_vyhr4yr2",
 "selector":{"exact":"Descale the kettle",
             "prefix":"intment (due: 2026-08-01)\n- [ ] ",
             "suffix":"\n- [ ] Call the plumber about th"},
 "body":"Which descaler should I buy?","requestsAgent":true}
```

A **reader text selection** of another item in the same document, commented via
the reader's own selection menu ("Actions for the selection" → 💬 Comment on
selection):

```json
{"parent":"doc_vyhr4yr2",
 "selector":{"exact":"Clean the gutters",
             "prefix":"bicycle (due: 2026-10-02)\n- [ ] ",
             "suffix":"\n- [ ] Repaint the shed door\n- ["},
 "body":"Reader-selection comment","requestsAgent":true}
```

Same wire shape, same 32-character context frames, same `requestsAgent`. Both
anchors, re-read through `GET /api/docs/doc_vyhr4yr2`, **resolve**:

```
anc_2b9e2bf5 th_yuanfczf orphaned false slice= "Clean the gutters"
anc_c74de5ee th_7h43q3ag orphaned false slice= "Descale the kettle"
```

The slice is taken from the returned body at the returned range — the anchor
points at exactly the item's words, not near them.

### Keyboard

```
⇧F10 on a focused row → menu "Actions for Descale the kettle", focus "Mark as done"
  ↓   → Comment on item
  ↓↓  → Open existing thread
  ↑   → Comment on item
  esc → menus 0 · readers 0 (nothing behind it closed) · focus back on row 4
```

Escape closes the menu **only** — the board underneath is untouched — and focus
returns to the row that opened it.

### Open existing thread

```
reader doc      : doc_vyhr4yr2
expanded slots  : ["th_7h43q3ag"]
all slots       : th_7h43q3ag (expanded), th_yuanfczf
.thread-card.flash: present for 72 of 137 sampled frames (~1.2 s)
entry           : {"docId":"doc_vyhr4yr2","scrollY":731}   ← reveal spent
```

The dev-only StrictMode defect the implementer escalated does **not** occur in
the production build served by the server, exactly as they predicted.

## Failures

None.

## Notes (not failures)

- **The "Mark as open" branch is not reachable from this column.** SPEC §12
  defines the Todos column as "aggregating **open items**", so a checked item
  never renders a row there and only the done direction can be exercised. The
  un-check stays reachable in the reader, which is what the §10 amendment
  requires ("every action a plugin row's menu offers must stay reachable without
  a pointer through the item's document surfaces"). Correct by spec, but the
  label's other half is untested in the real app and should be read as such.

## Summary

4 of 4 criteria passed. The menu is the app's own surface by measurement rather
than by resemblance, the toggle writes exactly one character and provably
refuses a stale write, the comment path produces an anchor a reader selection
would have produced and that the server resolves, and the keyboard contract
(⇧F10, roving arrows, ↵, layered esc, focus restore) holds.
