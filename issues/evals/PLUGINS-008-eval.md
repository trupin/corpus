# Evaluation: PLUGINS-008

**Date**: 2026-08-02
**Sprint**: sprint-023
**Verdict**: PASS

## Test environment

Real `corpus init` workspace at `/tmp/eval-dogfood`, real server on **:8791**,
**real built UI served by the server** at `http://127.0.0.1:8791/` (no Vite dev
server, no `stubCorpus`, no route interception), driven with a real headless
Chromium. The three legacy states were written **directly to disk** as
`data/docs/inbox/*.md` — which is exactly how they arise in a pre-existing
workspace — and picked up by the real watcher.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                       |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Filled with a state table, quoted server payloads, and CLI transcripts.                                                                                     |
| Commands are specific and concrete      | PASS   | Names `GET /api/docs/doc_legacychores`, `PUT /api/x/todos/doc_dualchores/items/0`, `corpus todos migrate --dry-run`, and quotes the responses verbatim.      |
| Real E2E (not mocked)                   | PASS   | Real server, real files, real git auto-commit; the quoted HTTP 400 body and the quoted migrate output both reproduce byte-for-byte in my own run.            |
| Scenarios cover acceptance criteria     | PASS   | All six criteria have matching evidence, including the "notice never shows" negative.                                                                        |
| Application restarted after changes     | PASS   | The log runs a full server + UI cycle, migrates, and reloads the reader to observe the notice clear.                                                         |
| Actual model recorded (implemented on:) | PASS   | "**Model: Opus 5 (`claude-opus-5[1m]`).**"                                                                                                                  |
| Reproduction logged before fix (bugs)   | PASS   | The bug is "empty body, no panel"; the log records the pre-fix state per document (`malformed → stats panel 0`, `frontmatter → editor checkboxes 0`) and the on-wire `extra.items` that proves the data was there and invisible. |

Two claims I attacked specifically, because they are the kind an agent could
write without running anything:

1. "the notice quotes `itemProblems`' sentence, which shares its clause with the
   refusal" — I fetched the real refusal (`PUT /api/x/todos/doc_dualchores/items/0`
   → HTTP 400) and diffed it against the on-screen text. The shared clauses are
   real (see AC 4 below).
2. "`button/input/a` inside the whole notice: **0**" — reproduced exactly, and
   pushed further: I clicked every read-only item and recorded **zero** non-GET
   requests and zero DOM change.

## Criteria Results

| #   | Criterion                                                              | Result | Notes                                                                                              |
| --- | ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| 1   | Frontmatter-items + empty body → explicit notice naming `corpus todos migrate` | PASS   | `data-todo-legacy="frontmatter"`, names the verb and says the agent or the CLI runs it.            |
| 2   | Legacy items render read-only under the notice, collapsed behind a count | PASS   | `<details open=false>` / summary "2 ITEMS, STORED IN FRONTMATTER"; expands to both items, inert.    |
| 3   | Malformed `items` key → notice with the plugin's diagnostic, not `null` | PASS   | `data-todo-legacy="malformed"`, diagnostic identical to the server's refusal text.                 |
| 4   | Dual-storage → says it needs migrating, quoting the same clause          | PASS   | Two clauses shared verbatim with the live HTTP 400.                                                |
| 5   | Migrated document renders exactly as today — notice never shows          | PASS   | `noticeCount: 0` on a body-format todo, before and after a real `corpus todos migrate`.            |
| 6   | Stats card behaviour unchanged, still absent where items are unreadable  | PASS   | Present on legacy/dual/migrated with correct counts; absent on malformed.                          |

## Evidence

### The three states are genuinely on the wire

`GET /api/docs/doc_legacychores` → `"extra": {"items": [{"text":"Book the passport appointment","done":false,…},{"text":"Send the signed form","done":true,…}]}`,
`"body": "\nChores that landed in the inbox before the item format changed.\n"`.
`doc_brokenchores` → `"extra": {"items": "nope"}`. `doc_dualchores` → an `items`
array **and** `"body": "\n- [ ] New body item\n"`.

### AC 1 + AC 2 — the frontmatter state

Reader text on `doc_legacychores` (`.reader [data-todo-legacy]`, kind
`frontmatter`, count 1):

> This list still stores its items in its `items` frontmatter — the format todo
> lists used before items became task-list lines in the document body. That is
> why the body below is empty, and why none of these items can be checked,
> edited or commented on here.
>
> Ask the agent to migrate it, or run `corpus todos migrate` yourself from the
> CLI — it converts every remaining list at once.
>
> ▸ 2 ITEMS, STORED IN FRONTMATTER

Disclosure state before interaction: `details.open === false`. After clicking
the summary:

```
☐ Book the passport appointment
☑ Send the signed form
```

markup: `<div class="t" data-todo-legacy-item="open"><span class="box">☐</span><span class="todo-item-text">…` and `<div class="t done" data-todo-legacy-item="done">…`.

Read-only, tested rather than assumed:
`[data-todo-legacy] button|input|a|[contenteditable=true]` → **0 elements**; I
then clicked all three item nodes with `{force: true}` and recorded
`writesAfterClickingItems: []` and unchanged text. Content is visible and
nothing pretends to be actionable.

### AC 3 — malformed

`data-todo-legacy="malformed"`, count 1 (the previous behaviour was no panel at
all):

