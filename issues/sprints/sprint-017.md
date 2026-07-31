# Sprint 017 — Phase 5 wave 3: todos moves into the body, and five shipped lies get fixed

**Issues**: PLUGINS-005 (stage A) · PLUGINS-006, PLUGINS-007 (stage B) · CLI-017 → CLI-016 (stage C,
serialized) · CLI-012, SERVER-032, SERVER-037, UI-015 (stage D, independent)
**Domains**: plugins, cli, server, ui
**Branch**: `phase-5-followups`
**Date**: 2026-07-30
**Test numbering**: continues the ladder from sprint-016's `TEST-474`; this sprint runs
`TEST-475`–`TEST-580`.

---

## What this wave is

Two unrelated bodies of work that happen to be ready at the same time.

**The PLUGINS chain (005 → 006 ∥ 007) is one design landing in three commits.** It is not three
issues that touch the same plugin; it is a single storage change whose consequences were split so
they could be verified separately. SHARED-005 is `done`, signed off by the user on 2026-07-30, and
**every amendment is applied to `SPEC.md` on this branch** — §12's doc-type bullet (`SPEC.md:403`),
§12's rendering bullet (`SPEC.md:404`), §15 M6 (`SPEC.md:460`), plus §7/§9.2's deferral rewords. So
the spec is ahead of the code in exactly the places this chain closes, and **`git diff SPEC.md` must
be empty at the end of every session in this batch** (TEST-569). Anything §12 appears to be missing
is an escalation, not an edit.

**The other six are independently-filed defects and gaps** — four of them found by an evaluator or a
reviewer against the shipped product, two by a domain agent mid-verification. They share nothing but
this branch and this machine. They are contracted individually and can land in any order.

The one thing every issue in this batch shares: **it is fixing something the product currently
claims and does not do.** §12 describes checkbox items in the body; they live in frontmatter. §11
promises the agent can widen a column; no CLI verb writes an `extra` key. §7 and a server 409 both
tell the agent to "unarchive"; the verb does not exist. A plugin declares a `seedTemplate`; `init`
never installs it. `POST /api/docs` commits documents nobody can ever read. That framing matters for
the evaluator: **the acceptance bar is the promise being kept, not the code being changed.**

---

## The PLUGINS chain — the signed design, in one place

Every agent on PLUGINS-005/006/007 reads this section, `SPEC.md` §12 + §15 M6 (as amended), and
`issues/plugins/003-item-level-commenting.md`'s **Technical Design** (Candidate 3, no-`View`
variant) before writing a line. The design is long and it is load-bearing; the summary below exists
to make the *staging* unambiguous, not to replace it.

### The change in one sentence

Todo items stop being `extra.items` in frontmatter and become GFM task-list lines in the document
body, the plugin stops registering a `View` for `todo`, and item-level commenting becomes an
**ordinary §6 text-quote anchor** — not because new anchoring code is written, but because there is
suddenly nothing special about an item.

### What the shipped tree looks like today

| Fact | Where |
| --- | --- |
| `TodoItemSchema` is `{text, done, ts, due?}`; `ts` is an ISO instant, `due` is `YYYY-MM-DD` | `plugins/todos/items.ts:40-55` |
| Items are read from `carrier.extra["items"]` (`ITEMS_KEY = "items"`, `:35`) | `items.ts:89-103` |
| Writes return the patch `{extra: {items: serializeItems(next)}}` through `context.mutateDoc` | `items.ts:129-136`, `server/routes.ts:104-145` |
| Five plugin routes: `GET /lists`, `GET /lists/:docId`, `POST /:docId/items`, `PUT`/`DELETE /:docId/items/:index` | `server/routes.ts:151-230` |
| Lost-update protection is "read inside the write lane, recompute the whole array"; `expectedText` guards the index against concurrent deletes (409 on mismatch) | `server/routes.ts:88-98,173-180` |
| The plugin broadcasts `[["lists"], ["lists", docId]]` after a write; core broadcasts `["docs"]` separately | `server/routes.ts:143` |
| `manifest.ts` registers `docTypes: [{type: "todo", View, ListItem, DocPanel, validate}]` and one column | `manifest.ts:25-47` |
| **`TodosColumn` reads items off list rows** — `useDocs({type: "todo"})` then `itemsOrEmpty(row)` | `ui/TodosColumn.tsx:46,62` |
| **`TodoListItem` reads items off list rows too** — same `itemsOrEmpty(row)` | `ui/TodoListItem.tsx:62` |
| `TodoDocPanel` reads `readItems(doc.frontmatter)` — a whole document, not a row | `ui/TodoDocPanel.tsx:21` |
| The anchoring ban forbids `TextQuoteSelector`, `resolveAnchor`, `selectorFromSelection` in every non-test plugin file | `imports.test.ts:103-116` |
| `parity.test.ts` asserts manifest ↔ `types.yaml` parity in both directions, and that the seed template ships **no** `items` key | `parity.test.ts:36-52,127-131` |
| CLI surface: `corpus todos add <list> <text> [--due]`, `check <list> <item> [--uncheck]`, `list [list] [--open]` | `cli/commands/*.ts`, `docs/cli.md:1538-1652` |
| There is **no** todos e2e spec | `apps/ui/e2e/` (confirmed absent) |

### The signed answers — do not re-litigate these

The PLUGINS-003 Technical Design ends with five open questions. **All five are closed.** Four were
answered by the user in SHARED-005's sign-off record (2026-07-30); the fifth is delegated to
PLUGINS-005 by this contract. An agent that reopens one of these has misread the sign-off.

1. **Per-item `due` — the inline convention, APPROVED.** `- [ ] text (due: 2026-08-01)`, the marker
   at the **end of the line**, tolerating absence **and malformation**: text that does not parse as
   the marker is ordinary item text, **never an error** (`SPEC.md:403`, signed verbatim).
   `corpus todos add --due` keeps working.
2. **The toggle path — CONFIRMED as drafted.** In the UI a checkbox toggle is an **ordinary core
   body edit** through autosave; the plugin's routes remain the **CLI/agent** item-level write path
   and the plugin remains the format owner behind them (`SPEC.md:404`).
3. **The renderer seam — CONFIRMED adequate.** No shipped `View` consumer is required; `docTypes` is
   proved by `ListItem` + `DocPanel` + `validate`. **Candidate 3b stays closed** — nobody re-opens
   "keep the View" as a fallback when the drill gets hard.
4. **Per-item `ts` is dropped, deliberately.** Body order becomes the order. Its absence from the
   signed §12 text is a decision, not an oversight (SHARED-005 A1(c)).
5. **Migration policy is PLUGINS-005's to decide** (design open question 4 — explicitly *not* spec
   text; SHARED-005 A1(c) records that mechanism stays out of the spec). Bulk verb
   (`corpus todos migrate`) and migrate-on-first-write are **both acceptable**; read-both-forever
   alone is not. TEST-486–489 contract the floor either one has to clear, and the choice is
   justified in writing (**Adjudication 4**).

### Staging, and why it is not negotiable

```
PLUGINS-005  (storage: items.ts, routes, migration, seeds, CLI parity)
      │
      ├──▶ PLUGINS-006  (manifest: drop View → anchorsHost true → item comments)
      └──▶ PLUGINS-007  (row surfaces: TodosColumn + TodoListItem re-sourced off the body)
```

PLUGINS-005 lands **alone and first**. 006 and 007 run in parallel afterward, worktree-isolated,
with a hard file split (**Adjudication 6**): 006 owns `manifest.ts`, `ui/TodoView.*` and the e2e
spec; 007 owns `ui/TodosColumn.*`, `ui/TodoListItem.*`, `ui/queries.*` and the aggregate route.
Neither touches the other's files; `items.ts` is frozen after 005 lands (**Adjudication 7**).

### The consequence the design does not spell out, and this contract assigns

Under body storage, **bodies do not ride list rows — only `excerpt` does.** The design records this
for `TodosColumn` and proposes the aggregate-route + `(id, updated)` fingerprint fix, which is
PLUGINS-007. It does **not** mention `TodoListItem`, which reads items from `itemsOrEmpty(row)` at
`ui/TodoListItem.tsx:62` for exactly the same reason and breaks for exactly the same reason. §15 M6
as signed names "the todo list rows" as behavior that returns when the plugin is restored, so this
is not a surface anyone may quietly drop.

**Adjudication 5 assigns `TodoListItem` to PLUGINS-007**, together with the column: one root cause,
one fix, one fingerprint. **Adjudication 8** is the narrow, named exception that lets PLUGINS-005
land without either shipping a broken board or doing PLUGINS-007's work twice.

---

## Machine rules — binding on every agent in this batch

### Ports

Verified free at contract time (2026-07-30): `lsof -nP -iTCP:9180-9199 -sTCP:LISTEN` shows **nothing
bound**; `lsof -nP -iTCP:5290-5299 -sTCP:LISTEN` shows **nothing bound**; and
`lsof -nP -iTCP:8765 -sTCP:LISTEN` shows **nothing** — leave it that way.

| Consumer             | Server range  | Primary | Vite dev port |
| -------------------- | ------------- | ------- | ------------- |
| PLUGINS-005          | `9180`–`9181` | `9180`  | —             |
| PLUGINS-006          | `9182`–`9183` | `9182`  | `5290`        |
| PLUGINS-007          | `9184`–`9185` | `9184`  | `5291`        |
| CLI-012              | `9186`–`9187` | `9186`  | —             |
| CLI-016              | `9188`–`9189` | `9188`  | `5292`        |
| CLI-017              | `9190`–`9191` | `9190`  | —             |
| SERVER-032           | `9192`–`9193` | `9192`  | —             |
| SERVER-037           | `9194`–`9195` | `9194`  | —             |
| UI-015               | `9196`        | `9196`  | `5293`        |
| sprint-017 evaluator | `9197`–`9199` | `9198`  | `5294`        |
| Automated tests, every workspace | — | `0` (ephemeral). **Never hardcode.** | — |

**`8765` is NEVER bound and NEVER killed, by anyone, for any reason.** The maintainer's personal
server lives there (user directive, 2026-07-29). The hazard is structural: `corpus init` with no
`--port` probes upward from `DEFAULT_PORT` 8765 (`apps/cli/src/commands/init/port.ts:19,51-63`), so
**every `corpus init` in this sprint passes `--port` explicitly**, including runs expected to fail.
Check `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done and leave whatever is there alone.

#### The Vite dev proxy points at `8765` by default

`apps/ui/vite.config.ts:14` is `const SERVER_ORIGIN = process.env.CORPUS_SERVER_ORIGIN ?? "http://127.0.0.1:8765";`
and `/api`, `/events` and `/attachments` are proxied to it. **An agent that starts
`npm run dev -w apps/ui` without setting `CORPUS_SERVER_ORIGIN` sends every request the browser
makes — creates, `PUT`s, and `DELETE`s — into the maintainer's personal server on 8765.** This
sprint's exposure is worse than wave 2's: PLUGINS-006 drives the **core editor** against real todo
documents, so a mis-pointed proxy rewrites the maintainer's document bodies through autosave, and no
test in this repo would notice.

So, for every agent that starts a dev server:

```sh
export CORPUS_SERVER_ORIGIN="http://127.0.0.1:<your primary port>"   # BEFORE npm run dev
npm run dev -w apps/ui -- --port <your vite port> --strictPort
```

Start your own `corpus server` **first**, then the dev server, then **prove the proxy is yours** and
paste it: a request through the dev port must be answered by your server and appear in its log —
e.g. `curl -s http://127.0.0.1:<vite port>/api/health` returning your workspace's health while
`lsof -nP -iTCP:8765 -sTCP:LISTEN` stays empty. An agent that cannot show that check has not
verified anything, whatever its screenshots say.

`5173`/`5174` are held by an `ssh` process and `apps/ui/vite.config.ts` pins
`server.port: 5173, strictPort: true` without reading `CORPUS_UI_PORT`, so a bare
`npm run dev -w apps/ui` fails to start — use `-- --port <your port from the table above>
--strictPort`. `5273` is the pre-push hook's e2e port; nobody binds it. **No issue in this batch
runs `npm run e2e`** — Playwright is single-holder and starts its own Vite; the orchestrator runs it
once at harvest. PLUGINS-006 writes the batch's one new spec, runs it **scoped** at most once
(`./node_modules/.bin/playwright test <spec> --workers=1` against its own port), and never while
another agent's dev server is up.

### Scratch directories

All scratch work lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` — **never bare
`/tmp`**, and **never inside the repository**.

| Issue       | Prefix                                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| PLUGINS-005 | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins005-XXXXXX` |
| PLUGINS-006 | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins006-XXXXXX` |
| PLUGINS-007 | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins007-XXXXXX` |
| CLI-012     | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-cli012-XXXXXX`     |
| CLI-016     | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-cli016-XXXXXX`     |
| CLI-017     | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-cli017-XXXXXX`     |
| SERVER-032  | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-server032-XXXXXX`  |
| SERVER-037  | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-server037-XXXXXX`  |
| UI-015      | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-ui015-XXXXXX`      |

Automated tests use `fs.mkdtemp`/`mkdtempSync`. **Never** glob-delete the prefix — other agents'
evidence lives there. Delete only paths you created and captured in a variable.

### Workspace creation — the subshell-cd rule still applies

