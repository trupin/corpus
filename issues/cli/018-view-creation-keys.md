# [CLI-018] Agent-writable view keys: make §11's "pin me a view" promise reachable

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-016
- Blocks: —

## Spec References
- SPEC.md §11 — "@agent pin me a view of unresolved finance threads just works"

## Summary
Wave-3 audit SPEC 37: `pinned`/`order`/`query`/`column` are core-reserved keys, so
CLI-016's `--extra` refuses them and no other flag writes them — the CLI-only agent
cannot create or pin a view, leaving §11's promise unreachable. Design space: dedicated
flags on `doc create`/`doc edit` (`--pinned`, `--order`, `--query k=v…`), or a
`corpus view create|pin` verb pair. Also decide audit SPEC 38 here: whether `--extra`
gains a documented object escape hatch (the publish plugin stores `publish: {…}`) or
its description drops "total" — one adjudication covering both scalar-shape questions.

**Correction the sprint contract makes to this summary** (sprint-018, Adjudication 13):
the four view keys have shipped on `POST /api/docs` and `PUT /api/docs/{id}` since
CONTRACT-011/017, and `extra` accepts objects on the wire (`EXTRA_MAX_DEPTH = 8`). Both
halves of this issue are therefore CLI **grammar and verb surface** decisions, not
contract gaps — no contract change was needed or made (TEST-645).

