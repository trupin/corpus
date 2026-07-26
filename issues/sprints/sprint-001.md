# Sprint 001 — Phase 1 Foundations

**Issues**: SERVER-001, SERVER-002, UI-001, AGENT-001
**Domains**: server, ui, agent-runtime
**Date**: 2026-07-26
**Plan phase**: Phase 1 — Foundations

---

## Verification Environment (read this first)

Phase 1 has **no running Corpus server and no running Corpus UI** beyond what these
four issues themselves scaffold. SERVER-003 (Hono bootstrap), CLI-001/CLI-002
(`corpus` bin, `corpus init`), and SERVER-004/005 (projection, write paths) are all
Phase 2. Verification is therefore calibrated per issue as follows, and the
evaluator must not fail an issue for lacking an interface that does not exist yet.

| Issue      | What counts as the "real application" in this sprint                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER-001 | Real markdown files on a real disk in a real `git init` scratch workspace, driven by real `npx tsx` scripts against the built library. No mocked `fs`, no in-memory fakes, no test doubles.        |
| SERVER-002 | Same: real files, real edits written back to disk, real `git diff` used as the observation instrument.                                                                                            |
| UI-001     | Real `npm run dev -w apps/ui` on `:5173`, driven by real Playwright and real `curl`. Because no Corpus server exists, the proxy targets a **stub origin** (below) — a real HTTP server, not a mock. |
| AGENT-001  | File-tree inspection of `assets/workspace/` plus a **simulated install** (`cp -R` + the documented rename/filter rules) into a scratch directory. `corpus init` is CLI-002 and is not available.   |

**The UI-001 stub origin.** The implementing agent stands up a throwaway Node HTTP
server on `127.0.0.1:8765` that serves exactly two things: `GET /api/health`
returning a body conforming to the contract's `HealthSchema`
(`{status:"ok", version, uptimeSeconds, workspace}`), and `GET /events` emitting
SSE heartbeat comments every ~1 s with `Content-Type: text/event-stream`. This is a
real HTTP origin over a real socket — it proves the Vite proxy configuration, which
is the only thing UI-001 owns on that path. It is throwaway verification scaffolding
and **must not be committed** as product code.

**Deferred verification is recorded, not skipped.** Any acceptance test below that
cannot be executed in this sprint must be marked `DEFERRED → <issue>` in the issue's
E2E Verification Log with the reason. UI-001's health/SSE tests are re-verified
against the real server in SERVER-003; AGENT-001 is re-verified end-to-end in
CLI-002.

---

## Acceptance Tests

### SERVER-001: Document model core — parse/serialize, ids, validation

TEST-1: Byte-stable round-trip over a real corpus
Given: A `git init` scratch workspace whose `data/docs/` and `data/threads/` hold at
least these hand-written files, all committed: a minimal-frontmatter note; a
full-frontmatter note using every §5 field; a thread with three turns; a document
carrying plugin frontmatter keys (`publish:` with a nested mapping); a document with
YAML comments and non-default key order; a CRLF-line-ending file; a file with no
trailing newline; a file with a UTF-8 BOM; a file with astral-plane unicode in title
and body; a document with `due: null` and one that omits `due` entirely.
When: A real script reads every `.md`, runs `parseDocument` then `serializeDocument`
with no mutation in between, and writes the result back over the original file.
Then: `git status --porcelain` in the workspace prints nothing. Zero files differ.

TEST-2: Round-trip over this repository's real Claude Code frontmatter
Given: This repository's real `.claude/skills/**/SKILL.md` and `.claude/agents/*.md`
files (genuine Claude Code frontmatter carrying `name`/`description` and no Corpus
fields).
When: The same read → parse → serialize → write script runs over them.
Then: `git status --porcelain` for those paths is empty. Unknown top-level keys did
not trip validation and were preserved verbatim.

TEST-3: Targeted mutation changes only the targeted field
Given: A parsed document whose frontmatter has YAML comments, a non-alphabetical key
order, and a single-quoted string value.
When: One field (`title`) is changed through the supported mutation path and the
document is re-serialized.
Then: A line-by-line diff of before vs. after shows exactly one changed line — the
`title` line. Comments, key order, quoting style of untouched keys, and the entire
body are byte-identical.

TEST-4: Malformed input fails loudly, never silently
Given: Three files — one with no frontmatter fence at all, one with an opening `---`
and no closing fence, one with an empty block (`---\n---\n`).
When: Each is parsed.
Then: The first two raise a parse error naming the offending path and line; neither
yields an empty-frontmatter success. The third parses to an empty mapping and then
fails validation with findings naming the missing required fields — it does not
throw an unhandled exception.

TEST-5: Canonical frontmatter validates; plugin keys pass through
Given: A document declaring every §5 core field plus a top-level `publish:` mapping
and a top-level `name:`/`description:` pair.
When: The document is parsed and validated.
Then: Validation succeeds. The validated value exposes the core fields with their
declared types (`tags` an array, `evergreen` a boolean, `due`/`reviewed` nullable),
and re-serializing preserves `publish:`, `name:`, and `description:` verbatim.

