# Evaluation: CLI-022

**Date**: 2026-07-31
**Sprint**: sprint-018
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059), CLI run from
source (`apps/cli/src/bin/corpus.ts` via tsx) with cwd inside the workspace. Port
8765 untouched.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                     |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Seven numbered sections plus a contract check.                                                              |
| Commands are specific and concrete      | PASS   | Verbatim invocations, thread/anchor ids, YAML excerpt, commit sha + author, exit codes.                     |
| Real E2E (not mocked)                   | PASS   | Real server on 8798, real workspace, real git; reproduced here independently on 8802.                       |
| Scenarios cover acceptance criteria     | PASS   | All three shapes, the quote-not-found case, refusals, lock interaction, help/docs.                          |
| Application restarted after changes     | PASS   | Server started fresh for the drill and stopped by recorded pid afterwards.                                  |
| Actual model recorded (implemented on:) | PASS   | "**Model: opus** (claude-opus-5, 1M context). 2026-07-31, branch `phase-6-dogfood`."                        |
| Reproduction logged before fix (bugs)   | N/A    | Missing-surface issue, not a defect. The pre-state is evidenced by the contract check naming what existed.  |

The log **corrects its own issue's premise** — the acceptance criterion said a
not-found quote should surface "the server's error", and the log explains that §6
makes an unresolvable anchor a normal state, so the server answers `201` plus a
`§14 orphaned_anchor` warning instead. I verified that reading against the running
server and it is correct; the criterion, not the implementation, was wrong.

## Criteria Results

| #   | Criterion                                                                                | Result | Notes                                                              |
| --- | ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| 1   | Whole-document and anchored threads creatable via documented verbs; anchor in frontmatter | PASS   | All three shapes; anchor written, thread file written, one commit. |
| 2   | Quote not found surfaces per existing conventions, no client-side selector construction   | PASS   | `201` + `orphaned_anchor` warning, exit 0.                         |
| 3   | `docs/cli.md` regenerated                                                                | PASS   | `check-generated-artifacts.ts` → "CLI reference is up to date".    |
| 4   | Cross-issue: the CLI-created anchor's highlight is visible in the UI (UI-027)             | PASS   | See below.                                                         |

## Evidence

### The three shapes

```
$ corpus thread create --parent doc_jq7szwg6 --quote "lender spreads" \
    -m "Which lenders are we comparing here?" --from agent
created th_vv5qglbw — anchored at anc_57e56afb on doc_jq7szwg6            exit=0

$ corpus thread create --parent doc_hffvakmq -m "@agent can you review this whole note?"
created th_pwnvj4nk — on doc_hffvakmq (whole document) (queued evt_kzjknjjyzxiy)   exit=0

$ corpus thread create -m "Where did the Q3 numbers end up?" --requests-agent false
created th_dx7fprv3 — standalone                                          exit=0
```

### Anchor in the **parent's** frontmatter

`data/docs/inbox/rates-memo.md`:

```yaml
anchors:
  anc_57e56afb:
    exact: lender spreads
    prefix: ""
    suffix: ""
```

Thread file `data/threads/th_vv5qglbw.md`: `parent: doc_jq7szwg6`,
`anchor: anc_57e56afb`, one `## agent · 2026-07-31T09:36:36Z` turn.

### One commit, both files, correct author

```
$ git show --stat 9e63aed
9e63aed agent  comment: new thread on doc_jq7szwg6 (th_vv5qglbw) by agent
 data/docs/inbox/rates-memo.md |  6 +++++-
 data/threads/th_vv5qglbw.md   | 14 ++++++++++++++
 2 files changed, 19 insertions(+), 1 deletion(-)
```

`--from agent` reached the git author (`agent <agent@corpus.local>`); the
whole-document and standalone creates without it committed as `user`. The parent's
frontmatter and the new thread file land in **one** commit, so a highlight never
points at a conversation that was not written.

### Quote not found → 201 + warning, exit 0

```
$ corpus thread create --parent doc_hffvakmq \
    --quote "a sentence that is nowhere in the note" -m "does this anchor?"
created th_xsfxyffb — anchored at anc_d0e95228 on doc_hffvakmq
  — warning: orphaned_anchor (anchor `anc_d0e95228` no longer resolves in the body;
    its thread is orphaned)                                                exit=0
```

`--json` on an equivalent case carries the structured form:

```json
{"thread":{"id":"th_g7s4ebfd",…,"anchor":"anc_6162c495"},
 "anchorId":"anc_6162c495","eventId":null,
 "warnings":[{"code":"orphaned_anchor","detail":"anchor `anc_d0e95228` …"},
             {"code":"orphaned_anchor","detail":"anchor `anc_6162c495` …"}]}
```

The thread exists and is usable; the server confirms the state
(`GET /api/docs/doc_hffvakmq` → `range: null, orphaned: true` for both, and
`range:{10,40}, orphaned: false` for a quote that does resolve).

### Cross-issue check with UI-027 — the CLI-made anchor is visible

The anchored thread above was created **only** through the CLI, on the
no-trailing-newline document. In the browser, with no further action:

```
.reader .anchor-hl = 1   text "lender spreads"
                         data-thread=th_vv5qglbw  data-anchor=anc_57e56afb
                         background rgba(59,95,151,0.1), border-bottom 2px
.anchor-pip = 1   .anchor-slot = 1
```

The agent's CLI-only path (SPEC §7) produces a highlight a human sees.

## Failures

None.

## LEDGER-P6-2 — the warning list is document-scoped, not call-scoped

`warnings` on a create response carries **every** unresolved anchor on the parent,
not only the one this call made. After two deliberately-orphaned creates on the same
parent, the second call's `--json` returned two `orphaned_anchor` entries, and a
third returned the human line `— 2 warnings: orphaned_anchor, orphaned_anchor`.

This follows from §14 validation being run over the whole rewritten frontmatter, and
the human single-warning line does name the right anchor. But a caller reading the
plural line cannot tell which warning is about the anchor it just created. Worth a
sentence in the verb's help, or scoping the printed list to the new anchor id.
Not a criterion failure — recording it for the ledger.

## Summary

4 of 4 criteria passed. All three §6 creation shapes are reachable from the CLI, the
anchored shape writes the parent's frontmatter and the thread file in one correctly
authored commit, an unresolvable quote is a 201 with a warning rather than a
rejection, and the anchor the CLI wrote renders as a highlight in the UI.
