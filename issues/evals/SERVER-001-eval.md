# Evaluation: SERVER-001

**Date**: 2026-07-26
**Sprint**: sprint-001 (Phase 1 — Foundations)
**Verdict**: FAIL (16 of 17 in-scope acceptance tests pass; TEST-3 fails)

Verification followed sprint-001's Verification Environment for SERVER-001: real markdown
files on real disk in real `git init` scratch workspaces, driven by the evaluator's own
throwaway `tsx` scripts against the built library. No implementation source was read to
reach this verdict; the public surface was discovered by runtime introspection
(`Object.keys(import("@corpus/server"))`). Probe scripts live in
`/Users/theophanerupin/code/corpus/node_modules/.eval/` (gitignored, not product code).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                  |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, per-test, with commands and observed output.                                                                                     |
| Commands are specific and concrete      | PASS   | Real `tsx` invocations, real `git status --porcelain` / `git diff -U0` output, real error strings.                                        |
| Real E2E (not mocked)                   | PASS   | Real files in `/tmp/corpus-e2e-ws`, real git. Only TEST-9/10 lean on the unit matrix; I re-ran them for real (both pass).                 |
| Scenarios cover acceptance criteria     | PASS\* | \*TEST-3's fixture was weaker than the contract's Given — it missed the case that actually breaks (see FAIL-1). Coverage otherwise full.  |
| Application restarted after changes     | PASS   | N/A for a library; every probe imported freshly built sources, and `npm run build` was re-run from a clean tree before evaluation.        |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus", plus "opus (claude-opus-5, 1M context)" in the TEST-62 addendum.                                                  |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                           |

Spot-check of log claims against the tree at HEAD: the log reports two `.claude/agents/*.md`
files rejected as unparseable YAML and "escalated to the orchestrator". At HEAD those files
parse — `git show ac6949f` shows the same commit quoted both descriptions. The log narrates a
resolved escalation as open; a stale note, not a fabrication.

## Criteria Results

| #        | Criterion                                            | Result   | Notes                                                                                                                                        |
| -------- | ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-1   | Byte-stable round-trip over a real corpus            | PASS     | My own 11-file corpus (minimal, full §5, 3-turn thread, plugin `publish:`, comments + odd key order, CRLF, no trailing NL, BOM, astral unicode, `due: null`, omitted-`due`) → `git status --porcelain` empty. |
| TEST-2   | Round-trip over the repo's Claude Code frontmatter   | PASS     | 21/21 files under `.claude/skills` + `.claude/agents` round-trip byte-identically; 0 rejected; `name`/`description` preserved; no validation tripped. |
| TEST-3   | Targeted mutation changes only the targeted field    | **FAIL** | See FAIL-1. Untouched YAML flow collections, comment spacing and nested indentation are reformatted by any single-field mutation.               |
| TEST-4   | Malformed input fails loudly                         | PASS     | No-fence and unterminated raise `DocumentParseError` naming path + line; empty block parses to `{}` then yields 5 named validation issues, no throw. |
| TEST-5   | Canonical frontmatter validates; plugin keys pass    | PASS     | `publish:` (nested), `name:`, `description:` preserved verbatim; core fields typed as declared.                                                 |
| TEST-6   | Thread frontmatter adds §6 fields                    | PASS     | `agent: requested` validates; omitting `agent` applies default `none` in memory only — the schema-default branch the contract allows, and TEST-17 holds for that file (verified on disk). |
| TEST-7   | Turn parsing on the §6 heading grammar               | PASS     | 3 turns in document order with author/ts/body; preamble excluded and preserved on rewrite.                                                      |
| TEST-8   | Appending guarantees a strictly greater timestamp    | PASS     | ts equal to last → `10:07:13Z`; ts earlier than last → `10:07:13Z`; both unique and strictly increasing; preamble intact.                       |
| TEST-9   | Deleting a turn by timestamp identity                | PASS     | Middle turn removed, first/third unchanged, deleted turn reported; absent timestamp → `null` and byte-identical body.                           |
| TEST-10  | Turn heading inside a fence does not split           | PASS     | Fenced `## user · 2026-01-01T00:00:00Z` stays verbatim inside a single turn.                                                                    |
| TEST-11  | Ids match the grammar, no collisions at scale        | PASS     | 10,000 × 4 prefixes = 40,000 ids, zero duplicates per prefix, all matching.                                                                     |
| TEST-12  | Collision predicate honored, gives up loudly         | PASS     | First-three-taken → id after 4 probes; always-taken → `IdGenerationError: … after 5 attempts`.                                                  |
| TEST-13  | Ref extraction ignores code, aliases, offsets        | PASS     | 4 refs in source order with correct aliases; offsets slice back exactly; fenced/inline-code refs and `[[unclosed` produce nothing, no throw.    |
| TEST-14  | Path conventions and containment                     | PASS     | Thread flat regardless of folder hint; slug lowercased/hyphenated/capped at 60; no folder → `data/docs/inbox/`; all 4 traversal inputs → `null`. |
| TEST-15  | An error for each §14 hard-failure rule              | PASS     | All 12 rules fire with an identifying code and a payload naming the document; the clean control yields 0 errors / 0 warnings. Note: a `doc_*` id on `type: thread` surfaces as `frontmatter-invalid` naming the id pattern rather than `id-prefix-mismatch` (the reverse direction emits the dedicated code) — still an error, still identified. |
| TEST-16  | Orphaned anchors / unresolved refs are warnings      | PASS     | All three produce warnings with an empty error list; dropping the resolver removes exactly the resolution-dependent warning.                    |
| TEST-17  | Reading does not materialize defaults into the file  | PASS     | `due: null` file byte-identical after read+write; defaults-omitting file's diff contains only the mutated field's line; the thread that omits `agent` gains no `agent:` line. |
| TEST-63  | File shape agrees with the wire contract             | PASS     | Defaulted minimal frontmatter passes `DocFrontmatterSchema` unmodified.                                                                         |
| TEST-62  | Checker composes with the real resolver              | PASS     | Re-verified independently: `checkCorpus(docs, { resolveAnchor })` — property shorthand, no cast/adapter — `tsc --noEmit --strict` exit 0; resolvable anchor silent, unresolvable → 1 warning, 0 errors. |
| TEST-61  | Seed documents pass the real validator               | PASS     | Deferred in the log; runnable now that both issues are on this branch, so I ran it — 0 errors, 0 warnings over `assets/workspace/` (see AGENT-001 eval). |
| Extra    | Adversarial round-trips                              | PASS     | `---` in body, body starting with `---`, YAML anchors/aliases, block scalars, BOM+CRLF together, empty body, CRLF without trailing newline — all byte-stable. |

