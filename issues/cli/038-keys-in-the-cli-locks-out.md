# [CLI-038] `corpus doc read` hands you a key; the write verbs demand one

## Domain

cli

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049, SERVER-098

## Spec References

- SPEC.md **§7** "A key, not a lock", and its orchestrator-skill invariant
- SPEC.md **§15** M3 — the CLI verb families, with `lock` struck

## Summary

The agent-facing half. This is where SHARED-041 either works or repeats the
lock's failure — the whole rider rests on a write being **impossible** without a
key, not merely discouraged.

## Acceptance Criteria

- [x] `corpus doc read` (and every verb that prints a document) prints the key,
      and prints it somewhere an agent will actually carry — not buried.
      `corpus doc show` prints it **whole, on line 3**, under the identity line
      and above everything descriptive; `corpus doc edit` prints the fresh key on
      the line after its confirmation, so a chain of writes needs one read at the
      start rather than one between every pair
- [x] The same output says when a person has an edit session open. §7 makes this
      information the agent acts on politely; the wording should invite that
      without implying a refusal — the notice states that nothing is refused, and
      a test forbids the words _lock_, _release_ and _read-only_ in it
- [x] `corpus doc edit` takes `--key` and **refuses without it** when it is
      replacing a body. The refusal must say what to do — re-read, then retry —
      because an agent that cannot recover from the message will guess
- [x] A `409` renders as the two useful facts: what the document now says, and
      the fresh key. Not a stack trace, and not a raw payload dump — the document
      is rendered by the same function `corpus doc show` uses, so the refusal
      cannot drift from the read the agent already knows how to parse
- [x] Delta verbs are unchanged and take no key: `--add-tag`, `--folder`,
      archive, unarchive, status, `reviewed`, move. (`corpus doc patch` does not
      exist yet — CLI-035; the contract records the rule for whoever adds it)
- [x] The `lock` verb family is **deleted**: `corpus lock acquire|release|break|
      list|reap`, `apps/cli/src/commands/lock/`, and its registry entries. Also
      `.corpus/locks/` out of `corpus init`'s scaffold, and every surviving
      `423`/lock claim in the verb prose rebased on keys or on the edit session
- [x] `docs/cli.md` regenerates and the drift check passes
- [x] Exit codes: a stale key is its own code, distinguishable from a usage error
      and from a server failure. An agent branches on exit codes — **exit 9**,
      `changed: false`, distinct from 2 (malformed invocation), 5 (the server
      failed) and 7 (refused, and retrying is _not_ the answer)

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/read.ts`, `edit.ts`
- **Delete** `apps/cli/src/commands/lock/`
- The command registry, and `docs/cli.md`

### Notes

- `apps/cli/src/commands/doc/edit.ts` carries comments about the `423` lock
  conflict and about not retrying it. Those are now about `409` and the advice
  inverts: a `409` is exactly the case where retrying (after re-reading) is
  right. Rewrite them rather than leaving them describing a mechanism that is
  gone.

## Testing Strategy

Unit against the stub server: the key round-trips, a missing key refuses before
any request is sent, a `409` renders both facts, and the exit code is distinct.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`.

Drive the agent's actual loop: read, edit with the key, read again, edit with the
stale key, see the refusal, retry with the fresh one.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Run 2026-08-12 against the **built**
CLI (`apps/cli/dist/bin/corpus.js`) and a **real server** on port 8891, scratch
workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws-cli038`. Ports 8765
and 5173 untouched; server stopped and the port verified free at the end.

**The scaffold no longer makes a lock directory** — `ls -a .corpus/` after
`corpus init`: `attachments/ jobs/ queue/ config.json template-manifest.json`.

**1 — read hands you the key, and the key is what the file hashes to.**

```
$ corpus doc show doc_qcjhsnkj
Mortgage options
doc_qcjhsnkj · note · open
key 87c646cda0d0cb08b8a1d9a2b173a4f71b336e2c4830450ce4dce82554d31c28
data/docs/inbox/mortgage-options.md
created 2026-08-12T05:29:48Z · updated 2026-08-12T05:29:48Z
tags —

