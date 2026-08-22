# [CONTRACT-047] An archive can rewrite a document it never named, and say nothing

## Domain

contract

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-078 (created the behaviour)
- Blocks: —
- Related: SPEC.md §4's "one action, one commit" reporting rule

## Spec References

- SPEC.md **§7** — location is a skill's enablement, so archiving moves the
  whole folder
- SPEC.md **§4** — the report and the commit are one story: `git log` never
  records an effect the user was told did not happen

## Summary

Raised by the implementing agent while fixing PR #38's review findings, and
deliberately not done there because it is a contract change.

Archiving a skill folder carries every file under it, including a nested skill
the request never named. SERVER-078 now writes into those carried files: the id,
so identity survives the move, and — when the destination is the **enabled**
root — `status: open`, reconciling a stale `archived` a previous independent
archive had written.

That reconciliation is correct (§7 makes location the enablement, so after the
move the file *is* enabled and `open` is the truth). **But it is visible only in
the commit and the server log.** The response says nothing. A person who archived
one skill has had another skill's frontmatter rewritten and is not told.

§4's reporting rule is about the inverse case — never recording an effect the
user was told did not happen. This is an effect the user was told **nothing**
about, which the same principle argues against for the same reason.

## Acceptance Criteria

- [x] A response that carried a reconciliation says so, naming the documents
      reconciled and what was changed about them
- [x] The mechanism is the existing `Warning` channel unless there is a reason it
      cannot be — a new top-level response field for this is a larger commitment
      than the fact warrants
- [x] **A carried document does not become `changed`.** PR #37 pinned, in prose
      and two tests, that a bulk result's three parts partition the **requested**
      ids; a reconciled document was never requested. This is a report *about*
      the act, not a fourth part of it
- [x] The single-document archive route reports it too, not only the bulk route —
      the behaviour lives in the single-document path
- [x] **The report covers the folder move itself, not only the frontmatter
      writes.** Raised by the pr-reviewer on PR #38, and it is the larger half:
      moving a skill folder *enables or disables a nested skill* under §7 — a
      consequence far bigger than a frontmatter key, and unreported since long
      before the writes existed. An issue closed having reported two bytes while
      the §7 enablement change beside them stays silent has fixed the smaller
      third of one problem
- [x] Silent when nothing was reconciled. A warning on every skill archive is
      noise, and noise is how a real one gets ignored

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/warning.ts` — **two** new `WarningCode`s (see
  the decision below), the third warning family in the module docblock, and a
  widened `warningsField` description.
- `packages/contract/src/routes/docs.ts` — the archive and unarchive
  descriptions, kept consistent with each other.
- `packages/contract/src/schemas/bulk.ts` — the result docblock and `changed`'s
  description: a carried document is reported in `warnings`, never as a fourth
  part.
- `packages/contract/src/schemas/warning.test.ts`,
  `packages/contract/src/openapi.test.ts` — pins.
- Regenerated `openapi.json` and `src/client/schema.generated.ts`.

### Notes

- Read `apps/server/src/docs/archive.ts`'s `ownedFields` first — it is the one
  place that decides what a carried write touches, so it is also the one place
  that knows what to report.
- The id stamp is arguably not worth reporting (it preserves identity rather than
  changing anything a reader would notice) while the `status` reconciliation is.
  Decide that deliberately rather than reporting both because both are writes.

## Testing Strategy

Archive a nested skill alone, then archive and unarchive the outer one: the
unarchive's response carries a warning naming the nested skill and its status
change. An archive that carries nothing carries no warning; one whose carried
files needed no reconciliation carries `carried_skill` alone.

> **Amended by the implementing agent.** The strategy above predates acceptance
> criterion 5 (the pr-reviewer's), which requires the **folder move itself** to
> be reported. A carry whose files needed no reconciliation is therefore not
> silent: the nested skill it enabled or disabled is the larger fact, and it is
> reported. Silence means the act carried **no other skill document at all**.

## What the contract now publishes (the shape SERVER-\* implements)

Two new `WarningCode`s on the shared `Warning` channel, so both the
single-document `POST /api/docs/{id}/archive` · `/unarchive` and the bulk act
report through the `warnings` array they already carry. No new response field,
and no new part of the bulk result.

| Code                     | Emitted                                                                                                    | Cardinality                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `carried_skill`          | Whenever a skill folder move carried an **indexed `SKILL.md` other than the requested one**; both directions | One per carried document                      |
| `carried_reconciliation` | Only where `ownedFields` actually rewrote a carried file's `status: archived` → `open` — **unarchive only** | One per carried document reconciled           |

Canonical `detail` (prose; the contract forbids parsing it, so nothing depends
on the exact bytes — but the server should populate these):

```
carried_skill (unarchive):
  doc_skillbb17e4 (.claude/skills/demo/helper/SKILL.md) was carried by this skill
  folder move and is now enabled; the request never named it (SPEC.md §7)

