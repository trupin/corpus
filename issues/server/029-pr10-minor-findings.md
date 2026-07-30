# [SERVER-029] Server hardening batch: PR #10 MINOR findings

## Domain

server

## Status

done

## Priority

P2

## Model

opus — two scoped fixes with the reviewer's diagnosis written.

## Dependencies

- Depends on: SERVER-016, SERVER-026
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), findings 8/15

## Summary

- (8) `docs/needs.ts:77-100` — the SQL `needs=form` detector disagrees with
  `FORM_FENCE_PATTERN` in both directions (unterminated fence → stuck "awaiting your answer"
  that the form route 404s; trailing-space info string → answerable but never surfaced). This is
  the exact disagreement `threads/forms.ts:14-21` says to file. Coordinate with CONTRACT-014
  (the pattern itself also drifts from CommonMark).
- (15) `docs/update.ts:128-152` — `EXTRA_MAX_BYTES` is per-request only; repeated merge patches
  under different keys grow a file's `extra` past the 64 KiB bound the contract advertises.
  Enforce the bound on the merged result.

## Acceptance Criteria

- [x] Detector and renderer agree on "carries an unanswered form" for the divergent shapes.
- [x] A merge patch that would grow `extra` past the bound is rejected 4xx with the file
      unchanged; test covers accretion across multiple requests.

## Technical Design (as implemented)

**Finding 8 — one grammar, not two.** The disagreement's cause was having two definitions of
"carries a form": `FORM_FENCE_PATTERN` + `FormSchema` on the route, and a SQL substring search in
`docs/needs.ts`. SQLite can express neither the anchored regex nor the YAML parse, so the fix is
not a better translation but the removal of the translation:

- `apps/server/src/core/form.ts` (new) composes the contract's `extractFormSource` with a YAML
  parse and `FormSchema`, returning either the form or *why there is none* (`no-fence` /
  `not-yaml` / `not-a-form` — the three the answer route reports separately).
- `turns` gains a derived `has_form` column, filled by `project-document.ts` from `carriesForm`.
  `SCHEMA_VERSION` 3 → 4, so every existing projection is rebuilt on first open (verified below).
- `NEEDS_REASON_SQL.form` now reads `tu.has_form = 1`; `opensFormFence` is gone.
- `threads/forms.ts`'s `requireForm` reaches the same reader, so the route and the projection
  cannot hold different opinions about one turn. CONTRACT-014 may adjust the fence grammar later;
  when it does, both consumers follow it for free — nothing here restates it.

The column means "carries a form somebody can *answer*", not merely "has a fence": §11's reason
exists to say an action is waiting, and a fence the route 404s is an action nobody can take. That
closes the unparseable-YAML case, which is the same defect as the two the finding named.

**Finding 15 — the bound is on the document.** `assertExtraWithinBound` in `docs/update.ts`
measures `readExtraFrontmatter(nextParsed.data)` — what the file will actually hold — against
`EXTRA_MAX_BYTES`, before anything is written, and only when the patch names `extra` at all (the
autosave path carries none and pays nothing). **Only growth is refused**: a file can exceed the
bound only by being hand-edited, and refusing every write to it would also refuse the one patch
that could fix it.

## E2E Verification Log

**Implemented on: opus.** Real server from source (`corpus server start`), real workspaces under
`/tmp/corpus-s014-serverhard-*`, port 9155/9156, real HTTP via `fetch`/`curl`.

### Pre-fix reproduction (2026-07-28, port 9155)

Three threads seeded through the API, each with an agent turn carrying one shape, then
`GET /api/docs?needs=form` compared against `POST …/turns/{ts}/form`:

| shape | `needs=form` lists it | `POST …/form` |
| --- | --- | --- |
| unterminated fence | **true** | 404 `not_found` |
| trailing-space info string | **false** | **201** |
| unparseable YAML | **true** | 404 `not_found` |

Both directions of finding 8, exactly as the reviewer diagnosed, plus the YAML variant of the same
class. Accretion, same server:

```
PUT extra.a (20 KiB) -> 200 ; .b -> 200 ; .c -> 200 ; .d -> 200
extra keys: [ 'a', 'b', 'c', 'd' ] serialized bytes: 81949   (bound is 65536)
```

### Post-fix — existing workspace, schema upgrade in place (port 9155)

Restarted the *same* workspace, whose `cache.db` was still at `SCHEMA_VERSION` 3. The server
dropped and rebuilt it, and `needs=form` went from **4 stuck rows** to exactly **1** — the
`Trailing-space info string` thread, which is the one that is genuinely answerable and was
previously invisible. (The second trailing-space thread had already been answered during the
repro, so it is correctly absent.) `corpus db doctor` afterwards:
`projection is clean — 18 documents from 18 files (1ms)`.

### Post-fix — fresh workspace (port 9156)

Seven shapes seeded, each listed *and* answered:

```
shape                        needs=form  POST …/form   agree?
well-formed fence            true        201 created    YES
trailing-space info string   true        201 created    YES
unterminated fence           false       404 not_found  YES
unparseable YAML             false       404 not_found  YES
YAML that is not a form      false       404 not_found  YES
```formula fence             false       404 not_found  YES
no fence                     false       404 not_found  YES
all shapes agree: true
```

Accretion on the same server:

```
PUT extra.a (20 KiB) -> 200
PUT extra.b (20 KiB) -> 200
PUT extra.c (20 KiB) -> 200
PUT extra.d (20 KiB) -> 400 bad_request body.extra
   message: this patch would leave `extra` at 81949 bytes on disk; the bound is 65536 bytes
            per document. `extra` is a merge patch, so the bound is on the merged result,
            not on one request.
PUT extra.e (20 KiB) -> 400 bad_request body.extra
extra keys on disk: [ 'a', 'b', 'c' ] bytes: 61462  (bound 65536)
```

The file is unchanged by the refusals — `grep -c "^d: " data/docs/inbox/accretion.md` → 0 — and
`git log --oneline` shows one `doc edit: Accretion (doc_po47ki4k) by user` commit, not four.
`corpus db doctor`: `projection is clean — 16 documents from 16 files (1ms)`.

### Checks

- `npm run lint`, `npm run format:check`, `npm run typecheck` (all workspaces): clean.
- `vitest run apps/server`: **120 files, 2361 tests, all passing.**
- Negative check: with the old SQL detector restored, exactly the 5 divergent shapes in
  `forms.test.ts`'s agreement suite fail and nothing else does.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
