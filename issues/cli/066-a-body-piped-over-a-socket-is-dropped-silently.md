# [CLI-066] A body piped over a socket is dropped silently, and a template lands instead

## Domain
cli

## Status
done

## Priority
P0 (raised from P1 by the user, 2026-08-23 — silent data loss)

## Model
opus

## Dependencies
- Depends on: — (CLI-007 is the decision this hardens, not reverses)
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- `apps/cli/src/input.ts` — `stdinCarriesABody()` and its CLI-007 rationale
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Hit for real during the SHARED-070 audit (2026-08-23, v0.19.0). The audit's
capture harness ran `corpus doc create … <<heredoc` through Node's `spawnSync`
with `input:` — which hands the child a **socketpair** on fd 0.
`stdinCarriesABody()` accepts only regular files and FIFOs (the CLI-007 fix for
agent harnesses that hold a never-closing socket on fd 0), so the CLI read
nothing: **five documents were created with the note template's empty scaffold
as their bodies, exit 0, no warning anywhere.** The loss surfaced only later as
an inexplicable `orphaned_anchor` on a thread whose quoted text "was" in the
body the caller sent. 340 bytes of body were verifiably written to the pipe and
verifiably absent from the document.

CLI-007's decision is right — a socket must never be *blocked on*. What is
wrong is the silence: the CLI cannot tell "no body offered" from "a body
offered on a transport I refuse", and it picks the interpretation that writes
the wrong document at exit 0. `spawnSync`-shaped callers are not exotic — any
tool that wraps the CLI programmatically gets a socketpair from libuv.

## Acceptance Criteria

**Adjudication, user directive 2026-08-23 — warn became refuse.** The criteria
below originally asked for a one-line stderr warning at exit 0. The user raised
the issue to P0 and set two requirements that supersede it: *never block on a
socket*, and *never write a document whose body the caller may have sent* — "if
the transport cannot be read safely, that is a refusal with a message naming the
transport and the remedy, not a create at exit 0". The refusal is what shipped.
The evidence that this does not break the product agent is in the log below: the
Claude Code Bash tool hands fd 0 a **character device** (`/dev/null`), not a
socket, so the agent's own calls never reach the refusal.

- [x] When fd 0 is a **socket** and the verb is one whose body may come from
      stdin (`doc create`, `doc edit`, `thread create/reply`, `skill create`,
      `doc patch --stdin`, `job log`), the CLI **refuses**: exit 2, nothing sent
      to the server, one message naming the transport and one hint naming the
      repairs. Decided by the `fstat` alone — zero bytes read, nothing waited on
      — so the CLI-007 hazard cannot return.
- [x] The refusal fires only when no `-m`/`--file` was given — a caller who
      passed the body explicitly is never refused and never nagged.
- [x] `--json` mode carries the same fact as the `{"error":{…}}` envelope on
      stderr, with `code`, `message` and `hint`.
- [x] The full `--help` of every body-taking verb names the three body sources
      and states that a socket is not one. Written once as
      `BODY_SOURCES_HELP` in `input.ts`, so five verbs cannot drift.
- [x] The Claude Code Bash-tool path (heredoc → regular file) still reads
      bodies and refuses nothing — regression-tested E2E and in unit tests.
- [x] Sending **no** body stays expressible from a socket caller: `< /dev/null`
      and `stdio: ["ignore", …]` both land on a character device and are silent.
      The refusal names that repair only on the verbs where sending none is
      legal — not on `thread reply`, `job log` or `doc patch --stdin`, which
      cannot act without the text.

## Technical Design

_As shipped. The plan said "warning"; the user's P0 directive made it a refusal
— see the adjudication above._

### Files Modified
- `apps/cli/src/input.ts` — the boolean `stdinCarriesABody(fd)` became
  `stdinKind(fd): StdinKind` (`file` | `fifo` | `tty` | `socket` | `other`), with
  `stdinCarriesABody(kind)` derived from it. New `stdinSocketRefusal(what,
  repair, { mayBeOmitted })` and `BODY_SOURCES_HELP`. `resolveBody` throws on
  `socket`; `InputDependencies.stdinIsBodySource` became `stdinKind`.
- `apps/cli/src/commands/job/log.ts` — the socket is refused by name instead of
  becoming the generic "no line to append".
- `apps/cli/src/commands/doc/patch.ts` — `--stdin` on a socket is its own
  refusal instead of "nothing is piped in", which stated the opposite of what
  happened.
