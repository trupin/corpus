# [CLI-026] `corpus doc diff <id> [--from <rev> --to <rev>]`

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028, SERVER-052
- Blocks: AGENT-011

## Spec References
- SHARED-008 rider

## Summary
Thin verb over the diff route: prints the bounded unified diff for a
document's revision range; defaults to the range named by the most recent
`doc.edited` event when invoked without --from/--to is NOT in scope (the
event carries the range; the skill passes it explicitly — keep the verb
stateless). Prints the truncated notice when the server flags it. Output is
agent-facing: stable, pipe-friendly, no decoration beyond the existing verb
conventions.

## Acceptance Criteria
- [x] Prints the diff for an explicit range; exit 0
- [x] Truncation surfaced as a clear trailing notice
- [x] Errors (bad rev, unknown doc) per existing verb error conventions
- [x] Registered in docs/cli.md generation

## Technical Design
### Files to Create/Modify
- apps/cli/src/commands/doc/diff.ts + registration + tests

## Testing Strategy
Colocated verb tests per house patterns.

## E2E Verification Plan
Real workspace: edit a doc, fetch the event's range, diff it through the verb.

## Design Decisions (cli-dev, 2026-08-04)

### 1. The range halves are `--from-rev` / `--to-rev`, not `--from` / `--to`
`--from` is a **global** flag naming the acting party (`user|agent`), resolved
by the dispatcher for every verb and forbidden to command specs by registry
validation (`registry/validate.ts`: `flag "--from" shadows a global flag`). A
range half spelled `--from` would be parsed as an actor and rejected before this
verb ran — on a read SPEC.md §9.2 says has *no* acting party. Relaxing the
shadowing rule for one verb was not on the table.

The suffix goes on **both** halves although `--to` is free: an asymmetric
`--from-rev`/`--to` pair hides that the two are one range and invites a `--to-rev`
that would be an unknown flag. With the suffix the mapping from a `doc.edited`
payload stays one-to-one with the wire (`from`→`--from-rev`, `to`→`--to-rev`),
which is what "passable verbatim" has to mean at the command line.

Because the collision is the *likely* mistake rather than a hypothetical one —
the event calls its halves `from`/`to` — `validateActor` now points a
**commit-sha-shaped** `--from` at `corpus doc diff <id> --from-rev <sha> --to-rev
<sha>`. Anything else keeps the attribution hint it always had.

### 2. Output shape: identity, range, counts+size, diff, cut
Five parts, in the order the agent consumes them, all through `out.line` in the
CLI's existing idiom (no new formatter, no colour, `#` for the meta channel as in
`thread context` and `search`):

```
doc_re6umjmc · data/docs/inbox/mortgage-options.md
e842c275a35a6c271efce97c2029a9b2149c36da..cc92776c6a1d370e39762ae631d56c88ebf0b132
1 commit · +1200 -3 · showing 401 of 93486 characters

<unified diff, byte for byte>

# the diff above is cut at a hunk boundary … Do not read it as the whole change …
```

The range is **alone on its line and unabbreviated** so re-pinning it later is a
copy rather than a lookup. The diff is passed through untouched — only the
framing newline is dropped, because `trimEnd` would eat a trailing context line,
which in a unified diff is a single space rather than nothing.

### 3. Truncation is said twice, in two different registers
The size lives in a **fixed slot** on the counts line — `465 characters` when
whole, `showing 401 of 93486 characters` when cut — so the measurement is stated
*before* the body, where a reader that stops early still meets it. The `#` notice
is stated *at the cut*, one line, naming what is missing in characters, that the
counts above are for the whole range, and the two escalations that exist (a
narrower range, or `corpus doc show <id>`). One notice in one place is one skim
away from being missed, and an agent reasoning about a change it only half saw is
the single failure this verb can cause.

### 4. Nothing normal is an error
An empty diff over a real range prints `no change in this range.` and exits 0; a
null range prints `no committed history for this document — nothing to diff.` and
exits 0. Both halves of the range are tested for null together — the contract
nulls them as a pair, and printing `null..9f1c2ab` would be worse than saying
there is no range.