CLI-013 landed, so `corpus init --workspace <path>` honors its flag. Both forms are legal; **prefer
the subshell `cd`** anyway, because it is correct whether or not CLI-013 is present in whatever tree
your session started from, and because a mistyped `--workspace` scaffolds your cwd:

```sh
# Preferred — the subshell cd is what makes the target real
( cd "$WS" && node --import tsx "$REPO/apps/cli/src/bin/corpus.ts" init --port 9180 )

# Legal since CLI-013, but only from a cwd outside this repository
corpus init --workspace "$WS" --port 9180
```

- **Every drill runs from a cwd OUTSIDE this repository.** Not the repo root, not a worktree, not
  any subdirectory of either. `cd` to your scratch prefix first and `pwd` into the log. The
  2026-07-29 CLI-014 drill got this wrong and clobbered the repo's `README.md` and `.gitignore`
  irrecoverably.
- **Verify `/Users/theophanerupin/code/corpus/.corpus` is absent** at the end of your session and
  paste the check (TEST-573). Confirmed absent at contract time.
- From-source CLI is `node --import tsx apps/cli/src/bin/corpus.ts`, or the built
  `apps/cli/dist/bin/corpus.js` after `npm run build` — **never `npx`**.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` kill sibling
agents' servers and the maintainer's `8765` server — **forbidden.** Stop what you started, by
recorded pid, and verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring done. This
includes the Vite dev server and any `claude` session you started for a drill.

### Tests and load

- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm test` unfiltered, never `npm run coverage` or `npm run test:coverage`,
  never `npm run e2e`. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum.**
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time** — never overlap builds, test runs, Playwright, or `npm install`.
- **Three concurrent implementation agents maximum**, and stage A makes it one.
- `npm run build` before lint/typecheck/test — `@corpus/*` imports resolve through `dist/`.

### Grep, and why this rule exists

**Use `/usr/bin/grep` for any grep-based evidence.** The `rtk` proxy has produced **false
negatives** — a search that finds nothing when the string is present. Every "X does not appear
anywhere" claim in an E2E log (TEST-495, TEST-540, TEST-559 and the cross-issue checks all rest on
one) must come from `/usr/bin/grep` with the command pasted, or it is not evidence.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed is marked `STRUCK → Adjudication N`,
`STRUCK → Open Conflict N`, or `DEFERRED → <reason>` in the E2E Verification Log, **with the reason
and the substitute evidence supplied**. Silent omission is a fail. Each agent also states
`implemented on: opus | fable` per CLAUDE.md's Record-actuals rule.

---

## Acceptance Tests

### PLUGINS-005: items become task-list lines in the body

**Stage A, alone, first.** `plugins/todos/` — `items.ts` (the format owner), `server/routes.ts`,
`cli/`, `seeds/todo-template.md`, `manifest.ts`'s `validate` line, and every colocated test. Model:
**opus**. Signed spec: `SPEC.md:403`, applied 2026-07-30.

This is the whole storage change, and it lands **green**: after it, `corpus todos add|check|list`
behave identically, the routes answer identically, and no surface regresses except by the narrow,
named permission of Adjudication 8. Nothing about anchoring, no manifest `View` change, no column
work — those are 006 and 007.

Four facts that decide most of the implementation:

- **`validate` is never called.** `packages/kit/src/plugin/types.ts:100` types it
  `(doc: Doc) => readonly string[]` — a whole document, body included — and `:98` says in so many
  words: *"Reserved: core does not invoke it in v1."* So repointing `itemProblems` at the body is
  free, it cannot regress a user-visible behavior, and it is **not** a reason to touch `packages/kit`.
- **`mutateDoc` is unchanged.** `server/routes.ts:104-145` already reads inside the write lane and
  recomputes the whole item list; the only difference is that the patch it returns stops being
  `{extra: {items: …}}` (`items.ts:129-136`) and becomes a **body** patch. The lost-update property
  (`:88-98`) and the `expectedText` 409 guard (`:173-180`) are properties of that lane, not of the
  storage, and both must survive verbatim.
- **`ts` is gone and `due` moves inline.** `TodoItemSchema` (`items.ts:40-55`) loses `ts`; body order
  becomes the order. `due` becomes `(due: YYYY-MM-DD)` at the **end of the line**.
- **The plugin now shares the body with the user.** This is the genuinely new hazard: before, the
  plugin owned an isolated frontmatter key, and a serializer bug could only corrupt items. Now a
  serializer that reformats, reorders, or re-wraps anything it did not mean to touch **eats the
  user's prose**. TEST-476 is the single most important test in this section.

#### A. The format

TEST-475: The body is standard GFM, and it is what the spec says
  Given: A todo document with two open items and one done item, one carrying a due date
  When: `corpus todos list <doc>` is run and the file is read from disk
  Then: The body contains exactly `- [ ] text` / `- [x] text` lines in body order, with the due date
  rendered as `(due: YYYY-MM-DD)` at the **end** of its line — `- [ ] Book the passport appointment
  (due: 2026-08-01)`. Not a checkbox variant, not `* [ ]`, not an HTML input, not a marker at the
  start of the line. The exact bytes are pasted. This is `SPEC.md:403` read literally, and the format
  is what every other test in the chain depends on.

TEST-476: Everything the plugin did not touch is byte-identical
  Given: A todo document whose body has prose before the list, a heading between two groups of
  items, a fenced code block containing a line that *looks* like a task item, and trailing prose
  When: One item is checked through `corpus todos check`
  Then: `git diff` in the workspace shows **exactly one changed line** — `- [ ]` → `- [x]` on the
  target item. The prose, the heading, the code fence and its lookalike line, blank lines, trailing
  whitespace and the final newline are all byte-identical. A serializer that rewrites the document
  from a parsed model instead of editing the lines it owns fails here, and this is the failure that
  loses user work rather than merely looking wrong.

TEST-477: A line inside a code fence is not an item
  Given: The document from TEST-476
  When: `corpus todos list <doc> --json` is read
  Then: The fenced lookalike is **not** listed as an item, and checking item 1 does not touch it. A
  plugin that parses line-by-line with a regex and no fence awareness fails here.

TEST-478: The due marker is tolerant in both directions
  Given: Items reading `- [ ] a (due: 2026-08-01)`, `- [ ] b (due: not-a-date)`, `- [ ] c (due:
  2026-08-01) trailing`, and `- [ ] d` with no marker
  When: They are listed
  Then: `a` has `due = 2026-08-01`; `b`, `c` and `d` have **no due date and no error** — their marker
  text is ordinary item text, exactly as `SPEC.md:403` signs off ("text that doesn't parse as the
  marker is ordinary item text — never an error"). Nothing is rejected, nothing warns, nothing is
  silently rewritten. `c` proves the marker is end-of-line-anchored.

TEST-479: `--due` round-trips through the CLI to the marker and back
  Given: `corpus todos add <doc> "Renew passport" --due 2026-08-01`
  When: The file is read, then `corpus todos list <doc> --json` is read
  Then: The line carries `(due: 2026-08-01)`, the JSON carries `due: "2026-08-01"`, and the shipped
  `ISO_DATE_PATTERN` validation (`items.ts:38`) still rejects `--due nonsense` at the CLI with the
  same error it gives today. The flag survives the storage change (signed answer 1).

TEST-480: `ts` is gone and nothing quietly depends on it
  Given: `TodoItemSchema` after the change
  When: The type and every consumer are inspected
  Then: There is **no** `ts` field. `/usr/bin/grep -rn 'ts:' plugins/todos --include=*.ts*` shows no
  surviving per-item timestamp, the CLI's `--json` output no longer emits one, and React keys are
  derived from something stable that is not `ts` (design open question 5, resolved by the sign-off).
  Order is body order, and TEST-481 is what proves that is enough.

TEST-481: Order is body order, and a toggle does not reorder
  Given: Three items in a known order
  When: The middle one is checked, then unchecked, then renamed
  Then: The order is unchanged after every operation, and `corpus todos list` returns them in body
  order every time. The shipped guarantee that `ts` protected — "a toggle must leave it
  byte-identical, which is what lets a list keep a stable order across any number of check/uncheck
  cycles" (`items.ts:44-47`) — is now a property of editing lines in place, and this test is what
  replaces that comment's proof.

#### B. Parity — the surfaces that must not move

TEST-482: Every route behaves identically
  Given: The five shipped routes — `GET /lists`, `GET /lists/:docId`, `POST /:docId/items`,
  `PUT /:docId/items/:index`, `DELETE /:docId/items/:index` (`server/routes.ts:151-230`)
  When: Each is exercised against a body-backed document
  Then: Same paths, same methods, same request bodies, same response shapes, same status codes as
  before the change. `server/routes.test.ts` is **updated in place, never deleted** — its assertions
  about behavior stand; only its fixtures move from frontmatter to body.

TEST-483: The `expectedText` 409 guard survives verbatim
  Given: Two concurrent operations where the second names an index whose text has changed
  (`server/routes.ts:173-180`)
  When: The second runs
  Then: **409**, same code, same message shape. The guard exists because indexes are not identities;
  body storage does not change that, and an implementation that drops the guard because "the line is
  right there" has removed a real protection.

TEST-484: The lost-update property is still proved, not assumed
  Given: Two concurrent item mutations on the same document through `mutateDoc`
  When: Both run
  Then: Both are reflected; neither overwrites the other with a stale list. The read-inside-the-
  write-lane property (`server/routes.ts:88-98`) is re-proved against body storage with a real
  concurrent test, because the thing it protects — recomputing from a snapshot taken before the
  lane — is exactly what a body parser makes easy to get wrong.

TEST-485: `corpus todos add|check|list` are unchanged in shape
  Given: `docs/cli.md:1538-1652`
  When: Regenerated after the change
  Then: The three verbs, their arguments, and their flags (`--due`, `--uncheck`, `--open`, `--from`,
  `--json`) are **identical** — unless the migration decision adds a verb (TEST-489), in which case
  the diff is exactly that addition and nothing else. `resolveSelector`'s behavior (`items.ts:260-289`
  — 1-based index or case-insensitive text match) is preserved and tested.

#### C. Migration — the decision, and the floor both options clear

The choice is PLUGINS-005's (**Adjudication 4**): a bulk verb (`corpus todos migrate`) or
migrate-on-first-write. **Read-both-forever with no convergence is not an option** — it leaves the
aggregate surfaces permanently ambiguous, which is the specific harm the design names. Whichever is
chosen, the following four tests are the floor.

TEST-486: The decision is recorded with its reasoning
  Given: The issue file's E2E Verification Log
  When: Read
  Then: It names the chosen policy, the option rejected, and **why** — in terms of the observable
  consequences (what a user with existing todo documents experiences, what a mixed-format workspace
  reads as, when convergence completes, and what happens to a document that is never written again).
  "Chose X" without the comparison is not a recorded decision.

TEST-487: No item is lost, in any order of operations
  Given: A workspace with three pre-existing todo documents carrying `extra.items` — one with a
  `due`, one with a done item, one with items whose text contains `- [ ]`-like characters
  When: Migration happens (however the chosen policy triggers it) and the documents are read back
  Then: Every item survives with its `text` and `done` intact and its `due` preserved into the
  inline marker; item order is preserved; and the item whose text contains checkbox-like characters
  round-trips without being split, escaped away, or re-parsed into two items. `corpus db doctor` is
  clean afterward.

TEST-488: A mixed-format workspace reads correctly throughout
  Given: One migrated document and one not-yet-migrated document, side by side
  When: `corpus todos list` is run with no argument (across all lists), and `GET /lists` is called
  Then: **Both** documents' items appear, correctly, with no duplication and no empty list. Tolerant
  reads are what makes the transition survivable, and this is the state a real user is in for however
  long the chosen policy takes to converge.

TEST-489: Residual `extra.items` is handled deliberately, not left to rot
  Given: A document that has been migrated
  When: Its frontmatter is read from disk
  Then: The stale `extra.items` key is **gone** — a migrated document does not carry both
  representations, because a document with items in two places is a document where the two can
  disagree. If the chosen policy leaves the key in place for any window, the log states the window,
  states which representation wins during it, and states what closes it. If a
  `corpus todos migrate` verb ships, it appears in the regenerated `docs/cli.md`, is idempotent
  (running it twice is a no-op with a clear message), and reports what it changed.

#### D. Seeds, templates and validation

TEST-490: The seed template ships starter items in its body
  Given: `plugins/todos/seeds/todo-template.md` after the change
  When: Read
  Then: Its **body** contains real starter task-list lines, and its frontmatter still ships **no**
  `items` key — so `parity.test.ts:127-131` passes for the same reason it passes today (template
  frontmatter never reaches instances) and now also asserts the body's task-list content. This is the
  design's "templates start working for todos" consequence and `SPEC.md:403`'s "its type's template
  can ship starter items in its body like any template pre-fill".

TEST-491: `validate` is repointed without touching the kit
  Given: `manifest.ts`'s `validate: (doc) => itemProblems(doc.frontmatter)` line
  When: Changed to read the body
  Then: It typechecks against the **unchanged** `packages/kit` signature `(doc: Doc) => readonly
  string[]` (`types.ts:100`), `parity.test.ts`'s manifest-shape assertions stay green, and
  `git diff packages/kit` is empty. Core never invokes it (`types.ts:98`), so this is a
  type-and-tidiness change with no behavior to verify beyond compiling.

#### E. Blast radius and evidence

