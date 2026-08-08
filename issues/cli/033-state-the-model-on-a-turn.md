# [CLI-033] Nothing can state a model, so every turn shows blank

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-043, SERVER-074 (both done — the field and the write path exist)
- Blocks: the SHARED-027 feature being visible at all
- Sibling of: AGENT-021 (which decides *what* to state)

## Spec References

- SPEC.md **§11** Thread view — "An agent turn says which model wrote it"
- SPEC.md **§7** — the deciding stage's weight governs

## Summary

**Found by SERVER-074, reported rather than papered over.** The contract carries
`model`, the server writes it into `turnModels` and projects it, and the UI shows
a chip for it. **Nothing sets it.** SERVER-074 checked every candidate source
before concluding this: the queue event carries no model, the job log has the
tier only as free prose in a dispatch line that §7 reaps with the event, and
`apps/cli/src/commands/thread/reply.ts` posts `{ body }` alone.

So the user's request — *"on each comment posted by the agent, I want to be able
to quickly identify which model worked on it"* — currently renders an empty space
on every turn. The mechanism is complete and **inert**.

The agent reaches the system only through the CLI (Architecture Decision 2), so
the CLI is where the value has to enter.

## Acceptance Criteria

- [x] `corpus thread reply` and `corpus thread create` can state the model that
      wrote the turn, and it reaches `turnModels` on disk
- [x] **Absent stays absent.** Omitting it must post no `model` at all, not an
      empty string — §11 requires a turn with no record to show nothing rather
      than a guess, and SERVER-074 refuses a blank so absence has one spelling
- [x] A **person's** turn cannot carry one. The server already refuses it with a
      `400`; the CLI should not make that reachable by accident, and its help
      should say so rather than leaving the refusal to be discovered
- [x] It is a **display string**, not a validated set — §7 keeps model names in
      the skill, and CONTRACT-043 kept the wire free of an enum for the same
      reason. A CLI that validated against a list would freeze what the rider
      took pains to keep editable
- [x] The help says what it is for — a fact about what ran, never a request for
      what should run. CONTRACT-039's weight is the other thing and they must
      not be conflated
- [x] `docs/cli.md` regenerated, never hand-edited

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/reply.ts`, `apps/cli/src/commands/thread/create.ts`,
  and whichever flag module they share.

### Notes

- Check `capture` too. SERVER-075 found three write doors when the issue named
  one, and SERVER-070 found a second door for forms; assuming this one has fewer
  would be the third time.
- **Do not have the CLI guess.** It cannot know which model is running it, and a
  plausible default is exactly what §11's "nothing rather than a guess" forbids.
  The value comes from the caller.

## Testing Strategy

Stated model reaches the request; omitted sends no field; a blank is refused; a
person's turn with a model is refused with a message that explains rather than
just failing. Plus the generated-docs drift check.

## E2E Verification Log

**Implemented by cli-dev on Opus 5 (1M context), 2026-08-08.**

### What was built

`--model <name>` on `corpus thread create` and `corpus thread reply`, declared
once as `MODEL_FLAG` in `apps/cli/src/input.ts` beside `bodyFlags` and `--from`,
and resolved by `resolveTurnModel(context)` in the same module. Absent ⇒ the key
is spread out of the request object entirely (`...(model === undefined ? {} :
{ model })`), so no `model` field is sent — not `null`, not `""`. Resolution
happens **before** the body is read, so a refusal never consumes a heredoc the
caller would have to type again.

### Write-door sweep (asked for explicitly; the answer is two)

Compared `packages/contract/src/routes/inventory.ts` against every `api.*` call
in `apps/cli/src` (`grep` for `/api/`):

| Route that can write a turn      | Carries `model` in the contract? | CLI door                         |
| -------------------------------- | -------------------------------- | -------------------------------- |
| `POST /api/threads`              | yes                              | `thread create` — **flag added** |
| `POST /api/threads/{id}/turns`   | yes                              | `thread reply` — **flag added**  |
| `POST /api/capture`              | **no** (`CaptureRequestSchema` has no `model`) | **no CLI verb at all** |
| `POST /api/threads/{id}/turns/{ts}/form` | **no** (`FormAnswerRequestSchema` has no `model`) | **no CLI verb at all** |

The multipart twins (`MultipartCreateThreadRequest`, `MultipartAppendTurnRequest`)
do carry `model`, but the CLI posts JSON only — it has no attachment path. So:
**exactly two doors, both closed.** `capture` was checked and is not a third: it
is UI-only and its schema never had the field.

### Commands run (real CLI from source via `tsx`, real server, port **8791** — never 8765 or 5173)

```
$ corpus init /tmp/corpus-cli033-e2e --port 8791
$ corpus server start
corpus 0.4.0 listening on http://127.0.0.1:8791 (pid 47868)
$ corpus doc create --type note --title "Mortgage assumptions" -m "We assume a 30-year fixed at 6.1%."
created doc_zaus2zb3 — data/docs/inbox/mortgage-assumptions.md

