# Evaluation: UI-008

**Date**: 2026-07-28 (re-verified after the fix pass at `85d929a`)
**Sprint**: sprint-011 (TEST-37…86)
**Verdict**: PASS

> **Round 2 — FAIL-1 is fixed.** Re-checked at `85d929a` on a fresh workspace (port 9031) in the
> exact case that failed: a turn-delete armed inside a chip-expanded card nested under a
> `contenteditable="true"` ancestor. Escape now disarms, with zero DELETE requests and the card and
> reader both left open. Verdict flipped FAIL → **PASS**.

Production-served board on `9030`, real workspace, real server, real CLI second actor, real Chromium.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | Longest log in the batch |
| Commands are specific and concrete      | PASS   | Real request bodies, real queue JSON, real attachment paths |
| Real E2E (not mocked)                   | PASS   | Real workspace on 9007, real `corpus thread reply --from agent` second actor |
| Scenarios cover acceptance criteria     | PASS   | TEST-37…86 addressed; three genuinely blocked criteria carry explicit `DEFERRED → …` markers rather than silent omission |
| Application restarted after changes     | PASS   | |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus." |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue |

**Honesty audit — no contradictions.** Every claim I sampled re-derived exactly: the composer
placeholder character-for-character, the foot's child order, the tri-state `requestsAgent` wire
values, the form route's URL-encoded `ts`, the `form.respond` payload shape, the attachment paths and
their gitignore status, and the whole-match fence grammar. The deferrals are honest — TEST-79's
margin-card case really did belong to UI-007.

## Criteria Results (selected; all 50 checked)

