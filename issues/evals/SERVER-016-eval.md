# Evaluation: SERVER-016

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

Real `corpus init` workspace on **8955**, real daemon, `curl` as the interface (there is no CLI verb
for this route). Thread markdown, `git log` and `.corpus/queue/pending/` read directly off disk.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                     |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | The most complete log in the sprint: a reusable fixture recipe (TEST-94) plus per-criterion evidence.                     |
| Commands are specific and concrete      | PASS   | Full `curl` invocations with the URL-encoding gotcha called out; real ids, real ISO stamps, real event filenames.         |
| Real E2E (not mocked)                   | PASS   | Real server process, real git repo, real queue directory. Unit suite is declared separately and does not stand in for E2E. |
| Scenarios cover acceptance criteria     | PASS   | All eight ACs, plus the three sprint-008 deferrals folded in as TEST-79/82/91.                                            |
| Application restarted after changes     | PASS   | Route was 404 before; answers 201 on the running daemon now.                                                              |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                                   |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug — a missing write path; the pre-state (route in inventory, 404 on a running server) is recorded.                |

## Criteria Results

| #        | Criterion                                        | Result | Observed (re-derived independently)                                                                                                                                                                                    |
| -------- | ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-73  | Route exists and answers `201`                   | PASS   | `POST /api/threads/th_7eyrmy6i/turns/2026-07-28T04%3A38%3A50Z/form` → `201` with `{thread, turn, eventId, warnings}`.                                                                                                    |
| TEST-74  | Every declared status reachable, no undeclared    | PASS   | `201` valid · `400` bad option · `401` no token (`www-authenticate: Bearer`) · `404` unknown thread (`no document with id th_zzzzzzzz`) · `404` unknown `ts`. **No `403`, `409` or `423` observed on any probe.**       |
| TEST-75  | No lock guard added                              | PASS   | Agent lock acquired on the parent (`POST /api/locks/{doc}` → `201`); a user answered a form under it → `201`, event enqueued.                                                                                            |
| TEST-76  | Acting party comes from the header               | PASS   | Body carrying `author`/`actor`/`from: user` + header `x-corpus-author: agent` → `turn.author: "agent"`, commit `agent <agent@corpus.local> \| form: answer on th_xapqldmr by agent`. The header decides.                 |
| TEST-77  | Validated against the actual form                | PASS   | Option `4.0% teaser` → `400 {"path":"body.option","message":"`4.0% teaser` is not one of this form's options: `6.1% fixed`, `5.4% variable`."}` — the offered options are quoted. `6.1% fixed` accepted.                 |
| TEST-78  | Contract's fence grammar, not a third definition | PASS   | Exercised over real HTTP: ` ```formula ` → 404 "carries no form"; ` ```form-builder ` → 404; no fence → 404; unparseable YAML → 404 "is not valid YAML"; `options: []` → 404 "…>=1 items"; a **user** turn carrying a valid fence → 404 "is not an agent turn and carries no form". |
| TEST-79  | An answer appends a real turn                    | PASS   | On disk: `## user · 2026-07-28T04:39:19Z` (U+00B7) then `**Answered:** 6.1% fixed` + blank line + note. Committed as `user <user@corpus.local>`.                                                                        |
| TEST-80  | The answer turn is a turn like any other         | PASS   | `GET /api/threads/{id}` → 3 turns, the answer last; its `ts` (`04:39:19Z`) strictly greater than the form turn's (`04:38:50Z`).                                                                                          |
| TEST-81  | Commit subject follows the convention            | PASS   | `form: answer on th_7eyrmy6i by user` — a deliberate sibling of `comment: turn on <id> by <actor>`, identical on every answer observed (three answers, three identical shapes).                                          |
| TEST-82  | Exactly one `form.respond`, no `comment.created` | PASS   | Pending dir before: one `comment.created` (the fixture's). After: that plus exactly one `evt_qkv375gbg5c5` of type `form.respond`. Nothing else appeared.                                                                |
| TEST-83  | Payload matches the pinned shape                 | PASS   | `{"threadId":"th_7eyrmy6i","formTs":"2026-07-28T04:38:50Z","option":"6.1% fixed","note":"…"}` — `formTs` is the **carrying** turn, not the answer. No-note case: raw file reads `"note":null` and `'note' in payload === true`. **Not omitted.** |
| TEST-84  | `eventId` names the enqueued event               | PASS   | Response `eventId: "evt_qkv375gbg5c5"` equals the `id` inside the on-disk `evt_qkv375gbg5c5.json`.                                                                                                                       |
| TEST-85  | Resolved thread: turn stands, nothing enqueued   | PASS   | Thread resolved (`200`), then answered → `201`, `eventId: null`, turn `**Answered:** B` written and committed (`form: answer on th_4bwo234t by user`), pending count **unchanged** (5 → 5).                              |
| TEST-86  | §8 decision is the shipped predicate             | PASS   | Static check: `forms.ts` imports and calls `decideParticipation` at one site; the only occurrence of the string `if (status === "resolved")` is inside a doc comment **disclaiming** such a check.                        |
| TEST-87  | Non-engaged thread handled deliberately          | PASS   | Behaviour stated in the log and consistent: `eventId` and queue state agree.                                                                                                                                             |
| TEST-88  | Second answer handled deliberately               | PASS   | Documented as allowed; a second answer appends a second turn and a second event. Observed twice on `th_xapqldmr`.                                                                                                        |
| TEST-89  | §14 warnings ride the response                   | PASS   | Accepted on the log's evidence (`201` + non-empty `commit_failed` warning, `HEAD unchanged: True`, turn still on disk). Not independently re-run — a pre-commit hook was not installed in the eval workspace.            |
| TEST-90  | Read-your-write, no sleep                        | PASS   | `GET /api/threads/{id}` issued immediately after the `201` in the same script tick: 3 turns, the answer present.                                                                                                         |
| TEST-91  | Answered form leaves Attention                   | PASS   | Before: `?needs=form` → `[th_7eyrmy6i]`, `?needs=me` → `["unread-reply","form"]`. After: `[]` and `[]`. Discharged by construction (a user turn moves `last_author`) — `needs.ts` untouched, confirmed by commit stat.   |
| TEST-92  | SSE keys only, no content                        | PASS   | Corroborated by the sprint-wide `/events` capture: every frame `event: invalidate` with `keys` only; zero occurrences of any option, note or prompt text.                                                                |
| TEST-93  | Unit suite covers what HTTP cannot reach cheaply | PASS   | `apps/server/src/threads/forms.test.ts` exists (20.3K), colocated, on the shipped `createThreadWorkspace` fixture.                                                                                                       |
| TEST-94  | The `curl` recipe is written down                | PASS   | I reproduced UI-008's fixture **from the log alone** — doc → agent-requested thread → agent form turn → answer — with no rediscovery. The recipe works. This is the criterion's whole point and it holds.                |
| TEST-95  | Event survives the queue lifecycle               | PASS   | Accepted on the log's evidence (`pending → in-progress → processed` with `GET /api/queue/status` counts at each step).                                                                                                   |
| TEST-96  | No regression on the thread surface              | PASS   | `POST /turns`, `/resolve`, `/seen`, thread creation and the deletion cascade all exercised repeatedly during this eval with no anomaly. See FIND-1 for the count wording.                                                |

## Honesty Audit

Sampled the fixture recipe, TEST-74's status table, TEST-78's six refusals, TEST-82/83's payload,
TEST-85's resolved case and TEST-91's before/after. **All reproduced**, including the exact error
strings.

- **FIND-1 (inaccurate wording, not fabricated evidence).** The log states
  `npx vitest run apps/server — 2079 passed, 0 failed across **484 test files**` and
  `Whole repo: 3851 passed, 0 failed (**933 test files**)`. `apps/server/src` contains **111**
  `*.test.ts` files and the repo contains **218** (`238` including `*.test.tsx`). The magnitudes
  match vitest's *suite* (describe-block) count, and the sibling SERVER-025 log reports the same
  order of magnitude using the correct word ("479/479 suites"). This is a mislabelled unit, not an
  invented result — but sprint TEST-96 and TEST-133 ask for a *stated count*, and the stated count is
  wrong by 4×. Correct it in the issue file.

No contradiction was found between any claimed behaviour and the observed application.

## Summary

24 of 24 criteria passed. The form write path is correct, the contract's validator and parser are
genuinely called rather than reimplemented, §8 routes through the single shipped predicate, and the
handoff recipe for UI-008 is reproducible from the log alone. PASS.
