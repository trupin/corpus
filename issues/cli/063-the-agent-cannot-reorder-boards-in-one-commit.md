# [CLI-063] The agent cannot reorder boards in one commit, and the UI now can

## Domain
cli

## Priority
P2

## Status
done

## Model
opus

## Dependencies
- Depends on: CONTRACT-080 (the route), CLI-060 (the board verbs)

## Spec References
- SPEC.md §2 — the CLI is the agent's whole surface
- SPEC.md §9.2 — `POST /api/boards/order`
- SPEC.md §10 — rider 2: "reordering boards writes `order` on every board, in one commit"

## Summary

Raised by PR #58's second review.

Rider 2's "in one commit" was unmet in the UI, and CONTRACT-080 fixed it with
`POST /api/boards/order`. **The agent has no verb for that route.** Its only
lever is `corpus doc edit <id> --order N`, one document at a time — the exact
shape the review condemned in `moveBoard`.

The board-order agent argued this is not a gap, on the ground that §4's commit
window belongs to a *party*, so the agent's several writes already fold into one
commit. That is true and it is the reason this is P2 rather than P1. But it
makes the agent's compliance an accident of the window's timing rather than a
property of the act, and the window can close between two writes.

`assets/workspace/data/docs/boards/attention.md` currently tells the agent to
reorder by changing `order` on each board document, which is correct today and
would need one line changed if a verb arrives.

## Decisions taken

### 1. A `board` topic with exactly one verb, and a rule for what may join it

`corpus board order <id> <id> …`, as the issue names it. A board **is** a
document (§10), so it is created, retitled, archived and deleted through
`corpus doc`, and its `columns`, `kanban` and `stage` are frontmatter
`corpus doc edit` writes. A `corpus board create` beside
`corpus doc create --type board` would be two ways to make one thing — the drift
the one-registry rule (§2.3) exists to prevent.

What belongs in the topic is the act whose subject is the **set**. The rule is
written into the topic's own doc comment so the next proposal answers it: if the
act is about one board, it is a `corpus doc` verb; if it is about the bar, it is
this topic. `apps/cli/src/commands/board/` was added to both pinned inventories
in `hygiene.test.ts`, and `board` joined `WRITE_RESTRICTED_TOPICS` — it is a pure
API client and may touch no file.

### 2. The CLI validates nothing the route already refuses

A repeated id, an id naming no document, and an id naming a non-board are all
refused by `POST /api/boards/order` in its own words. Restating any of them here
would be a second copy of a rule the server owns, and the copy is the one that
goes stale. All three are shown, not swallowed — including the `400`'s validation
issues.

### 3. The summary never claims a commit it has no sha for

`ordered 3 boards — 2 boards moved, in one commit <sha>`. "In one commit" is the
promise rider 2 makes, so the line prints the sha a caller can `git show` rather
than the word. The three ways a commit can be absent are distinguished: nothing
moved so there was nothing to write, or something was written and git did not
take it — and the second arrives with the server's own `commit_skipped` /
`commit_failed` warning appended.

The rows report **the position each board now carries and whether this act wrote
it**, which is the server's answer rather than a prediction. A caller reporting
"how many boards moved" counts the `moved` rows, never the ids it sent.

### 4. Where the one-commit claim is proved, and where it is not

The Testing Strategy asked for "a real-workspace test counting commits". That
test cannot live in `apps/cli`'s suite: the auto-commit is the **server's** act,
`apps/cli` may not depend on `apps/server` (CLAUDE.md dependency direction, and
`lifecycle.test.ts` states the same constraint), and a stub that reports one sha
proves only that the stub was written to. So the unit tests assert what the CLI
itself decides — the body, the order, the rows, the summary — and the **one
commit is proved against real `git log` output in the E2E log below**, which is
the form the criterion asked for.

## Acceptance Criteria
- [x] `corpus board order <id> <id> …` calls `POST /api/boards/order` and prints
      what the act says it wrote
- [ ] The seed board's guidance names the verb instead of the per-document edit —
      **not done here.** `assets/workspace/data/docs/boards/attention.md` is the
      agent-runtime domain, outside `apps/cli`. Escalated to the orchestrator as
      a one-line follow-up for agent-runtime-dev.
- [x] A test asserts one commit, against real git history rather than against the
      number of requests — in the E2E log, for the reason in decision 4
- [x] The refusals the route already declares are shown, not swallowed

## Testing Strategy
Vitest for the verb, and a real-workspace check counting commits — see decision 4
for why the commit count is proved in the E2E log rather than in the unit suite.

## E2E Verification Plan
### Verification Steps
1. Reorder three boards through the verb in a real workspace.
2. `git log` shows one commit naming three files.

## E2E Verification Log

**Model: Opus 5 (1M context) — `claude-opus-5[1m]`.** Date 2026-08-23.

Packaged bundle (`npm run package:build`) against a real daemonized server on
port **8931** in a scratch workspace with a real git repository — the user's
server on 8765 was never touched. The three seed boards.

### Before the fix

The verb did not exist; the agent's only lever was `corpus doc edit <id> --order N`
per board.

### The verb, and the git history it produced

