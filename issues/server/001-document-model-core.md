# [SERVER-001] Document model core: parse/serialize, ids, validation

## Domain

server

## Status

done

## Priority

P0

## Model

opus — well-specified formats; the spec pins every field.

## Dependencies

- Depends on: SHARED-001
- Blocks: SERVER-004, SERVER-005

## Spec References

- SPEC.md §5 — "The document model" (canonical frontmatter, ids, inline refs, staleness fields)
- SPEC.md §6 — "Threads and anchors" (thread fields, turn format, anchor entries)
- SPEC.md §14 — "Validation and git hooks" (`doc check` rules: what fails vs. what warns)
- CLAUDE.md — Architecture Decision 2 (server is the sole writer; formats are parsed/serialized in exactly one place, now server-side rather than in `cli/lib/*`)

## Summary

Build the core document library in `apps/server/src/core/` — the single place in the system where Corpus's on-disk formats are parsed and serialized. It covers markdown + YAML frontmatter round-tripping, the canonical frontmatter shape (§5) and thread extension (§6), the turn format with monotonic-unique timestamps as turn identity, id generation, `[[ref]]` extraction, path↔id conventions, and the `doc check` validator whose rules §14 pins. Every later write path (SERVER-005), the projection (SERVER-004), and the validation surface build on this library and never re-implement a parser. The hard guarantee is byte-stability: parsing a document and serializing it back without touching anything must reproduce the original bytes exactly.

## Acceptance Criteria