TEST-6: Thread frontmatter adds the §6 fields
Given: A `type: thread` document with `parent`, `anchor`, and `agent: requested`, and
a second `type: thread` document that omits `agent`.
When: Both are validated as threads.
Then: The first validates with `agent` = `"requested"`. The second is rejected with a
finding naming `agent` (or, if the schema defines a default, the default is applied
in memory only and TEST-17 still holds for that file).

TEST-7: Turn parsing splits on the §6 heading grammar
Given: A thread body with a preamble paragraph before the first heading, then three
turns delimited by `## user · <ISO Z>` / `## agent · <ISO Z>` headings using U+00B7
MIDDLE DOT.
When: The body's turns are parsed.
Then: Three turns are returned in document order with their author, timestamp, and
body text; the preamble is not one of them and is preserved when the body is
rewritten.

TEST-8: Appending a turn guarantees a strictly greater timestamp
Given: A thread whose last turn timestamp is `2026-07-19T10:07:12Z`.
When: A turn is appended with an explicit timestamp equal to `2026-07-19T10:07:12Z`,
and separately with an explicit timestamp earlier than it.
Then: In both cases the resulting body's new heading carries a timestamp strictly
greater than `2026-07-19T10:07:12Z`, and re-parsing the body yields turn timestamps
that are unique and strictly increasing.

TEST-9: Deleting a turn removes exactly one turn by timestamp identity
Given: A thread with three turns.
When: The middle turn is deleted by its timestamp.
Then: Re-parsing yields two turns — the first and the third, unchanged in content and
order — and the operation reports that a turn was deleted. Deleting a timestamp that
is not present reports no deletion and leaves the body byte-identical.

TEST-10: A turn heading inside a fenced code block does not split a turn
Given: A thread with one turn whose body contains a fenced code block containing the
literal line `## user · 2026-01-01T00:00:00Z`.
When: The body's turns are parsed.
Then: Exactly one turn is returned, and its body still contains the fenced block
verbatim.

TEST-11: Generated ids match the prefix grammar and do not collide at scale
Given: Nothing.
When: A real script generates 10,000 ids for each of the `doc`, `th`, `anc`, `evt`
prefixes.
Then: All 40,000 match their prefix grammar, and within each prefix there are zero
duplicates.

TEST-12: Id generation honors a collision predicate and gives up loudly
Given: A collision predicate that reports the first three candidates as taken, and a
second predicate that reports every candidate as taken.
When: An id is generated with each.
Then: The first returns an id that the predicate reports as free. The second throws a
named id-generation error after a bounded number of attempts — it does not loop
forever and does not return a colliding id.

TEST-13: Ref extraction ignores code, honors aliases, and reports offsets
Given: A body containing `[[doc_a1b2c3]]`, `[[th_x9y8|as text]]`, two adjacent refs,
a `[[doc_ignored]]` inside a fenced block, a `` `[[doc_alsoignored]]` `` inside an
inline code span, and a malformed `[[unclosed`.
When: Refs are extracted.
Then: Only the refs outside code are returned, in source order, each with its id, its
alias (or none), and offsets that slice back to the exact matched text. The malformed
bracket produces no result and no throw.

TEST-14: Path conventions and containment
Given: A `type: thread` document with id `th_x9y8`; a `type: note` titled
"Mortgage Options — 2026!"; a note with no folder specified.
When: A workspace-relative path is computed for each, and separately the path parser
is given `data/threads/th_x9y8.md`, `data/docs/finance/mortgage.md`,
`../../etc/passwd`, `/etc/passwd`, and `data/docs/../../escape.md`.
Then: The thread maps to `data/threads/th_x9y8.md` (flat, regardless of any folder
hint). The titled note maps under `data/docs/` with a lowercased, hyphenated,
length-capped slug. The unspecified-folder note lands under `data/docs/inbox/`. The
first two parse inputs return a structured result naming their root and folder; the
last three are rejected — none produces a path escaping the workspace.

TEST-15: The validator produces an error for each §14 hard-failure rule
Given: For each rule below, a corpus fixture that violates exactly that rule and
nothing else: unparseable frontmatter; a missing required field; an `id` prefix that
disagrees with `type`; two documents sharing an `id`; a malformed anchor entry (key
not `anc_*`; empty `exact`; non-string `prefix`); two anchor entries with the same id
in one document; a thread whose `parent` names a nonexistent document; a thread whose
`anchor` names an anchor absent from its parent; two threads claiming the same anchor;
duplicate turn timestamps within one thread.
When: The corpus is checked.
Then: Each fixture yields at least one **error** finding whose code identifies that
rule and whose payload names the offending document. A clean corpus assembled from
the same fixtures with the violation removed yields zero errors.

TEST-16: Orphaned anchors and unresolved refs are warnings, never errors
Given: A corpus containing a well-formed anchor whose `exact` text does not occur in
its parent's body; an anchor entry with no thread referencing it; a body containing
`[[doc_neverCreated]]`.
When: The corpus is checked with a resolver supplied.
Then: Each of the three produces a **warning** finding and the check's error list is
empty. Re-running with no resolver supplied produces no resolution-dependent warnings
and still zero errors.