carried_skill (archive):
  doc_skillbb17e4 (.claude/skills-archived/demo/helper/SKILL.md) was carried by
  this skill folder move and is now disabled; the request never named it (SPEC.md §7)

carried_reconciliation:
  doc_skillbb17e4 (.claude/skills/demo/helper/SKILL.md) still said
  `status: archived` under the enabled skills root, so its status was reconciled
  to `open`
```

Where the server computes them, in `apps/server/src/docs/archive.ts`:

- **`carried_skill`** — from `planSetArchived`'s `movedDocuments`, minus
  `loaded.path`, resolved through `findDocumentRowByPath`; i.e. the same set
  `carriedDocumentIds` computes, but taken from the plan (inside the lanes) so
  it reports what actually moved. It covers a carried document that was moved
  **but not stamped** (one that appeared after the lanes were chosen): the file
  moved, so its enablement changed, whether or not its bytes were rewritten. A
  moved file with no projection row is not named — there is no document to name,
  which is `planCarriedWrites`'s existing stance.
- **`carried_reconciliation`** — exactly where `ownedFields` puts
  `status: "open"` into the patch **and** `setFrontmatterFields` returned a
  changed document (a file already saying `open` writes nothing and warns
  nothing).
- Both reach the response through `runMutation`'s existing `warnings` argument,
  concatenated after `validateBeforeWrite`'s. `setArchived` currently passes
  `plan.text === null ? [] : validateBeforeWrite(...)`; the carried warnings do
  not depend on `plan.text`.

### Two decisions, made deliberately

1. **The `id` stamp is not reported; the `status` reconciliation is.** The stamp
   keeps an identity rather than changing one — afterwards the document is the
   same document with the same id, which is what a reader already assumed, and
   the write exists precisely to keep that true. It also fires on nearly every
   carry, which is how the reconciliation beside it would come to be ignored. It
   stays where a change with no consequence belongs: the commit and the log. The
   omission is pinned by a test, so restoring the symmetry ("both are writes")
   fails a test rather than a reader.
2. **Two codes, not one.** `detail` is prose the contract forbids parsing, so
   every distinction a client acts on has to live in `code`. A carry is §7
   working as specified and happens on every nested skill a folder move touches;
   a reconciliation is the server rewriting a file the caller never named, and is
   rare. One code for both would leave the console unable to tell the routine one
   from the one worth stopping at.

## SIGNED 2026-08-10 and applied — SPEC.md §11 bullet (the warnings channel reports effects on documents the request never named)

**Signed by the user on 2026-08-10 and applied verbatim** to §11, after "Every
server mutation validates before writing", carrying its own signed marker. The
user weighed it against splitting the channel later (a purpose-built field beside
`warnings`) and against declining the widening, and chose to sign as drafted —
noting that UI-106 already exists to stop the new codes rendering as errors,
which is the cost of one channel carrying two kinds of thing.

**Distinct from the other held drafts**: CONTRACT-048's §9.2 bulk-result draft
and CONTRACT-037's (now void) §9.2 draft are about the bulk act's shape; this one
is a **§11** bullet about what the warnings channel is for. (That last sentence
read "Nothing was edited in SPEC.md" while the draft was held; it was signed and
applied on 2026-08-10, and SPEC.md moves exactly one line for it.)

Rationale for needing a line at all: §11 introduces warnings as things that
"went wrong" and names two families. A carried effect is neither — the act was
correct and so was the effect — so publishing it on the same channel widens what
the channel means. §7 already requires the effect and §4 already requires the
honesty about it, so the bullet ratifies rather than authorises; it is held
because widening a §11 definition is the user's call.

Proposed addition to §11, as a new bullet after "Every server mutation validates
before writing":

> - **A response's warnings also carry effects on documents the request never
>   named.** A warning is not only a failure. An act that changes a document the
>   caller never mentioned says so there, because the alternative is a person
>   learning it from `git log`. Archiving or unarchiving a skill moves its whole
>   folder, which enables or disables any nested skill under it, and may correct
>   a stale `status` that skill's own frontmatter still carried (§7). Those
>   effects are correct; being correct is not the same as being reported, and §4
>   makes the report and the commit one story. Each such document is named,
>   along with what changed about it. It is never counted among the documents the
>   act changed — a result's parts answer for the ids the request named — and
>   nothing is said when the act touched nothing outside its request.

## E2E Verification Log

**Model: Opus 5 (1M context)** — `claude-opus-5[1m]`, as recommended.
Date: 2026-08-09. Branch `phase-28-serializer-sweep-stub-typing`, main working
tree, no git commands run.

This is not a bug, so there is no pre-fix reproduction; the missing report was
read directly out of `apps/server/src/docs/archive.ts` (`ownedFields` writes
`id` unconditionally and `status: "open"` when the destination is under
`SKILLS_ROOT`, and `setArchived` passes only `validateBeforeWrite`'s warnings to
`runMutation` — nothing about a carried document reaches the response).

**1. Build.** `npm run build` → exit 0 (contract → kit → apps → plugins → UI).

**2. Regeneration + idempotence** (never hand-edited):

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ shasum openapi.json src/client/schema.generated.ts   # then generate again, then shasum again
e0b19fe83b9c29d9ec4166353e07f6344e7cf6c4  openapi.json
13d2bd2a5d4d97f873c1925f20431f7de0a715a5  src/client/schema.generated.ts
$ diff sum1 sum2 → identical   # generation is a no-op when up to date
```