- [x] `parseDocument(raw)` returns frontmatter (parsed via the `yaml` package), body, and enough provenance to re-serialize byte-identically; `serializeDocument(parsed)` on an untouched parse returns the original string exactly (byte-stable round-trip), including CRLF vs. LF, presence/absence of a trailing newline, key order, comments, and quoting style.
- [x] Canonical frontmatter per §5 is validated with Zod: `id`, `type`, `title`, `created`, `updated`, `tags`, `status`, `anchors`, `due`, `reviewed`, `evergreen`; unknown top-level keys (plugin fields such as `publish:`) pass through and are preserved verbatim on serialize.
- [x] Thread documents (`type: thread`) additionally validate `parent`, `anchor`, `agent` per §6.
- [x] `parseTurns(body)` splits a thread body on `## <author> · <ISO ts>` headings; `appendTurn(body, turn)` appends a turn and guarantees the new timestamp is strictly greater than every existing turn timestamp in that thread; `deleteTurn(body, ts)` removes a turn by its timestamp identity.
- [x] `newId(prefix, isTaken?)` generates collision-safe `doc_`, `th_`, `anc_`, `evt_` ids and retries against the supplied predicate.
- [x] `extractRefs(text)` returns `[[id]]` and `[[id|alias]]` occurrences with their offsets, ignoring refs inside fenced and inline code.
- [x] `checkCorpus(documents, options)` implements §14's rules: hard failures for unparseable frontmatter, missing required fields, duplicate ids, malformed anchor entries, duplicate anchor ids within a document, and threads whose `parent`/`anchor` do not resolve; **warnings** (never failures) for well-formed-but-unresolvable anchors and unresolved `[[refs]]`.
- [x] `documentPathFor()` / `parseDocumentPath()` encode the path convention: threads are flat at `data/threads/<thread-id>.md`, docs nest freely under `data/docs/`; path is presentation, id is identity.
- [x] Unit tests cover the round-trip matrix, the turn format, the id generator, ref extraction, and every check rule (each with a passing and a failing fixture).

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/document.ts` — `parseDocument` / `serializeDocument`, `ParsedDocument` type
- `apps/server/src/core/frontmatter.ts` — Zod schemas for core + thread frontmatter, `DocType` union, coercion helpers
- `apps/server/src/core/turns.ts` — turn heading grammar, `parseTurns` / `appendTurn` / `deleteTurn`
- `apps/server/src/core/ids.ts` — `newId`, prefix constants, id-shape guards (`isDocId`, `isThreadId`, `isAnchorId`, `isEventId`)
- `apps/server/src/core/refs.ts` — `extractRefs`, code-span/fence masking
- `apps/server/src/core/paths.ts` — `documentPathFor`, `parseDocumentPath`, `slugifyTitle`, workspace-containment guard
- `apps/server/src/core/check.ts` — `checkCorpus`, `CheckFinding` types, severity rules
- `apps/server/src/core/time.ts` — `nowIso()` (UTC, second precision) and ISO parse/normalize helpers
- `apps/server/src/core/index.ts` — the library's public surface (nothing outside `core/` imports its internal modules directly)
- `apps/server/src/core/*.test.ts` — colocated Vitest suites
- `apps/server/package.json` — add `yaml` and `zod` dependencies

### Key Implementation Details

**Parsing and byte-stable round-trip.** A document is `---\n<yaml>\n---\n<body>`. `parseDocument` splits on the leading fence, records the exact frontmatter source text, the exact body text, the line ending in use, and whether the file ended with a newline. It parses the YAML with the `yaml` package (`YAML.parseDocument`, keeping the AST) — never a hand-rolled parser, per §5. `ParsedDocument` is:

```ts
type ParsedDocument = {
  frontmatter: DocFrontmatter; // validated, plain object
  body: string;
  readonly source: {
    raw: string;
    yamlDoc: YAML.Document; // retained AST, source of round-trip fidelity
    eol: "\n" | "\r\n";
    trailingNewline: boolean;
  };
};
```

`serializeDocument` re-emits the YAML from the retained AST, mutating only the nodes whose values actually changed (compare the plain object against the AST's `toJS()`); if nothing changed it emits the recorded source text verbatim. Body is written verbatim. This is what makes an untouched round-trip byte-identical and what preserves comments, key order, quoting style, and plugin keys the core knows nothing about. A `setFrontmatterFields(parsed, patch)` helper is the only supported mutation path — it applies the patch to both the plain object and the AST so the two never drift.

**Frontmatter schema.** `DocFrontmatterSchema` (Zod, `.passthrough()` so plugin keys survive validation):

| field       | type                                                                    | required | notes                                                              |
| ----------- | ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `id`        | string matching `^(doc\|th)_[a-z0-9]{4,16}$`                            | yes      | immutable; prefix must agree with `type` (`thread` ⇒ `th_`)        |
| `type`      | `note\|thread\|view\|template\|skill\|agent-def\|<plugin type>`         | yes      | unknown strings accepted (plugins own types) but recorded          |
| `title`     | string                                                                  | yes      |                                                                    |
| `created`   | ISO-8601 UTC instant                                                    | yes      | normalized to `Z`, second precision                                |
| `updated`   | ISO-8601 UTC instant                                                    | yes      |                                                                    |
| `tags`      | string[]                                                                | no       | default `[]`                                                       |
| `status`    | `open\|resolved\|archived`                                              | no       | default `open`                                                     |
| `anchors`   | record of `anc_*` → `{exact, prefix?, suffix?}`                         | no       | default `{}`                                                       |
| `due`       | ISO date or `null`                                                      | no       | default `null`                                                     |
| `reviewed`  | ISO instant or `null`                                                   | no       | default `null`                                                     |
| `evergreen` | boolean                                                                 | no       | default `false`                                                    |

`ThreadFrontmatterSchema` extends it with `parent: string | null`, `anchor: string | null`, `agent: "none" | "requested" | "engaged"`. Defaults are applied on **parse for use**, never written back on a pure read — a read-modify-write must not silently materialize defaults into a file that omitted them (that would break byte-stability).

`packages/contract` owns the wire schemas (CONTRACT-001). Where an equivalent schema already exists there, import it rather than declare a second copy; only the strictly file-format-specific pieces (round-trip provenance, path conventions) live here. Never maintain two definitions of the same shape — if the two diverge, escalate to the orchestrator for a contract issue.

**Turn format (§6).** Grammar: a turn starts at a line matching `^## (user|agent) · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s*$` — the separator is U+00B7 MIDDLE DOT. Everything until the next such line is the turn body (trimmed of the single blank line that follows the heading and the trailing blank lines). Headings inside fenced code blocks must not split a turn — mask fences before scanning. Any content before the first turn heading is a preamble and is preserved on append.

`appendTurn(body, {author, text, ts?})` computes `ts = ts ?? nowIso()`; if that value is `<=` the last turn's timestamp, it is bumped to `lastTs + 1s`, repeatedly until strictly greater. Timestamps are the turn's identity (§6), so uniqueness is a hard invariant of this function, not a caller responsibility. `deleteTurn` removes exactly one turn by timestamp and returns `{ body, deleted }`; it never decides the cascade (deleting the last turn deletes the thread — that policy belongs to the write path).

**Ids.** `newId(prefix, isTaken?)` = `<prefix>_` + 8 lowercase base32 characters derived from `crypto.randomBytes(5)`. When `isTaken(id)` is supplied it retries up to 5 times and then throws `IdGenerationError`. Callers that have the projection available pass a real predicate; callers that don't rely on the 40 bits of entropy. Prefixes are exported constants: `doc`, `th`, `anc`, `evt`.

**Refs (§5).** `extractRefs(text)` matches `\[\[([a-z]+_[a-z0-9]+)(\|([^\]]*))?\]\]` outside fenced blocks and inline code spans, returning `{ id, alias, start, end }[]`. Offsets are UTF-16 code-unit offsets into the input string.

**Paths (§4/§5).** `documentPathFor(frontmatter, opts)` → workspace-relative path: `type: thread` ⇒ `data/threads/<id>.md` (flat, always); everything else ⇒ `<folder ?? "data/docs/inbox">/<slugifyTitle(title)>.md`. `slugifyTitle` lowercases, transliterates to ASCII where trivial, replaces runs of non-alphanumerics with `-`, trims to 60 characters, and falls back to the id when the result is empty. `parseDocumentPath(relPath)` returns `{ root: "docs" | "threads", folder, filename }` or `null` for paths outside the document roots. A containment guard rejects absolute paths, `..` segments, and anything resolving outside the workspace — every caller passing user- or agent-supplied path input goes through it.

**`doc check` (§14).** `checkCorpus(docs, { resolveAnchor? })` takes the already-parsed documents (the caller does the I/O; this library stays I/O-free) and returns `{ errors: CheckFinding[], warnings: CheckFinding[] }` where a finding is `{ code, severity, docId, path, detail }`. Rules:

_Errors_ — frontmatter fails to parse; a required field is missing or ill-typed; `id` prefix disagrees with `type`; two documents share an `id`; an anchor entry is malformed (key not `anc_*`, missing/empty `exact`, non-string `prefix`/`suffix`); duplicate anchor ids within a document; a thread's `parent` names a document that does not exist; a thread's `anchor` names an anchor entry that does not exist in its parent; two threads claim the same anchor (one anchor per thread, §6); duplicate turn timestamps within a thread.

_Warnings_ — a well-formed anchor whose selector does not resolve in the current body (an orphaned thread is legitimate, §6/§14); an anchor entry with no thread referencing it; an unresolved `[[ref]]` (referencing a not-yet-created document is legitimate, §5).

Resolution is **injected**: `options.resolveAnchor` is supplied by SERVER-002's resolver. When it is absent, resolution-dependent warnings are simply not produced — that keeps this library free of a dependency on the anchor engine and lets both issues land independently.

### Edge Cases

- File with no frontmatter fence at all, or an unterminated fence → `DocumentParseError` with the offending path/line; never a silent empty frontmatter.
- Empty frontmatter block (`---\n---\n`) → parses to `{}`, then fails validation on missing required fields (an error, not a crash).
- `---` appearing inside the body must not be mistaken for the closing fence: only the fence that terminates the leading block counts.
- CRLF files, files with a UTF-8 BOM, files without a trailing newline — all must round-trip byte-identically.
- `due: null` / `reviewed: null` are meaningfully null (§5) — distinguish "absent" from "explicitly null" and preserve which one the file used.
- Non-UTC or millisecond-precision timestamps in hand-written files: accepted on read, normalized to `Z` second precision only when the field is actually rewritten.
- Unicode (including astral-plane characters) in titles, bodies, and anchor `exact` text — offsets are UTF-16 code units and must never split a surrogate pair.
- Skill/agent documents carry Claude Code's `name`/`description` alongside Corpus fields (§7) — passthrough keeps them; validation must not reject them.
- A turn body containing a fenced block whose content includes a `## user · …` line must stay a single turn.
- YAML aliases/anchors in frontmatter — parse them, but serialization fidelity is only guaranteed for untouched documents; document the limitation.

## Testing Strategy

Vitest, colocated `*.test.ts` per module.

- **Round-trip (table-driven, `it.each`)**: a fixture corpus of documents — minimal, full-frontmatter, thread with turns, plugin keys, YAML comments, CRLF, no trailing newline, BOM, unicode — each asserted `serializeDocument(parseDocument(raw)) === raw`.
- **Mutation fidelity**: patch one field, assert only that field's line changed (diff the before/after strings) and comments/key order survived.
- **Turns**: parse a multi-turn thread; append with a clock stubbed to a value equal to and earlier than the last turn, assert monotonic bump; fenced-block heading not split; delete by timestamp.
- **Ids**: prefix shape, retry on a predicate that reports collisions for the first N candidates, throw after exhaustion.
- **Refs**: aliases, code fences, inline code, adjacent refs, malformed brackets.
- **Paths**: thread flattening, folder nesting, slug collisions, traversal rejection.
- **Check**: one fixture per rule — a passing corpus and a corpus violating exactly that rule; assert the finding's `code` and severity, and specifically assert that orphaned anchors and unresolved refs land in `warnings`, never `errors`.

## E2E Verification Plan

This is a library, so "real application" means real files on disk driven by real scripts — no in-memory fakes, no mocked `fs`, per CONTRACT-001's pragmatic style.

### Reproduction Steps (bugs only)

N/A — this is a feature, not a bug.

### Verification Steps

1. Create a real scratch workspace (`mktemp -d`), `git init`, and populate `data/docs/` and `data/threads/` with hand-written markdown documents, including one thread with several turns, one document with plugin frontmatter keys, and one with YAML comments.
2. Run a real script (`npx tsx scripts/…` or an inline `tsx -e` snippet) that reads every `.md` file from disk, `parseDocument` → `serializeDocument`, and writes the result back. Expected: `git status --porcelain` is empty — byte-stable round-trip over real files.
3. Also run the same round-trip over this repository's real `.claude/skills/**/SKILL.md` and `.claude/agents/*.md` files (real Claude Code frontmatter, `name`/`description` present). Expected: no diff.
4. Run a script that appends a turn to the real thread file with `appendTurn` and writes it. Expected: the file gains a `## agent · <ts>` heading, the timestamp is strictly greater than the previous turn's, and re-reading with `parseTurns` yields one more turn.
5. Run a script that loads every document from the scratch workspace and calls `checkCorpus`. Expected: clean. Then hand-edit a file to point a thread's `anchor` at a nonexistent anchor id → re-run → an **error**. Restore, then edit an anchor's `exact` so it no longer occurs in the parent's body (with SERVER-002's resolver injected, or a trivial substring resolver) → re-run → a **warning**, exit path unaffected.
6. Verify ids over a real run: generate 10,000 ids in a script, assert no duplicates and that all match the prefix grammar.

## E2E Verification Log

**implemented on: opus**

Per the sprint-001 Verification Environment table, the "real application" for
SERVER-001 is real markdown files on a real disk in a real `git init` scratch
workspace, driven by real `tsx` scripts against the library. No mocked `fs`, no
in-memory fakes, no test doubles were used below. The scratch workspace is
`/tmp/corpus-e2e-ws` (10 hand-written documents, committed); the one-off driver
scripts lived under a gitignored scratch directory and are **not** committed.

### Reproduction (bugs only)

N/A — feature, not a bug.

### Post-Implementation Verification

**TEST-1 — byte-stable round-trip over a real corpus.** The workspace holds a
minimal-frontmatter note, a full-frontmatter note using every §5 field, a thread
with three turns, a document with a nested `publish:` plugin mapping, a document
with YAML comments and non-default key order, a CRLF file, a file with no
trailing newline, a UTF-8 BOM file, an astral-plane unicode file, and one
`due: null` document. Every `.md` was read, `parseDocument` → `serializeDocument`
with no mutation, and written back over the original.

```
$ tsx e2e-roundtrip.ts /tmp/corpus-e2e-ws/data
round-tripped 10 files, 0 differed in memory
$ git -C /tmp/corpus-e2e-ws status --porcelain
$                       # empty — zero files differ
```

PASS.

**TEST-2 — round-trip over this repository's real Claude Code frontmatter.**
Same script over `.claude/skills/**/SKILL.md` and `.claude/agents/*.md`.

```
$ tsx e2e-roundtrip.ts .claude/skills .claude/agents
round-tripped 19 files, 0 differed in memory
rejected 2 files as unparseable:
  .claude/agents/cli-dev.md :: 3: invalid YAML frontmatter: Nested mappings are not
    allowed in compact mappings at line 2, column 14
  .claude/agents/server-dev.md :: 3: invalid YAML frontmatter: Nested mappings are not
    allowed in compact mappings at line 2, column 14
$ git status --porcelain -- .claude/skills .claude/agents
$                       # empty
```

19/21 round-trip byte-identically with `name`/`description` preserved verbatim
and no validation tripped by the unknown keys. The 2 rejected files are
**genuinely invalid YAML 1.2**, not a library defect: their unquoted plain
`description:` scalar contains a second `": "` (`` the `corpus` binary: workspace
init ``), which YAML reads as a nested mapping. Confirmed by counting the
occurrences — `ui-dev.md`, whose description has only the key's own `": "`,
parses fine:

```
$ python3 -c "...count ': ' in line 3..."
.claude/agents/cli-dev.md    colon-space occurrences in description: 2
.claude/agents/server-dev.md colon-space occurrences in description: 2
.claude/agents/ui-dev.md     colon-space occurrences in description: 1
```

Rejecting these is the §14 "frontmatter fails to parse" rule working as
specified, and §5 mandates a real YAML library. ~~Escalated to the orchestrator:
these are dev-harness files outside this agent's domain and need their
descriptions quoted.~~ PASS for the library; two harness files flagged.

> **RESOLVED — the escalation above is closed** (annotated 2026-07-26, fix-loop
> round 1). The orchestrator quoted both descriptions in commit `ac6949f`. Both
> files parse at HEAD, so the paragraph above narrated an open escalation that
> no longer exists. Re-verified over a copy of the repo's real markdown at
> `/private/tmp/corpus-claude-md` (28 files: 12 `.claude/agents/*.md`, 9
> `.claude/skills/**/SKILL.md`, 7 under `assets/workspace/`):
>
> ```
> $ tsx e2e/roundtrip.ts /private/tmp/corpus-claude-md
> round-tripped 28 files: 28 identical, 0 changed
> $ git -C /private/tmp/corpus-claude-md status --porcelain
> $                     # empty — 0 rejected, 0 files differ
> ```
>
> 28/28 parse and round-trip byte-identically; nothing is rejected. No open
> action remains for TEST-2.

**TEST-3 — targeted mutation changes only the targeted field**, and
**TEST-17 — reading does not materialize defaults into the file.** `title` was
changed on `commented.md` (YAML comments, non-alphabetical key order, a
single-quoted value); `updated` was changed on `minimal.md` (which omits every
optional field); `explicit-null.md` was parsed and re-serialized untouched.

```
$ tsx e2e-mutate.ts /tmp/corpus-e2e-ws
data/docs/inbox/commented.md: validated=true defaults in memory ->
  tags=["finance"] status=open anchors={} due=null reviewed=null evergreen=false
