# [CLI-016] `corpus doc edit --extra <key>=<value>`: agent-writable extra frontmatter

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §11 — view width stored in the view doc's frontmatter, agent-stewardable ("@agent make the finance column wider")
- SPEC.md §7 — the agent mutates only via the CLI

## Summary
UI-019's escalation (sprint-016 TEST-455, Adjudication 23): §11 promises the agent can
widen a column, but `corpus doc edit` exposes no way to write an arbitrary `extra`
frontmatter key — `--extra` appears nowhere in docs/cli.md; `extra` is read-only output.
Since the agent is CLI-only, the stewardability promise is unreachable. The server side
already works (`PUT /api/docs/{id}` merges `{extra: {...}}` per RFC 7386 — UI-019 proved
it end to end), so this is a CLI-only verb surface: `corpus doc edit <id> --extra
width=520` (repeatable flag; typed value parsing decided per the registry's conventions
— at minimum numbers, strings, and `null` to delete a key per RFC 7386). No contract
change expected; verify.

## Acceptance Criteria
- [x] `--extra key=value` (repeatable) writes through the existing PUT; merge semantics match RFC 7386 incl. `key=null` deletion
- [x] Reserved/core frontmatter keys refused locally with a usage error naming the real flag (`--title`, `--status`, …)
- [x] docs/cli.md regenerated; hygiene inventories updated
- [x] E2E: agent sets `width` on a view doc via CLI; the board reflects it over SSE with no UI change (UI-019's log documents the read path)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/edit.ts` (+ tests), docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (job tmp dir, init from outside the repo, ports 9180-9199, never 8765): CLI width write → frontmatter shows it beside pinned/order/query → browser reflects it.

## E2E Verification Log

**implemented on: opus** (2026-07-30). Workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-cli016-CHSplt`,
server on **9188**, every command run with cwd **outside** this repository. **No Vite dev server was
started** (see "the board half" below), so `CORPUS_SERVER_ORIGIN` never applied and `8765` was
neither bound nor proxied — checked before and after: `lsof -nP -iTCP:8765 -sTCP:LISTEN` empty.

### TEST-529 · the value grammar (Adjudication 12), total and documented

Written down in the flag's own description, which is what `docs/cli.md` publishes:

1. `null` → **deletes** the key (RFC 7386, the server's shipped `extra` merge).
2. `true` / `false` → booleans.
3. A **canonical** JSON number literal (`520`, `-1.5`, `1e3`) → a number. Canonical matters: `007`,
   `1.`, `+1`, `0x10` and `Infinity` are *not* JSON numbers and stay strings, so an identifier that
   happens to be digits is never silently arithmetic.
4. A JSON **string literal** → its contents. This is the documented way to force a string:
   `--extra note='"520"'` stores the characters `520`, and it is the only way to store the literal
   text `null` or `true`. Quoting that is not valid JSON (`"unclosed`, `{"a":1}`) falls through to
   rule 5 rather than erroring.
5. Everything else → the string exactly as typed, including the empty one.

Nothing is dropped and nothing is coerced into something unwritten. Rule 3 is not optional: the
board reads `extra.width` with `typeof raw !== "number"` and falls back to the default
(`apps/ui/src/board/columnWidth.ts`), so storing `"520"` would be a green unit test and a column that
never widens. `--extra` with no `=`, or with an empty key, is a usage error before any request.

### TEST-528 / TEST-534 · the §11 promise, walked as the agent

Only commands `docs/cli.md` documents; no HTTP call, no file edit:

```
$ corpus doc list --type view --json          # discovery
doc_seedattention Attention data/docs/views/attention.md extra={}
$ corpus doc edit doc_seedattention --extra width=520 --from agent
edited doc_seedattention
```

The file the board reads from, and the audit trail:

```
$ sed -n '1,16p' data/docs/views/attention.md
id: doc_seedattention        type: view      title: Attention
pinned: true                 order: 1        query:\n  needs: me
width: 520                                   ← a YAML number, at top level
$ git log --format='%h %an %s' -1
dcc0453 agent doc edit: Attention (doc_seedattention) by agent      ← authored by agent
$ corpus doc list --type view --json | …
extra = {"width": 520} | typeof width = int                        ← the shape UI-019's reader consumes
```

**The SSE half** — the board updates with no reload because the write invalidates the core query
key; captured live on `/events` while the CLI ran:

```
$ curl -sN "http://127.0.0.1:9188/events?token=$TOKEN" &
:connected
event: invalidate
data: {"keys":[["docs"],["docs","doc_seedattention"]]}
```

**Browser half — DEFERRED → the plugins agent's lane.** The orchestrator ruled the browser check out
of this session (a dev server on `5292` would have been a second Vite against a shared machine), and
the substitute evidence is the pair above: the value arrives as the JSON **number** `readStoredWidth`
requires (anything else reads as "no chosen width"), and the `["docs"]` invalidation is exactly what
the board's column query subscribes to. `git diff apps/ui` is empty — **no UI change**, as the
criterion requires.

### TEST-531 · a merge, not a replacement

The CLI sends **only the named keys**. Wire body, from the unit tests:
`{"extra":{"width":520,"note":"keep it wide"}}` — one `PUT`, no read of the document first, so it
cannot race another writer of a key it never mentioned.

```
$ corpus doc edit doc_seedattention --extra note=keep --extra flags=a,b --from agent
$ cp data/docs/views/attention.md before.md
$ corpus doc edit doc_seedattention --extra width=700 --from agent
$ diff -u before.md data/docs/views/attention.md
-updated: 2026-07-30T20:46:45Z        +updated: 2026-07-30T20:46:57Z    ← the server's own stamp
-width: 640                           +width: 700
 note: keep
 flags: a,b                            ← byte-identical, as are `pinned`, `order`, `query`
```

### TEST-530 · `null` deletes, `"null"` does not

```
$ corpus doc edit doc_seedattention --extra width=null --from agent
$ corpus doc show doc_seedattention --json | …
extra = {"note": "keep", "flags": "a,b"}        ← `width` gone, not null, not "null"; others untouched
$ corpus doc edit doc_seedattention --extra note='"null"' --from agent
extra = {"note": "null", "flags": "a,b"}        ← the escape hatch stores the characters
```

The wire body for a deletion is exactly `{"extra":{"width":null}}` (asserted on the raw string, so a
`"null"` regression cannot hide behind a JSON round trip).

### TEST-532 · reserved keys refused locally, naming the real flag

```
$ corpus doc edit … --extra title=Nope
corpus: `title` is a core frontmatter key, not an `extra` key — `--extra title=…` is refused.
  Use `--title` instead.                                                          exit=2
$ … --extra status=archived   → Use `--status` instead.                           exit=2
$ … --extra due=2026-01-01    → Use `--due` instead.                              exit=2
$ … --extra tags=a            → Use `--add-tag`/`--remove-tag` instead.           exit=2
$ … --extra id=doc_x          → Core keys are not user-writable through `--extra`;
                                 `extra` may never shadow one.                    exit=2
```

Exit **2**, the CLI's shipped usage-error code, and **no request is sent** (asserted). The refusal
list is `RESERVED_FRONTMATTER_KEYS` from the contract, iterated — a unit test walks *every* key the
contract declares and expects a throw, so a field added there tomorrow is refused without an edit
here. The flag map only enriches the message; a key it does not know still gets the plain refusal.

### TEST-533 · the server backstop, and why the local guard is not it

Forced past the local guard, straight at the API:

```
$ curl -s -X PUT http://127.0.0.1:9188/api/docs/doc_seedattention -d '{"extra":{"title":"Nope"}}' …
{"code":"bad_request","message":"request failed validation","issues":[{"path":"json.extra.title",
 "message":"`title` is a core frontmatter key; core keys cannot be set or shadowed through `extra`."}]}
HTTP 400
```

The contract still refuses it. The CLI guard exists because an agent gets **one** read of a failure
and "use `--title`" is a next step where a round-tripped validation issue is a puzzle — it is a
better error message, not the enforcement, and skipping it "since the server checks anyway" would
trade the agent's recovery for nothing.

### TEST-537 · reconciled with CLI-017, not fought

`edit.ts` carries **both**: CLI-017's `assertNotArchived` guard (unchanged, not weakened — its
refusal, its wording and its narrowness are intact) and this issue's `--extra`. They compose without
interacting: `--extra` needs no read of the document, the guard's read is shared through
`currentDocument`, and both issues' tests are green on the merged tree
(`apps/cli/src/commands/doc/edit.test.ts`, 46 tests).