TEST-492: The anchoring ban is green, untouched
  Given: `plugins/todos/imports.test.ts:103-116`
  When: The suite runs
  Then: Green, and the file is **unmodified** — `TextQuoteSelector`, `resolveAnchor` and
  `selectorFromSelection` still appear in no non-test plugin file. sprint-016 Adjudication 14 carries
  forward: this ban may be changed only deliberately, with its comment rewritten, and never to
  accommodate a design. That it survives *unchanged* is the design's own stated proof that this is
  the right shape (PLUGINS-003 Technical Design, Candidate 3).

TEST-493: The blast radius is `plugins/todos` and nothing else
  Given: `git status --porcelain` at the end of the session
  When: Inspected
  Then: Changes are confined to `plugins/todos/**` plus the regenerated `docs/cli.md` if a verb was
  added. `git diff SPEC.md`, `git diff packages/contract`, `git diff packages/kit`, `git diff
  apps/server`, `git diff apps/ui` are **all empty** — the PLUGINS-003 design's blast-radius table
  says this design crosses no domain boundary, and this test is that claim being checked rather than
  asserted. A drill also runs the full CLI round-trip against a real server on `9180` from a
  workspace outside this repository, with output pasted.

---

### PLUGINS-006: the plugin stops claiming the slot, and item comments appear

**Stage B, parallel with PLUGINS-007.** `plugins/todos/manifest.ts`, `plugins/todos/ui/TodoView.*`,
and the batch's one new `apps/ui/e2e/` spec. Model: **opus**. Signed spec: `SPEC.md:404` (rendering
and item comments) and `SPEC.md:460` (§15 M6), applied 2026-07-30. Ports: server `9182`, Vite `5290`
— `CORPUS_SERVER_ORIGIN` exported and **proved** first.

This is the issue where the design either pays off or is wrong, and it is deliberately tiny in code:
**delete a `View` registration and a component, then prove that everything the design promised for
free actually arrives.** The design's two load-bearing discoveries (recorded in PLUGINS-003's E2E
log) are that `editorHandlesType` (`apps/ui/src/editor/DocEditor.tsx:45`) excludes **only** `thread`
and `view`, so dropping the `View` is sufficient to make `anchorsHost` true at
`apps/ui/src/reader/DocView.tsx:88-96`; and that the core editor already handles GFM task lists in
both directions (`editor/markdown/schema.ts:78-79`, `parse.ts:166`, `serialize.ts:231`) with the
kit's `MarkdownView` rendering them (`markdown.css:103-104`). **Both are claims about shipped code
that nobody has yet run.** The verification bar here is correspondingly high: every anchor-lifecycle
test below is *observed against a real server and a real browser*, not reasoned from §6.

**This agent does not edit `apps/ui` or `packages/kit`** (**Adjudication 9**). If the drill finds a
task-list round-trip defect or a comment-capture defect in core, it **stops, files, and escalates**
— it does not reach across the boundary, and it does not work around the defect inside the plugin.

TEST-494: The `View` registration is gone; the other three slots stay
  Given: `plugins/todos/manifest.ts:25-47` after the change
  When: Read
  Then: The `todo` `docTypes` entry has **no `View`** and still has `ListItem`, `DocPanel` and
  `validate`. The `columns` entry is untouched. `parity.test.ts`'s bidirectional manifest ↔
  `types.yaml` check (`:36-52`) and its manifest-shape assertions (`:60-86`) are green — a manifest
  that loses a renderer is a *supported* degradation, which is exactly what parity already asserts.

TEST-495: `TodoView` is deleted, and nothing still points at it
  Given: The tree after the change
  When: `/usr/bin/grep -rn 'TodoView' plugins apps packages` is run and pasted
  Then: **No hits outside deleted files.** `ui/TodoView.tsx` and `ui/TodoView.test.tsx` are gone, no
  import survives, no CSS rule in `todos.css` is orphaned by their removal without being removed too.
  The grep is run with `/usr/bin/grep` and pasted, per the Machine rules — a stale import that
  typechecks because the file still exists is precisely what a false-negative search hides.

TEST-496: A todo document renders in the core editor, with a live anchor layer
  Given: A todo document opened in the running app (server `9182`, Vite `5290`, proxy proved)
  When: The reader is inspected
  Then: It is the **standard editor**, not a plugin surface: the floating toolbar appears on
  selection, `[[ref]]` autocomplete works, markdown shortcuts work, and the anchor layer is present
  (`anchorsHost === true`). The `DocPanel` stats strip still sits above it — dropping the `View` must
  not take the panel with it. Screenshot plus the observed behavior, both pasted.

TEST-497: Checkboxes render, toggle, and the toggle is an ordinary body edit
  Given: The rendered task list
  When: A checkbox is clicked in the editor
  Then: It toggles; the change persists through **core autosave** (not a plugin route — signed answer
  2, `SPEC.md:404`); the file on disk shows `- [ ]` → `- [x]` and nothing else changed; the
  auto-commit is authored by `user`. The server's request log is pasted showing a core
  `PUT /api/docs/:id` and **no** `PUT /api/x/todos/…`. This is the clause the sign-off restated, and
  it is restated in behavior here.

TEST-498: An item comment is an ordinary anchor — resolved, not orphaned. **The gate.**
  Given: A todo document with several items
  When: An item's text is selected in the editor and commented on, through the ordinary
  comment-from-selection affordance
  Then: A thread is created **and it resolves**: the immediate response carries a real range, and
  — the half that separates the design from a demo — a subsequent `GET /api/docs/:id` reports
  `orphaned: false` with a real `range`, the projection carries a real `resolved_offset`, and
  `corpus db doctor` is clean. `corpus doc check` reports no anchor problem. This is sprint-016
  TEST-462 inherited as the chain's single gate: a thread that is created successfully and orphaned
  from birth is the failure mode every rejected candidate produced, and it looks identical to success
  in a screenshot.

TEST-499: The anchor survives check and uncheck
  Given: An item carrying a resolved thread
  When: It is checked, then unchecked, through **both** paths in turn — a click in the editor and
  `corpus todos check`
  Then: The thread stays attached and resolved after every transition. Only the line's prefix
  changed, so `exact` is untouched: resolution falls to the unique-`exact` rung and reconciliation
  refreshes `prefix`/`suffix`. Both paths are drilled because they write through different lanes and
  the design claims the outcome is the same.

TEST-500: The anchor follows a rename, and the quote stays honest
  Given: An anchored item
  When: Its text is edited in place (in the editor, and separately through the plugin route)
  Then: The thread stays attached and the stored `exact` becomes the **new** text — §6's "recomputed
  quotes are honest". Where the edit is large enough that §6's honesty checks refuse to recompute,
  the thread **orphans visibly** rather than silently misattaching, and the log states which branch
  was observed. "A visible orphan beats a silent misattachment" is the adjudicated rule and either
  outcome is acceptable; a thread pointing at text the user never wrote is not.

TEST-501: The anchor follows a reorder
  Given: Three items, the second anchored
  When: It is moved to the end — by cut/paste in the editor, and separately by a list rewrite through
  the routes
  Then: The thread follows the item to its new position and stays resolved (§6's moved-passage
  family). The other two items' threads, if any, are unaffected.

TEST-502: Deleting the item orphans the thread, quote preserved
  Given: An anchored item
  When: It is deleted — by deleting the line in the editor, and separately via
  `DELETE /:docId/items/:index`
  Then: The thread becomes **orphaned**, its selector preserved byte-for-byte, and it remains fully
  functional and listed in the detached-threads region — never silently detached, never re-attached
  to a lookalike item. §6 unchanged, observed rather than cited.

TEST-503: Whole-document commenting never stopped working
  Given: Todo documents in three states — created before the migration, migrated, and created after
  When: A whole-document (unanchored) thread is opened on each
  Then: It works on all three, at every point in the chain. This is PLUGINS-003's stated fallback
  floor and the behavior a user has today; the chain is not allowed to trade it for item comments
  even briefly.

TEST-504: The §15 M6 drill matches its newly signed text
  Given: `SPEC.md:460` as amended — delete `plugins/todos` → the app still boots and todo docs render
  as ordinary markdown **with working checkboxes**; the column shows a "plugin missing" card; restore
  → the DocPanel, the todo list rows and the Todos column return; **item-level commenting works
  identically in both states**
  When: The drill is run for real against the running app
  Then: Every clause holds, each pasted. The last clause is the new one and the one that proves the
  design: item commenting is core anchoring, so removing the plugin must not disturb it. A degraded
  todo document that loses its checkboxes, or item threads that break when the plugin is absent, is a
  fail.

TEST-505: The first todos e2e spec lands, and is run scoped
  Given: `apps/ui/e2e/` currently contains **no** todos spec (confirmed at contract time)
  When: One is added
  Then: It covers the UI-observable half — a todo document renders task-list checkboxes in the
  editor, a checkbox toggles, and an item can be commented on — and it runs **scoped**, at most once
  (`./node_modules/.bin/playwright test <spec> --workers=1` against port `5290`), never
  `npm run e2e`, never while another agent's dev server is up. Per sprint-016 Adjudication 19 the
  spec is only half the evidence: `apps/ui/playwright.config.ts:16-22` starts **no** workspace
  server, so the disk/git/projection half comes from the manual drill above.

TEST-506: A core defect is filed, not fixed, and the boundary holds
  Given: The end of the session
  When: `git diff apps/ui`, `git diff packages/kit`, `git diff packages/contract`, `git diff
  apps/server` and `git diff SPEC.md` are inspected
  Then: **All empty** (Adjudication 9). If the drill surfaced a task-list round-trip or capture
  defect in core, the E2E log records it in reproducible detail — the exact input, the exact
  serialized output, the exact step that fails — and the agent escalates to the orchestrator the same
  session for a `UI-0xx` filing. A defect worked around inside the plugin is a fail even if every
  other test passes, because the design's entire claim is that the plugin needs no such code.

---

### PLUGINS-007: the row surfaces re-sourced off the body

**Stage B, parallel with PLUGINS-006.** `plugins/todos/ui/TodosColumn.*`,
`plugins/todos/ui/TodoListItem.*`, `plugins/todos/ui/queries.*`, and the plugin's own aggregate
route in `server/routes.ts` if it needs widening. Model: **opus**. Ports: server `9184`, Vite `5291`
— `CORPUS_SERVER_ORIGIN` exported and **proved** first.

The problem in one line: **bodies do not ride list rows.** `extra` does, which is why
`TodosColumn.tsx:62` can aggregate every open item across every todo document with a single
`useDocs({type: "todo"})` and `itemsOrEmpty(row)` at `:46` — the plugin's own docstring calls this
"the kit-only proof". Once items live in the body, list rows carry only `excerpt`, and that query
returns nothing useful. **`TodoListItem.tsx:62` reads items exactly the same way and breaks for
exactly the same reason** — the PLUGINS-003 design does not mention it, and **Adjudication 5**
assigns it here, with the column, because it is one root cause with one fix. §15 M6 as signed names
"the todo list rows" among the surfaces that return when the plugin is restored, so this is not a
surface anyone may quietly drop.

And there is a live-update hole underneath it. The plugin broadcasts `[["lists"], ["lists", docId]]`
after its own writes (`server/routes.ts:143`); core broadcasts `["docs"]` after core writes. Before
this chain, a todo item could only change through a plugin route, so the plugin's cache always heard
about it. **After PLUGINS-006, the ordinary way to check a box is a core body edit** — which
broadcasts `["docs"]` and never `["x","todos",…]`. Without a fingerprint tying the plugin's query
key to something core invalidation moves, the column silently shows stale counts until reload. That
hole, closed and observed, is TEST-509.

TEST-507: The column is correct against body-backed lists
  Given: Three todo documents with a known mix of open and done items, one item overdue
  When: The Todos column renders
  Then: The counts, the grouping by document, and the per-item preview are exactly what the
  documents contain — verified against the files on disk, not against the previous implementation's
  output. `groupOpenItems`' contract (`TodosColumn.tsx:43-50` — documents with no open items are
  omitted entirely) is preserved.

TEST-508: The todo list row is correct too
  Given: A todo document's row on any board column that renders it
  When: Inspected
  Then: `TodoListItem` shows the same preview it shows today — up to `PREVIEW_ITEMS = 3` open items
  (`TodoListItem.tsx:42`) with the overdue treatment where it applies (`:123`) — sourced from the
  body. A row that has silently become an ordinary document row, or shows an empty preview for a
  document that has items, is a fail (Adjudication 5).

TEST-509: A toggle made in the core editor updates both surfaces without a reload. **The hole.**
  Given: The board showing the Todos column and a todo list row, and the same document open in the
  core editor in another pane or tab
  When: A checkbox is toggled **in the editor** (a core body edit — no plugin route involved)
  Then: The column's counts and the row's preview update **without a reload**, within the app's
  ordinary live-update latency. The E2E log pastes the server's request/broadcast log showing the
  core `["docs"]` invalidation and the plugin refetch that followed it, plus before/after
  screenshots. This is the defect the fingerprint exists to prevent, and asserting it in a unit test
  alone does not demonstrate it — the whole failure lives in the wiring between two caches.

TEST-510: A toggle made through the plugin route or CLI still updates them
  Given: The same board
  When: `corpus todos check <doc> <item>` is run, and separately `PUT /:docId/items/:index` is called
  Then: Both surfaces update live, exactly as they do today. The existing invalidation path
  (`server/routes.ts:143`) is **intact** — the fingerprint is added beside it, not instead of it.
  Breaking the shipped path while fixing the new one is a fail.