TEST-17: Reading does not materialize defaults into the file
Given: A committed document that omits `tags`, `status`, `anchors`, `due`,
`reviewed`, and `evergreen` entirely, and a second that writes `due: null`
explicitly.
When: Each is parsed (so defaults are applied for in-memory use), one unrelated field
is mutated on the first, and both are serialized and written back.
Then: The second file is byte-identical (`git status --porcelain` clean) and still
contains the literal `due: null`. The first file's diff contains only the mutated
field's line — no `tags: []`, `status: open`, `anchors: {}`, `due: null`,
`reviewed: null`, or `evergreen: false` line was added.

### SERVER-002: Anchor engine — text-quote resolution + reconciliation

TEST-18: Ladder rung 1 — contextual exact match wins
Given: A body in which the string `the rate` occurs three times, and a selector whose
`prefix` + `exact` + `suffix` concatenation occurs exactly once.
When: The selector is resolved.
Then: A range is returned whose slice equals `exact`, and it is the occurrence
surrounded by the declared prefix and suffix — not the first bare occurrence.

TEST-19: Ladder rung 2 — bare unique exact
Given: A selector with no prefix or suffix whose `exact` occurs exactly once in the
body.
When: The selector is resolved.
Then: The returned range slices back to `exact`.

TEST-20: Ladder rung 3 — fuzzy resolves a lightly edited body
Given: A body identical to the one a selector was captured from except that a few
characters inside the quoted sentence were changed (similarity comfortably above the
engine's threshold), such that neither rung 1 nor rung 2 matches.
When: The selector is resolved.
Then: A range is returned that covers the edited sentence, and the same call repeated
100 times returns the identical range.

TEST-21: Ladder rung 4 — orphan rather than guess
Given: A selector, and a body of entirely unrelated prose; separately, a body whose
nearest window scores just below the engine's stated threshold.
When: Each is resolved.
Then: Both return "unresolved". No spurious range is produced. A window scoring just
**above** the threshold does resolve — the boundary is exercised from both sides.

TEST-22: M1 matrix — edit strictly before the anchored range
Given: A real document on disk whose `anchors:` frontmatter quotes a sentence present
in its body, verified to resolve.
When: A real script inserts a new paragraph **above** the anchored sentence,
reconciles, and writes frontmatter + body back to disk.
Then: The report lists the anchor under `unchanged` or `remapped` (never `orphaned`);
the on-disk `exact` is byte-identical to what it was; the anchor resolves in the new
body to a range slicing back to the same sentence; `git diff` shows the body change
and, if and only if the surrounding context changed, the `prefix`/`suffix` lines.

TEST-23: M1 matrix — edit strictly after the anchored range
Given: The same document.
When: A paragraph is appended **below** the anchored sentence and the document is
reconciled and written back.
Then: The anchor is reported `unchanged`; `git diff` shows a change to the body only
— the anchor's `exact`, `prefix`, and `suffix` lines are untouched.

TEST-24: M1 matrix — edit inside the anchored range
Given: The same document.
When: Words inside the anchored sentence are changed, and the document is reconciled
and written back.
Then: The anchor is reported `remapped`; the on-disk `exact` now quotes the **edited**
sentence verbatim; the anchor resolves in the new body via rung 1 or rung 2.

TEST-25: M1 matrix — the anchored range is deleted
Given: The same document.
When: The whole anchored paragraph is deleted, and the document is reconciled and
written back.
Then: The anchor is reported `orphaned`; `git diff` shows **no change whatsoever** to
that anchor's frontmatter block — the last selector is preserved byte-for-byte for
history; nothing throws.

TEST-26: M1 matrix — only the surrounding context changes
Given: The same document.
When: The words immediately before and after the anchored sentence are rewritten
(the sentence itself untouched), reconciled, and written back.
Then: The anchor is reported `remapped`; `exact` is unchanged; `prefix` and `suffix`
on disk now quote the **new** surroundings, each no longer than the engine's stated
context window, clipped correctly at body boundaries.

TEST-27: Reconciliation is deterministic
Given: One `oldBody`, one `newBody`, and a map of at least five anchors including two
that orphan.
When: Reconciliation runs 100 times on those identical inputs.
Then: All 100 results serialize to byte-identical JSON — the anchors map and all three
report buckets, including their ordering.

TEST-28: The engine is pure
Given: The anchor engine's source modules and their transitive first-party imports.
When: Their import statements are inspected.
Then: None imports `node:fs`, `node:child_process`, `better-sqlite3`, or any runtime
value from the server's `core`/`projection`/`docs` areas (type-only imports are
permitted). No filesystem, git, database, or HTTP access occurs at any point.

TEST-29: Bounded work on a large document
Given: A ~1 MB body (a real file, e.g. `SPEC.md` concatenated to size) with 50
anchors distributed through it, and an edit applied to it.
When: Reconciliation runs once, timed.
Then: It completes in under one second on the implementing machine, and the measured
elapsed time is recorded in the E2E log.

TEST-30: Unicode safety
Given: A body containing astral-plane characters (e.g. emoji), combining marks, and
RTL text, with anchors whose `exact` and computed context sit adjacent to those
characters.
When: Resolution and reconciliation run.
Then: Every returned offset falls on a code-point boundary — no returned `exact`,
`prefix`, or `suffix` contains a lone surrogate — and slicing the body by the returned
ranges reproduces well-formed strings.