### TEST-535 · no contract change

`git diff packages/contract` — **empty**. `extra` was already
`z.record(z.string().min(1), z.unknown())`, the `PUT` already merged per RFC 7386
(`apps/server/src/docs/update.ts`), and the reserved-key `400` already shipped. This issue is a verb
surface over a working mechanism, exactly as the summary predicted.

### TEST-536 · docs and hygiene

`npm run docs:cli -w apps/cli` regenerated `docs/cli.md` on the merged tree (Adjudication 20 — the
one regeneration carries CLI-017's verb and the todos plugin's `migrate` too);
`apps/cli/src/docs/generate.test.ts` and `npx prettier --check docs/cli.md` pass;
`scripts/workspace-template.test.ts` green with `CLI_COMMANDS_PENDING_CLI_006` still `[]` — **no
allowlist entry added**. `--extra` is declared through the registry with `repeated: true` like
`--add-tag`, so it documents itself.

### Checks

`npm run build -w apps/cli`, `npm run typecheck -w apps/cli`, `npx eslint apps/cli`, prettier — all
clean. `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **831 passed / 66 files**. Server on 9188
stopped by recorded pid (87785); `lsof -nP -iTCP:9188` empty; `ls -d /Users/theophanerupin/code/corpus/.corpus`
→ "No such file or directory"; `git status --porcelain` shows only intended source edits.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix

## Audit fix round (wave-3, 2026-07-30 — opus)

Findings from `issues/evals/AUDIT-S017-wave3.md` closed here: **FIX 1**, **TEST 21**, **TEST 25**,
**CLEAN 56**.

**FIX 1 — the "total grammar" claim was falsifiable, and the audit falsified it.** `1e400` is a
perfectly canonical JSON number literal whose `double` is `Infinity`; `JSON.stringify(Infinity)` is
`null`; the server's `extra` patch is RFC 7386. So `--extra width=1e400` did not set a huge width —
it **removed the key**. `parseExtraValue` now gates rule 3 on `Number.isFinite` and falls through to
rule 5 (verbatim string), which is the `parse-args.ts#readNumber` pattern the audit named. The value
is stored rather than turned into a deletion nobody asked for.