TEST-511: The fingerprint is real, and derived from what actually moves
  Given: The implementation
  When: The query key is inspected and exercised
  Then: It is keyed on an `(id, updated)` fingerprint taken from a `useDocs({type: "todo"})` call, so
  a core-path body edit changes `updated`, changes the key, and refetches. A key that is constant, or
  keyed on something a core write does not touch, passes TEST-507 and fails TEST-509 — this test
  exists so the mechanism is checked directly rather than inferred from the symptom.

TEST-512: The aggregate is one request, not N+1
  Given: A workspace with ten todo documents
  When: The column renders and then a single document changes
  Then: The initial render issues **one** aggregate request, not one per document; the change issues
  one refetch, not ten. The server-side aggregation goes through the plugin's own `GET /lists` route
  (`server/routes.ts:151-158`), which already lists todo documents with open/done counts. The
  network log is pasted. Losing the one-query property is the cost the design explicitly set out to
  avoid paying.

TEST-513: Overdue treatment survives the storage change
  Given: An item whose inline `(due: …)` marker is in the past and one whose marker is in the future
  When: Both are shown in the column and in the list row
  Then: Only the past one gets the overdue treatment, in **both** surfaces — the `data-overdue`
  attribute and CSS class (`TodosColumn.tsx:102,108`, `TodoListItem.tsx:123`) behave as they do
  today, now driven by the parsed inline marker. `dueCount`/`isOverdue` keep their shipped semantics
  (`items.ts:297-305`).

TEST-514: Every assertion PLUGINS-005 marked `TRANSITIONAL` is restored
  Given: PLUGINS-005's E2E log listing each relaxed assertion with its original expectation quoted
  (Adjudication 8)
  When: This issue lands
  Then: **Every one is restored to its original strength** and green, and the log names them
  one-for-one against PLUGINS-005's list. The orchestrator does not close this wave with a
  `TRANSITIONAL` marker outstanding — that is the entire price of the exception, and TEST-578 is
  where it is collected.

TEST-515: `packages/kit` is untouched
  Given: `git diff packages/kit` at the end of the session
  When: Inspected
  Then: **Empty.** `usePluginQuery` and `useDocs` are kit surface owned by ui-dev; the fingerprint is
  expressed at the plugin's **call site**, through the shipped API. If it cannot be — if the key
  cannot be composed without changing kit — that is an **escalation to the orchestrator**, not an
  in-place edit, and the issue stops there (this is the same standing rule as `packages/contract`).

TEST-516: The file split with PLUGINS-006 held
  Given: Both issues landed
  When: `git status --porcelain` and the two diffs are inspected
  Then: PLUGINS-007 touched none of `manifest.ts`, `ui/TodoView.*`, or the e2e spec; PLUGINS-006
  touched none of `ui/TodosColumn.*`, `ui/TodoListItem.*`, `ui/queries.*`, or `server/routes.ts`
  (**Adjudication 6**). `items.ts` is untouched by both (**Adjudication 7**) — it was frozen when
  PLUGINS-005 landed, and an agent that needs to change it has found something the staging did not
  anticipate and escalates instead.

---

### CLI-012: declared plugin seed templates actually get installed

**Stage D, independent.** `apps/cli/src/commands/init/`, `apps/cli/src/commands/workspace/upgrade.ts`,
`apps/cli/src/template/`. Model: **opus**. Port `9186`. Spec: `SPEC.md` §10 (plugin assets), §11
(template pre-fill).

Found by PLUGINS-002: `plugins/todos/types.yaml:12` declares `seedTemplate: seeds/todo-template.md`
and the file ships, but `corpus init` copies `plugins/*/skills/` only — so the template is declared,
shipped, and never installed. This issue extends the existing plugin-**skill** install path to a
second asset kind, recorded in `template-manifest.json` with the `source: "plugin:<dir>"` marker so
`workspace upgrade` refreshes it exactly like a plugin skill, under CLI-005's never-clobber rules.

#### The SHARED-003 ledger residue, folded in

The SHARED-003 review ledger (`issues/shared/003-pr11-review-followups.md:68-69`) parked two small
items for "the next upgrade-touching issue". This is that issue, and **Adjudication 10** rules them
in. Both were checked at contract time, and the ledger's description of the first one is now
narrower than it reads:

- **`init` already writes it.** `apps/cli/src/commands/init/scaffold.ts:265-270` writes one
  `.gitkeep` per `QUEUE_EVENT_STATUSES` entry, and that constant already contains `deferred`
  (`packages/contract/src/schemas/queue.ts:42-49` — six statuses), with
  `apps/cli/src/commands/init/index.test.ts:95-98` and `scaffold.test.ts:102,118` pinning it. So a
  **fresh** workspace is fine.
- **`workspace upgrade` does not.** `/usr/bin/grep -n 'gitkeep\|queue' apps/cli/src/commands/workspace/upgrade.ts`
  returns **nothing**. A workspace created before CONTRACT-021 therefore never gains
  `.corpus/queue/deferred/.gitkeep`, so the directory does not survive a clone and the queue's
  deferred state has nowhere to live on a fresh checkout. That is the actual gap.
- **The gitignore comment is stale.** `assets/workspace/gitignore:18-21` still says the server moves
  event files "between these **five** directories". There are six. SHARED-003 folded this into
  AGENT-005, which landed without it; it is a comment-only fix and it belongs beside the `.gitkeep`
  work.

TEST-517: A fresh workspace arrives with the todos template installed
  Given: `corpus init --port 9186` in a scratch workspace, from a cwd outside this repository
  When: The workspace is inspected
  Then: The todos seed template exists at the workspace's template location, and
  `corpus doc list --type template --json` lists a template document carrying `for: todo`. "The file
  is on disk" alone is not the criterion — an installed template that the projection never indexes
  is not installed for any purpose the user has.

TEST-518: The installed template is byte-identical to the plugin's source
  Given: The installed file and `plugins/todos/seeds/todo-template.md`
  When: Compared with `diff`
  Then: **Identical.** This issue installs whatever the plugin ships and asserts nothing about its
  content — which is what makes it order-independent with respect to PLUGINS-005, whose whole job is
  to change that content (TEST-490). A CLI test that pins the template's body text couples two
  issues that have no reason to be coupled and will fail on the merged tree.

TEST-519: `corpus doc create --type todo` uses it
  Given: The freshly initialized workspace
  When: `corpus doc create --type todo --title "Groceries"` is run
  Then: The new document's body is pre-filled from the template, per §11's template pre-fill. The
  created file is pasted. This is the issue's own acceptance criterion and the only end-to-end
  evidence that the install landed somewhere the system actually looks.

TEST-520: The manifest records the provenance the upgrade path needs
  Given: `.corpus/template-manifest.json` after init
  When: Read
  Then: The seed template's entry carries `source: "plugin:todos"` — the same marker plugin skills
  carry — so `workspace upgrade` can tell a plugin-provided asset from a core template and from a
  user's own file. The exact entry is pasted.

TEST-521: `workspace upgrade` refreshes it, and never clobbers a user edit
  Given: A workspace whose installed todos template has been **edited by the user**, and a second
  workspace whose copy is untouched but stale
  When: `corpus workspace upgrade` runs on each
  Then: The untouched-but-stale copy is refreshed to the shipped version; the **user-edited** one is
  left alone and the upgrade reports it as skipped/conflicting per CLI-005's shipped rules — the same
  treatment a user-edited plugin skill gets today. Both outcomes are pasted. Silently overwriting a
  user's edited template is the failure this test exists for.

TEST-522: A plugin that declares no `seedTemplate` installs nothing
  Given: A plugin whose `types.yaml` declares doc types with no `seedTemplate` key
  When: `corpus init` runs
  Then: No template is installed for it, no manifest entry is written, and no error is raised. The
  new code path is opt-in by declaration; over-reach here would install phantom templates for every
  plugin in the tree.

TEST-523: A declared-but-missing seed file fails loudly at the right time
  Given: A `types.yaml` declaring `seedTemplate: seeds/does-not-exist.md`
  When: `corpus init` runs
  Then: It **fails or warns naming the plugin and the missing path** — it does not silently skip, and
  it does not write a manifest entry for a file that is not there. Whichever behavior is chosen
  matches how the existing plugin-skill install path treats the same mistake, and the log states
  which and shows the parity.

TEST-524: `workspace upgrade` heals a pre-CONTRACT-021 queue skeleton
  Given: A workspace whose `.corpus/queue/` contains the five pre-`deferred` directories and their
  `.gitkeep`s but **no** `deferred/` — the shape a workspace initialized before CONTRACT-021 has
  When: `corpus workspace upgrade` runs
  Then: `.corpus/queue/deferred/.gitkeep` exists afterward, is tracked by git in that workspace, and
  survives `git clone` of the workspace to a second directory — pasted, because "the directory
  exists" and "a clone carries it" are different claims and only the second one is the gap. A
  workspace that already has all six is unchanged (idempotent), and the check is driven from
  `QUEUE_EVENT_STATUSES` rather than a hardcoded list, so the next status added does not reopen this.

TEST-525: The gitignore comment counts correctly
  Given: `assets/workspace/gitignore:18-21`
  When: Read
  Then: It no longer says "these **five** directories". It states the correct number, or — better —
  stops naming a number that a contract constant already owns. Comment-only; no behavior changes.
  `scripts/workspace-template.test.ts` stays green.

TEST-526: Blast radius, and the CLI surface is unchanged
  Given: The end of the session
  When: `git status --porcelain` and the regenerated `docs/cli.md` are inspected
  Then: Changes are confined to `apps/cli/**` and `assets/workspace/gitignore`. **No new verb and no
  new flag** — this issue changes what `init` and `upgrade` *do*, not what they accept — so
  `docs/cli.md` regenerates with an empty diff. `git diff SPEC.md` and `git diff packages/contract`
  are empty. A drill on port `9186` from outside this repository provides the evidence for TEST-517,
  TEST-519, TEST-521 and TEST-524.

---

### CLI-016: `corpus doc edit --extra key=value` — the agent can finally widen a column

**Stage C, second — after CLI-017 lands (Adjudication 11).** `apps/cli/src/commands/doc/edit.ts`
plus its tests and the regenerated `docs/cli.md`. Model: **opus**. Ports: server `9188`, Vite `5292`
(the board half of TEST-530 needs a browser — `CORPUS_SERVER_ORIGIN` exported and **proved**).

UI-019's escalation, sprint-016 TEST-455 and Adjudication 23: `SPEC.md:377` promises "@agent make the
finance column wider" works, and it cannot, because the agent is CLI-only and no CLI verb writes an
arbitrary `extra` frontmatter key. Everything under it already works — UI-019 proved end to end that
`PUT /api/docs/{id}` merges `{extra: {…}}` per RFC 7386, and the merge is
`apps/server/src/docs/update.ts:142-149`: *a named key replaces wholesale, `null` removes it, unnamed
keys are untouched byte-for-byte*. This issue is a verb surface over a working mechanism.

Three shipped facts:

- **The repeatable-flag pattern already exists.** `--add-tag` / `--remove-tag` (`edit.ts:193-204`)
  are `repeated: true` string flags; `--extra` follows that pattern and does not invent a new one.
  Today's flag set is `--title`, `--add-tag`, `--remove-tag`, `--status`, `--due`, `--reviewed`,
  `--evergreen` (`edit.ts:189-234`).
- **`extra` is `z.record(z.string().min(1), z.unknown())`** (`packages/contract/src/schemas/extra.ts:195-222`),
  and the contract **already enforces reserved keys** (`:200-207`, `RESERVED_FRONTMATTER_KEYS`) so
  `extra` can never shadow a core field. That enforcement is the backstop, not the UX (TEST-534).
- **`docs/cli.md` is generated** from the command registry (`apps/cli/src/docs/generate.ts:14-17`,
  `npm run docs:cli -w apps/cli`) and drift-checked (`scripts/generated-artifacts.ts:30-35`). It is
  regenerated, never hand-edited.

TEST-527: The flag exists, repeats, and looks like its neighbours
  Given: `corpus doc edit --help` after the change
  When: Read
  Then: `--extra <key>=<value>` is present, documented, and **repeatable** — two `--extra` flags in
  one invocation set two keys in one `PUT`, not two requests. It is declared through the registry
  with `repeated: true` exactly as `--add-tag` is, so it documents itself in `docs/cli.md` like every
  other flag.

TEST-528: A width written by the CLI actually widens the column
  Given: A pinned view document, a running server on `9188`, and the board open in a browser through
  the proved dev proxy on `5292`
  When: `corpus doc edit <viewDocId> --extra width=520 --from agent` is run
  Then: The view document's frontmatter carries the width **in the form UI-019's reader consumes**,
  the board's column changes width **over SSE with no reload and no UI change**, and the auto-commit
  is authored by `agent`. Screenshot before and after, plus the frontmatter, both pasted. This is the
  issue's whole point: `520` arriving as a string the reader ignores is a passing unit test and a
  broken promise, and only this test tells them apart.