```
$ corpus doc list --type board --sort order --json | …
doc_seedboardattention 1
doc_seedboardbystatus 2
doc_seedboardfiles 3

$ corpus board order doc_seedboardfiles doc_seedboardbystatus doc_seedboardattention --from agent
doc_seedboardfiles      1  moved
doc_seedboardbystatus   2  unchanged
doc_seedboardattention  3  moved
ordered 3 boards — 2 boards moved, in one commit 0321ea5d959eba600aa19758340899581a150236
exit=0

$ git log --oneline 596368d..HEAD
0321ea5 board reorder: 2 boards by agent

$ git show --stat 0321ea5…
 author: agent <agent@corpus.local>
 subject: board reorder: 2 boards by agent
 data/docs/boards/attention.md | 2 +-
 data/docs/boards/files.md     | 2 +-
 2 files changed, 2 insertions(+), 2 deletions(-)
```

**One commit.** Two files rather than the three the plan predicted, and that is
the route working as documented: the middle board was already at position 2, so
it was not written — a write that changes nothing still stamps `updated` and
lands a line in the log the agent reads.

A reorder where every board moves does name three files in the one commit:

```
$ corpus board order doc_seedboardfiles doc_seedboardattention doc_seedboardbystatus --from agent --json
{"boards":[{"id":"doc_seedboardfiles","order":1,"changed":true},{"id":"doc_seedboardattention","order":2,"changed":true},{"id":"doc_seedboardbystatus","order":3,"changed":true}],"commit":"c6fbf84b240d4ce5cbc59f06b69c8482fa0cfbd0","warnings":[]}

$ git show --stat c6fbf84…
 author agent  |  board reorder: 3 boards by agent
 data/docs/boards/attention.md | 2 +-
 data/docs/boards/by-status.md | 2 +-
 data/docs/boards/files.md     | 2 +-
 3 files changed, 3 insertions(+), 3 deletions(-)
```

And a bar dragged back where it started writes nothing at all:

```
$ corpus board order doc_seedboardattention doc_seedboardbystatus doc_seedboardfiles --from agent
doc_seedboardattention  1  unchanged
doc_seedboardbystatus   2  unchanged
doc_seedboardfiles      3  unchanged
ordered 3 boards — none moved, so nothing was written
exit=0
# commits since: 0
```

### The old way, measured — and why P2 rather than P1 was right

The three-`PUT` loop was run in the same workspace:

```
$ corpus doc edit doc_seedboardattention --order 1 --from agent
$ corpus doc edit doc_seedboardbystatus  --order 2 --from agent
$ corpus doc edit doc_seedboardfiles     --order 3 --from agent
$ git log --oneline <before>..HEAD
fbc0f0a doc edit: Files (doc_seedboardfiles) by agent
```

**One commit** — §4's window folded the three writes, exactly as the board-order
agent argued. So the issue's P2 was correct and its diagnosis was too: the
history is compliant by accident of timing, and it is *mislabelled* —
`doc edit: Files (doc_seedboardfiles) by agent` names one document for an act
over three, so `git log` does not record that a reorder happened at all. The verb
lands `board reorder: 3 boards by agent`.

### The refusals, shown rather than swallowed

```
$ corpus board order doc_seedboardattention doc_seedattention --from agent
corpus: 400 bad_request: doc_seedattention is a `view` document, not a board: `order` is a board's position among boards and nothing else (SPEC.md §10), so only `type: board` documents can be reordered here.
  [ { "path": "boards[1]", "message": "doc_seedattention is not a board" } ]
exit=5

$ corpus board order doc_seedboardattention doc_nosuchboard --from agent
corpus: 404 not_found: no document with id doc_nosuchboard
exit=5

$ corpus board order doc_seedboardattention doc_seedboardattention --from agent
corpus: 400 bad_request: request failed validation
  [ { "path": "json.boards.1", "message": "`doc_seedboardattention` is named twice. A board has one position on the bar (SPEC.md §10), so a repeat cannot be resolved into an order — name each board once." } ]
exit=5

$ corpus board order --from agent
corpus: missing required argument <id…> for "order".
  Usage: order <id…> [flags]
exit=2
```

Nothing is printed for a refused reorder, which is what "all or nothing" has to
look like: no caller ever reads half an order.

### One thing found that is not this issue's to fix

```
$ corpus doc edit doc_seedattention --order 5 --from agent
edited doc_seedattention
exit=0
```

`doc_seedattention` is a `type: view`. Rider 2 says a view document has no
`order`, and `POST /api/boards/order` enforces that — but `PUT /api/docs/{id}`
accepts it. The narrow route refuses what the wide one allows, which is one more
argument for the verb, and a server-side gap for **server-dev**. Escalated to the
orchestrator, not touched here.

### Falsification — the verb broken three ways on purpose

| break | tests that failed |
|---|---|
| the summary claims one commit even with a null sha | "says nothing was written when the bar was already in that order"; "never claims a commit it has no sha for, and carries the warning that explains it" |
| the ids are sorted before they are sent, so the bar is not the caller's | "posts the ids as one list, in the order given, in one request" |
| `changed` is ignored, so every board reports as moved | "prints the position each board now carries, whether it moved, and the single commit" |

Restored, 13 passed. **No test in `order.test.ts` passes with the verb absent** —
the whole file imports `runBoardOrder`, `summaryLine` and `boardTopic`, none of
which existed before.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

### Checks

- `npx vitest run apps/cli` — 2,015 passed, 104 files. Scoped runs only,
  `VITEST_MAX_THREADS=4`.
- `eslint apps/cli/src apps/cli/scripts` — clean, no rule disabled anywhere.
- `prettier --check apps/cli/src docs/cli.md` — clean.
- `tsc --noEmit -p apps/cli/tsconfig.json` — clean.
- `docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`;
  `docs/generate.test.ts` green.
- Test server on 8931 stopped; port 8765 never touched.

## Completion Checklist (orchestrator)
- [ ] Committed with `[CLI-063]` prefix
