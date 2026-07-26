# [SERVER-001] Document model core: parse/serialize, ids, validation

## Domain

server

## Status

in_progress

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

- [ ] `parseDocument(raw)` returns frontmatter (parsed via the `yaml` package), body, and enough provenance to re-serialize byte-identically; `serializeDocument(parsed)` on an untouched parse returns the original string exactly (byte-stable round-trip), including CRLF vs. LF, presence/absence of a trailing newline, key order, comments, and quoting style.
- [ ] Canonical frontmatter per §5 is validated with Zod: `id`, `type`, `title`, `created`, `updated`, `tags`, `status`, `anchors`, `due`, `reviewed`, `evergreen`; unknown top-level keys (plugin fields such as `publish:`) pass through and are preserved verbatim on serialize.
- [ ] Thread documents (`type: thread`) additionally validate `parent`, `anchor`, `agent` per §6.
- [ ] `parseTurns(body)` splits a thread body on `## <author> · <ISO ts>` headings; `appendTurn(body, turn)` appends a turn and guarantees the new timestamp is strictly greater than every existing turn timestamp in that thread; `deleteTurn(body, ts)` removes a turn by its timestamp identity.
- [ ] `newId(prefix, isTaken?)` generates collision-safe `doc_`, `th_`, `anc_`, `evt_` ids and retries against the supplied predicate.
- [ ] `extractRefs(text)` returns `[[id]]` and `[[id|alias]]` occurrences with their offsets, ignoring refs inside fenced and inline code.
- [ ] `checkCorpus(documents, options)` implements §14's rules: hard failures for unparseable frontmatter, missing required fields, duplicate ids, malformed anchor entries, duplicate anchor ids within a document, and threads whose `parent`/`anchor` do not resolve; **warnings** (never failures) for well-formed-but-unresolvable anchors and unresolved `[[refs]]`.
- [ ] `documentPathFor()` / `parseDocumentPath()` encode the path convention: threads are flat at `data/threads/<thread-id>.md`, docs nest freely under `data/docs/`; path is presentation, id is identity.
- [ ] Unit tests cover the round-trip matrix, the turn format, the id generator, ref extraction, and every check rule (each with a passing and a failing fixture).

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

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-001]` prefix