$ corpus thread create --parent doc_zaus2zb3 --from agent --model claude-opus-4-1 -m "I split this into two notes; the second needs a title."
created th_ucvpzvrs — on doc_zaus2zb3 (whole document)
$ corpus thread reply th_ucvpzvrs --from agent --model claude-sonnet-4-5 -m "Second note filed under finance/."
$ corpus thread reply th_ucvpzvrs --from agent -m "And a third, no model stated."
$ corpus thread reply th_ucvpzvrs -m "Thanks."
```

`data/threads/th_ucvpzvrs.md` on disk — two entries for four turns, the stated
ones only:

```yaml
turnModels:
  2026-08-08T16:21:33Z: claude-opus-4-1
  2026-08-08T16:21:47Z: claude-sonnet-4-5
```

Read back through the API (`corpus thread show --json`), which is what the board
renders:

```
[('agent', '…21:33Z', 'claude-opus-4-1'), ('agent', '…21:47Z', 'claude-sonnet-4-5'),
 ('agent', '…21:54Z', None),              ('user',  '…21:55Z', None)]
```

The agent turn that stated nothing and the person's turn are `null` — §11's
"nothing rather than a guess", and the absence has one spelling.

### Refusals (all exit 2, nothing sent — turn count stayed 4 across all four)

```
$ corpus thread reply th_ucvpzvrs --model claude-opus-4-1 -m "not sent"        # default actor is user
corpus: only an agent turn names the model that wrote it.
  A turn authored by `user` names no model (SPEC.md §11). Pass `--from agent` when the agent
  wrote this turn, or drop --model. Nothing was sent to the server.

$ corpus thread reply th_ucvpzvrs --from agent --model "" -m "not sent"
$ corpus thread reply th_ucvpzvrs --from agent --model "   " -m "not sent"
corpus: --model was given without a model name.
  Name the model that wrote the turn — `--model claude-opus-4-1` — or leave the flag out
  entirely: a turn with no model recorded shows nothing, which is what an unknown should
  show. A blank is not that, and nothing was sent to the server.

$ corpus thread create --parent doc_zaus2zb3 --model claude-opus-4-1 -m "not sent"   # same refusal
```

### Not a validated set

```
$ corpus thread reply th_ucvpzvrs --from agent --model "Some Model 9 (preview)" -m "…"
replied to th_ucvpzvrs — turn 2026-08-08T16:22:35Z
#   turnModels:  2026-08-08T16:22:35Z: Some Model 9 (preview)
```

A name this CLI has never heard of, with spaces and parentheses, recorded
verbatim: nothing here validates against a list (§7 keeps the names in the
skill; CONTRACT-043 kept the enum off the wire).

Server stopped (`corpus server stop` → `stopped (pid 47868)`); port 8791
confirmed free, pid gone.

### Checks

- `npx vitest run apps/cli` — **1329 passed, 0 failed** (first run failed only
  the `docs/cli.md` drift assertion, as designed; regenerated with
  `npm run docs:cli -w apps/cli` and re-ran green).
- `tsc --noEmit -p apps/cli` clean; `eslint` clean on the touched files;
  `prettier --check` clean on all seven touched files including `docs/cli.md`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-033]` prefix