data/docs/inbox/minimal.md:   validated=true defaults in memory ->
  tags=[] status=open anchors={} due=null reviewed=null evergreen=false
explicit-null.md: due key present in file = true | value = null

$ git -C /tmp/corpus-e2e-ws diff -U0
--- a/data/docs/inbox/commented.md
+++ b/data/docs/inbox/commented.md
@@ -5 +5 @@ id: doc_comment1 # assigned at creation
-title: 'Single quoted title'
+title: 'Renamed by the write path'
--- a/data/docs/inbox/minimal.md
+++ b/data/docs/inbox/minimal.md
@@ -6 +6 @@ created: 2026-07-19T10:00:00Z
-updated: 2026-07-19T10:00:00Z
+updated: 2026-07-26T12:00:00Z
```

Exactly one changed line per file. Comments, key order and the single-quote
style survived. `explicit-null.md` does not appear in the diff at all — it is
byte-identical and still contains the literal `due: null`. `minimal.md`'s diff
contains no `tags:`, `status:`, `anchors:`, `due:`, `reviewed:` or `evergreen:`
line even though all six defaults were applied in memory. PASS.

**TEST-4 — malformed input fails loudly, never silently.** Three real files
written to disk and parsed.

```
$ tsx e2e-misc.ts /tmp/corpus-e2e-ws
no-fence.md:     PARSE ERROR -> malformed/no-fence.md:1: missing YAML frontmatter
                 fence (expected a leading `---`)