## Failures

### FAIL-1: A single-field mutation reformats untouched YAML in the frontmatter

**Criterion**: TEST-3 — "A line-by-line diff of before vs. after shows exactly one changed
line — the `title` line. Comments, key order, quoting style of untouched keys, and the entire
body are byte-identical." Also the issue's own design ("`serializeDocument` … mutating only
the nodes whose values actually changed") and SPEC §4's premise that autosaved git history
stays meaningful.

**Expected**: exactly one changed line.

**Observed**: three changed lines on the contract's own fixture shape, and the failure
reproduces on a document with entirely ordinary formatting. Minimal case — a canonical
frontmatter with `tags: [core]`, mutating only `title`:

```
title: T      -> title: Z          (intended)
tags: [core]  -> tags: [ core ]    (untouched key, reformatted)
```

Full fixture (YAML comments, non-alphabetical key order, single-quoted value — exactly the
contract's Given), mutating only `title`:

```
L3: - "type: note   # trailing comment"      L3: + "type: note # trailing comment"
L4: - "title: 'Single quoted title'"         L4: + "title: 'Renamed by the write path'"
L8: - "tags:   [finance,   housing]"         L8: + "tags: [ finance, housing ]"
L12: - "      exact: assume a 30-year …"     L12: + "    exact: assume a 30-year …"
L15: - "due:    2026-08-01"                  L15: + "due: 2026-08-01"
```

The un-mutated round-trip is byte-stable (TEST-1 passes), so the regression is confined to
the mutation path: it re-emits the whole YAML block from the AST instead of replacing only
the changed node. Affected shapes, isolated: any non-empty flow collection (`[a, b]` →
`[ a, b ]`), inner whitespace before a trailing comment, nested-mapping indentation other
than two spaces, and extra spaces after a key's colon. Empty flow collections (`tags: []`,
`anchors: {}`), block mappings, block scalars and quoted scalars are unaffected.

**Consequence for later issues**: SERVER-005 autosaves through this path, so every save of a
document whose frontmatter uses `tags: [a, b]` will carry a spurious diff line into its
auto-commit.

**Steps to reproduce**:

1. `cd /Users/theophanerupin/code/corpus`
2. Write `/tmp/repro.ts`:
   ```ts
   import { parseDocument, serializeDocument, setFrontmatterFields } from "@corpus/server";
   const raw =
     "---\nid: doc_i000001\ntype: note\ntitle: T\ncreated: 2026-07-19T10:00:00Z\n" +
     "updated: 2026-07-19T10:00:00Z\ntags: [core]\n---\n\nbody\n";
   const out = serializeDocument(setFrontmatterFields(parseDocument(raw, "x.md"), { title: "Z" }));
   console.log(out);
   ```
   (run it from inside the repo so `@corpus/server` resolves — e.g. place it in
   `node_modules/.eval/`)
3. `./node_modules/.bin/tsx node_modules/.eval/repro.ts`
4. Observe `tags: [ core ]` in the output where the input had `tags: [core]`.

## Summary

16 of 17 SERVER-001 acceptance tests pass, plus the three cross-issue tests it owns a side of
(TEST-61, TEST-62, TEST-63). The parse/serialize/validate/check core is solid under
adversarial input — BOM, CRLF, astral unicode, YAML aliases, `---` in the body, every §14
rule. The single failure is real and load-bearing: byte stability holds for pure reads but
not for the mutation path the whole write layer will use.

**Verdict: FAIL** — fix FAIL-1 and re-verify TEST-3 with a fixture that includes a non-empty
flow collection and irregular inline spacing.