### 5. A non-sha revision is refused locally, exit 2, no request
Using the contract's own `CommitShaSchema`, so there is one spelling of the rule.
The reason is the rename: the server's `400` names `query.from`, and an agent that
typed `--from-rev` would be told about a parameter it never wrote. This is what
`resolveActor` already does with a misspelled actor. A *well-formed* sha the
workspace does not contain still goes to the server — only history can answer
that — and comes back as its `400` (exit 5).

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-04, branch
`phase-11-edit-ack`. Real `corpus init` workspace at `/tmp/corpus-cli026-e2e`,
real server via `corpus server start` from source, **port 9612** (never 8765,
never 5173). `editAcknowledgment.idleMs` set to `2000` so the acknowledgment
window is watchable. No git command run by this agent. Nothing written outside
`apps/cli/`, the generated `docs/cli.md`, and this file.

**1. The bare call, which the rider itself spells.**

```
$ corpus doc diff doc_re6umjmc                                          [exit 0]
doc_re6umjmc · data/docs/inbox/mortgage-options.md
b01ab0f78339e6cab716bf37db575f4cde8a123c..3bcde2637a38c90c5e5b5256802b10e6f80622be
1 commit · +14 -0 · 465 characters

diff --git a/data/docs/inbox/mortgage-options.md …
@@ -0,0 +1,14 @@
+---
+id: doc_re6umjmc
…
```

**2. The round trip the verb exists for: event range → verb argument, unchanged.**
`doc create` then `doc edit`, both `--from user`, then the window, then the real
agent claim path:

```
$ corpus queue claim-all --from agent
{"events":[{"id":"evt_osnvmqfxapvg","type":"doc.edited","source":"edit","payload":{
  "docId":"doc_re6umjmc","sessionId":"es_3f7c08641e72fb29","actor":"user","endedBy":"idle",
  "from":"b01ab0f78339e6cab716bf37db575f4cde8a123c",
  "to":"e842c275a35a6c271efce97c2029a9b2149c36da",
  "stats":{"commits":1,"insertions":15,"deletions":0}}}]}

$ corpus doc diff doc_re6umjmc \
    --from-rev b01ab0f78339e6cab716bf37db575f4cde8a123c \
    --to-rev   e842c275a35a6c271efce97c2029a9b2149c36da            [exit 0]
doc_re6umjmc · data/docs/inbox/mortgage-options.md
b01ab0f78339e6cab716bf37db575f4cde8a123c..e842c275a35a6c271efce97c2029a9b2149c36da
1 commit · +15 -0 · 538 characters
…
+30-year fixed at 6.4%.
+Rate locked on 2026-08-05; the escrow reserve is recalculated annually.
```

The two payload fields were pasted with **no transformation of any kind**, and
the printed counts (`1 commit · +15 -0`) are the event's own
`{"commits":1,"insertions":15,"deletions":0}` — the agent can check what it was
told against what it fetched.

A second session (a 600-paragraph rewrite) repeated it end to end:

```
event: {"sessionId":"es_f3932b667034c39d","endedBy":"idle",
        "from":"e842c275…","to":"cc92776c…",
        "stats":{"commits":1,"insertions":1200,"deletions":3}}
$ corpus doc diff doc_re6umjmc --from-rev e842c275… --to-rev cc92776c…   [exit 0]
1 commit · +1200 -3 · showing 401 of 93486 characters
```

**3. Truncation, on a real 93 486-character diff.**

```
line 3:  1 commit · +1200 -3 · showing 401 of 93486 characters
last line:
# the diff above is cut at a hunk boundary to fit the 16000-character bound: it
  stops 93085 characters short of the whole change, and the counts above are for
  the whole range. Do not read it as the whole change — narrow the range with
  --from-rev/--to-rev, or read the document as it now stands with:
  corpus doc show doc_re6umjmc
```

`--json` on the same call is the wire envelope unchanged, exactly one value:
`{"id":…,"from":"e842c275…","to":"cc92776c…","stats":{"commits":1,"insertions":1200,
"deletions":3},"diff":"diff --git a/data/docs/…","truncated":true,"totalChars":93486}`.

**Server defect found here — escalated, not fixed (see below).** 401 characters
of an allowed 16 000.

**4. The refusals, on the real socket.**