- `doc/create.ts`, `doc/edit.ts`, `thread/create.ts`, `thread/reply.ts`,
  `skill/create.ts` — each appends `BODY_SOURCES_HELP` to its description.
- `apps/cli/src/testing/stdin.ts` — `connectedSocket()`, a real Unix-domain
  socket fd for the classification test.
- `docs/cli.md` — regenerated.

### Key Implementation Details
Collapsing `socket` into `false` alongside `other` is what made the loss
possible: the CLI could not tell "no body offered" from "a body offered on a
transport I will not read". `StdinKind` keeps them apart, and the refusal is
decided by the `fstat` alone — zero bytes read, nothing waited on — so CLI-007's
guarantee is untouched.

### Edge Cases
- `0<&-` (no fd 0) and `< /dev/null`: `other`, silent — nothing was offered.
- A socket on a verb that takes no body from stdin: never consulted, no refusal.
- A socket with `-m` or `--file`: the caller answered the question, no refusal.
- `job log` with the positional: checked first, so the agent's own call under a
  socket harness is untouched.
- `doc patch --stdin` named stdin as the source, so its refusal does not offer
  `< /dev/null` — nor do `thread reply`/`thread create`/`job log`, whose text is
  mandatory.

## Testing Strategy
Unit tests in `input.ts`'s suite over a **real** connected socket fd (`net`,
via `testing/stdin.ts#connectedSocket`) for the classification, and over an
injected `stdinKind: "socket"` with the `unreadable()` stdin fixture for the
refusal — so "nothing was blocked on" is an assertion rather than a timeout.
Command-level tests on `doc create`, `doc edit`, `thread reply`, `skill create`,
`job log` and `doc patch` assert exit 2 **and an empty `stub.requests`**: the
wrong document is not written. Regression tests keep the heredoc, the pipe,
`-m`, `--file` and `< /dev/null` paths silent.

## E2E Verification Plan
A Node `spawnSync({ input })` against a real workspace server; before: silent
template body; after: exit 2 with nothing written. A CLI-007-style harness
holding a never-closing socket on fd 0 proves the command still returns
promptly. A shell heredoc run alongside stays silent.

### Reproduction Steps (bugs only)
1. Scratch workspace, server up
2. `node -e 'const r=require("child_process").spawnSync("node",["<bin>","doc","create","--type","note","--title","probe"],{input:"# Body\n",encoding:"utf8"}); console.log(r.stdout,r.stderr,r.status)'`
3. Expected: body lands, or a refusal saying it cannot
4. Actual (2026-08-23): `created doc_…`, exit 0, template body, no warning

### Verification Steps
1. Rebuild, repeat step 2 — expect exit 2 and no document
2. Run the same create via a shell heredoc — body lands, nothing printed
3. Run under a never-closing-socket harness — expect a prompt exit, not the bound

## E2E Verification Log

implemented on: **opus** (claude-opus-5, 1M context)