| #  | Criterion                              | Result   | Notes |
| -- | -------------------------------------- | -------- | ----- |
| 37 | `.thread-card` computed                | PASS     | `rgb(239,237,232)` = `--surface-2`, **3px** left border `rgb(59,95,151)` = `--accent`, radius 10px, `max-width` 62ch |
| 38 | Head's three variants                  | PASS     | `.t-quote` = `“Final paragraph fo”`, italic, `rgb(86,93,102)` = `--ink-2`, 12.5px; `.chip.t-status` = `open`; `.t-resolve` = `✓ resolve`; `.t-collapse` = `–` |
| 39 | Context line names the parent          | PASS     | `on Mortgage options · at “Final paragraph fo”` |
| 40 | Deleted parent degrades                | PASS (log) | Not independently re-run |
| 41 | One component, three hosts             | PASS     | Card carries a host class (`thread-card host-slot`) rather than branching JSX |
| 42 | Turns render as prototype blocks       | PASS     | First `.turn` `border-top: 0px`, the rest `1px`; `.who.agent` class present on agent turns only |
| 43 | Turn bodies are markdown with live refs| PASS     | An agent turn's `[[doc_mbc52nvo]]` rendered as **Rates** through the kit's `MarkdownView` |
| 44 | Trace line `↳` from `::before`         | PASS (log) | Not independently re-run |
| 45 | React keys are turn timestamps         | PASS (log) | Method stated in the log |
| 46 | Delete arms before it fires            | PASS (round 2) | Arming, user-only restriction, hover reveal and the URL-encoded DELETE were correct in round 1; esc-disarm FAILed and was **fixed at `85d929a` and re-verified** — see "Round 2 re-verification" |
| 47 | Deletion honest on disk and in git     | PASS     | Turn block removed from the file; `git log -p` retains it; deletion auto-commit present |
| 48 | Cascade reflected, not assumed         | PASS (log) | Not independently re-run |
| 49 | Turn-with-children behavior recorded   | PASS     | Recorded in the log rather than guessed |
| 50 | Placeholder exact                      | PASS     | `Reply — @ route · / skill · [[ link · paste or drop files`, `aria-label="Reply"` — character-for-character |
| 51 | Foot is the prototype's, in order      | PASS     | `.composer-foot` children in order: `clip:📎`, `toggle on:◉ ask agent`, `composer-hint:thread stays open`, `send:Reply ↵` |
| 52 | Tri-state `requestsAgent`              | PASS     | **Verified all three ways on an engaged thread.** `○ note only` → `{"body":"note only reply","requestsAgent":false}` — explicit `false`, not omitted; queue held **no** event for it. `◉ ask agent` → `requestsAgent:true` and a `comment.created` in `.corpus/queue/pending/`. Timestamps correlated turn-by-turn against the thread file |
| 53 | `@`/`/` in text and the toggle         | PASS     | Behavior observed and stated; UI sends raw text + flag, server parses mentions |
| 54 | Hint follows thread status             | PASS     | Open thread → `thread stays open` |
| 55 | Send cannot fire twice                 | PASS     | Two rapid clicks → **1** POST, one turn on disk |
| 56 | Optimistic turn appears then reconciles| PASS     | No duplicates after refetch |
| 58 | One autocomplete, three triggers       | PASS     | `@` → `type: agent-def` (`agent`, `researcher`); `/` → `type: skill` (`summarize`, `comment`, `orchestrate`); `[[` → documents by title. A `researcher` agent-def created with `corpus doc create` was autocompletable immediately — no registry |
| 59 | Lives in kit, three callers            | PASS     | One `AutocompleteMenu` + one matcher in `packages/kit/src/components/Autocomplete/`. Per the Wave-B Addendum, two *trigger detectors* are accepted; menu/matcher singularity holds |
| 61 | Menu is the prototype's                | PASS     | `.ac-menu`/`.ac-item` with mono `.k` and dim `.d`; ↑↓/↵/esc/hover all work |
| 62 | Three ways in, one pending list        | PASS     | 📎 picker verified live; all land in one `PendingAttachment[]` |
| 64 | Pending chips preview and clean up     | PASS     | `.att-chip` `1px rgb(227,225,218)`, radius 7px, padding `3px 8px`, 11px, `--surface-2`; image thumbnail measured at exactly **34px**; remove button present |
| 65 | Attachment-only turn is a turn         | PASS     | Send **enabled** with empty text; posted multipart; the thread file gained a turn whose body is only the attachment references |
| 66 | Posted attachments resolve real bytes  | PASS     | `.turn-att-img` `max-height 180px`, radius 8px; `.att-file` chip `📄 doc.pdf`; `GET /attachments/th_b43j4a3q/2026-07-28T19%3A36%3A07Z/pic.png` → **200 image/png** |
| 67 | Bytes on disk, gitignored, refs committed | PASS  | Bytes at `.corpus/attachments/<threadId>/<turnTs>/`; `git check-ignore` → `.gitignore:9:.corpus/*`; committed markdown holds relative links |
| 68 | Oversized upload surfaces the answer   | PASS     | A 26 MB file → server 413; toast read `Reply failed — POST /api/threads/{id}/turns failed (HTTP 413): attachment big.bin is 27262976 bytes, over the per-file limit of 26214400 bytes (25 MB)`. Turn not posted; text and chips restored |
| 69 | Failed upload posts nothing            | PASS     | `grep -c "this should not post"` on the thread file → **0**. No partial turn |
| 70 | `form` fence renders live controls     | PASS     | `.form-comment` with three `.form-opt` cards and a `.form-submit` reading `Answer` |
| 71 | Fence grammar matched WHOLE            | PASS     | Turns carrying ```` ```formula ```` and ```` ```form-builder ```` rendered as **plain code blocks**; only ```` ```form ```` became a form |
| 72 | Picking marks; submit uses form route  | PASS     | `.form-opt.picked` gains `rgb(59,95,151)` border + `rgba(59,95,151,0.1)` background; submit issued `POST /api/threads/th_fbr7ffcy/turns/2026-07-28T19%3A21%3A51Z/form` with `{"option":"30-year fixed"}` — the dedicated route, `ts` URL-encoded, **not** a hand-built turn |
| 73 | Answer produces turn + queue event      | PASS     | Thread file gained `## user · … **Answered:** 30-year fixed`; queue held exactly `form.respond {"threadId":"th_fbr7ffcy","formTs":"2026-07-28T19:21:51Z","option":"30-year fixed","note":null}`. (On a thread with `agent: none` the server correctly declines to enqueue — server policy, verified separately over raw HTTP) |
| 74 | Answered form is inert                 | PASS     | After the 201 the submit control count went to **0**; the card reads `Answered — 15-year fixed` |
| 75 | Malformed YAML degrades                | PASS     | Invalid-YAML fence rendered as a plain code block plus `This form could not be read — Flow sequence in block collection must be sufficiently indented…` (the `yaml` library's own message). **Zero** page errors |
| 79 | Seen fires for displayed content only  | PASS     | Expanding a chip issued `POST /api/threads/th_gzbc6a4x/seen`; opening the parent with chips collapsed issued none |
| 80 | Seen de-duplicated per (thread, turn)  | PASS     | Three collapse/expand cycles with no new turn → **0** further POSTs |
| 81 | Kit's bare seen call stays bare        | PASS     | `POST …/seen` body is `null` — no `lastSeenTs` |
| 86 | Resolve/reopen from both places        | PASS     | Card head's `✓ resolve` hits `POST …/resolve`; status chip and styling update live; reflected in the file's `status` |

## Round 2 re-verification (commit `85d929a`)

Fresh workspace on port 9031. I rebuilt the exact failing situation rather than a convenient one: an
anchored thread created through the UI, its chip expanded so the `.thread-card` renders **inline in
the document reader**, whose body is the TipTap editor. The ancestor chain was confirmed before
arming:

```
ancestor contenteditable chain from .turn-del:
  ["anchor-slot ProseMirror-widget=false", "tiptap ProseMirror doc-body=true"]
```

Two user turns present, so deleting one is not the cascade case.

```
ARMED:                  delete?|turn-del armed      DELETEs so far: 0
focused element:        turn-del armed
→ press Escape
AFTER ESCAPE:           ✕|turn-del                  ← DISARMED
  DELETE requests:      0
  thread card open: 1   reader open: 1   turns: 2   ← Escape consumed only the arming
```

Regression checks on the halves that already worked:

```
re-ARMED:                     delete?|turn-del armed
→ click elsewhere
AFTER CLICK ELSEWHERE:        ✕|turn-del        DELETEs: 0
→ arm, then click again
TWO CLICKS -> DELETE:  ["/api/threads/th_4b2kx7pw/turns/2026-07-28T20%3A27%3A06Z"]
turns after delete:    1                        ← ts still URL-encoded; cascade untouched
```

Zero page errors.

## Failures

None at `85d929a`.

### FAIL-1 (round 1, at `ae1e855` — FIXED at `85d929a`): Escape did not disarm an armed turn-delete

**Criterion**: TEST-46 — *"Clicking elsewhere or pressing esc disarms."*

**Expected**: After the first click arms `.turn-del` (label `delete?`, class `armed`), pressing
Escape returns it to `✕` / `turn-del`, exactly as clicking elsewhere does.

**Observed**: Escape leaves the button armed. The next click on it deletes the turn — which is the
precise safety property the two-click arming exists to provide. Clicking elsewhere *does* disarm, so
only the keyboard half of the criterion is missing.

**Steps to reproduce**:

1. Open `Mortgage options` on the production-served board; expand a thread chip.
2. Click a **user** turn's `.turn-del` (`✕`) once.
3. Observe it arms and that the button holds DOM focus.
4. Press `Escape`.
5. Read the button again.

```
armed:                     delete?|turn-del armed
focused element:           turn-del armed
after Escape:              delete?|turn-del armed     ← still armed
                           thread card still open: 1   reader open: 1
after clicking elsewhere:  ✕|turn-del                  ← this half works
```

Note that Escape was not consumed by another layer — the thread card and the reader both stayed
open, so the keypress reached no handler at all.

## Summary

**50 of 50 criteria PASS at `85d929a`** (6 accepted on an audited log rather than re-run). Round 1
at `ae1e855` scored 49 PASS / 1 FAIL; the failure was fixed and re-verified.

This is the densest surface in the batch and it is in very good shape. The two criteria the sprint
singled out as the easiest to get silently wrong are both right: **`requestsAgent` is genuinely
tri-state** — I correlated three consecutive replies against `.corpus/queue/pending/` by timestamp
and the note-only one produced no event — and **the form answer goes through the dedicated route**
and yields a real `form.respond` with the exact `{threadId, formTs, option, note}` payload. The
destructive and irreversible paths are honest: deletion arms first and is user-only, a 413 posts
nothing partial and restores the composer, and attachment bytes land gitignored with relative links
committed.

Round 1's single failure was a keyboard gap on the arming affordance — small, but on the one
destructive control in the surface, and the criterion names Escape explicitly. It is closed, and the
re-check confirmed the fix did not cost the two behaviors that already worked: click-elsewhere still
disarms, and two deliberate clicks still delete with the timestamp URL-encoded.