unterminated.md: PARSE ERROR -> malformed/unterminated.md:4: unterminated YAML
                 frontmatter fence (no closing `---`)
empty-block.md:  parsed to {}; validation errors ->
  frontmatter-invalid(id: Invalid input: expected string, received undefined),
  frontmatter-invalid(type: Invalid input: expected string, received undefined),
  frontmatter-invalid(title: Invalid input: expected string, received undefined),
  frontmatter-invalid(created: Expected an ISO-8601 UTC instant),
  frontmatter-invalid(updated: Expected an ISO-8601 UTC instant)
```

The first two raise `DocumentParseError` naming path and line; neither yields an
empty-frontmatter success. The third parses to `{}` and fails validation naming
all five missing required fields, with no unhandled exception. PASS.

**TEST-5 — canonical frontmatter validates; plugin keys pass through**, and
**TEST-63 — the file shape agrees with the wire contract.**

```
validated: {"id":"doc_a1b2c3","type":"note","title":"Mortgage options",
  "created":"2026-07-19T10:00:00Z","updated":"2026-07-19T10:42:00Z",
  "tags":["finance","housing"],"status":"open",
  "anchors":{"anc_k4f7":{"exact":"assume a 30-year fixed at 6.1%",
    "prefix":"the model we ","suffix":" which may be stale"}},
  "due":"2026-08-01","reviewed":"2026-07-20T09:00:00Z","evergreen":false}