TEST-31: An already-orphaned anchor is never silently re-attached
Given: A document whose anchor does **not** resolve in `oldBody`, and a `newBody`
that happens to contain text similar to that anchor's `exact`.
When: Reconciliation runs.
Then: The anchor is reported `orphaned` and its selector is returned byte-identical to
the input — the engine did not fuzzy-match it onto the new body.

TEST-32: Reconciliation does not mutate its input
Given: An anchors map object.
When: Reconciliation runs and its result is modified by the caller.
Then: The original input map is unchanged (deep equality with a pre-call snapshot),
and the returned map is a distinct object.

### UI-001: App scaffold + design system

TEST-33: The dev server boots and the shell renders
Given: `npm run dev -w apps/ui` running, with the stub origin on `127.0.0.1:8765`.
When: Playwright opens `http://localhost:5173`.
Then: The page loads with no uncaught console error, and the top bar, the board
region, and the console strip are all present and visible in that document order.

TEST-34: Top bar content matches the design prototype
Given: The app open.
When: The top bar is inspected.
Then: A serif wordmark reads "Corpus" with a mono, uppercase eyebrow reading
"workbench"; a centered search affordance is a `button` (not an `input`) showing the
prototype's placeholder copy and a `⌘K` `<kbd>` hint; an accent-colored
"＋ Ask / Capture" button shows a `c` `<kbd>` hint. Neither the search button nor the
compose button has the `disabled` attribute or `aria-disabled="true"`, and clicking
each throws nothing (no-op is expected in this issue).

TEST-35: The board is a horizontal snap scroller
Given: The app open.
When: The board element's computed style is read.
Then: `overflow-x` is scrollable, `overflow-y` is `hidden`, and `scroll-snap-type` is
`x proximity`. The board occupies the flexible middle of the column layout (it grows;
the top bar and console strip do not).

TEST-36: The console strip pushes the board and never overlays it
Given: The app open.
When: The console strip's computed style and geometry are read.
Then: Its `position` is not `fixed` or `absolute`; it is a flex sibling of the board
in the same column; its top edge is at or below the board's bottom edge — the two do
not overlap. It renders as a single collapsed line.

TEST-37: The theme toggle cycles and repaints
Given: The app open with no persisted theme.
When: The theme toggle is clicked, and after each click `document.documentElement`'s
`data-theme` attribute and the computed `background-color` of `body` are read; the
toggle is clicked enough times to return to the starting mode.
Then: The attribute cycles through the three states with `system` represented by the
attribute being **absent** (not `data-theme="system"`); the `light` and `dark` states
produce different computed background colors, each equal to the `--bg` value declared
for that theme in `packages/kit/src/tokens.css`; the toggle exposes an accessible name
identifying the current mode.

TEST-38: The chosen theme survives reload with no wrong-theme flash
Given: The theme has been toggled to `dark`.
When: The page is reloaded and `document.documentElement.getAttribute("data-theme")`
is evaluated at the earliest opportunity after navigation.
Then: It already reads `dark` — the attribute is set before React mounts, not after —
and the rendered background is the dark `--bg`.

TEST-39: `system` mode defers to the OS preference, live
Given: The toggle set to `system` (no `data-theme` attribute present).
When: Playwright emulates `prefers-color-scheme: dark`, then `light`, without
reloading.
Then: The computed `body` background changes to the dark and light `--bg`
respectively, and no `data-theme` attribute is written at any point.

TEST-40: The token layer is complete and dark-parity
Given: `packages/kit/src/tokens.css`.
When: Its custom properties are compared against the four token blocks in
`design/index.html`.
Then: Every color, shadow, and type-family token declared in the prototype's `:root`
is declared in the kit's `:root` with an identical value; every one of those
properties also appears in the kit's `[data-theme="dark"]` block; the
`:root[data-theme="light"]` and `:root[data-theme="dark"]` blocks appear **after** the
`@media (prefers-color-scheme: dark)` block in source order.

TEST-41: No hard-coded colors in the app
Given: The `apps/ui/src` tree.
When: It is searched for CSS color literals.
Then: No hex color, `rgb(`, `rgba(`, or `hsl(` literal appears in any file under
`apps/ui/src` — every color reference goes through a `var(--…)` token.

TEST-42: Focus rings match the prototype
Given: The app open.
When: The compose button is focused via keyboard (Tab), and its computed style is
read.
Then: A `2px solid` outline in the `--accent` color is rendered with `2px` offset and
`4px` radius, and the same rule applies to inputs and `[tabindex]` elements.

TEST-43: Reduced motion is honored
Given: `packages/kit/src/tokens.css` / the app's global stylesheet.
When: The `@media (prefers-reduced-motion: reduce)` block is inspected.
Then: It disables the pulse animation and the column/row transitions with the same
`!important` declarations the prototype uses.

TEST-44: `/api` proxies through Vite
Given: The dev server on `:5173` and the stub origin on `:8765`.
When: `curl -sS http://localhost:5173/api/health` runs.
Then: It returns the stub's JSON body — `status: "ok"` plus `version`,
`uptimeSeconds`, and `workspace` — proving the request reached `:8765` through the
proxy.