TEST-529: The value grammar is total, documented, and stated
  Given: The chosen parsing rules
  When: `--help`, `docs/cli.md`, and the E2E log are read
  Then: The grammar is written down and covers **every** input: at minimum integers and decimals as
  numbers, `null` as deletion, and everything else as a string, with booleans decided either way and
  documented. No input is silently dropped or silently coerced into something the user did not type.
  If a way to force a string (`--extra note="520"` or similar) ships, it is documented; if it does
  not, the log states that a value that looks numeric cannot be stored as a string and judges that
  acceptable. **Adjudication 12**: the rules are the implementer's call within these bounds; TEST-528
  is the outcome that is not.

TEST-530: `null` deletes the key, per RFC 7386
  Given: A view document carrying `extra: {width: 520, note: "keep"}`
  When: `corpus doc edit <id> --extra width=null` is run
  Then: `width` is **gone** from the frontmatter — not set to `null`, not set to `"null"` — and
  `note` is untouched. This is the server's shipped merge semantics (`update.ts:142-149`) reached
  through the new flag, and the string `"null"` case is drilled explicitly because it is the obvious
  way to get this wrong.

TEST-531: The merge is a merge, not a replacement
  Given: A view document whose `extra` carries `pinned`, `order`, `query` and `width`
  When: `corpus doc edit <id> --extra width=640` is run
  Then: Only `width` changes; `pinned`, `order` and `query` are **byte-identical** afterward, and
  `git diff` in the workspace shows a one-line change. A CLI that reads, mutates and sends the whole
  `extra` object races anything else writing the document; a CLI that sends only the named keys does
  not. The log states which shape it sent.

TEST-532: Reserved keys are refused locally, naming the real flag
  Given: `corpus doc edit <id> --extra title=Nope`, `--extra status=archived`, `--extra due=2026-01-01`,
  `--extra tags=a`, and `--extra id=doc_x`
  When: Each is run
  Then: Each is refused **before any request is sent** — a usage error naming the real flag where one
  exists (`--title`, `--status`, `--due`, `--add-tag`/`--remove-tag`) and saying plainly that the
  field is not user-writable where none does (`id`, `type`, `created`, `updated`, `anchors`). Exit
  code follows the CLI's shipped usage-error convention and the log names it. The refusal list is
  derived from the contract's `RESERVED_FRONTMATTER_KEYS` (`extra.ts:200-207`), **not** hand-copied —
  a hand-copied list drifts the first time the contract adds a field.

TEST-533: The server backstop still works and is not relied on for UX
  Given: The same reserved-key attempt, forced past the local guard (or reasoned about in the log if
  it cannot be forced)
  When: It reaches `PUT /api/docs/{id}`
  Then: The contract refuses it. The local guard is a better error message for an agent that has one
  chance to read it, not a security boundary — and the log states that distinction, because an
  implementer who believes the CLI guard *is* the enforcement will be tempted to skip it "since the
  server checks anyway".

TEST-534: The §11 promise is kept, in the agent's own vocabulary
  Given: `SPEC.md:377` — "@agent make the finance column wider"
  When: The full path is walked: an agent, CLI-only, discovers the verb in `docs/cli.md`, finds the
  view document (`corpus doc list --type view`), and widens it
  Then: It works, using only commands `docs/cli.md` documents, with no HTTP call and no file edit.
  The commands and their real output are pasted. sprint-016 TEST-455 recorded this gap; this is the
  test that closes it, and walking the path as the agent would is what proves the verb is
  *discoverable*, not merely present.

TEST-535: No contract change
  Given: `git diff packages/contract` and `git diff packages/contract/openapi.json`
  When: Inspected
  Then: **Empty.** The issue's own summary says "No contract change expected; verify" — the
  verification is this test plus the confirmation that `extra` already accepts arbitrary keys and the
  `PUT` already merges them. If the implementing agent finds otherwise, that is an escalation, not an
  in-place edit (standing rule since sprint-008).

TEST-536: `docs/cli.md` regenerates and the hygiene inventories stay honest
  Given: `npm run docs:cli -w apps/cli`, then the drift check
  When: Run
  Then: `docs/cli.md` regenerates cleanly with the new flag documented, the drift check is green
  (`scripts/generated-artifacts.ts:30-35`), and `scripts/workspace-template.test.ts` is green with
  `CLI_COMMANDS_PENDING_CLI_006` still `[]` (`scripts/workspace-template.ts:216`) — **no allowlist
  entry added**. Permission for a skill to name a command comes from `docs/cli.md` documenting it,
  which regeneration supplies.

TEST-537: The `edit.ts` collision with CLI-017 was reconciled, not fought
  Given: CLI-017's `--status open` guard and this issue's `--extra` flag, both in
  `apps/cli/src/commands/doc/edit.ts`
  When: Both have landed
  Then: The file carries **both**, is internally consistent, and both issues' tests are green on the
  merged tree. Adjudication 11 sequences CLI-017 first and makes **this** agent the reconciler;
  reverting or weakening CLI-017's guard to reach a clean implementation is a fail.

---

### CLI-017: `corpus doc unarchive` — the recovery the agent is told to use

**Stage C, first — before CLI-016 (Adjudication 11).** `apps/cli/src/commands/doc/unarchive.ts`
(new), the doc command index, a guard in `edit.ts`, and the regenerated `docs/cli.md`. Model:
**opus**. Port `9190`.

The sprint-016 evaluator's MAJOR finding (`issues/evals/AGENT-P5W2-eval.md`, 2026-07-30): the comment
skill **and the server's own 409 message** both tell the agent to unarchive an archived skill, and
`corpus doc unarchive` does not exist. The route does — `POST /api/docs/{id}/unarchive`, handler at
`apps/server/src/docs/write-routes.ts:119-125`, calling `setArchived(workspace, mutex, actor, id,
false)`, which moves the skill folder back from `skills-archived/` to `skills/`
(`apps/server/src/docs/archive.ts:71-89`). The CLI-only agent simply cannot reach it. `archive.ts`
in the CLI (`:15-30`) is the shape to mirror: read the document first, then `POST`, then emit.

#### The `--status open` half-state, adjudicated: **refuse**

The near-miss today is `corpus doc edit --status open` on an archived document. It reports success
and produces a **half-state**: the frontmatter flips to `open` (`apps/server/src/docs/update.ts:125-151`)
while the folder stays in `skills-archived/` and the name stays 409-blocked. The issue offers two
fixes and recommends refusal. **Adjudication 13 decides: refuse**, for three reasons the implementing
agent does not need to re-derive:

1. **The half-state is a lie, and the lie is the bug.** A verb that reports success while leaving the
   document unreachable by the operation the user was trying to enable is worse than one that fails.
2. **`doc edit` is a frontmatter-merge verb; unarchiving is a filesystem move plus a name release.**
   Making `--status open` sometimes move directories — depending on hidden state the caller cannot
   see in the flag they typed — gives one flag two meanings.
3. **A refusal that names the verb is executable.** The agent is CLI-only and reads error messages
   as instructions; "use `corpus doc unarchive <id>`" turns a dead end into a next step, which is the
   entire complaint the evaluator filed.

No shipped caller depends on the half-state, so refusing breaks nothing.

TEST-538: The verb exists and round-trips the shipped route
  Given: An archived document, and a real server on `9190` in a workspace outside this repository
  When: `corpus doc unarchive <id>` is run
  Then: Exit 0; the response is the shipped route's response, emitted in the same shape
  `corpus doc archive` emits; `corpus doc show <id>` reports `status: open`. The CLI adds **no**
  logic of its own beyond the round trip — it mirrors `archive.ts:15-30`, and any behavior it
  invents is behavior the HTTP route does not have.

TEST-539: The folder moves back and the name is freed
  Given: An archived **skill** — the case the evaluator hit
  When: It is unarchived through the CLI
  Then: The skill directory is back under `.claude/skills/<name>/` and gone from
  `.claude/skills-archived/`; `corpus skill create <same-name>` now fails **as installed** rather
  than as archived (a different 409, or whatever the shipped create path returns for a live name);
  the skill is discoverable again; and the move is a single auto-commit. The directory listings
  before and after are pasted. Frontmatter alone is not the evidence — the half-state has correct
  frontmatter.

TEST-540: The instruction the agent is given is now executable verbatim
  Given: The server's 409 text (`apps/server/src/skills/create.ts` — "unarchive it to bring it
  back…") and the comment skill's genesis section
  When: `/usr/bin/grep -rn 'unarchive' assets/workspace apps/server/src/skills docs/cli.md` is run
  and pasted
  Then: Every place that tells the agent to unarchive names a command that `docs/cli.md` documents,
  spelled exactly as the CLI accepts it. An agent following the 409 message word for word succeeds.
  If the skill text needs a word changed to name the verb, that change is in scope here; if it needs
  more than a word, it is an AGENT issue and is escalated rather than improvised.

TEST-541: `doc edit --status open` on an archived document refuses
  Given: An archived document
  When: `corpus doc edit <id> --status open` is run
  Then: It **fails** — non-zero exit, nothing written, no commit — with a message naming
  `corpus doc unarchive <id>` as the thing to do instead (Adjudication 13). `git log` in the
  workspace shows no new commit and `git status` is clean.

TEST-542: The half-state is unreachable by any route
  Given: The fix
  When: Every way of setting `status` on an archived document through the CLI is tried — the flag
  directly, and any other verb that writes `status`
  Then: None of them produces a document whose frontmatter says `open` while its file sits in an
  archived location. The evaluator's original reproduction is re-run pre-fix and post-fix and both
  runs are pasted: the half-state observed, then refused.

TEST-543: Nothing else about `--status` changes
  Given: A **non-archived** document
  When: `corpus doc edit <id> --status open`, `--status archived`, and every other status the field
  accepts are run
  Then: All behave exactly as they do today. The guard is narrow — it fires only on the
  archived-document case — and a guard that has started refusing ordinary status edits has broken a
  shipped verb to fix a corner of it.

TEST-544: Unarchiving is sane at its edges
  Given: (a) a document that is not archived, (b) a document id that does not exist, (c) a document
  already unarchived by a concurrent call
  When: `corpus doc unarchive` is run against each
  Then: Each gets a clear, non-crashing outcome whose exit code follows the CLI's conventions —
  (a) either a no-op reporting it was already open or a refusal saying so, decided and documented;
  (b) the same not-found treatment `corpus doc archive` gives; (c) no corruption. The chosen (a)
  behavior matches whatever `corpus doc archive` does for an already-archived document, so the pair
  stays symmetric.

TEST-545: The destination-collision 409 surfaces, it does not crash
  Given: The server's collision guard at `apps/server/src/docs/archive.ts:108-114` — the destination
  folder already exists
  When: A collision is provoked and unarchive is attempted
  Then: The CLI reports the server's 409 with its message intact and a non-zero exit; it does not
  stack-trace, and it does not swallow the message into a generic failure. An agent that cannot read
  why it failed cannot recover.

TEST-546: `docs/cli.md` regenerates and the inventories stay honest
  Given: `npm run docs:cli -w apps/cli` and the drift check
  When: Run
  Then: `docs/cli.md` documents `corpus doc unarchive <id>` beside `corpus doc archive`, the drift
  check is green (`scripts/generated-artifacts.ts:30-35`), and
  `scripts/workspace-template.test.ts` is green with `CLI_COMMANDS_PENDING_CLI_006` still `[]`. This
  is what grants the skills permission to name the verb, and it is why TEST-540 can pass.

TEST-547: Blast radius, and no contract change
  Given: The end of the session
  When: `git status --porcelain` is inspected
  Then: Changes are confined to `apps/cli/**`, the regenerated `docs/cli.md`, and at most a word in
  `assets/workspace/**` per TEST-540. `git diff packages/contract` and `git diff apps/server` are
  **empty** — the route and the 409 message already ship; this issue reaches them, it does not change
  them. `git diff SPEC.md` is empty.

---

### SERVER-032: `needs=form` counts unanswered forms, not last speakers

**Stage D, independent.** `apps/server/src/docs/needs.ts` (+ the projection if it needs a linkage)
and colocated tests. Model: **opus**. Port `9192`. Spec: `SPEC.md` §6 (forms), §11 (Attention).

The Phase 4 evaluator's reproducible F-1 (`issues/evals/HARDENING-P4-eval.md`, 2026-07-29): a thread
carrying **two** unanswered forms leaves `needs=form` as soon as **either** is answered, while the
second is still answerable (`201`) and the renderer deliberately keeps it live (UI-013's finding-12
fix). The board stops telling the user about a question the app is still waiting on.

#### The detector, and why it does this

`apps/server/src/docs/needs.ts:58-86`:

```sql
(t.id IS NOT NULL AND t.status = 'open' AND t.last_author = 'agent' AND EXISTS (
  SELECT 1 FROM turns tu
   WHERE tu.thread_id = t.id AND tu.ts = t.last_ts AND tu.author = 'agent'
     AND tu.has_form = 1
))
```

It is not a form counter at all — it asks *"is the **last** turn an agent turn carrying a form?"*
Answering form 1 appends a user turn, so `last_author` becomes `user`, `t.last_ts` moves off the
form turn, and the whole predicate goes false while form 2 sits unanswered above it. That is a
faithful heuristic for the one-form case and simply the wrong question for any other.

#### The spec reading, done at contract time: **form-scoped. Decided.**

The issue says "decide with a SPEC reading; don't guess", and `SPEC.md:185` answers it:

> A form has no identity of its own: it is identified by the timestamp of the turn carrying it, so a
> turn carries **at most one form**, and answering a form addresses the turn that carries it.

