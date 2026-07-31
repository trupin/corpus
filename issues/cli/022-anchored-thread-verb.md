# [CLI-022] No CLI surface for anchored thread creation

## Domain
cli

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §6 (anchored threads), §7 (the agent interacts only through the CLI), §9.2 `POST /api/threads`

## Summary
Found during CLI-018 (2026-07-31): `POST /api/threads` supports three creation shapes
(anchored on a selection, whole-document, standalone), but the CLI reaches only the
standalone shape — an agent cannot open a comment thread ON a document, let alone on
a text-quote anchor, despite §7 binding it to the CLI for every interaction. Add the
missing shapes to the thread-creation surface (e.g. `corpus thread new --on <docId>
[--quote "<exact text>"]` — the server derives the selector from the quote the way
the create-thread endpoint already specifies). Exact verb/flag shape follows the
existing thread verb conventions; no contract change expected (the route accepts all
three shapes today — verify against the generated client first).

## Acceptance Criteria
- [x] Agent can create a whole-document thread and an anchored thread (quote → selector, anchor written into the parent's frontmatter) via documented verbs
- [x] Quote not found in the parent: the server's error surfaces per existing conventions (no client-side selector construction)
- [x] `docs/cli.md` regenerated; thread verb inventory tests updated

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/thread/` creation verb (+ tests); docs regen

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: anchored create from the CLI → anchor in parent frontmatter, thread file, highlight visible in the UI (once UI-027 lands).

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). 2026-07-31, branch `phase-6-dogfood`.

### Contract check first (no contract change needed)
`packages/contract/src/client/schema.generated.ts` → `CreateThreadRequest` publishes
`parent?: string | null`, `selector?: {exact, prefix?, suffix?} | null`, `title?`, `body`,
`requestsAgent?`. All three shapes of SPEC.md §6 are reachable from the generated client with
no contract edit; `TextQuoteSelectorRequestSchema` accepts a bare `{exact}`.

### Correction to the acceptance criterion's premise
**A quote the parent does not contain is not a server _error_.** `apps/server/src/threads/create.ts`
is explicit: "Resolution is not a write-time gate … §6 resolves anchors at projection/render time
and calls an unresolvable one _orphaned_, which is a normal state of a living corpus, not a
rejected request." What the server does surface is §14's **`orphaned_anchor` warning** on the
`201` (the parent's new frontmatter goes through `validateBeforeWrite`, whose
`anchorUnresolved` finding maps to that code). The verb surfaces it through the existing
`warningSuffix` convention — no client-side resolution, no client-side selector construction.
An **ambiguous** quote (present twice, no context) warns the same way, which is what
`--prefix`/`--suffix` are for.

### Real server, real workspace
Server started from source on port **8798**, workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-cli/cli-022-e2e`
(`corpus init … --port 8798` → `corpus server start` → `listening on http://127.0.0.1:8798 (pid 80737)`).
Parent doc: `corpus doc create --type note --title "Mortgage options" --folder finance` →
`doc_hhmlxicl`, body containing `The model we assume a 30-year fixed at 6.1% which may be stale.`
plus a second paragraph repeating `6.1%`.

**1 — anchored create (heredoc, `--from agent`)**
```
$ corpus thread create --parent doc_hhmlxicl --quote "assume a 30-year fixed at 6.1%" --from agent <<'EOF'
Is 6.1% still the right assumption?
EOF
created th_6ykldoee — anchored at anc_a4622c7f on doc_hhmlxicl
```
Anchor in the **parent's frontmatter** (`data/docs/finance/mortgage-options.md`):
```yaml
anchors:
  anc_a4622c7f:
    exact: assume a 30-year fixed at 6.1%
    prefix: ""
    suffix: ""
```
Thread file on disk (`data/threads/th_6ykldoee.md`): `parent: doc_hhmlxicl`, `anchor: anc_a4622c7f`,
one `## agent · 2026-07-31T08:35:40Z` turn.
Auto-commit: `acc06f1 agent <agent@corpus.local> comment: new thread on doc_hhmlxicl (th_6ykldoee) by agent`
— both files in one commit, `agent` as git author.

**2 — whole-document create** (`corpus thread create --parent doc_hhmlxicl -m "@agent can you review this whole note?"`)
→ `created th_5airoxsk — on doc_hhmlxicl (whole document) (queued evt_6ji3gy3jyxsb)`;
commit `7045f09 … comment: new thread on doc_hhmlxicl (th_5airoxsk) by user`. No anchor entry added.

**3 — standalone create** (`… -m "Where did the Q3 numbers end up?" --requests-agent false`)
→ `created th_x5p4hr6r — standalone`; commit `e16ea09 … comment: new standalone thread (th_x5p4hr6r) by user`;
nothing enqueued (note-only honoured).

**4 — quote not found in the parent**
```
$ corpus thread create --parent doc_hhmlxicl --quote "a sentence that is nowhere in the note" -m "does this anchor?"
created th_lnsvtqwy — anchored at anc_1c06cf1d on doc_hhmlxicl — warning: orphaned_anchor (anchor `anc_1c06cf1d` no longer resolves in the body; its thread is orphaned)   (exit 0)
```
`--json` on the same case: `anchorId: anc_45c82a3a | warnings: [{'code': 'orphaned_anchor', 'detail': 'anchor `anc_45c82a3a` no longer resolves in the body; its thread is orphaned'}]`.
A quote that **does** resolve returns `warnings: []`.

**5 — ambiguous quote and its disambiguation.** `--quote "6.1%"` (twice in the body, no context)
warned `orphaned_anchor`; the same quote with `--prefix "fixed at " --suffix " which"` resolved
(no new warning). `corpus doc check` over the whole workspace afterwards:
`checked 20 documents — 3 warnings, no errors`, the three being exactly the three deliberately
unresolvable quotes.

**6 — refusals, all before any request (exit 2)**: `--quote` without `--parent`
("--quote needs a document to anchor to."); `--prefix` without `--quote`; missing body
("no first turn to send."), which notably did **not** hang under the agent-harness socket on fd 0;
`--requests-agent yes`; a flag given without a value ("--parent was given without a value.").
Unknown parent → `404 not_found: no document with id doc_zzzzzzzz`, exit 5.
Parent held by the other party's edit lock → anchored create refused with
`423 locked: doc_hhmlxicl is being edited by user` (exit 5), while a whole-document create on the
same locked parent succeeded — anchoring writes the parent, commenting on it does not.

**7 — help/docs**: `corpus thread --help` lists `create` first; `docs/cli.md` regenerated with
`npm run docs:cli -w apps/cli` and passes `prettier --check`.

Server stopped (`stopped (pid 80737)`); port 8798 verified free.

### Checks
- `npm test -w apps/cli` — **68 files, 972 tests, all passing** (15 new in `thread/create.test.ts`).
- `npm run typecheck -w apps/cli` — clean. `eslint apps/cli` — clean. `prettier --check` — clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