**Setup.** Scratch workspace `…/scratchpad/ws`, own server on port **8971** (the
user's own server on 8765 was never touched). CLI entry is the built bin,
`node <repo>/apps/cli/dist/bin/corpus.js`, rebuilt with `npm run build` before
every measurement below.

```
$ corpus init …/scratchpad/ws --port 8971
Initialized Corpus workspace at …/scratchpad/ws
  port 8971, token in .corpus/config.json (mode 600)
$ corpus server start
corpus 0.19.0 listening on http://127.0.0.1:8971 (pid 50465)
```

### What fd 0 actually is, per caller

Measured first, because the whole fix turns on it. `fstatSync(0)` under each
real caller:

| caller | fd 0 |
| --- | --- |
| **Claude Code Bash tool** (this session) | **character device** (`/dev/null`, mode 20666) |
| shell heredoc `<<'CORPUS_EOF'` | regular file |
| shell pipe `cmd \| corpus` | FIFO |
| `< /dev/null`, `0<&-` | character device |
| `spawnSync(…, { input })` | **socket** |
| `spawnSync(…, { stdio: "pipe" })` | **socket** |
| `execSync` / `exec` (default options) | **socket** |
| `spawn(…, { stdio: "inherit" })` | inherits the parent's |

This is the fact that made a refusal safe rather than disruptive. CLI-007's note
recorded "Claude Code's Bash tool included" among the socket harnesses; on this
version it is not one, and the harness that hung CLI-007 was a hand-built
`net.Socket` on fd 0. The product agent therefore never reaches the new refusal.
What does reach it is any programmatic wrapper — `exec`, `execSync`, `spawn`,
`spawnSync` — which is exactly the SHARED-070 audit's shape.

### Reproduction (bugs only)

**1. `doc create` — the SHARED-070 incident, reproduced.** 247 bytes written to
the child's fd 0, exit 0, no warning:

```
$ node repro.js "CLI-066 repro"
bytes written to fd 0: 247
stdout: "created doc_jtdxyrml — data/docs/inbox/cli-066-repro.md\n"
stderr: ""
status: 0

$ cat data/docs/inbox/cli-066-repro.md
---
id: doc_jtdxyrml
type: note
title: CLI-066 repro
…
---

## Context

## Notes

## Open questions
```

The body is the `note` template's empty scaffold. Every one of the 247 bytes is
absent, and nothing on either stream said so.

**2. `doc edit` — the second silent loss, not in the original report.** A body
sent on fd 0 with a frontmatter flag: the title changes, the body is dropped, and
the verb reports success. Worse than the create, because `doc edit` decides
whether a `--key` is required by asking "is a body being sent" — so the dropped
body also skipped the staleness check it should have needed:

```
$ node repro-edit.js doc edit doc_jtdxyrml --title "CLI-066 repro (edited)"
bytes written to fd 0: 52
stdout: "edited doc_jtdxyrml\nkey 425addc5…\n"
stderr: ""
status: 0
# body on disk: still the template scaffold
```

### Post-Implementation Verification

**1. The same `spawnSync` repro, refused.** Exit 2, nothing created:

```
$ node repro.js "CLI-066 after the fix"
bytes written to fd 0: 247
stdout: ""
stderr: "corpus: stdin is a socket, and a socket is never read — no body was taken.
  A socket on fd 0 is what `spawn`, `exec` and `spawnSync({ input })` give a child, and it is
  also what an agent harness leaves behind — one that never ends, so reading it would hang this
  command forever. Those two cannot be told apart without reading, so nothing was sent to the
  server rather than a body you may have sent being dropped. Send it with `-m \"…\"` or with
  `--file <path>` — both work from any caller — or on a heredoc or a pipe, which are read. If
  you meant to send no body, say so: redirect `< /dev/null`, or spawn with `stdio: [\"ignore\", …]`."
status: 2
```

**2. `--json` carries the same fact** as the error envelope, with `hint`:

```
$ … doc create --type note --title "json probe" --json     # via spawnSync({ input })
stdout: ""
stderr: {"error":{"code":"usage_error","message":"stdin is a socket, and a socket is never read
  — no body was taken.","hint":"A socket on fd 0 is what `spawn`, `exec` and `spawnSync({ input })`
  give a child, …"}}
status: 2
```

**3. CLI-007's guarantee, re-proved.** A harness holding a connected socket on
fd 0 that is **never written to and never closed** (the shape that hung CLI-007),
with a 20 s SIGKILL bound. Verified socket first, then two verbs:

```
$ node socket-harness.js 10000 node -e '…fstatSync(0)…'
fd0 isSocket true isFile false isFIFO false
[harness] child exited code=0 signal=null after 51ms

$ node socket-harness.js 20000 node <bin> doc create --type note --title "harness probe"
corpus: stdin is a socket, and a socket is never read — no body was taken. …
[harness] child exited code=2 signal=null after 203ms

$ node socket-harness.js 20000 node <bin> job log evt_doesnotexist
corpus: stdin is a socket, and a socket is never read — no line was taken. …
[harness] child exited code=2 signal=null after 195ms
```

**203 ms and 195 ms, not the 20 s bound.** Nothing was read and nothing was
waited on — the refusal is the `fstat` and nothing else.

**4. Every transport that worked still works, silently.**

```
$ corpus doc create --type note --title "CLI-066 heredoc" <<'CORPUS_EOF'   # regular file
created doc_24wgf4s2 — data/docs/inbox/cli-066-heredoc.md      exit=0
  body on disk: "# From a heredoc\n\nThis body must land verbatim.\n"
$ printf '# From a pipe\n' | corpus doc create … "CLI-066 pipe"            # FIFO
created doc_a5hud2ou                                            exit=0
  body on disk: "# From a pipe\n"
$ corpus doc create … "CLI-066 devnull" < /dev/null                        # char device
created doc_2ued5gax                                            exit=0, no warning
$ spawnSync(…, ["-m", "# Repaired\n\nThis body reached the document."])    # socket + -m
created doc_isjlvnit    stderr: ""   status 0
  body on disk: "# Repaired\n\nThis body reached the document.\n"
$ spawnSync(…, { stdio: ["ignore", …] })                                   # socket repaired
created doc_2voaipyn    stderr: ""   status 0
```

**5. The refusal names the transport on every affected verb**, with the repair
that suits it. `doc patch --stdin` and `thread reply` deliberately do **not**
offer `< /dev/null`, because neither can act without the text:

```
$ … doc patch doc_isjlvnit --stdin      # via spawnSync({ input })
corpus: stdin is a socket, and a socket is never read — no patch request was taken.
  … Send the request on a heredoc — `corpus doc patch <id> --stdin <<'CORPUS_EOF'`, the JSON,
  then `CORPUS_EOF` — or drop `--stdin` and name the two sides with `--old-file` and
  `--new-file`, which read from any caller.
status: 2

$ … thread reply th_nope                # via spawnSync({ input })
corpus: stdin is a socket, and a socket is never read — no reply body was taken.
  … Send it with `-m "…"` or with `--file <path>` — both work from any caller — or on a
  heredoc or a pipe, which are read.
status: 2
```

Before the fix `thread reply` answered "no reply body to send. Pass it with
-m …, or pipe it in" — telling the caller to do the thing it had just done.

**6. `--help` names the socket on all seven verbs** (`doc create`, `doc edit`,
`thread create`, `thread reply`, `skill create`, `job log`, `doc patch`): one
`grep -ci socket` hit each. `docs/cli.md` regenerated with
`npm run docs:cli -w apps/cli`; `docs/generate.test.ts`'s drift assertion passes.

### Falsification

The fix removed from `resolveBody` (socket collapsed back into "no body
offered"), rebuilt, same reproduction:

```
$ node repro.js "CLI-066 falsification"
bytes written to fd 0: 247
stdout: "created doc_fvbna2pa — data/docs/inbox/cli-066-falsification.md\n"
stderr: ""
status: 0
# body on disk: the note template's empty scaffold, again
```

The loss returns exactly as reported. The six new tests that assert the refusal
fail with it removed and pass with it restored:

```
× resolveBody > refuses a socket instead of resolving it to no body — and never reads it
× resolveBody > names the caller's own noun in the refusal, so a mandatory body reads right
× corpus doc create — a body on a socket (CLI-066) > refuses rather than creating the document with the template body
× corpus doc edit — a body on a socket (CLI-066) > refuses rather than performing a frontmatter-only edit the caller never asked for
× corpus thread reply — a body on a socket (CLI-066) > names the socket instead of asking for the body that was already sent
× corpus skill create — a body on a socket (CLI-066) > refuses rather than installing a skill whose body the caller replaced
Tests  6 failed | 199 passed (205)
```

A test asserting only "a document was created" would have passed throughout.
Each of these asserts `stub.requests` is **empty** — the wrong document is not
written — which is the property that fails without the fix.

### Where the two requirements pull against each other

They do not conflict on the mechanism: the refusal is decided by `fstat`, so
"never block on a socket" and "never write a body you may have been sent" are
both satisfied with zero reads. They pull against each other on exactly **one**
call shape, and it is a cost rather than a contradiction:

> A caller whose fd 0 is a socket and who genuinely intends **no** body —
> `exec("corpus doc edit doc_x --status resolved")`, a metadata-only edit — is
> now refused, though nothing was lost.

The socket that carries a body and the socket that carries nothing are
indistinguishable without reading, and reading is the hang. Choosing to write is
the CLI-066 loss; choosing to refuse costs this caller one redirect. The refusal
names it (`< /dev/null`, `stdio: ["ignore", …]`), and the product agent is not
this caller — its Bash tool hands fd 0 a character device.

**Checks.** `npm run build`, `npm run typecheck -w apps/cli`, `npm run lint`
(repo-wide, exit 0), `prettier --check apps/cli/src docs/cli.md` (exit 0) all
clean. `vitest run apps/cli` → **104 files, 2031 tests passed**. Scratch server
stopped by pid; port 8971 free.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