contract DocFrontmatterSchema accepts it: true
selector satisfies TextQuoteSelectorSchema: true
plugin doc validates: true | publish preserved:
  {"google-docs":{"id":"1AbCdEf","lastSync":"2026-07-19T11:00:00Z","folder":"Shared/Finance"}}
```

The defaulted value passes `@corpus/contract`'s `DocFrontmatterSchema`
unmodified. `prefix`/`suffix` are always emitted as strings (orchestrator
decision on Open Conflict 3), so selectors satisfy `TextQuoteSelectorSchema`
directly. PASS.

**TEST-6 — thread frontmatter adds the §6 fields.**

```
thread validates: true {... "parent":"doc_a1b2c3","anchor":"anc_k4f7","agent":"engaged"}
thread omitting `agent` validates with default: true none
```

`agent` carries a documented default of `none` (§8's "not engaged" state), so
the second branch of TEST-6 applies — the default is in-memory only and TEST-17
above proves it never reaches disk. PASS.

**TEST-7/TEST-8 — turn parsing and monotonic append against the real thread
file.** A turn was appended with an explicit `ts` **equal to** the last turn's.

```
$ tsx e2e-turns.ts /tmp/corpus-e2e-ws
turns before: [["user","...10:05:00Z"],["agent","...10:06:00Z"],["user","...10:07:12Z"]]
preamble before: ""
requested ts: 2026-07-19T10:07:12Z -> written ts: 2026-07-19T10:07:13Z
turns after : [[...10:05:00Z],[...10:06:00Z],[...10:07:12Z],["agent","...10:07:13Z"]]
unique: true | strictly increasing: true

$ git -C /tmp/corpus-e2e-ws diff
@@ -19,3 +19,6 @@
+
+## agent · 2026-07-19T10:07:13Z
+Updated the doc to 6.4%.
```

The file gained one `## agent · <ts>` heading, the timestamp is strictly greater,
and re-reading with `parseTurns` yields one more turn. The earlier-timestamp
case is covered in the unit matrix (`turns.test.ts`, "bumps a timestamp earlier
than the last turn"). PASS.

**TEST-9/TEST-10 — turn deletion by timestamp identity, and a heading inside a
fenced block.** Covered by the colocated unit matrix rather than a separate
on-disk run, since neither touches the file container: `deleteTurn` removes
exactly one turn and reports no deletion for an absent timestamp, leaving the
body byte-identical; a fenced `## user · 2026-01-01T00:00:00Z` stays inside a
single turn with the fence verbatim. PASS.

**TEST-11/TEST-12 — id generation at scale and the collision predicate.**

```
doc: generated=10000 unique=10000 allMatchGrammar=true sample=doc_3n22iyuz
th:  generated=10000 unique=10000 allMatchGrammar=true sample=th_x2oibzi4
anc: generated=10000 unique=10000 allMatchGrammar=true sample=anc_wcpxv7nv
evt: generated=10000 unique=10000 allMatchGrammar=true sample=evt_nl4ak4hr

first three reported taken -> doc_zvntb6pq after 4 probes
everything taken -> IdGenerationError: Could not generate a free doc_* id after 5 attempts
```

40,000 ids, zero duplicates within each prefix, all matching the generated
grammar `^(doc|th|anc|evt)_[a-z2-7]{8}$`. Per the orchestrator's decision on
Open Conflict 1, that narrow shape is a **generation** policy; validation
imports the contract's schemas unchanged (`ids.test.ts` asserts
`isDocId("doc_A1B2C3") === true` and `isDocumentId("th_x") === true`). PASS.

**TEST-13 — ref extraction.**

```
  doc_a1b2c3 alias=null      [5,19)  slices back to "[[doc_a1b2c3]]"
  th_x9y8    alias="as text" [32,51) slices back to "[[th_x9y8|as text]]"
  doc_aaaa   alias=null      [62,74) slices back to "[[doc_aaaa]]"
  doc_bbbb   alias=null      [74,86) slices back to "[[doc_bbbb]]"
```

The fenced `[[doc_ignored]]`, the inline-code `` `[[doc_alsoignored]]` `` and the
malformed `[[unclosed` produced no result and no throw. Offsets slice back to
the exact matched text. PASS.

**TEST-14 — path conventions and containment.**

```
thread:      data/threads/th_x9y8.md          (folder hint "finance" ignored)
titled note: data/docs/finance/mortgage-options-2026.md
no folder:   data/docs/inbox/mortgage-options-2026.md
  parseDocumentPath("data/threads/th_x9y8.md")   -> {"root":"threads","folder":"","filename":"th_x9y8.md"}
  parseDocumentPath("data/docs/finance/mortgage.md") -> {"root":"docs","folder":"finance","filename":"mortgage.md"}
  parseDocumentPath("../../etc/passwd")          -> null
  parseDocumentPath("/etc/passwd")               -> null
  parseDocumentPath("data/docs/../../escape.md") -> null
```

PASS.

**TEST-15 — an error for each §14 hard-failure rule.** Thirteen corpora were
written to disk under `/tmp/corpus-e2e-rules/`, each violating exactly one rule,
plus a clean control assembled from the same fixtures.

```
$ tsx e2e-rules.ts /tmp/corpus-e2e-rules
00-clean                     errors=[] warnings=[]
01-unparseable               errors=[frontmatter-unparseable]
02-missing-field             errors=[frontmatter-invalid]
03-id-prefix-mismatch        errors=[id-prefix-mismatch]
04-duplicate-id              errors=[duplicate-id, thread-anchor-missing]
05-anchor-key-not-anc        errors=[anchor-malformed, frontmatter-invalid]
06-anchor-empty-exact        errors=[anchor-malformed, frontmatter-invalid]
07-anchor-nonstring-prefix   errors=[anchor-malformed, frontmatter-invalid]
08-duplicate-anchor-id       errors=[duplicate-anchor-id]
09-thread-parent-missing     errors=[thread-parent-missing]
10-thread-anchor-missing     errors=[thread-anchor-missing]
11-anchor-claimed-twice      errors=[anchor-claimed-twice]
12-duplicate-turn-ts         errors=[duplicate-turn-timestamp]
```