**3. Drift check fires, on both of its legs.**

- _Hand-edit leg._ Replaced `carried_reconciliation` with `carried_HANDEDIT`
  inside `packages/contract/openapi.json`; sha became
  `0d49fd0eba7807965ecd33df1612da0cd62338ad`.
  `node --import tsx scripts/check-generated-artifacts.ts` → exit 1,
  `✗ API contract is stale: packages/contract/openapi.json, …`, and the check's
  own regeneration restored the file to `e0b19fe8…` (hand edit gone).
- _Committed-tree leg._ The same check, run with the artifacts regenerated but
  uncommitted, also exits 1 and prints the diffstat against `HEAD`
  (`openapi.json | 42 ++++---`, `schema.generated.ts | 40 ++++---`). That is the
  expected state until the orchestrator commits both artifacts; it goes green
  with the commit.

**4. Typed client against the real route definitions mounted on a Hono app**
(scratch `packages/contract/c047-e2e.ts`, run with `tsx`, then deleted — no port
bound; the client's `fetch` is `app.fetch`, `baseUrl` is a dummy host):

```
admitted         : ["carried_skill","carried_reconciliation"]
archive warnings : [{"code":"carried_skill","detail":"doc_skillbb17e4 (.claude/skills/demo/helper/SKILL.md) was carried by this skill folder move and is now enabled; the request never named it (SPEC.md §7)"}]
unarchive codes  : ["carried_skill","carried_reconciliation"]
unarchive detail : doc_skillbb17e4 (.claude/skills/demo/helper/SKILL.md) still said `status: archived` under the enabled skills root, so its status was reconciled to `open`
status after     : open
```

Type-level, against the **generated** client (`tsc --noEmit` over the scratch
file with the contract's own compiler options):

```
good: exit 0   — `const admitted: ClientWarningCode[] = ["carried_skill", "carried_reconciliation"]`
bad : exit 2   — c047-e2e.ts(66,57): error TS2322: Type '"carried_bogus"' is not
                 assignable to type '"commit_failed" | "commit_skipped" |
                 "orphaned_anchor" | "unresolved_ref" | "carried_skill" |
                 "carried_reconciliation"'
```

So the union a client sees is exactly the six codes: both new members admitted,
anything else a compile error.

**5. Tests.** `VITEST_MAX_THREADS=4 vitest run packages/contract` → **59 files,
2330 tests, all passing**. Scoped run of the two files this issue touches:
`warning.test.ts` 15 tests, `openapi.test.ts` 379 tests, green.

**6. Lint and typecheck.** `eslint packages/contract` → exit 0.
`npm run typecheck -w packages/contract` → exit 0.

> _One transient failure worth recording, not caused by this change._ The first
> typecheck run failed in `src/client/index.test.ts` and `src/routes/index.test.ts`
> over a `provenanceProbe` property that exists nowhere on disk — a concurrent
> agent's in-flight edit to those two files (the branch's stub-typing work).
> Re-run immediately afterwards: exit 0. Nothing in this issue touches either
> file.

**7. Both directions checked before publishing the asymmetry.** The contract
claims `carried_reconciliation` "arises on unarchive only". Verified in
`archive.ts`: `ownedFields` gates on the destination path starting with
`SKILLS_ROOT` + `/`,
and `planFolderMove`'s `to` is `SKILLS_ARCHIVED_ROOT` for an archive, so the
archive direction can never reconcile — and `.claude/skills-archived/…` does not
false-match the `.claude/skills/` prefix (the next character is `-`, not `/`).
`openapi.test.ts` asserts the claim from both sides: the unarchive description
contains `carried_reconciliation` and the archive description **must not**.

**8. Consumers.** Grepped every workspace: no exhaustive `switch` over
`WarningCode` exists — `apps/ui` and `apps/cli` render `code: detail` generically
— so the two new members break no consumer's types. Flagged for the orchestrator:
several UI call sites notify warnings with `tone: "error"`; a carried effect is
not an error, so a small UI issue may be worth filing to render `carried_*` as
info. Out of this domain.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
