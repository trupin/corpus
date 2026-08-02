# Evaluation: UI-025

**Date**: 2026-08-02
**Sprint**: sprint-022
**Verdict**: PASS
**Evaluator model**: Opus 5 (1M context)

Real browser (headless Chromium via Playwright, 1600×1000) against the **real app**: the server on
`8808` serving the freshly built `apps/ui/dist`, over a 273-document workspace with a real semantic
index at `state current` (`local/all-MiniLM-L6-v2@384`, 587 chunks). No stubs, no fixtures.

### Design quality (subjective rubric)

| Dimension     | Score | Note                                                                                          |
| ------------- | ----- | ----------------------------------------------------------------------------------------------- |
| Design        | 4     | The pair reads as one idea: `REFERENCED BY` then `RELATED`, same measure, same mono-caps heading, relation right-aligned as a quiet caption |
| Originality   | 4     | The relation caption is a genuine design decision — it answers "why is this here" inline instead of a tooltip or an icon legend |
| Craft         | 4     | Consistent with the backlinks panel it sits beside; rank order preserved from the server; no layout shift when a row arrives over SSE |
| Functionality | 5     | Every row is a button, click-through is a real navigation push with a labelled Back target       |

Average 4.25, no dimension at 1 — passes the threshold.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                       |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/ui/025-related-documents-panel.md:46-168`                                                |
| Commands are specific and concrete      | PASS   | Live DOM extraction pasted as JSON beside the CLI's own answer; `getComputedStyle` measure quoted |
| Real E2E (not mocked)                   | PASS   | Real workspace on 8807 + Vite 5282, real semantic index, real second-process write for the SSE case |
| Scenarios cover acceptance criteria     | PASS   | All three ACs plus both hosts and the empty state                                                |
| Application restarted after changes     | PASS   | Ports confirmed free before and after                                                            |
| Actual model recorded (implemented on:) | PASS   | `Implemented on: opus` (ui-dev, 2026-08-01)                                                      |
| Reproduction logged before fix (bugs)   | N/A    | Feature                                                                                          |

The log flags the `searchCorpus`/`useCorpusSearch` naming as an orchestrator-directed deviation from
the sprint's "one `search` method" wording rather than letting it pass silently. Accepted as
directed, not drift.

## Criteria Results

| #   | Criterion                                                     | Result | Observed                                                                     |
| --- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| 1   | Ranked rows with relation labels; click pushes the nav stack, Back returns | PASS | 10 rows, ids/order/relations identical to the CLI; click on a `similar` row pushed and Back popped |
| 2   | Present in both hosts; absent (not empty-boxed) when no related docs | PASS | `.focus .related` count `1` in focus mode; a document with 0 related rendered **no** `.related` node at all |
| 3   | SSE invalidation refreshes it like backlinks                  | PASS   | Out-of-band `[[ref]]` write from a second process produced a new `LINKED` row in rank position with no reload and no interaction |

## Evidence

### AC 1 — the panel is the server's answer, not a second opinion

`corpus doc related doc_gt2cvtta` (CLI, at the moment of the browser read):

```
1 doc_7svpaawn both    | Potting compost mix
2 doc_seedtemplatenote similar | Note template
3 th_mso6oy65 similar  | Re: Greenhouse plan
4 doc_ievftcgl similar | Long section doc
5 doc_seedtemplatetodo similar | Todo template
6 doc_tubbza3k similar | Dawn misting for nursery beds
7 doc_skillcomment similar | Comment
8 th_3iwyjeyu similar  | Re: "THE DEEP ANCHOR PHRASE SITS HERE"
9 doc_bulk00202 similar | Bulk note 202
10 doc_calc3teb similar | Cold frame notes
```

The panel, extracted from the live DOM — same ten ids, same order, same relations:

```json
[{"id":"doc_7svpaawn","title":"Potting compost mix","rel":"BOTH"},
 {"id":"doc_seedtemplatenote","title":"Note template","rel":"SIMILAR"},
 {"id":"th_mso6oy65","title":"Re: Greenhouse plan","rel":"SIMILAR"},
 {"id":"doc_ievftcgl","title":"Long section doc","rel":"SIMILAR"},
 {"id":"doc_seedtemplatetodo","title":"Todo template","rel":"SIMILAR"},
 {"id":"doc_tubbza3k","title":"Dawn misting for nursery beds","rel":"SIMILAR"},
 {"id":"doc_skillcomment","title":"Comment","rel":"SIMILAR"},
 {"id":"th_3iwyjeyu","title":"Re: \"THE DEEP ANCHOR PHRASE SITS HERE\"","rel":"SIMILAR"},
 {"id":"doc_bulk00202","title":"Bulk note 202","rel":"SIMILAR"},
 {"id":"doc_calc3teb","title":"Cold frame notes","rel":"SIMILAR"}]
```

Both a `both` row and `similar` rows are present, and `doc_tubbza3k` is a document the reference
graph could never have reached (zero shared content words with the parent, cited by nothing).

Markup, for the record:

```html
<div class="related"><h3>Related</h3>
  <div class="related-doc">
    <button type="button" class="ref" data-related="doc_7svpaawn">Potting compost mix</button>
    <span class="relation" data-relation="both">both</span></div>
  …
```

**Navigation.** Clicked the `similar` row `doc_tubbza3k`:

```
STATE 0 (parent open):  back button "‹ Attention"        · doc_gt2cvtta · related rows 10
STATE 1 (after click):  back button "‹ Greenhouse plan"  · doc_tubbza3k · related rows 4
STATE 2 (after Back):   back button "‹ Attention"        · doc_gt2cvtta · related rows 10
```

A push onto the reader's own stack, with the previous document named on the Back control, and a pop
that restores it — identical to following a `[[ref]]`.

### AC 2 — both hosts, and absent rather than empty-boxed

Focus mode (`[data-expand]` → `.focus.open`): `.focus .related` count **1** — one mount, two hosts,
same rows and relations.

Empty state: a document whose `GET /api/docs/{id}/related` returned `[]` rendered

```json
{"docMainChildren":["fm-chips","doc-title","doc-editor"],"relatedNodes":0,"backlinksNodes":0}
```

— no `.related` element in the DOM at all, not an empty panel.

### AC 3 — SSE, honestly

Reader open on `doc_gt2cvtta` and untouched; a **second process** ran
`corpus doc edit doc_bulk00001 --file …` adding `[[doc_gt2cvtta]]`:

```
BEFORE panels: ["related"]
BEFORE rows:   [doc_7svpaawn BOTH, doc_seedtemplatenote SIMILAR, th_mso6oy65 SIMILAR, …]

out-of-band edit done (no browser action taken)

AFTER  panels: ["backlinks","related"]
AFTER  rows:   [doc_7svpaawn BOTH, doc_bulk00001 LINKED, doc_seedtemplatenote SIMILAR, …]
BACKLINKS:     REFERENCED BY / NOTE / Bulk note 1
```

Two panels refreshed off one server frame, with no reload and no interaction, and the new row
landed in **rank position 2** rather than being appended. The backlinks panel materialised beside
it, which is the arrangement the pair exists to show.

Zero page errors and zero uncaught exceptions across every browser run in this evaluation.

## Failures

None.

## Summary

3 of 3 criteria passed against the real app over a real 273-document semantic corpus. The panel is
provably the server's ranked answer rather than a client-side re-derivation, and the SSE case was
driven by a genuine out-of-band write from a second process.