30-year fixed at 6.1%.
$ shasum -a 256 data/docs/inbox/mortgage-options.md
87c646cda0d0cb08b8a1d9a2b173a4f71b336e2c4830450ce4dce82554d31c28  …
```

**2 — a body write without a key is impossible, and the message is the recovery.**

```
$ corpus doc edit doc_qcjhsnkj --from agent <<'EOF'
30-year fixed at 6.4%.
EOF
corpus: replacing the body of doc_qcjhsnkj needs its `--key`.
  Read the document first — `corpus doc show doc_qcjhsnkj` prints its `key` — then send this
  edit again with `--key <key>`. … A write that names its own delta (--add-tag, --status,
  --folder, a view key) needs no key. Nothing was sent to the server.
exit=2
```

Nothing reached the server (the refusal is before the request).

**3 — with the key it lands, and answers with the next one.**

```
$ corpus doc edit doc_qcjhsnkj --key 87c646cd… --from agent <<'EOF' … EOF
edited doc_qcjhsnkj
key be66c14e26fb08ee5e6f6eb3a058b5fc5e14400f3dfaf3a70a652dde88c739b9
exit=0
```

**4 — the stale key, which is the case the whole rider exists for.**

```
$ corpus doc edit doc_qcjhsnkj --key 87c646cd… --from agent <<'EOF' … EOF
corpus: 409 stale_key: doc_qcjhsnkj changed after the read that handed you that key —
  nothing was written, and the text you tried to save is still yours to resend.
  Reconcile against the document below — it is what `corpus doc show doc_qcjhsnkj` would
  print right now — then run the same command again with `--key be66c14e…`. Retrying after
  a re-read is the expected path here, not a failure.

Mortgage options
doc_qcjhsnkj · note · open
key be66c14e26fb08ee5e6f6eb3a058b5fc5e14400f3dfaf3a70a652dde88c739b9
data/docs/finance/mortgage-options.md
created 2026-08-12T05:29:48Z · updated 2026-08-12T05:30:10Z
tags —

30-year fixed at 6.4%.
exit=9
```

Two facts, no payload dump, no stack: what it now says (rendered exactly as
`corpus doc show` renders it) and the fresh key, quoted beside the flag it goes in.

**5 — retry with the key from the refusal, no second read.** `edited doc_qcjhsnkj`,
exit 0, and the file on disk carries the merged text.

**6 — delta verbs take no key and none started asking for one.** `--add-tag`,
`--status resolved --reviewed`, `doc move --folder finance`, `doc archive`,
`doc unarchive` — all exit 0 with no key presented.

**7 — the editing signal, and that it is not a gate.** A `--from user` write opens
§4's edit session; the agent's next read says so:

```
someone is editing this — a person has an edit session open on doc_qcjhsnkj right now.
Nothing is refused for it and a write would land; the polite move is to leave the document
alone and come back, or park the work with `corpus queue defer <event-id> --blocked-on
doc_qcjhsnkj`, which returns to pending on its own when the session ends.
```

The agent's keyed write during that session then **landed** (exit 0) — advisory,
never a refusal.

**8 — `--json` refusal envelope**: `code=stale_key`, `changed=false`,
`details.key` the fresh key, `details.body` the current content un-truncated,
`details.userEditing` present.

**9 — a truncated key is a usage error (exit 2), not a stale one**, so an agent is
not sent re-reading a document that never moved.

**10 — an out-of-band edit invalidates a key for free.** `printf … >> the file`
outside the app, then a write presenting the key read before it: refused, exit 9,
with the file's new key.

**11 — the lock verb family is gone.** `corpus lock list` → `unknown command
"lock"`, exit 2; `docs/cli.md` contains no `corpus lock` and no `423`.

**Checks run**: `npm run build -w packages/contract`, `npm run build -w apps/cli`,
`npm run typecheck -w apps/cli` (clean), `npx vitest run apps/cli`
(**1365 passed / 85 files**, `VITEST_MAX_THREADS=4`), `npx eslint apps/cli/src`
(clean), `npx prettier --check` on the touched files and `docs/cli.md` (clean),
`npm run docs:cli -w apps/cli` regenerated and the drift test passes.
`npm run build` at the root fails in `apps/ui` — UI-107's concurrent work, not
this issue's; `apps/server` has no build script (it runs from source via tsx).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