TEST-45: `/events` proxies without buffering
Given: The same setup.
When: `curl -N http://localhost:5173/events` runs for several seconds.
Then: The response headers show `content-type: text/event-stream`, and heartbeat
frames arrive **incrementally** during the run — not all at once when the connection
closes. The observed timing (first frame within ~2 s) is recorded in the E2E log.

TEST-46: A failing health check fails soft
Given: The dev server running and the stub origin **stopped**.
When: `http://localhost:5173` is loaded.
Then: The shell still renders — top bar, board, console strip all present — and the
console strip shows a "server unreachable" notice. No React error boundary, no blank
page, no uncaught exception in the console.

TEST-47: The production build and strict typecheck pass
Given: A clean tree.
When: `npm run build` (dependency order, contract → kit → apps) then
`npm run typecheck` and `npm run build -w apps/ui` are run.
Then: All succeed. The `@corpus/kit/tokens.css` import resolves through the kit's
`exports` map under Node ESM resolution (a build that silently inlines a relative path
instead does not satisfy this). No `any` appears in `apps/ui/src` application code.

TEST-48: The router is mounted
Given: The app open.
When: `/` is loaded and then an unknown path such as `/nope` is loaded.
Then: `/` renders the board shell. The unknown path does not crash the app — it
renders the shell (with whatever fallback the implementer chose) rather than a blank
page or an uncaught router error.

### AGENT-001: Workspace template — skills layout, seed documents, config

TEST-49: The template tree is complete
Given: `assets/workspace/`.
When: Its tree is listed.
Then: It contains exactly, and no more than, the documented tree: `README.md`,
`gitignore`, `claude/skills/orchestrate/SKILL.md`, `claude/skills/comment/SKILL.md`,
`claude/agents/.gitkeep`, `data/docs/inbox/.gitkeep`,
`data/docs/templates/note.md`, `data/docs/views/attention.md`,
`data/docs/views/inbox.md`, `data/docs/views/open-threads.md`,
`data/threads/.gitkeep`.

TEST-50: No dot-prefixed names except `.gitkeep`
Given: The template tree.
When: Every entry name at every depth is inspected.
Then: No name begins with `.` except files named exactly `.gitkeep`. In particular
there is no `.claude/` and no `.gitignore` inside `assets/workspace/`.

TEST-51: No placeholder markers anywhere
Given: Every file in the template tree.
When: Their contents are searched.
Then: None contains `TODO`, `FIXME`, `XXX`, `<placeholder>`, `<fill me>`, or a
lorem-ipsum stand-in. Every file reads as finished, honest content a real operator
could receive today.

TEST-52: Every template document is a valid §5 document with a unique id
Given: Every `.md` file in the template tree.
When: Each is parsed with a real YAML library and validated against the §5 core field
set.
Then: Each has `id`, `type`, `title`, `created`, `updated`, `tags`, `status`,
`anchors`, and `evergreen: true`, with correct types; `created` and `updated` are
valid ISO-8601 UTC instants; every `id` is unique across the whole tree and matches
the contract's `DocumentIdSchema` pattern `^(doc|th)_[A-Za-z0-9]+$` (see
**Open Conflicts**, item 2 — the `doc_seed_attention` form in the issue's draft does
**not** match and must be corrected).

TEST-53: The three seed views are well-formed columns
Given: `data/docs/views/`.
When: The three view documents are parsed.
Then: There are exactly three, each `type: view` with `pinned: true`, each with a
non-empty one-paragraph body; their `order` values are the integers 1, 2, 3 with no
duplicates and no gaps; Attention carries `query: {needs: me}` with `order: 1`, Inbox
carries `query: {folder: inbox}` with `order: 2`, Open threads carries
`query: {type: thread, status: open}` with `order: 3`; every key used under `query`
is drawn from the SPEC §9.2 `GET /api/docs` parameter set (`q`, `type`, `status`,
`tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`,
`unread`, `needs`, `sort`); `folder` values carry no leading or trailing slash.

TEST-54: The note template declares what it is for
Given: `data/docs/templates/note.md`.
When: It is parsed.
Then: It is `type: template` with `for: note`. Every `type: template` document in the
tree declares a `for` field.

TEST-55: Both skill skeletons are valid and discoverable
Given: `claude/skills/orchestrate/SKILL.md` and `claude/skills/comment/SKILL.md`.
When: Each is parsed.
Then: A single YAML block carries both Claude Code's `name` and `description` and
Corpus's `id`, `type: skill`, `title`, `created`, `updated`, `tags`, `status`,
`anchors`, `evergreen`; `name` equals the containing directory name (`orchestrate`,
`comment`); no Corpus field is named `name`; the body contains the required section
headings and states the invariant that every mutation goes through the `corpus` CLI
and workspace files are never hand-edited.