Every rule yields an error whose code identifies it; the clean corpus yields
zero errors and zero warnings. The `04` fixture's extra `thread-anchor-missing`
is a fixture artifact (the duplicate copy sorts first in the walk and carries no
`anchors:` block), not a second rule firing. The `05`–`07` `frontmatter-invalid`
companion is deliberate: a malformed selector is reported both as the specific
anchor rule and by the schema. An **earlier run of this same script** showed
cascading `thread-parent-missing`/`thread-anchor-missing` on cases 02 and 05–07;
that noise was fixed by tracking every parsed document's id (even when its
frontmatter fails validation) so a thread is never accused of naming a missing
parent that plainly exists. Two regression tests cover the fix. PASS.

**TEST-16 — orphaned anchors and unresolved refs are warnings, never errors.**
Run against the real workspace with a resolver injected on the published
signature (no adapter, no cast — this is also **TEST-62**'s shape).

```
$ tsx e2e-check.ts /tmp/corpus-e2e-ws                 # clean corpus
checked 10 documents (resolver: true)
errors: 0
warnings: 1
  WARNING ref-unresolved data/docs/finance/mortgage.md —
    reference `[[doc_neverCreated]]` does not resolve to a document in the corpus

# point the thread at an anchor its parent does not declare
$ sed -i '' 's/^anchor: anc_k4f7$/anchor: anc_nosuch/' data/threads/th_x9y8.md
$ tsx e2e-check.ts /tmp/corpus-e2e-ws
errors: 1
  ERROR   thread-anchor-missing data/threads/th_x9y8.md —
    anchor `anc_nosuch` is not declared in doc_a1b2c3
warnings: 2
  WARNING anchor-unused ... anchor `anc_k4f7` has no thread referencing it
  WARNING ref-unresolved ...
exit=1

# restore, then edit the anchored sentence out of the body
$ git checkout -- . && sed -i '' 's/we assume a 30-year fixed at 6.1% which may be stale/we now assume a 15-year fixed at 5.2% instead/' data/docs/finance/mortgage.md
$ tsx e2e-check.ts /tmp/corpus-e2e-ws
errors: 0
warnings: 2
  WARNING anchor-unresolved data/docs/finance/mortgage.md —
    anchor `anc_k4f7` no longer resolves in the body; its thread is orphaned
  WARNING ref-unresolved ...
exit=0

$ tsx e2e-check.ts /tmp/corpus-e2e-ws --no-resolver
errors: 0
warnings: 1                     # the resolution-dependent warning is simply absent
```

An orphaned anchor, an unreferenced anchor entry and an unresolved `[[ref]]` are
all warnings with an empty error list; the exit path is unaffected. Removing the
resolver removes the resolution-dependent warning and still reports zero errors.
PASS.

**TEST-62 — composition with SERVER-002's resolver: ~~DEFERRED → SERVER-002~~
VERIFIED 2026-07-26** (see the addendum below).

**TEST-61 — the seed documents pass the real validator: DEFERRED → AGENT-001.**
`assets/workspace/` currently contains only `.gitkeep`; there are no seed
documents to check yet.

**Repo gates** (`npm run build && npm run lint && npm run format:check &&
npm run typecheck && npm run test:coverage`): all pass. 496 tests across 33
files; combined coverage 99.83% lines / 95.79% branches / 100% functions, above
the 90% gate.

### Addendum — TEST-62 verified after SERVER-002 merged (2026-07-26)

**implemented on: opus** (claude-opus-5, 1M context).

Both issues are now merged into `phase-1-foundations`, so the deferred cross-issue
integration check was run for real.

**A genuine signature mismatch was found first.** SERVER-001 published
`AnchorResolver` with a third positional parameter (`hint?: number`); SERVER-002
published `resolveAnchor(body, selector, options?: ResolveOptions)` — an options
bag. Neither issue's Technical Design mandated the third parameter's shape, so the
two worktrees chose differently and the composition did **not** type-check:

```
$ npx tsc --noEmit -p apps/server/tsconfig.json     # probe: const p: AnchorResolver = resolveAnchor
error TS2322: Type '(body: string, selector: TextQuoteSelectorInput, options?: ResolveOptions) => Range | null'
  is not assignable to type 'AnchorResolver'.
  Types of parameters 'options' and 'hint' are incompatible.
    Type 'number | undefined' is not assignable to type 'ResolveOptions | undefined'.
```

Per sprint-001 ("a mismatch here is an integration failure, not a preference") this
was fixed at the injection point rather than shimmed: `AnchorResolver` now declares
only the two arguments the checker actually passes. The checker has no `oldBody` and
therefore no previous offset to offer, so naming a third parameter over-specified
the contract. Extra *optional* parameters on the injected function stay assignable,
so `resolveAnchor` composes as published — and the pre-existing unit test that
injects a three-parameter resolver still passes unchanged.

**TEST-62 — the checker composes with the real anchor resolver: PASS.**

Colocated suite: `apps/server/src/check-with-anchors.test.ts` (5 tests) — imports
`resolveAnchor` from `./anchors` and `checkCorpus` from `./core`, injects it with
object-property shorthand (`{ resolveAnchor }`), no adapter, cast or wrapper lambda.

Real-file E2E: a throwaway `tsx` script (scratchpad, **not committed**) walked a real
scratch corpus on disk — `data/docs/finance/mortgage.md` carrying two well-formed
anchors (`anc_k4f7` resolvable, `anc_m2n5` quoting text absent from the body), plus
`data/threads/th_x9y8.md` and `th_p3q4.md` claiming one each so `anchor-unused` never
fires:

```
$ npx tsx <scratchpad>/e2e-test62.ts <scratchpad>/test62-ws
documents: 3  resolver: real resolveAnchor
errors: 0
warnings: 1
  WARNING anchor-unresolved data/docs/finance/mortgage.md — anchor `anc_m2n5` no longer resolves in the body; its thread is orphaned
exit=0

$ npx tsx <scratchpad>/e2e-test62.ts <scratchpad>/test62-ws --no-resolver
documents: 3  resolver: none
errors: 0
warnings: 0
exit=0

$ npx tsc --noEmit --strict --module nodenext ... <scratchpad>/e2e-test62.ts
tsc exit=0        # the injection needs no adapter
```

The resolvable anchor produces no finding; the unresolvable one produces exactly one
warning and zero errors; removing the resolver removes the warning entirely, proving
it came from the injected engine and not from the checker. A fifth test edits the
anchored sentence (`6.1%` → `6.4%`) so `indexOf` cannot match and only the engine's
rung-3 fuzzy search can place the anchor — the corpus still reports zero warnings,
confirming the real ladder is in play rather than a substring stand-in.

**Repo gates after the change** (`npm run build`, `lint`, `format:check`,
`typecheck`, `test:coverage`): all PASS. **778 tests across 54 files**; combined
coverage **99.75% lines / 95.6% branches / 100% functions** (`apps/server/src` at
100/100/100), above the 90% gate.

### Addendum — fix loop round 1: evaluator FAIL-2 / TEST-3 (2026-07-26)

**implemented on: opus** (claude-opus-5, 1M context).

`issues/evals/SERVER-001-eval.md` failed TEST-3: pure round-trips were byte-stable,
but `setFrontmatterFields` re-emitted the **whole** YAML block on any single-field
mutation, reformatting untouched lines. This is a bug, so it was reproduced E2E
before a line of code changed.

#### Reproduction (before the fix)

Driver: `parseDocument` → `setFrontmatterFields` → `serializeDocument` against the
implementation as it stood, diffing before/after line by line.

```
$ tsx <scratchpad>/repro/repro.ts
=== MINIMAL CASE (mutate only `title`): 2 changed line(s) ===
L4: - "title: T"
L4: + "title: Z"
L7: - "tags: [core]"
L7: + "tags: [ core ]"

=== GIVEN FIXTURE (mutate only `title`): 6 changed line(s) ===
L3: - "type: note   # trailing comment"
L3: + "type: note # trailing comment"
L4: - "title: 'Single quoted title'"
L4: + "title: 'Renamed by the write path'"
L8: - "tags:   [finance,   housing]"
L8: + "tags: [ finance, housing ]"
L11: - "      exact: assume a 30-year fixed at 6.1%"
L11: + "    exact: assume a 30-year fixed at 6.1%"
L12: - "      prefix: \"the model we \""
L12: + "    prefix: \"the model we \""
L14: - "due:    2026-08-01"
L14: + "due: 2026-08-01"

pure round-trip minimal byte-identical: true
pure round-trip given byte-identical: true
```

Confirmed: 2 changed lines where 1 was required (minimal), 6 where 1 was required
(the contract's Given), while pure round-trips stayed byte-stable — exactly the
evaluator's characterization.

**Reproduced again on real files with real git**, since SERVER-005 will autosave
through this path. A scratch workspace of 8 hand-written documents (irregular
formatting, plugin keys, comments, a thread, CRLF, BOM, no-trailing-newline) was
`git init`-ed and committed, then one field (`updated`) was mutated on every file
using the pre-fix implementation:

```
$ tsx e2e/seed.ts /private/tmp/corpus-prefix-e2e
seeded 8 files into /private/tmp/corpus-prefix-e2e
$ git -C /private/tmp/corpus-prefix-e2e init -q && git add -A && git commit -qm seed
$ tsx e2e/mutate-prefix.ts /private/tmp/corpus-prefix-e2e/data
mutated `updated` on every document (pre-fix implementation)
$ git -C /private/tmp/corpus-prefix-e2e diff --numstat
2   2   data/docs/inbox/bom.md
1   1   data/docs/inbox/commented.md
2   2   data/docs/inbox/crlf.md
2   2   data/docs/inbox/minimal.md
6   6   data/docs/inbox/mortgage.md
2   2   data/docs/inbox/no-trailing-newline.md
1   1   data/docs/inbox/plugin-keys.md
1   1   data/threads/th_x9y8.md
```

Five of eight files carry spurious diff lines; `mortgage.md` (the Given's shape)
carries five. Bug confirmed on disk.

#### Root cause

`setFrontmatterFields` re-parsed the frontmatter, applied the patch to the AST, and
let `serializeDocument` emit `yamlDoc.toString()` — the entire block, every node
rendered by the serializer. The `yaml` package preserves comments, key order and
scalar quoting style across that cycle, but it does **not** preserve source-level
whitespace: flow collections are re-spaced (`[a, b]` → `[ a, b ]`), nested mappings
are re-indented to the serializer's width, padding after a colon is collapsed, and
inner whitespace before a trailing comment is normalized. No AST-level API restores
those, because they are not in the AST. The prior "mutating only the nodes whose
values actually changed" intent could not be met by re-emitting from the AST at all.

#### The fix

`setFrontmatterFields` now composes the result from **source text**, not from the
serializer alone (`apps/server/src/core/document.ts`):

1. Both the original and the patched document are split at top-level key
   boundaries (`segmentTopLevelKeys`) — each key owns the lines from the start of
   its own line to the start of the next key's line, so nested block values, blank
   lines and trailing comments travel with the key they belong to.
2. `spliceUntouchedKeys` rebuilds the block in the patched document's key order,
   taking each **untouched** key's lines verbatim from the original source and only
   the **changed** keys' lines from the serializer's output. Untouched keys are
   matched by name in order, so duplicate keys each keep their own lines.
3. The splice is accepted only after re-parsing it and confirming it means exactly
   what the fully re-emitted document means. Any shape the line-oriented split
   cannot describe honestly (flow-style mapping, explicit `? key`, a collection used
   as a key, empty/non-mapping frontmatter) returns `null` and degrades to the old
   full re-emit — correctness never depends on the splice succeeding, and no fixture
   is special-cased anywhere.
4. A patch whose values already equal what the file says is now a no-op: it returns
   the same `ParsedDocument`, so a read-modify-write that changes nothing writes
   nothing (no spurious auto-commit for SERVER-005).

`DocumentSource.frontmatterDirty` became `frontmatterRewritten`, and
`frontmatterText` now holds the current text rather than only the original;
`serializeDocument` no longer consults the AST at all. §14 validation behavior and
the structural byte-stability of pure round-trips are untouched.

#### Post-fix verification

Same reproduction scripts, unchanged, against the fixed library:

```
$ tsx <scratchpad>/repro/repro-wt.ts
=== MINIMAL CASE (mutate only `title`): 1 changed line(s) ===
L4: - "title: T"
L4: + "title: Z"

=== GIVEN FIXTURE (mutate only `title`): 1 changed line(s) ===
L4: - "title: 'Single quoted title'"
L4: + "title: 'Renamed by the write path'"

pure round-trip minimal byte-identical: true
pure round-trip given byte-identical: true

RESULT: minimal changed=1 (want 1), given changed=1 (want 1)
```

**Real files, real git — round-trip first (TEST-1 regression guard):**

```
$ tsx e2e/seed.ts /private/tmp/corpus-server001-e2e
seeded 8 files into /private/tmp/corpus-server001-e2e
$ git -C /private/tmp/corpus-server001-e2e init -q && git add -A && git commit -qm seed
$ tsx e2e/roundtrip.ts /private/tmp/corpus-server001-e2e/data
round-tripped 8 files: 8 identical, 0 changed
$ git -C /private/tmp/corpus-server001-e2e status --porcelain
$                     # empty — still byte-stable
```

**Then the same one-field mutation that produced the pre-fix numbers above:**

```
$ tsx e2e/mutate.ts /private/tmp/corpus-server001-e2e/data
mutated `updated` on every document
$ git -C /private/tmp/corpus-server001-e2e diff --numstat
1   1   data/docs/inbox/bom.md
1   1   data/docs/inbox/commented.md
1   1   data/docs/inbox/crlf.md
1   1   data/docs/inbox/minimal.md
1   1   data/docs/inbox/mortgage.md
1   1   data/docs/inbox/no-trailing-newline.md
1   1   data/docs/inbox/plugin-keys.md
1   1   data/threads/th_x9y8.md
```

8/8 files: exactly one line replaced, down from up to six. The full `diff -U0` on
`mortgage.md` — the file that previously lost its comment spacing, flow spacing,
nested indentation and colon padding — is now a single hunk:

```
@@ -6 +6 @@ created: 2026-07-19T10:00:00Z
-updated: 2026-07-19T10:00:00Z
+updated: 2026-07-26T12:00:00Z
```

**Container properties survived the mutation** (checked on the written bytes, not
in memory):

```
$ tsx e2e/shapes.ts
crlf.md  — every newline is CRLF: true
crlf.md  — mutated line present: true
bom.md   — still starts with U+FEFF: true
noNl.md  — still has no trailing newline: true
mortgage — untouched irregular lines survive: [ true, true, true, true, true ]
```

**Mutation over the repo's real markdown** (the 28-file copy from the TEST-2
annotation above), mutating one field per file:

```
$ tsx e2e/mutate.ts /private/tmp/corpus-claude-md
mutated `updated` on every document
$ git -C /private/tmp/corpus-claude-md diff --numstat
1  0  .claude/agents/agent-runtime-dev.md      … (21 files: key added, +1 -0)
1  1  assets/workspace/README.md               … (7 files: key changed, +1 -1)
```

28/28 files changed exactly one line — `+1 -0` where `updated` was absent and the
key was appended, `+1 -1` where it already existed. No collateral reformatting on
any real repo document.

#### Regression tests

`apps/server/src/core/document.test.ts` gains a `setFrontmatterFields — untouched
keys keep their bytes` suite of **17 cases, 13 of which fail against the pre-fix
implementation** (measured by running the suite verbatim against the unmodified
module: `13 failed | 4 passed (17)`; the 4 passing ones are the guard cases that
were never broken — adding an absent key, and the three fallback shapes). It
covers: the evaluator's minimal flow-collection case; the contract's Given
asserted to exactly
one changed line; mutating the first / middle / last key; rewriting a nested
mapping while its neighbours stay verbatim; key removal and key addition asserted
against the exact expected file bytes; duplicate top-level keys; CRLF; a chain of
three successive single-field mutations; the no-op patch; explicit `null` vs.
removal; and the three fallback shapes (flow mapping, `? key`, collection-as-key)
asserted to still apply the patch correctly. Two new round-trip fixtures
(`irregular inline formatting`, `duplicate top-level keys`) join the byte-stability
matrix.

#### Repo gates after the fix

`npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
`npm run test:coverage` — all PASS. **797 tests across 54 files** (405 in
`apps/server`); combined coverage **99.75% lines / 95.40% branches / 100%
functions**, above the 90% gate; `core/document.ts` at **100% lines / 100%
functions**, its remaining uncovered branches being the defensive `null` returns of
the splice guards.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-001]` prefix