```
$ … --from b01ab0f78339e6cab716bf37db575f4cde8a123c              [exit 2, no request]
corpus: --from must be one of: user, agent — got "b01ab0f7…".
  That is a commit sha. A revision range belongs to `corpus doc diff <id> --from-rev
  <sha> --to-rev <sha>`; `--from` names the acting party on every verb.

$ … --from-rev HEAD~1                                            [exit 2, no request]
corpus: --from-rev must be a commit sha — got "HEAD~1".
  7–64 lowercase hex characters, abbreviated or full. Named revisions are not
  accepted; the `from` and `to` a `doc.edited` event carries are shas and pass
  straight through.

$ … --to-rev v1.0.0                                              [exit 2, no request]
$ … --from-rev 0123456789abcdef0123456789abcdef01234567          [exit 5]
corpus: 400 bad_request: request failed validation
  [{"path":"query.from","message":"0123…4567 is not a commit in this workspace"}]

$ corpus doc diff doc_zzzzzzzz                                   [exit 5]
corpus: 404 not_found: no document with id doc_zzzzzzzz
```

**5. The answer that is not a failure.**

```
$ … --from-rev e842c275… --to-rev e842c275…                              [exit 0]
doc_re6umjmc · data/docs/inbox/mortgage-options.md
e842c275a35a6c271efce97c2029a9b2149c36da..e842c275a35a6c271efce97c2029a9b2149c36da
0 commits · +0 -0 · 0 characters

no change in this range.                        ← stderr empty, exit 0
```

(The null-range/no-committed-history answer is not reachable through a workspace
whose server commits every write; it is covered by unit tests and by SERVER-052's
own E2E.)

**6. Help renders in both modes** (`corpus doc diff --help`, exit 0): usage line,
the id argument, both range flags with the reason for the `-rev` suffix, then the
global flags.

**7. Docs.** `npm run docs:cli -w apps/cli` regenerated `docs/cli.md`
(hand-editing it never happened); regeneration is idempotent — `shasum` before and
after a second run both `bb1f47c56824b66326f487b8ee212050bbf557e22c2105a5dd075caa405fa705`
— and `prettier --check docs/cli.md` is clean, so the drift check's hash half
passes. `scripts/check-generated-artifacts.ts` still reports the file as differing
from `HEAD`, which is the uncommitted-artifact half the orchestrator's commit
resolves.

**8. Gates.**
- `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **78 files, 1122 tests, all
  passing** (32 new: 31 in `commands/doc/diff.test.ts`, 1 in `input.test.ts`).
- `tsc --noEmit -p apps/cli/tsconfig.json` → clean.
- `eslint apps/cli/src --max-warnings 0` → no issues; no rule disabled anywhere.
- `prettier --check apps/cli/src docs/cli.md` → clean.

**9. Cleanup.** `corpus server stop` → `stopped (pid 61113)`; nothing listening on
9612; no vitest worker left alive; scratch workspace and the generated body file
are under `/tmp`.

## Escalation — server defect in `truncateDiff` (SERVER domain, not fixed here)

The truncation E2E above returned **401 characters of an allowed 16 000**, with
93 085 characters dropped. Not a CLI bug — the verb reported it correctly, which
is how it was noticed — but `apps/server/src/edit/diff.ts#truncateDiff` wastes
almost the whole bound whenever a diff has a small leading hunk followed by one
oversized hunk (the normal shape of an edit: a one-line `updated:` frontmatter
hunk, then the body):

```ts
const cut = hunks.slice(1).findLast((start) => start <= max);
if (cut !== undefined && cut > 0) return { diff: text.slice(0, cut), … };
```

With hunk starts `[~0, 401]`, the only candidate is `401`, so the answer is the
frontmatter hunk alone and the body hunk — the entire change — is dropped, even
though ~15 600 characters of budget were free. The line-boundary fallback that
SERVER-052 added only fires when there is *no* admissible hunk boundary. The
contract's stated exception ("a single hunk larger than the whole bound … is cut
at a line boundary") describes this case, so the rule that satisfies both is:
take the **larger** of the hunk-boundary cut and the last line boundary ≤ `max` —
hunk-aligned when a hunk boundary is genuinely near the cap, line-aligned when
honouring it would throw away the budget. Suggest a SERVER-* issue; CLI-026 needs
no change either way.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
