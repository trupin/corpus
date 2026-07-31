# Evaluation: CLI-018

**Date**: 2026-07-31
**Sprint**: sprint-018
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059), Vite `:5280`,
CLI from source. The live-board check was driven from a **single** Playwright page
that was loaded before the CLI ran and never reloaded afterwards — `page.url()`
re-read at the end to prove no navigation happened.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Long, with the SPEC 38 adjudication written out.                                     |
| Commands are specific and concrete      | PASS   | Verbatim invocations, resulting frontmatter, exit codes.                             |
| Real E2E (not mocked)                   | PASS   | Real server, real board over SSE; reproduced here on an independent workspace.        |
| Scenarios cover acceptance criteria     | PASS   | Creation, the SSE arrival, the value grammar, and the docs regen.                    |
| Application restarted after changes     | PASS   | Fresh workspace for the drill.                                                       |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (`claude-opus-5[1m]`), 2026-07-31."                        |
| Reproduction logged before fix (bugs)   | N/A    | Missing-capability issue, not a defect.                                              |

## Criteria Results

| #   | Criterion                                                                                     | Result | Notes                                                     |
| --- | ----------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| 1   | A pinned, ordered view with a query is creatable through documented CLI verbs alone, and appears as a board column over SSE | PASS   | Column live in ~1s, no reload.                            |
| 2   | SPEC 38 adjudicated and implemented accordingly (flat map, no object/array values)              | PASS   | Flat `key=value` grammar; an object value is a usage error. |
| 3   | `docs/cli.md` regenerated                                                                      | PASS   | Drift check green.                                        |

## Evidence

### §11's "pin me a view", in one command, live

One browser page open on the board, untouched. Columns read before, the CLI run from
a shell, columns re-read on the same page with no reload:

```
[0] columns BEFORE:
    ["doc_seedattention | Attention", "doc_seedinbox | Inbox", "doc_seedopenthreads | Open threads"]

$ corpus doc create --type view --title "Skills" --folder views --evergreen true \
    --pinned true --order 9 --query type=skill --from agent
created doc_bzhyx7mk — data/docs/views/skills.md

[1] column appeared after ~1s WITHOUT reload:
    ["doc_seedattention | Attention", "doc_seedinbox | Inbox",
     "doc_seedopenthreads | Open threads", "doc_bzhyx7mk | Skills"]
[2] page.url() unchanged: http://localhost:5280/
[3] skill row present in the new column: true
```

The column arrived over SSE and populated with the matching document. `--from agent`
is recorded as the git author (`2e3c8af agent doc create: Skills (doc_bzhyx7mk) by agent`).

### The keys reach the file

`data/docs/views/finance-threads.md`, from
`--evergreen true --pinned true --order 1.5 --query type=thread --query status=open --query tag=finance`:

```yaml
evergreen: true
pinned: true
order: 1.5
query:
  type: thread
  status: open
  tag: finance
```

`order` is a YAML **number**, and the board sorts on it — the fractional value lands
between its neighbours without renumbering:

```
GET /api/docs?pinned=true&sort=order
[('Attention', 1), ('Finance threads', 1.5), ('Inbox', 2), ('Open threads', 3), ('Skills', 9)]
```

### The write side of the flags

`corpus doc edit doc_ls2jtpgh --pinned false` removed the column (the board stopped
listing it; a later `--pinned true --order 20` brought it back), so `--pinned` is a
genuine explicit-value flag rather than a create-only switch.

### The value grammar refuses before any request

```
corpus doc create --type view --title X --order notanumber   → exit 2
  "--order takes a finite number or `null` — got "notanumber". The board sorts columns on
   this number, so it has to be one: --order 4, --order 1.5 …"
corpus doc create --type view --title X --query bad          → exit 2
  "--query takes `key=value` — got "bad", which has no `=`."
corpus doc create --type view --title X --column noslash     → exit 2
  "--column takes `<plugin>/<type>` — got "noslash". Exactly one slash, no whitespace …"
```

Each message says what the value is for, which is the honest-description half of the
SPEC 38 adjudication.

### Docs

```
$ npx tsx scripts/check-generated-artifacts.ts
✓ API contract is up to date (packages/contract/openapi.json, …schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
```

`docs/cli.md` carries 17 occurrences of the four view flags.

## Failures

None.

## Summary

3 of 3 criteria passed. The agent can pin an ordered, queried board column with one
documented command, and a browser sitting on the board grows the column about a
second later without a reload — SPEC §11's "pin me a view" reached entirely through
the CLI, which is what this issue existed to make possible.
