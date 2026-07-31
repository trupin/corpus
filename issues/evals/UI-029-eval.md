# Evaluation: UI-029

**Date**: 2026-07-31
**Sprint**: sprint-020 (TEST-733–748)
**Evaluator model**: Opus 5 (1M context) — `claude-opus-5[1m]`
**Verdict**: PASS

Rig: my own, independent of the implementer's. Workspace `…/tmp/eval-p7b/ws` (`corpus init --port
8807`), server on `8807`, real Chromium via Playwright driving the **production build** the server
serves statically (`npm run build` output, React 19.2.8 in the bundle). `8765` never bound, never
killed, never proxied. All manifest churn restored byte-identically (shasums below).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                        |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/ui/029-react-19-upgrade.md:48-431`, ~380 lines, per-test structure TEST-733–748       |
| Commands are specific and concrete      | PASS   | `npm ls react react-dom`, `npm audit --json`, per-site `RefObject` table, named e2e spec list |
| Real E2E (not mocked)                   | PASS   | Real `corpus init` workspace, real server, real Playwright run; not a test client              |
| Scenarios cover acceptance criteria     | PASS   | Every TEST-733–748 addressed; the eight `RefObject` sites enumerated individually              |
| Application restarted after changes     | PASS   | Server booted on `8804` post-install; hand-walk transcript with console output pasted          |
| Actual model recorded (implemented on:) | PASS   | `**implemented on: opus** (2026-07-31)` at `:50`                                               |
| Reproduction logged before fix (bugs)   | N/A    | Upgrade, not a bug                                                                             |

## Criteria Results — verified independently, not read from the log

| #   | Criterion                                        | Result | Observed                                                                                                                                                                             |
| --- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Four manifests on the 19 line, root untouched    | PASS   | `apps/ui`: `react ^19.2.8`, `react-dom ^19.2.8`, `@types/react ^19.2.18`, `@types/react-dom ^19.2.4`. Root `package.json` declares no React (shasum unchanged across my whole session) |
| 2   | TEST-735 — resolved React ≥ 19.2.7               | PASS   | `npm ls react` → `react@19.2.8` at every consumer                                                                                                                                     |
| 3   | TEST-736 — one hoisted copy, no nested React     | PASS   | `npm ls react` shows one real copy, everything else `deduped`. `find node_modules -path "*/node_modules/react"` at depth 3–4 → **zero hits**                                          |
| 4   | TEST-737 — zero unmet peers, no escape hatch     | PASS   | `npm ls` grepped for `UNMET\|invalid\|extraneous` → **no output**                                                                                                                     |
| 5   | TEST-738 — types moved together                  | PASS   | Both `@types/react@^19.2.18` and `@types/react-dom@^19.2.4`; no peer complaint in `npm ls`                                                                                            |
| 6   | TEST-745 — no ref / element.ref warnings         | PASS   | See console evidence below: **zero** console messages of any kind across five browser sessions                                                                                        |
| 7   | TEST-747 — the real app still works, hand-walked | PASS   | Full transcript below                                                                                                                                                                |
| 8   | TEST-748 — the audit did not get worse           | PASS   | `metadata.vulnerabilities` = `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` — better than the contract's expectation of `total:2` (UI-016 cleared them)             |

### The real-app walk (production bundle, React 19.2.8)

Seeded by CLI: three notes, three threads (two anchored to quoted spans, one whole-document).

```
=== 1. BOARD ===
columns: [ 'doc_seedattention', 'doc_seedinbox', 'doc_seedopenthreads' ]
activeCol: 'doc_seedattention'

=== 2. READER ===
reader head: ‹ Inbox  doc_escch2xh · git ✓  💬 3  ⋯  ⤢  note inbox/ open  updated 2026-07-31  edit …
anchor highlights: [
  { tag:'SPAN', cls:'anchor-hl', anchor:'anc_eed336b0', text:'three anomalies in the northern ledger' },
  { tag:'SPAN', cls:'anchor-hl', anchor:'anc_6c1b236a', text:'treasury team has not yet signed off' } ]

=== 3. HIGHLIGHT CLICK === focus moves into the TipTap body (ProseMirror-focused)

=== 4. THREAD + REPLY COMPOSER ===
composer: INPUT placeholder "Reply — @ route · / skill · [[ link · paste or drop files"
buttons: 📎 clip · ◉ ask agent (toggle on) · Reply ↵ (send)
typed a reply, pressed send → turn appended:
  'userJul 31, 12:44 PM💬✕Evaluator reply from the real browser — UI-029/…'

=== 5. FOCUS MODE (⤢) ===
after ⤢: focus overlay `.focus open` — "✕ Close  esc closes · click anywhere to edit  doc_escch2xh …"
after esc: focus:0, reader still open, focus restored to BUTTON.expand

=== 6. SEARCH OVERLAY (⌘K) ===
role="dialog" .search-panel — "save as view  type: any  status: any  folder: any  tag: any  due: any …"
activeElement INPUT; esc closes

=== 7. CONSOLE DRAWER ===
DIV.console / DIV.console-strip — "▴ console  agent: idle · queue 0  0 running · 0 done · 0 failed"

=== 8. CATCH-ALL ROUTE ===
/nope/not/a/route?x=1 → board renders, 3 columns; /a/b/c likewise; history back/forward both fine
```

**Live editing + anchor reconciliation under React 19** was proved by accident and is worth
recording: a stray keystroke into the reader body mutated the text to "in fthe northern ledger", the
server committed `doc edit: Rates memo (doc_escch2xh) by user`, and the anchor **remapped itself**
(`chars 32–70` → `chars 32–71`, quote updated). Restoring the body remapped it back. React 19 has
not disturbed the editor/anchor pipeline.

### TEST-744 / TEST-745 — console, counted rather than waved at

Console and `pageerror` were captured on **every** session (walk, walk2, ui030, ui030b, ui030c,
ui031, ui031b, routes). Every one printed:

```
=== CONSOLE MESSAGES ===
(none)
```

Zero errors, zero warnings, zero `not wrapped in act(...)`, zero `Accessing element.ref`, zero
`forwardRef render functions`.

### TEST-748 — the audit, measured in this tree

```
$ npm audit --json
keys: auditReportVersion,vulnerabilities,metadata
metadata.vulnerabilities: {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
vuln keys: []
$ npm audit ; echo $?
0
```

## Failures

None.

## Summary

8 of 8 independently-checked criteria pass. React 19.2.8 is hoisted once with no nested copies and
no unmet peers, the four manifests carry the floors C3 fixed and the root manifest is untouched, and
the running application — board, reader, anchor highlights, TipTap editing with live anchor
reconciliation, threads and the reply composer, focus mode, the console drawer, the ⌘K search
overlay, and the catch-all route — behaves as specified with a **completely silent browser console**
across eight sessions. Nothing changed except what was supposed to.