Forms are identified **per turn**, and answering addresses **the turn that carries it** — not the
thread. A thread may therefore hold several forms, each independently answerable, which is exactly
what the renderer already does and what the answer route's `:ts` parameter already encodes.
**Adjudication 14: the detector is fixed; the spec is not changed and no "one form at a time" clause
is proposed.** The alternative would require the renderer to regress and the route's per-turn
addressing to become meaningless.

TEST-548: The evaluator's reproduction is reproduced first
  Given: A real server on `9192` and a thread with two agent turns, each carrying a form, neither
  answered
  When: The **first** form is answered and the document's needs reasons are read back
  Then: **Pre-fix**, `needs=form` is gone while `POST` to the second form's `:ts` still answers `201`
  — the defect, observed, with both outputs pasted. Per the SDLC's bug rule this reproduction is
  logged before any code changes, and it becomes the regression test.

TEST-549: The detector stays in `needs=form` while any form is unanswered
  Given: The same two-form thread, post-fix
  When: The first form is answered
  Then: The document **still** reports `needs=form`. The count of unanswered agent forms, not the
  identity of the last speaker, is what drives the reason.

TEST-550: Answering the last one clears it
  Given: The same thread with one form left
  When: It is answered
  Then: `needs=form` clears. The fix must not make the reason sticky — a detector that never clears
  is as wrong as one that clears too early, and it is the easier mistake to ship because every test
  about *staying* would still pass.

TEST-551: Order does not matter
  Given: The two-form thread
  When: The **second** form is answered first, then the first
  Then: `needs=form` holds after the first answer and clears after the second. Answering out of order
  is normal — the forms are independent by construction — and an implementation that assumes forms
  are answered in turn order passes TEST-549 and fails here.

TEST-552: Detector and renderer finally agree
  Given: A three-form thread with one, then two, then all three answered
  When: The board's Attention reason and the rendered thread are compared at each step
  Then: They agree at every step: the reason is present exactly while the renderer still shows an
  answerable form. This is the issue's actual acceptance criterion — the defect was a disagreement
  between two shipped components, and consistency is the thing being restored.

TEST-553: Nothing else about `needs` moves
  Given: A single-form thread, a thread with no forms, a resolved thread, and documents carrying
  each of the other `needs` reasons
  When: Their reasons are computed before and after the change
  Then: **Identical** in every case. `t.status = 'open'` still gates it, an agent form in a resolved
  thread still does not raise the reason, and the other reasons are untouched. `needs.ts` computes
  more than this one predicate and the blast radius must not exceed the one clause.

TEST-554: The spec was read, cited, and left alone
  Given: The E2E Verification Log
  When: Read
  Then: It quotes `SPEC.md:185` as the basis for the form-scoped reading (Adjudication 14) and
  `git diff SPEC.md` is **empty**. The issue offered "propose the SPEC clarification instead" as a
  branch; that branch is closed at contract time, and an agent that reopens it escalates rather than
  edits.

TEST-555: If the projection grew, it still rebuilds clean
  Given: Whatever linkage the fix needs to know which form turns are answered — the shipped
  `turns.has_form` column may be enough, or an answer-to-form linkage may have to be projected
  When: The choice is made
  Then: The log states which, and **if the projection schema changed**: `corpus db rebuild` followed
  by `corpus db doctor` is clean on a workspace built before the change, the rebuild reconstructs the
  new column from files alone, and no existing workspace needs manual repair. "`rebuild && doctor`
  clean" is the standing invariant (`SPEC.md` §14) and a schema change that skips it is not done.

TEST-556: Blast radius
  Given: `git status --porcelain`
  When: Inspected
  Then: Confined to `apps/server/**`. `git diff SPEC.md`, `git diff packages/contract` and
  `git diff apps/ui` are empty — the renderer is already correct (UI-013), which is precisely why
  this is a server issue.

---

### SERVER-037: a document nobody can ever read is never created

**Stage D, independent.** `apps/server/src/core/paths.ts` (folder validation) and colocated tests.
Model: **opus**. Port `9194`. Spec: `SPEC.md` §5 (the document tree), §9.2 (write paths).

Found by server-dev during SERVER-036's containment verification (2026-07-30), pre-existing.
`POST /api/docs` with `folder: ".claude/skills"` is **not refused**: `normalizeDocFolder`
(`apps/server/src/core/paths.ts:74-91`) resolves it inside the docs root to
`data/docs/.claude/skills/` — containment holds, nothing escapes — the file is written
(`apps/server/src/docs/create.ts:149`), **auto-committed** (`apps/server/src/docs/write.ts:155`),
and then the read-back at `create.ts:164` answers `404 no document with id doc_…` because
`classifyPath` (`apps/server/src/projection/roots.ts:126-141`) returns `null` for any path with a
dot-prefixed segment (`:135`). Net effect: a document created, committed to the audit trail, and
permanently invisible to every read surface.

The fix direction is the issue's own and is not in question: **refuse at validation time, before any
write** — a `400` naming `folder`. Reads should never have to learn about paths writes can produce
but the projection will not index.

#### One widening, ruled at contract time

`classifyPath:135` skips a segment when it `startsWith(".")` **or** when
`IGNORED_DIRECTORIES.has(segment)`. The issue names only dot-segments. A folder whose component
matches an ignored directory name reproduces **the identical bug through a different door** —
written, committed, unreadable. **Adjudication 15: the refusal covers every segment `classifyPath`
skips, derived from the same declaration** rather than from a second hand-maintained list, so the two
can never drift apart. Fixing half of a bug whose two halves share one line of code is not a fix.

TEST-557: The bug is reproduced before it is fixed
  Given: A real server on `9194`, a workspace outside this repository
  When: `POST /api/docs` is called with `folder: ".claude/skills"`
  Then: **Pre-fix**, the response is `404 no document with id doc_…`, the file exists under
  `data/docs/.claude/skills/`, and `git log` in the workspace shows the auto-commit that created it.
  All three pasted — SERVER-036's log recorded this and the SDLC requires it re-observed here before
  any code changes.

TEST-558: A dot-segment folder is a `400` naming the field
  Given: The same request, post-fix
  When: Sent
  Then: **`400`**, and the error names `folder` — so the caller learns which input was wrong, not
  merely that something was. Every dot-prefixed position is drilled: leading (`.claude`), nested
  (`notes/.hidden/x`), and the whole folder (`.foo`).

TEST-559: Nothing was written and nothing was committed
  Given: The refused request
  When: The workspace is inspected — `git log --oneline`, `git status --porcelain`, and a filesystem
  sweep under `data/docs/` with `/usr/bin/grep`/`find` for the refused path
  Then: **No file, no commit, no projection row, no id burned.** The refusal happens at validation,
  ahead of the write pipeline, so there is nothing to clean up. Checking the response alone is not
  enough here: the entire defect was a `400`-shaped outcome arriving *after* a successful commit, and
  the audit trail is the surface the bug actually damaged.

TEST-560: Every segment the projection skips is refused
  Given: `classifyPath`'s skip condition (`roots.ts:135`) — `startsWith(".")` **or**
  `IGNORED_DIRECTORIES.has(segment)`
  When: A folder is submitted for each ignored-directory name as a component, as well as for
  dot-prefixed components
  Then: All are `400` (Adjudication 15), and the validation derives its rule from the **same**
  declaration `classifyPath` uses — proved by a test that would fail if a new entry were added to one
  and not the other. Two lists that must agree, maintained separately, is how this bug comes back.

TEST-561: Legal near-misses are not over-refused, and they round-trip
  Given: Folders that merely resemble the refused shapes — `my.notes`, `v1.2`, `notes/2026.07`,
  `a.b/c.d` (dots present, never leading a segment) — plus an ordinary nested folder
  When: A document is created in each and then read back
  Then: All succeed, and each walks the **full write → commit → project → read** round trip: `200`,
  the file on disk, the auto-commit, a projection row, `GET /api/docs/{id}` returning it, and
  `corpus db doctor` clean. This is the issue's own "no over-refusal" criterion and it is deliberately
  a round-trip rather than a status-code check, because a folder that is accepted and then not
  indexed is the same bug wearing a different name.

TEST-562: Containment is not weakened on the way past
  Given: `normalizeDocFolder`'s existing `PathTraversalError` behavior and its tests
  (`apps/server/src/core/paths.test.ts:79-83,111-124,126-128`)
  When: `../../etc`, `data/docs/../../escape`, absolute paths, and `.`/`..` components are submitted
  Then: All still refused, with the **same** error class and the same treatment as today. The
  existing tests pass unmodified. A new validation layer added ahead of an old one is the classic
  place to accidentally short-circuit the old one.

TEST-563: Reads are left alone
  Given: `git diff apps/server/src/projection/`
  When: Inspected
  Then: **Empty.** `classifyPath` is not taught to index dot-segment paths — the issue's stated
  direction is that reads never learn about paths writes can no longer produce, and teaching the
  projection instead would make `.claude/` under `data/docs/` a supported location, which is a
  product decision nobody has made.

TEST-564: Any already-committed invisible document is recorded, not silently inherited
  Given: A scratch workspace exercised through the pre-fix reproduction, and a sweep of the drill
  workspace afterward
  When: The agent checks whether such documents can still exist from before the fix
  Then: The log states plainly that the fix is **forward-only** — it prevents creation and does not
  clean up anything already committed — and records whether a recovery path is needed (a `db doctor`
  warning, a cleanup verb) as a **finding for the orchestrator to file**, not as work done here.
  Scope discipline: the issue asks for a refusal, and inventing a migration inside it is how a P2
  becomes a P0.

TEST-565: Blast radius
  Given: `git status --porcelain`
  When: Inspected
  Then: Confined to `apps/server/src/core/paths.ts`, its colocated tests, and at most the
  `docs/create.ts` call site. `git diff SPEC.md`, `git diff packages/contract` and
  `git diff apps/ui` are empty. `400` is a status the create route already returns, so no contract
  change is required — verified, not assumed.

---

### UI-015: two more outcomes that die with their observer

**Stage D, independent.** `apps/ui/src/anchors/useAnchorLayer.ts` and
`apps/ui/src/thread/ThreadCard.tsx`, plus tests. Model: **opus**. Ports: server `9196`, Vite `5293`.

UI-012 established the mechanism and the fix: TanStack Query v5 drops **per-call**
`onSuccess`/`onError` when the observer tears down, so feedback attached that way vanishes if the
component unmounts mid-flight; hook-level `SettledCallbacks`
(`packages/kit/src/query/settledCallbacks.ts:1-25`) survive. Two call sites were out of UI-012's
scope and still report through per-call callbacks:

- **`useAnchorLayer.post`** (`apps/ui/src/anchors/useAnchorLayer.ts:425-451`) — thread-creation
  warnings and the failure toast.
- **`ThreadCard`'s resolve button** (`apps/ui/src/thread/ThreadCard.tsx:167-186`) — the
  resolved/reopened confirmation and its failure toast.

Both are safe today only because their surfaces happen to stay mounted. Close the reader while a
comment is in flight and the user is told nothing — the comment either landed or did not, and the
app is silent about which.

**The one subtlety:** `useAnchorLayer`'s callbacks do **two different jobs** in one closure —
notification (`onNotify`) *and* local state cleanup (`setOptimistic(...)`, clearing the optimistic
chip). Only the first must survive unmount. The second is meaningless after unmount and must not
fire there. A migration that moves the whole closure to the hook level trades a silent toast for a
state update on an unmounted component; a migration that moves only the notification is correct.
`ThreadCard`'s callbacks are notification-only and migrate wholesale.

TEST-566: A thread-creation warning still surfaces after the reader closes
  Given: A comment being created from a selection, with the server about to return **warnings**
  When: The reader is closed (unmounting the anchor layer) **before** the mutation settles
  Then: The warning toasts appear anyway, one per warning, with the same `code — detail` text they
  carry today (`useAnchorLayer.ts:433-437`). The test pins the teardown path explicitly: unmount,
  then settle, then assert the notification.

TEST-567: A thread-creation failure still surfaces after the reader closes
  Given: The same flow with the request about to fail
  When: The reader is closed before it settles
  Then: The `Comment failed — <message>` toast appears, with the server's message intact. Silence
  here is the worst outcome of the three — the user believes their comment was posted.

TEST-568: The optimistic cleanup does not run on a dead component
  Given: The same teardown
  When: The mutation settles after unmount
  Then: **No** state update is attempted on the unmounted anchor layer — no React warning, no
  `setOptimistic` call — while the notification from TEST-566/567 still fires. The two halves of the
  old closure ended up in different places, and this is the test that proves the split was made
  rather than skipped.

TEST-569: `ThreadCard`'s resolve and reopen both survive teardown
  Given: A resolve in flight, then separately a reopen in flight
  When: The card unmounts before either settles
  Then: The corresponding toast still fires, with today's exact wording preserved — "Thread resolved
  — committed. Replying reopens it." and "Thread reopened — committed."
  (`ThreadCard.tsx:171-176`) — and the failure branch preserves `Resolve failed — …` /
  `Reopen failed — …`. All four paths are covered; the wording is user-visible text and this issue
  has no mandate to change it.

TEST-570: Nothing changes while mounted
  Given: Both call sites with their components mounted, in the normal case
  When: Success and failure are exercised
  Then: Behavior is **identical** to today — same toasts, same tones, same optimistic-chip clearing,
  same ordering, no duplicates. A hook-level callback that also fires the old per-call one produces
  two toasts, and that is the obvious regression to ship here.