> This list's `items` frontmatter has been hand-edited into something that no
> longer parses, so its items cannot be shown, counted, or written to:
>
> - `items: must be a list of items; found string`
>
> Repair the frontmatter by hand, then ask the agent to run
> `corpus todos migrate` (or run it from the CLI) to move the items into the body.

The diagnostic is the same string the server refuses with:
`{"code":"bad_request","message":"doc_brokenchores has malformed items and was not written — items: must be a list of items; found string"}`.
Screenshot `/tmp/eval-dogfood/shots/30-malformed.png`.

### AC 4 — dual storage, checked against the real refusal

On screen (`data-todo-legacy="dual"`):

> This document stores its items in two places — the task lines in the body
> below, and a leftover `items` frontmatter key nothing on this screen shows. It
> needs migrating: until one of the two lists is removed, the agent and the CLI
> refuse every item write they are sent:
>
> - this document **carries items in its body \*and\* in its `items` frontmatter** — **remove whichever list is stale**; until then nothing can be written to it

Live server refusal, `PUT /api/x/todos/doc_dualchores/items/0` → HTTP 400:

> doc_dualchores **carries items in its body \*and\* in its `items` frontmatter**, and was not written — **remove whichever list is stale** before writing to it

Both clauses match verbatim. A user reading the reader can predict the agent's
failure, which is what the criterion asks for.

### AC 5 + AC 6 — the negative and the stats card

| Document           | notices | kind          | stats card         | body checkboxes |
| ------------------ | ------- | ------------- | ------------------ | --------------- |
| `doc_legacychores` | 1       | `frontmatter` | 1 — 1 OPEN / 1 DONE | 0               |
| `doc_brokenchores` | 1       | `malformed`   | **0 (absent)**      | 0               |
| `doc_dualchores`   | 1       | `dual`        | 1 — 1 OPEN / 0 DONE | 1               |
| `doc_wreqytia`     | **0**   | —             | 1 — 1 OPEN / 1 DONE | 2 `[false,true]` |

Zero non-GET requests were issued while any of the four rendered — the notice is
derived in the browser and costs no write.

### The verb the notice names actually does the job

```
$ corpus todos migrate --dry-run
would migrate Legacy chores [doc_legacychores] — 2 items to move into the body
would skip Hand-edited chores [doc_brokenchores] — … malformed items … found string
would skip Half-migrated chores [doc_dualchores] — … carries items in its body *and* in its `items` frontmatter …
1 to migrate · 2 to skip · 1 already migrated
nothing was written — re-run without --dry-run to convert.

$ corpus todos migrate
migrated Legacy chores [doc_legacychores] — 2 items moved into the body
1 migrated · 2 skipped · 1 already migrated
```

The two documents `migrate` **skips** are exactly the two whose notices tell the
user to repair something by hand first — the screen and the verb agree about who
has to act.

On disk afterwards the `items:` key is gone and the body carries
`- [ ] Book the passport appointment` / `- [x] Send the signed form`.

### The affordance the bug removed, back

Reloading the reader on `doc_legacychores` after migration: `noticeCount: 0`,
checkboxes `[false, true]`, stats `1 OPEN / 1 DONE` (the same two numbers as
before — the notice added a region, it did not move a number). Clicking the first
checkbox issued `POST /api/locks/doc_legacychores` + `PUT /api/docs/doc_legacychores`,
the screen went `[false,true] → [true,true]`, the card went `0 OPEN / 2 DONE`,
and the file on disk now reads `- [x] Book the passport appointment`.

Screenshots: `/tmp/eval-dogfood/shots/30-legacy.png`, `30-malformed.png`,
`30-dual.png`, `30-migrated.png`, `31-legacy-expanded.png`, `32-post-migrate.png`.

## Failures

None.

## Subjective quality (the notice)

- Design quality **4** — two clearly distinct treatments (a neutral advisory
  panel; a red diagnostic panel), both sitting in the reader's existing card
  rhythm above the stats strip. `corpus todos migrate` is set in a code chip so
  the runnable thing is visually separable from the prose.
- Originality **3** — a conventional migration-notice pattern, executed with care
  rather than reinvented.
- Craft **4** — collapsed-by-default disclosure with an item count, done items
  struck through inside it, and the exact server diagnostic rendered as data
  rather than paraphrased.
- Functionality **5** — the failure is now self-explaining: what is wrong, where
  the content went, who fixes it, and the exact command. Nothing is guessable-only.

Average 4.0, no score of 1.

## Observations (not failures)

`PUT /api/x/todos/<id>/items/0` on a **frontmatter-only** legacy document
succeeds (HTTP 200) and silently rewrites the document into body format — i.e.
the write path self-migrates that one state, while `dual` and `malformed` refuse.
That is server/plugin write-path behaviour outside PLUGINS-008's criteria (the
issue is about the reader), and it does not contradict the notice, whose claim is
that the items "cannot be checked, edited or commented on **here**" — true, since
the reader offers no control for them. Noted so the next person does not read the
200 as a contradiction.

## Summary

**6 of 6 criteria passed.** All three legacy storage states now explain
themselves in the reader instead of rendering a silently empty body; the legacy
items are visible but inert; the diagnostics are the server's own sentences, not
paraphrases; the migrated document is untouched; and the whole cycle — notice,
`corpus todos migrate`, notice gone, checkbox toggles through to disk — was
driven end to end against the real running application.
