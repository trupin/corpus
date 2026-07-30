# Audit — sprint-017 wave 3 (cb7825d..2f4f5cc)

Produced 2026-07-30 by a fresh-context audit agent (opus); adjudicated by the
orchestrator the same day. Verdict context: the evaluator passed all four wave-3
verdicts (91/91) the same hour; the migration trigger (SERVER-032 6->7) was found
architecturally clean. Findings below are numbered as in the original report.
Orchestrator adjudication: FIX 1-4, 6-16 + associated TESTs fixed in the wave-3 fix
round (per-domain briefs reference these numbers); FIX 5 filed as SERVER-039;
SPEC 33-40 routed to the phase-PR spec rider + new issues; CLEAN 42 is the
orchestrator's own bookkeeping; remainder fixed in-round or ledgered.

## FIX
1. edit.ts:170 parseExtraValue: no finiteness check; --extra k=1e400 silently DELETES the key (JSON null under RFC 7386). Gate Number.isFinite, fall through to string (parse-args.ts:197 pattern).
2. plugins/todos/server/routes.ts:236 everyList inherits DEFAULT_PAGE_LIMIT=50; workspace #51+ breaks column/rows/CLI list. Page like everyTodoDoc.
3. routes.ts:215-219 migrate catches only TodoItemError; any 423/404/git failure aborts the whole run, names nothing migrated, never broadcasts. Catch per document, record conflicts, broadcast successes.
4. routes.ts:212 migrate count uses parseBodyItems(plan.body).length — counts pre-existing body items as migrated. Count legacy.items.length.
5. docs/update.ts (guard absent): archived-status refusal is CLI-only; UI FrontmatterForm + raw PUT reach the half-state. -> SERVER-039 (write-boundary enforcement).
6. items.ts:328/manifest.ts:46 itemProblems silent on dual storage while planWrite refuses every write to it. Report dual storage as a validation problem.
7. items.ts:180-233 unclosed fence swallows the rest of the document (editor shows checkboxes, panel says 0). Bound an unterminated fence.
8. items.ts:105 4-space-indented line inside an indented code block parses as an item. Track indented code or cap indent <4.
9. cli list --open renumbers filtered items; check resolves against the unfiltered list — off-by-selector. Render original indices.
10. core/form.ts:167-184 a turn that both answers and carries a form gets form_answered=NULL — accepts answers but never advertises. Decide + test (mark answered:false or document the divergence with a test).
11. doc/unarchive.ts:30 POST issued even when already-not-archived — silently reopens a resolved doc. Skip when !wasArchived.
12. needs.ts:100-104 EXISTS lost the indexed seek; full turn scan inside needs=me. Partial index + perf case.
13. template/install.ts:329 existsSync true for a directory -> EISDIR unwinds all of init. statSync().isFile().
14. items.ts:414-426 writer always \n; CRLF docs become mixed-convention on first append. Match dominant ending.
15. edit.ts:134-141 assertNotArchived message only true for skills; archived note/view refusal wrong or two-commit. Narrow to type skill or make honest.
16. projection/db.ts:263-279 openProjectionReadonly (doctor) skips the schema stamp check; a v6 cache.db reports clean. Stamp-check + rebuild guidance.

## TEST
17. project-document.test.ts: no form_answered column-value coverage (multi-form incl. NULL cases).
18. db.test.ts:173: no real v6->v7 fixture (old DDL) rebuild test.
19. query.test.ts: malformed forms x form_answered combinations missing.
20. project-document.ts:313-337: duplicate-ts turn drops the form_answered=0 row (INSERT OR IGNORE) — add case.
21. edit.test.ts: CLI-016 x CLI-017 interaction untested (archived+--extra; flag precedence; smuggling).
22. edit.test.ts: archived-guard fixtures are notes only; the motivating skill case uncovered.
23. routes.test.ts: migrate past a non-TodoItemError failure unexercised (onWrite hook exists); empty-corpus migrate missing.
24. routes.test.ts: fake listDocs ignores includeArchived; no fixture exceeds a page — neither everyTodoDoc reason asserted.
25. edit.test.ts: --extra edges (non-finite, >MAX_SAFE_INTEGER precision loss, empty value, weird keys).
26. unarchive.test.ts: no 423 case; no archived-between-GET-and-POST case.
27. items.test.ts: migration with empty legacy key + body items; legacy text containing newline bypasses checked()'s refusal via newLine.
28. items.test.ts: unclosed fence + indented code block cases (FIX 7/8).
29. verbs.test.ts: --open fixture must have first item done (FIX 9 invisible today).
30. queries.test.ts: PLUGINS-007 AC3 pinned only by key-shape proxy; mount useTodoLists and assert refetch.
31. upgrade.ts:236 --dry-run predicts a repair a real run refuses (queueSkeletonIgnored hard-coded []). Test with an old .gitignore.
32. install.test.ts: seedTemplate-is-directory case; same-plugin two-type collision blames itself.

## SPEC
33. SPEC 12 doesn't name corpus todos migrate (data-transforming verb outside the spec) — phase-PR spec rider.
34. No UI unarchive affordance while the broken transition is UI-reachable — file UI issue with SERVER-039.
35. comment/SKILL.md:345 "unarchive <id>" not executable verbatim: the 409 carries the NAME, not the id. Put the id in the 409 or add the lookup hop.
36. comment/orchestrate SKILL.md "reversible" clauses still name no verb.
37. SPEC 11's "pin me a view" promise: pinned/order/query/column unreachable via CLI (--extra refuses core keys). Follow-up CLI issue.
38. --extra scalars only; publish plugin needs objects. Decide escape hatch or drop "total".
39. TodoDocPanel lacks the overdue treatment SPEC 403 says applies "wherever items are shown".
40. plugins/todos/README + docs/PLUGINS.md still document the deleted View.

## CLEAN
41. core/form.ts carriesForm dead in production, docstring false. Delete or correct.
42. Wave-3 statuses unflipped; PLAN duplicate rows across phase tables (CLI-012, SERVER-032, UI-015, SERVER-030) with differing deps. Orchestrator.
43. queries.ts:54 todoListKey dead; the ["lists",docId] broadcast half matches nothing. Remove or consume.
44. install.ts:345-352 same-plugin collision message blames itself. Special-case holder===dir.
45. routes.ts:168 unbounded pagination loop. Bound by page.total.
46. cli/client.ts:73 2xx non-JSON -> raw ZodError. Translate.
47. migrate: no --dry-run/progress; route already computes the numbers. Add --dry-run.
48. items.ts nested task lists silently flattened — document.
49. unarchive.ts duplicates archive.ts; extract runArchiveToggle (also homes FIX 11/26).
50. project-document.ts:335 nested ternary simplify.
51. form.ts attribution choice (order-based vs formTs) undocumented — note it. (Evaluator's shared-option refutation: attribute by addressed turn's :ts as P3.)
52. scaffold.ts:275 stale "five status directories" comment.
53. scripts/coverage-gate.test.ts:90 names deleted TodoView (only surviving reference).
54. edit.ts stdin drained before flag parsing; undocumented status race.
55. init/index.ts hand-rolled plural.
56. docs/cli.md "grammar is total" falsified by FIX 1 (regen after fix).