TEST-571: The shipped pattern is reused, not reinvented, and the blast radius is two files
  Given: The diff
  When: Inspected
  Then: Both sites use the **existing** `SettledCallbacks` surface from `@corpus/kit`
  (`packages/kit/src/query/settledCallbacks.ts`), so `git diff packages/kit` is **empty** — this
  issue applies UI-012's shipped mechanism to two call sites and adds no new mechanism. Changes are
  confined to the two files plus tests; the tests mirror UI-012's teardown technique
  (`apps/ui/src/anchors/useAnchorLayer.test.tsx:234-297`) rather than inventing a second one.
  `git diff SPEC.md` and `git diff packages/contract` are empty.

---

## Cross-Issue Tests

TEST-572: No agent edited SPEC.md
  Given: `git diff SPEC.md` across all nine issues
  When: Inspected
  Then: **Empty.** Every spec sentence this batch implements was signed off and applied on
  2026-07-30 (SHARED-005: §12 ×2, §15 M6, §7 ×5, §9.2 ×2); there is nothing left to add. Anything
  §12 or §15 appears to be missing is an escalation to the orchestrator, routed to spec-writer with
  user sign-off, never patched in passing.

TEST-573: No workspace was scaffolded into the dev repo
  Given: `ls -d /Users/theophanerupin/code/corpus/.corpus` at the end of each session
  When: Run
  Then: Absent — "No such file or directory", pasted. Verified absent at contract time. Every drill
  ran from a cwd outside this repository (**Adjudication 18**). This is the CLI-014 incident's direct
  check and it is not optional for any issue in this batch, including the ones that never run
  `corpus init`.

TEST-574: No agent amended `packages/contract` in place
  Given: `git diff packages/contract`
  When: Inspected
  Then: **Empty.** CLI-016 was verified at contract time to need none (`extra` is already
  `z.record(z.string().min(1), z.unknown())` and the `PUT` already merges per RFC 7386); CLI-017's
  route already ships; SERVER-037's `400` is already a declared response. Standing rule since
  sprint-008: if an agent finds otherwise, it escalates.

TEST-575: No agent ran a state-changing git command
  Given: Every agent's transcript and the repository's reflog
  When: Audited
  Then: No `git commit`, `push`, `checkout`, `reset`, `stash`, `mv`, or `rm` by an implementing agent
  in **this repository**. Git activity inside a scratch workspace is the *server's* own auto-commit
  and is expected — that is what TEST-476, TEST-497 and TEST-559 read.

TEST-576: The repository is clean of scratch escape
  Given: `git -C /Users/theophanerupin/code/corpus status --porcelain` at the end of each session
  When: Read
  Then: Only intended source edits. No `data/`, no `.corpus/`, no `.claude/skills/` entries, no
  clobbered `README.md`/`.gitignore`, no stray coverage or Playwright output, no `corpus-*.tgz`.
  Pasted by **every** agent.

TEST-577: Ports and processes are clean, and `8765` was never touched or proxied
  Given: The end of each session
  When: `lsof -nP -iTCP:<port> -sTCP:LISTEN` is run for each allocated server port, each Vite port,
  and for `8765`
  Then: Nothing bound that the agent started; no orphaned vitest or Playwright workers
  (`ps aux | grep -E 'vitest|playwright'`); and whatever is on `8765` is **exactly as it was** —
  never bound, never killed, **never proxied into**. Each of the four agents that started a Vite dev
  server (PLUGINS-006, PLUGINS-007, CLI-016, UI-015) pastes its `CORPUS_SERVER_ORIGIN` export **and**
  the request that proves the proxy answered from its own server (**Adjudication 2**). This sprint's
  exposure is the worst yet: PLUGINS-006 drives the core editor's autosave against real documents.

TEST-578: The PLUGINS chain is coherent on the merged tree, with no `TRANSITIONAL` left
  Given: PLUGINS-005, 006 and 007 all landed
  When: `plugins/todos` is inspected and its scoped suite is run on the merged tree
  Then: One storage format, one manifest with three slots and no `View`, both row surfaces sourced
  from the body, and **every assertion PLUGINS-005 marked `TRANSITIONAL → PLUGINS-007` restored to
  its original strength** (Adjudication 8, TEST-514). The exception PLUGINS-005 was granted is paid
  back here or the wave does not close. `imports.test.ts` is green and unmodified;
  `parity.test.ts` is green; `PLUGINS-003` — the umbrella — is closable, and the orchestrator closes
  it when PLUGINS-006 lands, per its own "stays open as the umbrella" note.

TEST-579: Generated artifacts regenerate cleanly at harvest
  Given: The merged tree, on which **three** issues may have regenerated `docs/cli.md` — CLI-016
  (`--extra`), CLI-017 (`doc unarchive`), and PLUGINS-005 if its migration policy shipped a verb
  When: The orchestrator runs the generated-artifact drift checks (`scripts/generated-artifacts.ts:30-35`)
  for `docs/cli.md` and `openapi.json`
  Then: **Green.** `docs/cli.md` is regenerated from the registry on the merged tree, never
  hand-merged (**Adjudication 20**) — a hand-reconciled generated file is drift by construction.
  `openapi.json` has no reason to move at all: no issue in this batch changes the API surface, so any
  diff there is a symptom of something nobody intended.

TEST-580: The repo-wide gate passes at harvest
  Given: The merged tree
  When: The orchestrator runs the single repo-wide `npm run coverage`
  Then: Lint, format, typecheck, unit tests, e2e and the ≥90% four-metric merged gate all pass, with
  **no new per-path exemption** added to `scripts/coverage-config.ts` (**Adjudication 17**). This is
  the batch's only repo-wide run and the only `npm run e2e` execution — and it is the first run that
  includes PLUGINS-006's new todos spec.

---

## Out of Scope

- **Any SPEC.md edit.** SHARED-005 applied nine amendments on 2026-07-30; the spec is ahead of the
  code, which is the *point* of this wave. Anything still wrong in it is a spec-writer rider at the
  phase PR.
- **Any in-place `packages/contract` amendment.** Standing rule since sprint-008.
- **Any `packages/kit` change.** PLUGINS-005's `validate` repointing needs none (`types.ts:100`
  already takes a whole `Doc`); PLUGINS-007's fingerprint is a call-site composition (TEST-515);
  UI-015 reuses UI-012's shipped `SettledCallbacks` (TEST-571). A kit change in any of the three is
  an escalation.
- **Re-opening PLUGINS-003's Candidate 3b** (items in the body, plugin keeps its `View`). The user
  confirmed Q3 on 2026-07-30: no shipped `View` consumer is required. It does not come back because
  the drill got hard.
- **A `View` for any other doc type**, or a replacement consumer for the `View` slot. §13's publish
  plugin is its natural first real consumer and is not this phase.
- **Fixing a core editor task-list or capture defect inside `plugins/todos`.** File it; escalate it
  (Open Conflict 1). PLUGINS-006's entire claim is that the plugin needs no such code.
- **A "one form at a time" spec clarification** for SERVER-032. `SPEC.md:185` already settles it
  form-scoped (Adjudication 14).
- **Cleaning up documents already committed into dot-segment folders** (SERVER-037). The fix is
  forward-only; a recovery path, if one is warranted, is a finding for the orchestrator to file
  (TEST-564).
- **Teaching `classifyPath` to index dot-segment paths** (TEST-563). That would make `.claude/` under
  `data/docs/` a supported location — a product decision nobody has made.
- **Changing the wording of any shipped user-visible toast** in UI-015. The issue is about *whether*
  feedback arrives, not what it says.
- **A global column-width default, a browser-local width, or a settings panel** (CLI-016's
  neighbourhood). Per-view frontmatter only, per sign-off item 3 of SHARED-004.
- **UI-016 (react-router v8) and SERVER-033 (@hono/node-server v2)** — deferred beyond Phase 5 per
  `issues/PLAN.md:192`.
- **Publishing to npm.** Still a user decision; the package name is still provisional.

---

## Integration Points

- **SHARED-005 → the whole PLUGINS chain.** The signed §12 doc-type bullet (`SPEC.md:403`), the
  signed §12 rendering bullet (`:404`) and the signed §15 M6 clause (`:460`) are the text all three
  issues implement, and the four closed design questions are its sign-off record.
  **Producer**: SHARED-005 (`done`). **Consumers**: PLUGINS-005, 006, 007.
- **PLUGINS-005 → PLUGINS-006 and PLUGINS-007.** The body format is the interface: task-list lines in
  body order, `(due: YYYY-MM-DD)` at end of line, no `ts`. 006 needs the text to be *in the body* for
  anchors to resolve at all; 007 needs it parseable from a server-side aggregate. Both consume
  `items.ts`'s parser and **neither modifies it** (Adjudication 7). Serialized by Adjudication 3.
- **PLUGINS-006 ∦ PLUGINS-007 — disjoint by ruling, not by luck.** 006 owns `manifest.ts`,
  `ui/TodoView.*` and the e2e spec; 007 owns `ui/TodosColumn.*`, `ui/TodoListItem.*`, `ui/queries.*`
  and `server/routes.ts`. Adjudication 6; TEST-516 checks it.
- **PLUGINS-005 → CLI-012, decoupled on purpose.** PLUGINS-005 rewrites
  `plugins/todos/seeds/todo-template.md`'s content (TEST-490); CLI-012 installs whatever that file
  contains and asserts only byte-identity (TEST-518). Because CLI-012 pins no content, **the two are
  order-independent** and may run in either order or in parallel. A CLI-012 test that pins the
  template's body breaks this and fails on the merged tree.
- **The core editor's GFM task-list support → PLUGINS-006.** `editor/markdown/schema.ts:78-79`,
  `parse.ts:166`, `serialize.ts:231`, and the kit's `markdown.css:103-104`. **Producer**: shipped
  (UI-006 lineage). **Consumer**: PLUGINS-006 — and this is the first time anything exercises it
  against real user documents, which is why TEST-476's byte-stability check lives in PLUGINS-005 and
  TEST-506's escalation path lives in 006.
- **`editorHandlesType` → PLUGINS-006.** `apps/ui/src/editor/DocEditor.tsx:45` excludes only `thread`
  and `view`, so `anchorsHost` (`reader/DocView.tsx:88-96`) becomes true for `todo` the moment the
  `View` registration goes. **Producer**: UI-014 (shipped). **Consumer**: PLUGINS-006. No `apps/ui`
  change is required — TEST-496 is that claim being observed for the first time.