## Acceptance Criteria
- [x] The agent can create a pinned, ordered view with a query through documented CLI verbs alone; it appears as a board column over SSE
- [x] SPEC 38 adjudicated (object escape hatch or honest description), implemented accordingly
- [x] docs/cli.md regenerated

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/frontmatter.ts` (new) — the shared value grammar, the
  `--extra`/`--extra-json` parsers, the four view-key parsers, and **one** declaration of
  the view flags that both verbs spread.
- `apps/cli/src/commands/doc/frontmatter.test.ts` (new)
- `apps/cli/src/commands/doc/edit.ts` — consumes the shared module (re-exporting
  `parseExtraValue`/`parseExtraFlags`, whose tests live in `edit.test.ts`), adds
  `--extra-json` and the four view flags.
- `apps/cli/src/commands/doc/create.ts` — adds `--evergreen` and the four view flags.
- `apps/cli/src/commands/doc/{create,edit}.test.ts`, `apps/cli/src/commands/hygiene.test.ts`
  (both pinned module inventories), `docs/cli.md` (regenerated).

### Decision 1 — verb shape: flags on `doc create`/`doc edit`, not a `corpus view` topic (TEST-644)

Argued from what a CLI-only agent reading `corpus --help` finds.

- **§11 says a column *is* a document** — "deletable like any document, nothing
  hardwired". A `corpus view` topic would be a second species: it would need its own
  `edit`, `archive`, `unarchive`, `list` and `show` to be usable, or it would strand the
  agent switching topics mid-task ("pin it with `corpus view pin`, retitle it with
  `corpus doc edit`"). TEST-641 is exactly the property a separate topic erodes.
- **The keys are carried on every document**, not only views (`packages/contract`'s
  `viewFrontmatterShape` is spread into every frontmatter response) — so a topic gated on
  `type: view` would be narrower than the field it writes.
- **Discovery is better where the type is chosen.** `corpus doc create --help` names
  `--type view` two lines above `--pinned`; a separate topic hides the connection behind a
  second `--help`.
- Cost: `doc create` grows five flags and `doc edit` grows five. Accepted — they are
  declared once (`VIEW_KEY_FLAGS`) and rendered by the registry into all three help levels.

**Rejected:** `corpus view create|pin`. It reads well in isolation and is worth
revisiting if views ever grow behaviour a note does not have; today it would duplicate
five verbs to add zero capability.

### Decision 2 — SPEC 38: a documented object escape hatch, `--extra-json` (TEST-639, outcome (a))

The contract has accepted objects since CONTRACT-011 — `EXTRA_MAX_DEPTH = 8` exists
precisely because `todo.items` is an array of objects — so the scalars-only limit was
`--extra`'s grammar and nothing else. Outcome (b) (drop "total", state the limitation)
would have had to name what a plugin storing an object does instead, and for a CLI-only
agent the honest answer was "nothing" — the same shape of gap as this issue's own.

Shipped: `--extra-json key=<json>`, repeatable, same merge-patch semantics as `--extra`
(named keys replace, `null` deletes, unnamed keys untouched) and the same core-key
refusal. **No CLI-side bound**: depth and size are the contract's `EXTRA_MAX_DEPTH` /
`EXTRA_MAX_BYTES`, enforced server-side over the whole merged object — a second limit
here could only ever disagree with it, and would disagree about keys it cannot see. The
CLI's one rule is that the text parses as JSON, so a shell-quoting slip is a usage error
(exit 2) rather than a key that stores a string that looks like an object.

**Rejected:** widening `--extra` so a `{`-leading value parses as JSON. It would change
what `--extra k='{a}'` stores today, and it makes every plugin value ambiguous between
"an object" and "a string that starts with a brace".

`--extra`'s description no longer claims bare totality: it says **"total over scalars"**
— every input maps to exactly one JSON *scalar* — and names `--extra-json` for the rest.

### Decision 3 — the shipped grammar, and its one documented divergence (TEST-636/637)

`--order`, and every `--query` value, go through **CLI-016's `parseExtraValue`**, moved
into the shared module rather than re-implemented (Adjudication 11). Consequences that
are the point: `--order 1e400` is refused (the finiteness gate) instead of becoming a
deletion, `--order '"4"'` is refused instead of writing a quoted number the board cannot
sort on, and `order` reaches the file as a YAML number.

Two **divergences**, both published in the flags' own descriptions:

1. **A comma in a `--query` value is an OR** (`--query type=note,view` → `{type: ["note","view"]}`),
   because that is already the wire form of the same filter (`ViewQuerySchema`'s own
   docblock: `{type: ["note","view"]} ≡ type=note,view`). The escape hatch is rule 4's:
   a quoted value is verbatim, commas included (`--query q='"salt, pepper"'`).
2. **`null` is not a `--query` *value*** — `GET /api/docs` has no null parameter — so
   `--query tag=null` is refused, naming `--query null`, which clears the whole map.

Two edges decided rather than discovered:

- **Clearing.** `--order null`, `--query null`, `--column null` reach
  `UpdateDocRequestSchema`'s `null`, which removes the key from the file; `--pinned false`
  is the same for `pinned`, whose absent and false states are one. On create, `null` is
  the same as omitting the flag — the contract says so, and one description covers both
  verbs.
- **`--query` replaces, never merges.** `query` is one core field, not an RFC 7386
  sub-object like `extra`, so the server stores what it is sent. A merge would be a
  read-modify-write this verb deliberately does not do (`edit.ts`'s own note on why
  `--add-tag` costs a round trip and nothing else does).

### Decision 4 — parity with the board's own creator (TEST-642)

`apps/ui/src/board/newList.ts#columnRequest` sends
`{type: "view", title, folder: "views", pinned: true, order, query, evergreen: true, column?}`.
The CLI reaches all of it, but **explicitly**: `doc create` gained `--evergreen` and the
documented view example passes `--folder views --evergreen true`. The flags are not
implied by `--type view`, because this verb "defaults nothing per type" is its shipped
doctrine (`create.ts`: it does not check the folder, does not invent an id, does not
pre-validate) and a type-conditional default would be the first exception. The example in
`docs/cli.md` is the discovery path, and the E2E log below diffs a CLI-created view
against a board-created one: identical key set, identical YAML shapes.

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: agent creates+pins a view via CLI; board shows the column live.

## E2E Verification Log

**Implemented on: opus** (`claude-opus-5[1m]`), 2026-07-31.
Workspace: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-cli/cli-018-34DxLM`
(created with `mktemp -d`, cwd outside this repository — `pwd` pasted below).
Ports: server **8799**, Vite **5278** — CLI-018's own allocation in sprint-018's table.
CLI: the built bin, `apps/cli/dist/bin/corpus.js` (`node --import tsx` cannot resolve
`tsx` from a cwd outside the repo, so the built bin is the from-outside form).

### Pre-state — the gap, before any code

```
$ /usr/bin/grep -n -- "--pinned\|--order\|--query\|--column\|--extra-json" docs/cli.md
529:| `--pinned` | boolean | `false` | Only documents pinned to the board as columns … |
```

One hit, and it is `doc list`'s read **filter**. No verb wrote any of the four keys, and
`--extra pinned=true` fell to `FLAG_FOR_RESERVED_KEY`'s generic branch ("Core keys are
not user-writable through `--extra`") with nowhere to go. §11's sentence was unreachable.

### Setup

```
$ pwd
/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-cli/cli-018-34DxLM
$ node …/dist/bin/corpus.js init --port 8799
Initialized Corpus workspace at …/cli-018-34DxLM
  port 8799, token in .corpus/config.json (mode 600)
$ node …/dist/bin/corpus.js server start
corpus 0.0.0 listening on http://127.0.0.1:8799 (pid 64007)
```

Fixtures, all through documented verbs: two notes, and two standalone threads — one
tagged `finance` (matches the query below) and one not.

```
$ corpus doc create --type thread --title "Refinance at 5.4%?" --tags finance --from agent -m "Worth switching?"
created th_m3dftvn3 — data/threads/th_m3dftvn3.md
$ corpus doc create --type thread --title "Can we refinance?" --from agent -m "x"
created th_y3egm5xj — data/threads/th_y3egm5xj.md
```

### TEST-633 — the §11 sentence, walked with nothing but documented verbs — **PASS**

One command, taken verbatim from `doc create`'s own generated example:

```
$ corpus doc create --type view --title "Unresolved finance" --folder views \
    --evergreen true --pinned true --order 4 \
    --query type=thread --query status=open --query tag=finance --from agent
created doc_rja5qv32 — data/docs/views/unresolved-finance.md
```

On disk (`data/docs/views/unresolved-finance.md`) — `order` a YAML **number**, `query` a
nested mapping:

```yaml
id: doc_rja5qv32
type: view
title: Unresolved finance
created: 2026-07-31T07:48:19Z
updated: 2026-07-31T07:48:19Z
tags: []
status: open
anchors: {}
due: null
reviewed: null
evergreen: true
pinned: true
order: 4
query:
  type: thread
  status: open
  tag: finance
```

Auto-commit authored by the agent:

```
$ git log --format='%h %an <%ae> %s' -1 -- data/docs/views/unresolved-finance.md
63e1d5e agent <agent@corpus.local> doc create: Unresolved finance (doc_rja5qv32) by agent
```

`corpus doc list --type view --json` reports it beside the three seeds, with
`pinned: true`, `order: 4`, and the query map intact.

### TEST-634 — the board renders it live, in a browser, with no reload — **PASS**

Proxy proof (Adjudication 2) — the dev port answers with **my** workspace:

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:8799"; export VITE_CORPUS_TOKEN=<workspace token>
$ npm run dev -w apps/ui -- --port 5278 --strictPort
$ curl -s http://localhost:5278/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":80.677,"workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-cli/cli-018-34DxLM"}
$ curl -s http://127.0.0.1:8799/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":80.703,"workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-cli/cli-018-34DxLM"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN
node    15627 theophanerupin   15u  IPv4 …  TCP 127.0.0.1:8765 (LISTEN)   # untouched, not mine
```

(Vite binds `[::1]:5278`, so the proxy probe is `localhost`, not `127.0.0.1`.)

Board opened **before** the CLI ran, and the CLI spawned from inside the driving script
so the ordering is a sequence rather than a claim
(`…/tmp/s018-cli/board-live.mjs`; the view created in a first pass was deleted with
`corpus doc delete --from user` so the observed run is a genuine creation):

```
NAVIGATIONS_AFTER_LOAD 2
CLI_STDOUT created doc_rja5qv32 — data/docs/views/unresolved-finance.md
CLI_EXIT 0
NAVIGATIONS_TOTAL 2          # unchanged: no navigation, no reload
SAME_DOCUMENT_MARKER same-document   # a window property set before the CLI ran, still there
COLUMN_TEXT_START
Unresolved finance
VIEW
1
… type: thread / status: open / tag: finance
COLUMN_TEXT_END
```

Screenshot `board-after.png`: the fourth column, **Unresolved finance**, in its `order: 4`
position after Attention (1), Inbox (2), Open threads (3); its single row is
**"Refinance at 5.4%?"** — the finance-tagged thread. The non-matching
**"Can we refinance?"** is present on the board (in Open threads) and **absent** from the
new column: both outcomes shown.

**The SSE frame, captured off the workspace's own stream**
(`curl -sN "http://127.0.0.1:8799/events?token=$TOKEN"`, attached before any of this):

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_rja5qv32"],["tree"]]}
```

`["docs"]` is the key `apps/ui/src/board/useColumns.ts` subscribes to — the column set is
one query (`{pinned: true, type: "view", sort: "order"}`) and this frame is what wakes it.

_Browser leg note._ The Claude-in-Chrome extension was not connected in this session
("Browser extension is not connected"), so the page was driven with the **Playwright
library** (`chromium.launch()`) against the dev server that was already up — one browser,
one page load, **no `playwright test`, no second Vite**, which is what Adjudication 14's
single-holder rule protects. `npm run e2e` was not run.

### TEST-635 — unpin and reorder are reachable too — **PASS**

One page load, CLI spawned from inside it (`board-repin.mjs`):

```
HEADS_BEFORE       ["Attention","Inbox","Open threads","Unresolved finance","Skills & agents"]
CLI> doc edit doc_rja5qv32 --pinned false --from agent => 0 edited doc_rja5qv32
HEADS_AFTER_UNPIN  ["Attention","Inbox","Open threads","Skills & agents"]
CLI> doc edit doc_rja5qv32 --pinned true --order 1.5 --from agent => 0 edited doc_rja5qv32
HEADS_AFTER_REPIN  ["Attention","Unresolved finance","Inbox","Open threads","Skills & agents"]
NAVIGATIONS 2  MARKER same-document
```

The column left the board live and re-entered at the **midpoint** — `order: 1.5`, between
Attention (1) and Inbox (2) — with no column renumbered, which is the shipped tiebreak's
whole rationale.

### TEST-636 / TEST-637 — the query and value grammars — **PASS**

Positive, over the real server:

```
$ corpus doc create --type view --title "Notes and views" --folder views --evergreen true \
    --pinned true --order 6 --query type=note,view --query includeArchived=true --query limit=25 --from agent
created doc_xxio7zl2 — data/docs/views/notes-and-views.md
```

```yaml
query:
  type:
    - note
    - view
  includeArchived: true
  limit: 25
```

Repeated single-key form, the comma/OR form, booleans and finite numbers, all as typed.
`--query needs=me` (the Attention seed's own value) round-trips as the string `me`
(covered in `frontmatter.test.ts`). Replacement, not merge:

```
$ corpus doc edit doc_xxio7zl2 --query type=note --from agent
query:
  type: note          # includeArchived and limit are gone, as documented
```

Clearing:

```
$ corpus doc edit doc_xxio7zl2 --query null --order null --column null --from agent
exit=0    # the `order:`, `query:` and `column:` keys are absent from the file afterwards
```

Refusals — every one **exit 2, before any request**, and the file's `pinned`/`order`/`query`
verified untouched after the batch:

| command | exit |
| --- | --- |
| `--query 'filters={"type":"note"}'` → "a board query is a flat map…" | 2 |
| `--query null --query type=note` → "clears the whole query, so it takes no other pairs" | 2 |
| `--query tag=null` → "is not a filter", naming `--query null` | 2 |
| `--order 1e400` → "takes a finite number or `null`" | 2 |
| `--order '"4"'` → same | 2 |
| `--pinned yes` → `--pinned expects "true" or "false"` | 2 |
| `--column nonsense` → "takes `<plugin>/<type>`" | 2 |

`1e400` is the finiteness gate the wave-3 audit's FIX 1 added, reached through the *same*
`parseExtraValue` — it comes back as the string `"1e400"`, which is not a number, so it is
a refusal rather than the deletion `null` would have meant.

### TEST-638 — `column` is validated, and the plugin-missing path works — **PASS**

```
$ corpus doc edit doc_xxio7zl2 --column todos/todos --order 6 --from agent
column: todos/todos
$ corpus doc edit doc_xxio7zl2 --column not-installed/board --from agent
column: not-installed/board
$ corpus doc edit doc_xxio7zl2 --column nonsense   →  exit 2
```

`board-plugin-column.png`: the **Notes and views PLUGIN** column renders the installed
todos plugin ("Nothing open. Every todo list is clear.").
`board-plugin-missing.png`, after the uninstalled reference and **without a reload**
(NAVIGATIONS 2): the same column, in the **same position**, showing "Plugin missing —
This column renders `not-installed`'s board view, which is not installed. Restore the
plugin to bring the column back, or unpin this list — its view document is untouched
either way." (§15 M6.) The refusal is about the *shape* only; `readColumn`'s read-side
asymmetry was left alone, per the contract's note.

_One deviation from the contract's wording, deliberate._ TEST-638 writes the example as
`--column todos/board`; the reference plugin's actual column type is
`TODOS_COLUMN_TYPE = "todos"` (`plugins/todos/shared.ts:17`, and the board's own picker
shows `todos/todos`). The flag description and the `doc create` example therefore say
**`todos/todos`** — a documented example that names a column nobody can render is the
kind of prose drift the interface-docs check exists to catch.

### TEST-639 — SPEC 38, implemented — **PASS**

```
$ corpus doc edit doc_rja5qv32 --extra width=520 --extra-json 'publish={"target":"blog","draft":true}' --from agent
edited doc_rja5qv32
```

```yaml
width: 520
publish:
  target: blog
  draft: true
```

A scalar through `--extra`, an object through `--extra-json`, one merge patch, one
request. Refusals: malformed JSON → exit 2; a key named by **both** flags → exit 2; a
core key through `--extra-json` → exit 2. Decision and reasoning recorded above
(Decision 2).

### TEST-640 — the reserved-key refusal now names the real flag — **PASS**

```
$ corpus doc edit doc_rja5qv32 --extra pinned=true
corpus: `pinned` is a core frontmatter key, not an `extra` key — `--extra pinned=…` is refused.
  Use `--pinned` instead.                                                            exit 2
$ … --extra order=1      → "Use `--order` instead."     exit 2
$ … --extra query=x      → "Use `--query` instead."     exit 2
$ … --extra column=a/b   → "Use `--column` instead."    exit 2
```

No request sent in any case. The **refusal list** is still iterated from the contract's
`RESERVED_FRONTMATTER_KEYS`, never copied — `edit.test.ts`'s "derives the refusal list
from the contract" case walks every key the contract declares and still passes unmodified.

### TEST-641 — the view is a document like any other — **PASS**

```
$ corpus doc edit doc_rja5qv32 --title "Unresolved finance (2026)" --from agent   → edited
$ corpus db doctor                    → projection is clean — 16 documents from 16 files (1ms)
$ corpus doc archive doc_rja5qv32     → archived
$ corpus doc list --pinned --type view --json
   ["Notes and views","Skills & agents","Attention","Inbox","Open threads"]   # the column is gone
$ corpus db doctor                    → projection is clean
$ corpus doc unarchive doc_rja5qv32   → unarchived
$ corpus doc list --pinned --type view --json
   ["Unresolved finance (2026)","Notes and views","Skills & agents","Attention","Inbox","Open threads"]
$ corpus db rebuild && corpus db doctor   → clean, exit 0
```

Answering the contract's question: **both** removals work and they mean different things —
`--pinned false` clears the key (the document stops being a column), archiving leaves
`pinned: true` but drops the document from the default non-archived list, which the board's
`pinned=true&type=view` query is. Unarchiving restores the column in place.

### TEST-642 — indistinguishable from a view the board creates — **PASS**

A column was created **from the board itself** (＋ New list → "Skills & agents"), and its
file diffed against the CLI's:

```
board:  id/type/title/created/updated/tags/status/anchors/due/reviewed/evergreen/pinned/order/query
cli:    id/type/title/created/updated/tags/status/anchors/due/reviewed/evergreen/pinned/order/query
$ diff <(grep -o '^[a-z]*:' skills-agents.md) <(grep -o '^[a-z]*:' unresolved-finance.md)
IDENTICAL KEY SET
```

Both carry `type: view`, `evergreen: true`, `pinned: true`, `order` as a number, `query`
as a nested mapping, both in `data/docs/views/`. One observation, not a defect: the
board's *preset* writes the OR form as the wire string `type: skill,agent-def`, where
`--query type=note,view` writes the array `[note, view]`; `ViewQuerySchema` documents the
two as equivalent (`{type: ["note","view"]} ≡ type=note,view`) and the board renders both
as chips (screenshot `board-plugin-missing.png`, "type: skill, agent-def").

### TEST-643 — `docs/cli.md` regenerated, never hand-edited — **PASS**

```
$ npm run docs:cli -w apps/cli        → generated ../../docs/cli.md
$ npx prettier --check docs/cli.md    → All files formatted correctly
$ vitest run apps/cli/src/docs        → 16 passed  (incl. "matches the committed docs/cli.md")
$ vitest run scripts/workspace-template.test.ts → 96 passed, no new allowlist entry
```

No new topic and no new headings, so `scripts/workspace-template.ts`'s second gate (every
`corpus …` invocation in the workspace template resolves against `docs/cli.md`'s headings)
is unmoved. `--query` and `--extra-json` are declared `repeated: true` and render as
"(repeatable)".

### TEST-644 / TEST-645 — recorded, and no contract change

Decision 1 above (verb shape). `packages/contract` was not touched: all four keys were
already optional-and-validated on create and update, and `ViewQuerySchema` and
`COLUMN_REF_PATTERN` are **imported** by the CLI rather than re-typed. Files changed by
this issue: `apps/cli/src/commands/doc/{frontmatter.ts,frontmatter.test.ts,create.ts,create.test.ts,edit.ts,edit.test.ts}`,
`apps/cli/src/commands/hygiene.test.ts`, `docs/cli.md`, and this issue file. Nothing in
`packages/`, `apps/server`, `apps/ui` or `assets/` was edited.

### TEST-646 — scoped suite green, CLI-016/017's guards intact — **PASS**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli
  Test Files  67 passed (67)
       Tests  957 passed (957)
$ npx eslint apps/cli        → No issues found
$ npm run typecheck -w apps/cli → clean
$ npx prettier --check apps/cli/src/commands/doc docs/cli.md → clean
```

`edit.test.ts`'s existing cases pass **unmodified** — CLI-017's `assertNotArchived`
refusal and CLI-016's `--extra` grammar are neither weakened nor routed around; the
grammar moved file but not behaviour, and `edit.ts` re-exports it so its tests import
from where they always did. A new case pins the three concerns composing: `--status open
--pinned true` on an archived document is still refused after one `GET`, with no `PUT`.

### Machine hygiene

```
$ lsof -nP -iTCP:8799 -sTCP:LISTEN   → (empty)
$ lsof -nP -iTCP:5278 -sTCP:LISTEN   → (empty)
$ ps -o pid,command -p 64007 -p 64939 -p 64962 -p 93195 -p 64126  → header only; all gone
$ lsof -nP -iTCP:8765 -sTCP:LISTEN   → node 15627 … 127.0.0.1:8765 (LISTEN)   # never touched
$ ls -d /Users/theophanerupin/code/corpus/.corpus
ls: /Users/theophanerupin/code/corpus/.corpus: No such file or directory      # TEST-652
```

Every `corpus init` passed `--port` explicitly. No glob deletes; the scratch workspace is
left in place for inspection. No git command was run in this repository.

### Unresolved / observed, not fixed

- **The CLI cannot open a thread on a document.** `corpus doc create --type thread` makes a
  *standalone* thread (which is what the fixtures above used), but there is no verb for the
  §6 comment flow — `POST /api/threads` with a parent and an anchor has no CLI surface.
  Out of scope here; worth a filed issue, since it is the same species of gap as this one.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