TEST-56: The gitignore ignores runtime state and keeps the queue skeleton
Given: A scratch git repository whose `.gitignore` is a copy of the template's
`gitignore`, populated with `.corpus/cache.db`, `.corpus/jobs/x.jsonl`,
`.corpus/attachments/th_a/1/x.png`, `.corpus/locks/doc_a.json`, `.corpus/seen.json`,
`.corpus/HALT`, and `.corpus/queue/{pending,in-progress,processed,failed,abandoned}/`
each holding a `.gitkeep`.
When: `git status --porcelain --ignored` and `git check-ignore -v` are run.
Then: All six runtime-state paths are ignored; all five queue directories remain
trackable (not ignored) so a clone of a workspace still has the skeleton.

TEST-57: The workspace README teaches the operator loop in under a page
Given: `assets/workspace/README.md`.
When: It is read.
Then: It fits under roughly one page and explicitly covers: starting the server,
starting `claude` in the workspace, invoking `/orchestrate`, where the board is, the
HALT toggle, and the `corpus skill rollback <name>` recovery path.

TEST-58: The install contract is documented and cannot drift from the code
Given: `docs/workspace-template.md` (repo-side, **not** copied into workspaces) and
the template helper module's exported rename table and filter list.
When: The document and the exported values are compared.
Then: They agree exactly on the rename table (`claude/` → `.claude/`,
`gitignore` → `.gitignore`) and the filter list (`.gitkeep`), and the document
additionally enumerates what `corpus init` **generates** rather than copies:
`.corpus/config.json` (version, port, generated bearer token, `dataDir`), the
`.corpus/queue/{pending,in-progress,processed,failed,abandoned}/` skeleton, and
`git init` plus the initial commit. A test fails if the two ever diverge.

TEST-59: A simulated install produces a clean workspace
Given: An empty scratch directory outside the repository.
When: The template is copied there (`cp -R`), the rename table is applied, and every
`.gitkeep` is removed — exactly the procedure `docs/workspace-template.md` specifies
— then `ls -aR` is run.
Then: The result contains `.claude/skills/{orchestrate,comment}/SKILL.md`,
`.claude/agents/`, `data/docs/{inbox,templates,views}/`, `data/threads/`,
`.gitignore`, and `README.md`; there is no leftover `claude/` directory, no leftover
`gitignore` file, and no `.gitkeep` anywhere. The template contains no secrets, no
tokens, and no machine-specific absolute paths.

TEST-60: Prettier never rewrites the template's bytes
Given: A clean tree with the template committed.
When: `npm run format` (write mode) is run and then `git status --porcelain` is
checked.
Then: No file under `assets/workspace/` is modified — the `.prettierignore` entry
holds. `npm run format:check` also passes.

### Cross-issue integration

TEST-61: The seed documents pass the real validator
Given: The template tree from AGENT-001 and the document-model library from
SERVER-001, both landed.
When: A real script loads every `.md` in `assets/workspace/` (including both
`SKILL.md` files) through `parseDocument` and runs the corpus checker over the result.
Then: Zero **errors** are reported. Any warnings are enumerated in the E2E log with a
one-line justification each. This is the sprint's stand-in for `corpus doc check`,
which arrives with CLI-002 — record it in AGENT-001's log as such.

TEST-62: The checker composes with the real anchor resolver
Given: SERVER-001's checker and SERVER-002's resolver, both landed.
When: A real script injects SERVER-002's `resolveAnchor` as the checker's resolver
option and runs the checker over a scratch corpus containing one resolvable anchor
and one well-formed-but-unresolvable anchor.
Then: The call type-checks with no adapter, cast, or wrapper shim; the resolvable
anchor produces no finding; the unresolvable one produces exactly one **warning** and
zero errors. The two modules compose on their published signatures — a mismatch here
is an integration failure, not a preference.

TEST-63: The file-level frontmatter shape agrees with the wire contract
Given: SERVER-001's parsed-and-defaulted frontmatter for a document that omitted every
optional field.
When: The resulting value is validated against `@corpus/contract`'s
`DocFrontmatterSchema`.
Then: It passes without modification. (The contract's schema requires every core
field; the file-level schema is the pre-defaults form and must produce a
contract-valid value once defaults are applied — while TEST-17 still guarantees those
defaults never reach disk.)

TEST-64: Reconciled selectors agree with the wire contract
Given: SERVER-002's reconciliation output for a document with anchors, including one
whose recomputed context is empty (anchor at the very start of the body).
When: Each emitted selector is validated against `@corpus/contract`'s
`TextQuoteSelectorSchema`.
Then: All pass. Absent and empty-string `prefix`/`suffix` are treated equivalently by
the engine — an anchor at a body boundary is not confused with an anchor lacking
context.