- **Core vs. plugin cache invalidation → PLUGINS-007.** Core broadcasts `["docs"]`; the plugin
  broadcasts `[["lists"], ["lists", docId]]` (`server/routes.ts:143`). After PLUGINS-006 the ordinary
  toggle is a *core* write, so the plugin's cache stops hearing about item changes. The `(id,
  updated)` fingerprint is the join. **Producers**: core write path + PLUGINS-006. **Consumer**:
  PLUGINS-007, TEST-509.
- **CLI-017 → CLI-016**, in `apps/cli/src/commands/doc/edit.ts`. CLI-017 adds the archived-document
  guard; CLI-016 adds `--extra`. Same file. Serialized by Adjudication 11 with CLI-016 as the
  reconciler; TEST-537 checks it.
- **CLI-016/CLI-017/PLUGINS-005 → `docs/cli.md`.** Up to three issues regenerate the same generated
  file. It is regenerated on the merged tree at harvest, never hand-merged (Adjudication 20,
  TEST-579).
- **UI-019's read path → CLI-016.** UI-019 shipped the board's consumption of `extra.width` and
  proved `PUT /api/docs/{id}`'s RFC 7386 merge end to end. CLI-016 writes the same key from the other
  side, and TEST-528 joins them: the CLI write must produce the value *shape* UI-019's reader
  consumes. **Producer**: UI-019 (shipped). **Consumer**: CLI-016.
- **UI-012's `SettledCallbacks` → UI-015.** `packages/kit/src/query/settledCallbacks.ts:1-25`, the
  shipped hook-level mechanism. **Producer**: UI-012 (shipped). **Consumer**: UI-015, which adds no
  new mechanism (TEST-571).
- **UI-013's renderer → SERVER-032.** UI-013's finding-12 fix deliberately keeps every unanswered
  form live; the detector is the half that disagrees. **Producer**: UI-013 (shipped, correct).
  **Consumer**: SERVER-032, which changes the server only (TEST-556).
- **The Vite dev proxy → every agent that starts one.** Default target is `127.0.0.1:8765`; every
  agent overrides `CORPUS_SERVER_ORIGIN` and proves it (Adjudication 2).
  **Producer**: `apps/ui/vite.config.ts:14`. **Consumers**: PLUGINS-006, PLUGINS-007, CLI-016,
  UI-015, the evaluator.

---

## Open Conflicts — orchestrator decision required

### 1. A core editor defect would block PLUGINS-006 inside a domain that may not fix it (**P1 — ESCALATED, default supplied**)

The PLUGINS-003 design's blast-radius table marks `apps/ui` **"No, contingent"**: the editor already
handles GFM task lists in both directions, *so* no UI change is needed — "only if the wave-3 drill
finds a task-list round-trip or capture defect does a ui-dev issue get filed, on discovery". The
design deliberately did not pre-file that issue, because pre-filing would invent work the shipped
extensions may already do correctly.

Nobody has run it. `editor/markdown/schema.ts:78-79`, `parse.ts:166` and `serialize.ts:231` are read
evidence, not executed evidence, and PLUGINS-006 is the first thing that will ever round-trip a
task-list document through the editor and then anchor a comment inside one of its lines. If that
turns up a defect — a checkbox that does not survive serialization, a selection whose offsets are
wrong inside a list item, a capture that produces an untruthful quote — **PLUGINS-006 cannot close
and plugins-dev may not fix it** (Adjudication 9).

**Recommended default (proceed on this unless overruled):** the PLUGINS-006 agent **stops at
discovery**, records the defect reproducibly in its E2E log (exact input, exact serialized output,
exact failing step), escalates the same session, and marks the affected tests
`STRUCK → Open Conflict 1`. It does **not** work around it in the plugin and does **not** reach into
`apps/ui`. The orchestrator then rules between (a) spawning ui-dev on a filed `UI-0xx` inside this
wave — one more agent against the ~3 cap, and the chain's staging already frees a slot by then — or
(b) landing PLUGINS-006's manifest change and carrying the issue open into wave 4. **Cost of (a)**:
schedule pressure. **Cost of (b)**: the tree ships a todo doc type with no renderer and item comments
that do not fully work, which is worse than either endpoint — so (a) is the better default *if a
defect appears at all*, and the most likely outcome remains that none does.

### 2. SERVER-032 may need a projection schema change (**P2 — ESCALATED, default supplied**)

The detector's fix needs to know **which form turns have been answered**. The projection today stores
`turns.has_form` per turn (`needs.ts:72-80`) and the answer route addresses a form by its turn
timestamp (`POST /api/threads/:id/turns/:ts/form`), but whether the *linkage* from an answer back to
the form it answers is projected — or is merely derivable by counting — was not established at
contract time.

If it is derivable (count agent form-turns against answer-turns, given that a form is answerable at
most once), the fix is a query change and nothing else. If it is not, SERVER-032 grows a projection
column, and a projection column means a schema change, a `db rebuild` path, and `db doctor` behavior
on every workspace built before it.

**Recommended default (proceed on this unless overruled):** the implementing agent takes whichever
shape the shipped projection actually supports, states it explicitly in the log (TEST-555), and — if
it changed the schema — proves `rebuild && doctor` clean on a pre-change workspace before declaring
done. It does **not** need to wait on a ruling to proceed. But it **reports the choice to the
orchestrator when it reports done**, because a projection migration in a P2 bugfix is exactly the
kind of change that should pull `/audit` in at harvest and would otherwise land unremarked.

### 3. PLUGINS-007's fingerprint may not be expressible through the shipped kit surface (**P2 — ESCALATED, default supplied**)

`usePluginQuery` and `useDocs` live in `packages/kit` and are ui-dev's. The design assumes the column
can key its plugin query on an `(id, updated)` fingerprint taken from a `useDocs` result — i.e. that
this is a **call-site** composition. That is very likely true, but it was not verified against kit's
actual query-key API at contract time.

**Recommended default (proceed on this unless overruled):** if the fingerprint cannot be composed
without changing kit, PLUGINS-007 **stops and escalates** rather than editing kit (TEST-515), and
marks TEST-509/511 `STRUCK → Open Conflict 3`. The orchestrator then rules between a small ui-dev
kit rider and carrying PLUGINS-007 into wave 4. Landing the column *without* the fingerprint is
**not** an acceptable fallback: it passes TEST-507 and TEST-508 while shipping a column that silently
goes stale on the app's most ordinary interaction, which is a worse product than the one we have.

---

## Orchestrator Adjudications (2026-07-30)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

1. **`8765` is never bound and never killed, by anyone.** The maintainer's personal server lives
   there. Every `corpus init` passes `--port` explicitly, because init's default probes upward from
   8765. Carried forward from sprint-015/016.
2. **`CORPUS_SERVER_ORIGIN` is exported before any Vite dev server starts**, pointing at the agent's
   own port, and the proxy target is **proved** in the E2E log. The highest-risk rule in this sprint:
   the dev proxy's default target is the maintainer's live server, and PLUGINS-006 drives the core
   editor's autosave against real documents.
3. **The PLUGINS chain is serialized: 005 alone and first, then 006 ∥ 007.** 006 and 007 both depend
   on the body format existing and on `items.ts` being settled. Running any of them early turns three
   verifiable steps into one unreviewable change.
4. **Migration policy is PLUGINS-005's decision.** Bulk verb and migrate-on-first-write are both
   acceptable; read-both-forever with no convergence is not. The decision is recorded with its
   reasoning (TEST-486) and clears the floor of TEST-487–489. This was explicitly kept out of the
   spec (SHARED-005 A1(c)) — it is an implementation choice, not a product one.
5. **`TodoListItem` belongs to PLUGINS-007**, with the column. It reads items off list rows
   (`TodoListItem.tsx:62`) for the same reason `TodosColumn` does and breaks for the same reason; the
   PLUGINS-003 design does not mention it, and §15 M6 as signed names "the todo list rows" as
   behavior that must return. One root cause, one fix, one fingerprint.
6. **PLUGINS-006 and PLUGINS-007 have a hard file split.** 006: `manifest.ts`, `ui/TodoView.*`, the
   e2e spec. 007: `ui/TodosColumn.*`, `ui/TodoListItem.*`, `ui/queries.*`, `server/routes.ts`.
   Worktree-isolated; neither touches the other's files (TEST-516).
7. **`items.ts` is frozen once PLUGINS-005 lands.** Neither 006 nor 007 modifies the format owner. An
   agent that needs to has found something the staging did not anticipate and escalates.
8. **The one named exception to Adjudication 19.** PLUGINS-005 may leave `TodoListItem` and
   `TodosColumn` reading an empty item list for body-stored documents, **provided** it (i) deletes no
   test, (ii) marks each relaxed assertion `TRANSITIONAL → PLUGINS-007` in its E2E log with the
   original expectation quoted verbatim, and (iii) PLUGINS-007 restores every one of them
   (TEST-514). The wave does not close with a `TRANSITIONAL` marker outstanding (TEST-578). This is
   an exception **by name**, not by category: no other issue may invoke it.
9. **PLUGINS-006 does not edit `apps/ui` or `packages/kit`.** A core defect is filed and escalated,
   never worked around inside the plugin (Open Conflict 1). The design's whole claim is that the
   plugin needs no such code, so a workaround falsifies the thing being verified.
10. **The SHARED-003 ledger residue lands in CLI-012.** The ledger parked it for "the next
    upgrade-touching issue" and this is it. Scope: the `workspace upgrade` gap for
    `.corpus/queue/deferred/.gitkeep` (TEST-524 — `init` already handles it) and the stale "five
    directories" comment in `assets/workspace/gitignore:18-21` (TEST-525). Both small, both checked
    at contract time, neither a licence to widen CLI-012 further.
11. **CLI-017 runs before CLI-016; CLI-016 is the reconciler.** Both edit
    `apps/cli/src/commands/doc/edit.ts` and both regenerate `docs/cli.md`. CLI-017 first because its
    guard is the smaller change and it is the evaluator's MAJOR finding. Reverting or weakening
    CLI-017's guard to reach a clean `--extra` implementation is a fail (TEST-537).
12. **CLI-016's value grammar is the implementer's call within stated bounds** — numbers, `null` for
    deletion, strings at minimum; documented and total (TEST-529). What is *not* the implementer's
    call is the outcome: `--extra width=520` must produce a value the board's shipped reader consumes
    and the column must actually widen (TEST-528).
13. **`corpus doc edit --status open` on an archived document REFUSES**, naming
    `corpus doc unarchive <id>`. The half-state is the bug; `doc edit` is a frontmatter-merge verb
    and unarchiving is a filesystem move plus a name release; a refusal that names the verb is
    executable for a CLI-only agent, which is the evaluator's whole complaint. No shipped caller
    depends on the half-state. **Decided, not escalated.**
14. **`needs=form` is form-scoped; SERVER-032 fixes the detector and the spec is not changed.**
    `SPEC.md:185` — a form "is identified by the timestamp of the turn carrying it… and answering a
    form addresses the turn that carries it" — settles the reading. The issue's "propose a SPEC
    clarification instead" branch is closed. **Decided, not escalated.**
15. **SERVER-037's refusal covers every segment `classifyPath` skips**, not just dot-prefixed ones —
    `roots.ts:135` skips `startsWith(".")` **or** `IGNORED_DIRECTORIES.has(segment)`, and both
    produce the identical write→commit→404 bug. The rule is derived from the same declaration, never
    a second hand-maintained list (TEST-560).
16. **Scoped tests only**, `VITEST_MAX_THREADS=4`, one workspace-scoped run per session maximum, one
    heavy command at a time; nobody runs `npm run e2e` or `npm run coverage`. Playwright, where
    needed (PLUGINS-006 only), runs scoped with `--workers=1` against the agent's own port. The
    orchestrator's harvest run is the single repo-wide gate.
17. **No new per-path coverage exemption** in `scripts/coverage-config.ts`, in any issue.
18. **All scratch lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`**, one prefix per
    issue, never bare `/tmp`, never inside the repository, never glob-deleted; **every drill runs
    from a cwd outside this repository** and every agent verifies
    `/Users/theophanerupin/code/corpus/.corpus` is absent before declaring done (TEST-573).
19. **Deleting or weakening a test to reach green is a fail**, in every issue except Adjudication 8's
    named case. Deliberate inversions are listed in the E2E log with reasons and keep both branches
    covered. sprint-016 Adjudication 14 carries forward for `plugins/todos/imports.test.ts`
    specifically: its anchoring ban may be changed only deliberately, with its comment rewritten, and
    never deleted to accommodate a design — and under this design it should not need to change at all
    (TEST-492).
20. **`docs/cli.md` is regenerated, never hand-edited and never hand-merged.** Up to three issues
    touch it; whoever lands later regenerates on the merged tree and the orchestrator runs the drift
    check at harvest (TEST-579).
21. **`/usr/bin/grep` for every grep-based claim.** The `rtk` proxy has produced false negatives, and
    every "X appears nowhere" assertion in this contract is only as good as the search that backs it.
    The command is pasted with its output.
22. **UI evidence is two-part.** `apps/ui/playwright.config.ts:16-22` starts **no** workspace server,
    so a Playwright spec proves only the UI-observable half; the disk / git / lock / projection half
    comes from the manual real-app drill against the agent's own server. Neither is acceptance alone
    (carried forward from sprint-016 Adjudication 19).

---

## Merge order (recommendation)

1. **Stage A — PLUGINS-005, alone.** The storage change, landing green. Commit as `[PLUGINS-005]`
   before any other plugins work starts. Its `TRANSITIONAL` list is the handoff to stage B.
2. **Stage B — PLUGINS-006 ∥ PLUGINS-007** (two agents, worktree-isolated, hard file split per
   Adjudication 6). Rule **Open Conflict 1** the moment PLUGINS-006 reports a core defect, not at
   harvest.
3. **Stage C — CLI-017, then CLI-016** (serialized, Adjudication 11). Both regenerate `docs/cli.md`;
   CLI-016 reconciles `edit.ts`.
4. **Stage D — CLI-012, SERVER-032, SERVER-037, UI-015**, independent of everything and of each
   other. Slot them into whatever capacity stages A–C leave, staggered so end-of-session test runs do
   not collide. CLI-012 is order-independent with respect to PLUGINS-005 by construction (TEST-518).
5. **Respect the ~3-agent cap throughout.** Stage A makes it one; stage B makes it two plus at most
   one stage-D issue. Nine issues do not mean nine agents.
6. **Harvest** — the orchestrator regenerates `docs/cli.md` on the merged tree, runs the
   generated-artifact drift checks, then the single repo-wide gate (`npm run coverage`, including the
   one `npm run e2e` execution).
7. **Audit** — `/audit` qualifies for the PLUGINS chain (cross-cutting, storage-format change, >5
   files, reverses a prior decision) and for SERVER-032 if Open Conflict 2 resolved into a projection
   schema change.
8. **Close the umbrella** — mark `PLUGINS-003` closed when PLUGINS-006 lands, per its own note, and
   fold its acceptance criterion 2 into PLUGINS-006's evidence.
9. **Evaluate**, then route any spec rider the wave surfaced to spec-writer for the phase PR — noting
   that this wave is expected to surface **none**, because SHARED-005 was applied first.

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- **TEST-498 passes** — an item comment resolves on creation *and* after a round trip, with
  `corpus db doctor` clean. It is the single gate that separates the PLUGINS design from a demo, and
  no other combination of passing tests substitutes for it
- **No `TRANSITIONAL → PLUGINS-007` marker is outstanding** (Adjudication 8, TEST-514, TEST-578)
- PLUGINS-005's migration decision is recorded in its issue file with the option rejected and the
  reasoning, in terms of what a user with existing todo documents experiences
- Every UI-facing issue's E2E log contains both halves of Adjudication 22, including the proof that
  the dev proxy pointed at the agent's own server
- Both bug issues (SERVER-032, SERVER-037) carry a **pre-fix reproduction** in their logs, per the
  SDLC's bug rule
- `docs/cli.md` regenerates cleanly on the merged tree and `openapi.json` has not moved
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest with no new exemptions
- `git diff SPEC.md`, `git diff packages/contract` and `git diff packages/kit` are empty across the
  whole batch
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent, and
  `8765` is untouched and unproxied
- Every escalated Open Conflict is either ruled or explicitly carried to wave 4