**TEST 25, the `>2^53` half — documented, not refused** (the audit left the choice open and accepts
documenting with a test). `9007199254740993` is taken as a number and rounds to
`9007199254740992`, because every JSON parser between the flag and the file does the same to that
literal; refusing here would make the CLI stricter than the wire it writes to, and the escape hatch
already exists (quote it). Both halves are now in the flag's own description, so `docs/cli.md`
publishes them, and pinned by a test that reads the description back.

### E2E Verification Log (fix round)

Real server on `9190`, workspace `.../jobs/4dd0ddef/tmp/audit3-cli/ws1`, `corpus init` from outside
the repo, binary rebuilt between the change and these runs.

```
$ corpus doc edit doc_seedattention --extra width=520   --from agent   → edited
$ corpus doc edit doc_seedattention --extra width=1e400 --from agent   → edited
$ corpus doc show doc_seedattention --json
  extra.width = "1e400"  typeof string  | key present: true
$ grep width data/docs/views/attention.md
  15:width: "1e400"
```

The regression it closes, demonstrated by sending the payload the pre-fix code produced:

```
$ node -e 'console.log(JSON.stringify({width:Number("1e400")}))'
{"width":null}
$ curl -XPUT … -d '{"extra":{"width":null}}' …/api/docs/doc_seedattention
$ corpus doc show doc_seedattention --json
  key present: false          ← the key the caller was trying to SET, gone
```

Nothing else about the grammar moved:

```
$ corpus doc edit doc_seedattention --extra width=760 \
      --extra big=9007199254740993 --extra exact='"9007199254740993"' --from agent
  width 760 number | big 9007199254740992 number | exact "9007199254740993" string
```

**TEST 21 — the CLI-016 × CLI-017 interaction, which nothing exercised.** Four cases, in
`edit.test.ts`, all against a real archived-skill fixture:

- `--extra` on an archived skill goes through in **one** request, with **no `GET`** — the archived
  check belongs to `--status`, and `--extra` names no status, so it costs nothing.
- `--extra status=open` cannot smuggle the field past the guard: refused locally before even the
  read (and by `ExtraFrontmatterSchema` behind that).
- **Precedence pinned**: with `--status open` *and* `--extra title=…` both wrong, the pure flag
  check wins — the cheap, certain error, raised with no server in the loop.
- `--status open --extra width=520` on an archived skill writes **neither**.

```
$ corpus doc edit doc_seedattention --extra title=Nope --from agent   (with a heredoc piped in)
corpus: `title` is a core frontmatter key, not an `extra` key — `--extra title=…` is refused.
  Use `--title` instead.                                              exit=2
```

That last run is also CLI-017's CLEAN 54: flags are parsed before `resolveBody`, so a usage error no
longer drains and discards the caller's body.

**CLEAN 56** — `docs/cli.md` regenerated (`npm run docs:cli -w apps/cli`) so the published grammar
matches the code. The regeneration necessarily also carries the concurrent todos-plugin registry
prose (`todos migrate --dry-run`, `todos list --open`), since one generator emits the whole file.

### Checks (fix round)

`npm run build`, `npx tsc --noEmit -p apps/cli/tsconfig.json`, `npx eslint apps/cli/src`,
`npx prettier --check` — all clean. `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **869 passed / 66
files**; `edit.test.ts` alone is 66 tests. Server stopped by recorded pid 54636; 9190–9195 and 8765
free; no workspace under the repo.