TEST-65: The repo-wide gates stay green
Given: All four issues landed.
When: `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
and `npm test` are run from a clean tree, followed by `npm run e2e`.
Then: All pass, with no regression against the pre-sprint baseline, and combined
coverage remains at or above the repo's 90% gate. `npm run e2e` runs UI-001's
Playwright smoke spec rather than skipping for want of specs.

---

## Out of Scope

Nothing below is part of this sprint. An implementing agent that finds itself
building one of these has drifted; an evaluator that fails an issue for lacking one
is wrong.

**Server**

- The Hono app, HTTP routes, auth, and static UI serving — SERVER-003.
- The SQLite projection, FTS, `db rebuild` / `db doctor` — SERVER-004.
- Document and thread **write paths**, git auto-commit, author attribution, autosave
  squashing, the delete/archive cascade — SERVER-005/006. SERVER-001's turn helpers
  deliberately do **not** decide the "deleting the last turn deletes the thread"
  policy; SERVER-002 deliberately does **not** write anchors into frontmatter.
- The chokidar watcher, SSE invalidation, out-of-band edit reconciliation —
  SERVER-007.
- Queue endpoints, long-poll idle, locks, job logs — SERVER-008/009.
- Any filesystem, git, or database access from the anchor engine — permanently out of
  scope for that module (TEST-28).

**UI**

- Every real data query. UI-001 wires exactly one request: the health check.
  Columns, rows, readers, the editor, threads — UI-002 onward.
- The search overlay (UI-009) and the Ask/Capture composer (UI-010). Their top-bar
  buttons are affordances only in this issue and must not render as disabled.
- The console drawer's expanded state, job master-detail, live log streaming, HALT
  toggle, and drag-resize — UI-011. This issue ships the collapsed one-line strip as
  a static placeholder.
- The SSE bridge and TanStack Query invalidation wiring — UI-002. UI-001 only proves
  the `/events` proxy passes bytes through unbuffered.
- Real board columns and the "＋ New list" ghost column — UI-003.
- Merging Playwright coverage into the combined gate — INFRA-004.
- Mobile layouts — a stated product non-goal, not a deferral.

**Agent runtime**

- The actual behavioral prose of the orchestrate skill (AGENT-002) and the comment
  skill (AGENT-003). This issue ships honest skeletons: valid frontmatter, the
  required section headings, and the CLI-only invariant — nothing that pretends the
  loop works yet.
- `corpus init` itself, `.corpus/config.json` generation, bearer-token generation,
  `git init`, and the initial commit — CLI-002. AGENT-001 **documents** these as the
  contract CLI-002 implements; it does not implement them.
- Subagent persona documents (`type: agent-def`). The directory ships empty.
- A workspace-level `CLAUDE.md` — explicitly deferred to a follow-up AGENT issue.
- Plugin-supplied skills and seed documents — plugins ship their own (§10).
- `corpus workspace upgrade` — CLI-005.

**Everywhere**

- Attachments, forms in turns, read state, publish, todos.
- Performance work beyond the two bounded budgets named in TEST-29 (1 MB / 50
  anchors / < 1 s) and TEST-45 (first SSE frame within ~2 s).

---

## Integration Points

**SERVER-001 ↔ SERVER-002 — injected resolution (the only coupling between them).**
SERVER-001's corpus checker takes an optional `resolveAnchor` in its options and
produces resolution-dependent warnings only when one is supplied; SERVER-002 exports a
function with a compatible signature. Neither imports the other. Verified by TEST-62 —
they must compose on published signatures with no adapter. Both issues can therefore
land in either order and be verified independently, which is the point of the
injection.

**SERVER-001 / SERVER-002 ↔ `@corpus/contract` (already landed, CONTRACT-001) —
one definition per shape.** The contract owns the wire schemas. The server owns only
what is genuinely file-format-specific: round-trip provenance, path conventions,
turn-heading grammar, and the pre-defaults read shape. Concretely:

- Ids: `DocIdSchema` / `ThreadIdSchema` / `DocumentIdSchema` / `AnchorIdSchema` /
  `EventIdSchema` are the authority. `DocumentIdSchema` is
  `^(doc|th)_[A-Za-z0-9]+$`. **Server-side id validation must not be stricter than
  the contract's** — see Open Conflicts item 1.
- Frontmatter: `DocFrontmatterSchema` is the post-defaults shape (every core field
  required). The server's file-level schema is the pre-defaults shape plus
  passthrough. TEST-63 pins the relationship; TEST-17 pins that defaults never reach
  disk.
- Selectors: `TextQuoteSelectorSchema` (`exact` required and non-empty; `prefix` and
  `suffix` defaulting to `""`) is the authority for what reconciliation may emit.
  TEST-64 pins it.
- Anchor resolution results: `ResolvedAnchorSchema` already declares
  `range: {start, end} | null` and `orphaned: boolean` — SERVER-002's resolver output
  must map onto that without translation when SERVER-004 consumes it.
- If a shape needs to exist in both places, that is a contract issue (CONTRACT-002),
  not a second declaration. Escalate rather than duplicate.

**AGENT-001 → SERVER-001 — the seed corpus is the first real test corpus.** Every
document in `assets/workspace/` must parse and validate through the document-model
library with zero errors (TEST-61). This is the sprint's substitute for
`corpus doc check`, which does not exist yet. If a seed document cannot be made valid
without weakening the validator, the seed document is wrong — the validator is not
negotiable.

**AGENT-001 → CLI-002 — the copy contract.** `docs/workspace-template.md` is the sole
source of the rename table, the filter list, and the generate-don't-copy list.
CLI-002 copies the tree wholesale and applies those rules; it must encode no knowledge
of any individual seed file. TEST-58 makes the doc and the code inseparable; TEST-59
proves the procedure produces a correct workspace by hand today.

**AGENT-001 → SERVER-004 / UI-003 — the seed view query vocabulary.** Seed views'
`query` mappings use the SPEC §9.2 `GET /api/docs` parameter names verbatim so the UI
can hand a view's mapping to the collection endpoint with no translation layer. Those
parameters are **not yet declared in the contract** (that is CONTRACT-002), so SPEC
§9.2 is the authority for this sprint and TEST-53 validates against it. CONTRACT-002
must adopt these exact names.

**UI-001 → `@corpus/kit` → plugins — tokens live in the kit.** `packages/kit`
declares the token layer and exposes it at `@corpus/kit/tokens.css` through its
`exports` map; `apps/ui` imports it exactly once at the app root and declares no color
literal of its own (TEST-41). Plugins inherit theming for free by consuming the same
stylesheet. The four semantic roles are load-bearing for later issues and must be
preserved with their meanings documented in comments: `--accent` = agent /
interactive, `--signal` = needs-you / destructive, `--sepia` = the **dedicated
staleness axis** (never reused for anything else), `--good` = success / resolved.

**UI-001 → SERVER-003 — the proxy contract.** Vite proxies `/api` and `/events` to
`http://127.0.0.1:8765`. UI-001 proves the proxy config against a stub origin; the
same tests are re-run against the real server as part of SERVER-003's E2E log. The
health response shape UI-001 codes against is the contract's `HealthSchema`, which is
already landed — UI-001 must consume it through the generated typed client or the
contract's exported schema, never by hand-writing the response type.

