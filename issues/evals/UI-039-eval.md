# Evaluation: UI-039

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Production UI served by the real server at `http://127.0.0.1:8891/`, workspace
`/tmp/eval-dogfood-ws`. **No transport stub** — every suggestion below came out
of the real projection over real HTTP.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------ |
| Verification log present                | PASS   |                                                                          |
| Commands are specific and concrete      | PASS   | Six numbered drill steps with keystrokes and observed values             |
| Real E2E (not mocked)                   | PASS   | Real Chromium; transport stubbed there, re-verified here without a stub  |
| Scenarios cover acceptance criteria     | PASS   | All five, plus the adjudicated unknown-field notice                      |
| Application restarted after changes     | PASS   | Port named per run                                                       |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (`claude-opus-5[1m]`)"                                    |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue, not a bug                                                 |

## Criteria Results

| #   | Criterion                                                        | Result | Notes                                                                    |
| --- | ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| 1   | Field suggestions; real workspace values after `field=`          | PASS   | Values are counted rows from the live projection, incl. the plugin type  |
| 2   | Follows the §11 autocomplete conventions (arrows/↵/esc)          | PASS   | `.ac-menu` `role="listbox"`, ⇥ completes, ↓ moves, ↵ accepts, esc layers |
| 3   | Visible help button opens a syntax reference; dismissible; kbd   | PASS   | `?` reachable by one ⇥; `role="dialog"`; esc closes panel only           |
| 4   | Invalid queries surface the existing error state unchanged       | PASS   | `sort=nonsense` → the column's existing failed-request card              |
| 5   | No behavior change to query execution                            | PASS   | Commits are one `PUT` carrying the typed query verbatim                  |

### Field and value completion, real data

```
"ty"        → listbox below the field: "type — Document type. Plugins add their own, so the set is open"
⇥           → field reads "type="
"type="     → view (6 documents), skill (4), thread (3), note (2), template (2),
              todo (2), agent-def (core type)
```

`todo` is offered **because two `type: todo` documents exist in this workspace** —
a plugin type, counted from `GET /api/docs`. No hardcoded list produces that.

```
"status="   → open, resolved, archived   (contract order)
  ↓         → aria-selected moves to "resolved"
  ↵         → field reads "status=resolved"
"&folder="  → finance (3 docs), inbox (4), templates (2), views (6)   ← from the tree
"tag="      → core (2 documents), finance (2)                          ← from the rows
"parent="   → offered BY TITLE with the id inserted:
              th_yuanfczf "Re: \"Clean the gutters\"", doc_vyhr4yr2 "House chores", …
```

Escape layering: with the menu open, the **first** `esc` closes the menu and
leaves the field open; the **second** abandons the edit — the column's chips
still read `type: thread` / `status: open` and **zero** `PUT`s were sent.

### Help panel vs. the server's actual fields

The panel's `[data-query-field]` rows were compared against the parameter list
the **running server publishes** for `GET /api/docs` (fetched from
`http://127.0.0.1:8891/api/openapi.json`):

```
server params (19): limit offset q type status includeArchived tag folder parent
                    references agent author since due stale unread pinned needs sort
panel fields  (19): q type tag status folder needs due since stale unread agent
                    author parent references includeArchived pinned sort limit offset
missing from panel: []      extra in panel: []
```

Exact set equality with the live server. The panel also states the grammar the
server actually implements — `=` as the only operator, `&` for AND across fields,
`,` for OR within one — with worked examples (`type=thread&status=open`,
`needs=me&folder=finance`, `type=note,view&tag=finance`, `due=week&sort=due`).

Keyboard reach and layering: one `⇥` from the input focuses
`.col-query-help-toggle` (aria-label "Query syntax for Conversations"); opening
the panel does not commit the edit (`.col-query-input` still present);
`esc` inside the panel closes the **panel only** and returns focus to the `?`
button with the field still open. Page horizontal overflow with the panel open:
**0 px**.

### Unknown-field notice (orchestrator-accepted scope)

```
typing "typ=todo" → [role="status"].col-query-notice :
  "Unknown field: typ — the server ignores what it does not recognise."
↵ still commits → PUT /docs/doc_wqjq4oib  {"query":{"typ":"todo"}}
```

Non-blocking, exactly as adjudicated.

### Existing error state, untouched

```
"sort=nonsense" → ↵ → PUT /docs/doc_wqjq4oib {"query":{"sort":"nonsense"}}
column body: "This list could not be loaded
              GET /api/docs failed (HTTP 400): request failed validation"
```

That is the column's pre-existing failed-request card, reached because the
editor passes the query through unchanged. Criterion 4 and 5 both hold: the
editor adds no validation to the commit path.

## Failures

None.

## Summary

5 of 5 criteria passed. The autocomplete draws from the live projection (a
plugin type in use, real folders, real tags, refs by title), the help panel's
field set is *exactly* the 19 parameters the running server publishes, and the
write path is byte-verbatim in both the healthy and the malformed case.
