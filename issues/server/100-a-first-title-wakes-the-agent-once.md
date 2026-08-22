# [SERVER-100] A document with no `title:` wakes the agent on the save that adds one

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: SERVER-095 (introduced the condition this refines)

## Spec References

- SPEC.md **§4** "Edit acknowledgment" — a session is opened by a change to what
  the document **says**: its body, or the title it goes by

## Summary

Found by PR #42's third review pass, and filed rather than fixed because it is
arguably correct behaviour rather than a defect.

`projection/project-document.ts:171` derives a row's title from
`data["title"] ?? data["name"] ?? titleFromPath(...)`, so a document's
frontmatter can carry **no** `title` key at all while the reader still displays
one. When the reader autosaves, it sends the title it is displaying;
`sameValue(undefined, "…")` is false, so `title` lands in `fields` and opens an
edit session — waking the agent for a change nobody made.

Self-limiting: the save genuinely adds `title:` to the file, and every subsequent
save compares equal. So it fires **once** per such document, ever.

## The question to answer before changing anything

Is this wrong? §4 says a session opens on "the title it goes by". A document
whose title was derived from its filename and is now written into its frontmatter
has, arguably, had the title it goes by pinned down — which is a real editorial
event, and the one acknowledgment is honest.

The counter-argument: nothing a reader can see changed, and the person did not
type anything. §4's line is about what the document says, and it said the same
thing before and after.

**Decide this explicitly, in this file, before touching the comparison.** If the
answer is "it is correct", close the issue with the reasoning rather than
weakening a condition that is doing its job.

## The answer (server-dev, 2026-08-21)

**It is a defect.** §4 is not ambiguous once the phrase is read as written: a
session opens on a change to **"the title it goes by"**. The title this document
goes by is `quarterly-plan` before the save and `quarterly-plan` after it. Its
frontmatter gained a key, which §4 lists in the other column — retagging, filing,
archiving, resizing a column: changes to how the document is *held*.

The "pinned down" reading fails on who did it. §4's acknowledgment exists to ask
the agent to reflect on a change **a person made**, and nobody made this one: the
reader echoed back the name the server told it the document had. Reading the
autosave as an editorial act would mean the agent is woken by the act of *opening
a document*, which is exactly the class SERVER-095 removed.

**The comparison is what is wrong, not the condition.** `changedFields` asked
`sameValue(current["title"], patch.title)` — the raw frontmatter key — while
every reader answers `title ?? name ?? path`. This repository has already ruled
on that shape once, in this same function: PR #47's re-review made the `origin`
stamp ask `originOrNull(current["origin"])` rather than the raw value, because
*"a write whose comparison asks a different question from the one the reader
answers is a write that disagrees with what the caller was shown."* The title now
follows the same rule, and the condition at `editSession:` is untouched.

Two things fall out of fixing it at the comparison rather than at the session
trigger, and both are wanted: the save writes **nothing at all** (§4: "a save
re-sending a body or title identical to the stored one **changes nothing** and
opens nothing" — no bytes, no `updated` stamp, no commit), and a `SKILL.md` or
persona carrying Claude Code's `name:` no longer acquires a `title:` duplicating
it the first time somebody opens it.

## Acceptance Criteria

- [x] The question above is answered in writing, with the reasoning
- [x] It is a defect: a save that writes a title equal to the one the
      projection already derived opens no session — and writes nothing
- [x] The genuine rename case still opens one — the fix must not reach it
- [x] SERVER-095's acknowledgment cases still pass unchanged (`acknowledgment.test.ts`
      40 passed, 0 failed, the 38 that existed before untouched)

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/title.ts` **(new)** — `documentTitle(data, fallback)`,
  the one derivation of the name a document goes by
- `apps/server/src/core/index.ts` — export it
- `apps/server/src/docs/read.ts` — `wireFrontmatter` reads it instead of
  spelling `title ?? name ?? row.title` inline
- `apps/server/src/docs/update.ts` — `changedFields` takes the derived name and
  drops a `title` equal to it; the commit subject uses the same function
- `apps/server/src/docs/update.test.ts`, `apps/server/src/edit/acknowledgment.test.ts`

## Testing Strategy

A document created out of band with `name:` or no title, then a reader autosave.

## E2E Verification Log

Model: **Opus 5 (1M context)**, server-dev agent, 2026-08-21.

Real workspace throughout, on **port 8931** (`corpus init`, `corpus server
start`, run from source via tsx). Port 8765 untouched.

### Pre-fix reproduction (red)

A hand-written document with **no `title:`**, dropped into `data/docs/` and
picked up by the watcher:

```
$ cat > data/docs/quarterly-plan.md   # id: doc_notitle01, no title:, no name:
$ curl .../api/docs/doc_notitle01  →  frontmatter.title = "quarterly-plan"
```

The reader then autosaves what it read — the same body, and the title it is
displaying:

```
$ curl -X PUT -d '{"title":"quarterly-plan","body":"<byte-identical>","key":"4285…"}'
  → "userEditing": true          ← a session opened
$ curl -X POST .../api/docs/doc_notitle01/edit-session/flush
$ ls .corpus/queue/pending/
  evt_meruztnfy564.json
```

```json
{ "type": "doc.edited",
  "payload": { "docId": "doc_notitle01", "actor": "user", "endedBy": "close",
               "stats": { "commits": 1, "insertions": 9, "deletions": 0 } } }
```

The file on disk after that save:

```
 id: doc_notitle01
 created: 2026-08-21T10:00:00Z
-updated: 2026-08-21T10:00:00Z
+updated: 2026-08-22T02:12:59Z
+title: quarterly-plan
```

A second identical save answered `userEditing: false`, confirming the issue's
"fires once, ever".

### Post-fix (green), same server, restarted

| step (real HTTP against the real server) | observed |
| --- | --- |
| `doc_notitle02`, no `title:`, autosave echoing `"annual-review"` | `userEditing: **false**`, HEAD unchanged (`cf60d82`), file byte-identical, no `title:` written, queue empty |
| `.claude/agents/reviewer.md` (`name: reviewer`, no `title:`), autosave echoing `"reviewer"` | `userEditing: **false**`, HEAD unchanged, **no `title: reviewer` written beside the `name:`** |
| genuine rename of `doc_notitle02` to `"Annual review 2027"` | `userEditing: **true**`, commit `8e27cc0 doc edit: Annual review 2027 (doc_notitle02) by user`, and after the flush `evt_nudqgejxlhd6` — a `doc.edited` naming that commit |

### Falsification — the tests fail without the fix

`loaded.row.title` replaced by `null` at the one call site, i.e. the fix removed
while every test stays:

```
× writes nothing when the title was only ever derived from the filename
× writes nothing when the title was derived from Claude Code's `name:`
✓ still writes a genuine rename of a document that carried no title
✓ still writes a rename that only replaces a derived `name:`
× leaves a blank `title:` alone when the save re-sends the derived name
—— acknowledgment.test.ts ——
× does not wake the agent when a save pins down a title the file never carried
```

Three write-path cases and the acknowledgment case go red, the two rename
controls stay green — so the controls are not propping up the fix.

### Checks

- `apps/server/src/docs` + `edit` + `core`: **1307 passed**, 0 failed.
- Whole `apps/server` suite afterwards: **4338 passed**, 0 failed, 973 suites.
- `tsc --noEmit -p apps/server`: clean. `eslint --max-warnings 0` on the touched
  files: clean. `prettier --write`: clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