**UI-001 → INFRA-004 — the first Playwright specs.** UI-001 creates
`apps/ui/e2e/` with real specs, which flips `npm run e2e` from "skipped, no specs" to
"runs". INFRA-004 then merges that coverage into the combined 90% gate. UI-001 must
leave `npm run e2e` green, not merely non-empty.

---

## Open Conflicts — orchestrator decision required before implementation

These are genuine conflicts between issues in this batch and already-landed code. The
recommendations below are what the acceptance tests above assume; if the orchestrator
decides otherwise, TEST-52 and TEST-63 must be amended to match.

**1. SERVER-001's proposed id regex is stricter than the shipped contract.**
SERVER-001's Technical Design specifies `^(doc|th)_[a-z0-9]{4,16}$`. The landed
`DocumentIdSchema` is `^(doc|th)_[A-Za-z0-9]+$` — it accepts uppercase and any
length. A document carrying a contract-valid id would fail server-side validation,
which is exactly the drift Architecture Decision 3 exists to prevent.
_Recommendation_: the server **generates** ids in the narrow 8-character lowercase
base32 form (a generation policy, freely stricter), but **validates** by importing the
contract's schemas unchanged. Never declare a second id pattern.

**2. AGENT-001's proposed seed ids are invalid under the shipped contract.**
The issue drafts `doc_seed_attention`, `doc_seed_inbox`, `doc_seed_open_threads`,
`doc_seed_template_note`, `skill_orchestrate`, `skill_comment`. Two problems:
`DocumentIdSchema` allows no underscore after the prefix, so every
`doc_seed_*` form fails; and `skill_` is not a defined id prefix at all — §5 defines
ids as `doc_*` for documents and `th_*` for threads, and `skill` is a *type*, not a
prefix. AGENT-001's own text anticipates this ("escalate to the orchestrator rather
than inventing a variant").
_Recommendation_: use fixed, readable, contract-valid `doc_*` ids —
`doc_seedattention`, `doc_seedinbox`, `doc_seedopenthreads`, `doc_seedtemplatenote`,
`doc_skillorchestrate`, `doc_skillcomment`. They stay stable and human-referenceable,
they match the shipped schema, and skills correctly carry `doc_` ids with
`type: skill`. TEST-52 assumes this resolution.

**3. Selector optionality differs between the engine's draft types and the
contract.** SERVER-002's design types `prefix`/`suffix` as optional
(`prefix?: string`); the contract defaults them to `""`, so post-parse they are always
strings. _Recommendation_: the engine accepts both absent and `""` on input and always
**emits** strings, so its output satisfies `TextQuoteSelectorSchema` directly. TEST-64
assumes this. An anchor at a body boundary legitimately has an empty context and must
not be confused with an anchor that never had context (an edge case SERVER-002's own
issue already calls out).

---

## Done Criteria

This sprint is complete when:

- All 65 acceptance tests above PASS in the evaluator's verdict, or are explicitly
  recorded as `DEFERRED → <issue>` per the Verification Environment rules with a
  stated reason.
- The three Open Conflicts have an orchestrator decision recorded, and the
  implementations follow it.
- Every issue's E2E Verification Log is filled with concrete evidence — real commands,
  real observed output — including the model each implementing agent ran on.
- `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
  `npm test`, and `npm run e2e` all pass from a clean tree, with combined coverage at
  or above 90%.
- The pr-reviewer verdict on the phase PR is APPROVE, with all CRITICAL and MAJOR
  findings fixed or explicitly waived by the user.
- No throwaway verification scaffolding (the UI-001 stub origin, scratch workspaces,
  one-off tsx scripts) is committed as product code.
