# [CLI-019] `corpus search` + `corpus doc related`: token-frugal retrieval verbs

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-022, SERVER-040, SERVER-041
- Blocks: AGENT-008, CLI-020

## Spec References
- SPEC.md §7 Retrieval discipline (SHARED-006 Edit 4), §9.2 (Edits 7, 8)

## Summary
The agent's retrieval surface. `corpus search "<query>"` with the same filter flags as
`corpus doc list` (shared flag definitions — they must not drift) plus `--limit`;
`corpus doc related <id> [--limit] [--include-archived]`. Output is the **token-frugal
contract**: one line per hit — id, heading path (or relation label for related), the
snippet/excerpt — nothing else; a `--json` escape hatch mirrors the wire shape. Both
are thin typed-client calls; no local logic beyond formatting. Exit codes and error
rendering follow the existing verb conventions.

## Acceptance Criteria
- [x] One line per hit, **space-padded columns in the existing list-output style** (Open Conflict 1,
      ruled by the orchestrator 2026-07-31: the issue's "tab-separated" is struck; `--json` is the
      mechanical parse target); no bodies, no wrapping, stable field order (agents parse this)
- [x] Filter flags shared with `doc list` (single definition site); `--json` mirrors the wire response
- [x] Empty result and unknown id render per existing conventions (empty table / 404 error path)
- [x] Search verb prints the semantic-state note line ONLY when the server flags degraded ranking (silent in Phase A)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/search.ts` (new), `apps/cli/src/commands/doc/related.ts` (new), shared filter-flag module with `doc/list.ts`, command registration

As built: `commands/search.ts`, `commands/doc/related.ts`, `commands/filters.ts` (shared flags +
collector + `oneOf`), `commands/columns.ts` (the house row renderer + `oneLine`, moved out of
`doc/list.ts`), `commands/retrieval.ts` (the degraded-ranking note), their five test files, plus
edits to `commands/doc/list.ts`, `commands/doc/index.ts`, `registry/index.ts`,
`commands/hygiene.test.ts` (both pinned inventories) and the regenerated `docs/cli.md`.

## Testing Strategy
apps/cli scoped: output formatting against a stubbed client (frugal line shape, --json passthrough, degraded-note gating), flag-parity test with doc list.

## E2E Verification Plan
Real server + seeded workspace via the bin (`apps/cli/src/bin/corpus.ts`): search a phrase, follow a related id, confirm one-line-per-hit output and that a full doc read remains a separate `corpus doc show` (C13 — there is no `corpus doc get`).

## Recorded Decisions

1. **Output is padded columns, three fields, last ragged** (OC1 as ruled). `search`: `id`,
   `headingPath`, `snippet`. `doc related`: `id`, `relation`, `excerpt`. The wire's `title` is
   **not** a fourth column: the sprint pins this line shape (TEST-700) because AGENT-008's skill
   text quotes it, and `headingPath` already falls back to the title when a passage has no heading
   above it. `--json` carries the title for anything that needs the field.
2. **The house table is now one function**, `commands/columns.ts#renderColumns`, moved verbatim out
   of `doc/list.ts` and used by all three verbs (Adjudication 3 — no second implementation beside a
   shipped one). `doc/list.test.ts`'s exact-output assertion is unmodified and green, which is the
   proof the move changed nothing. `oneLine` (whitespace collapsed, **nothing truncated**) went with
   it: TEST-700 requires a hit to print on one line even if a snippet arrives with a newline, and
   TEST-708 forbids trimming the server's snippet.
3. **The shared flags live in `commands/filters.ts`** — `DOC_FILTER_FLAGS` (the fourteen structured
   filters, in `doc list`'s published order), `collectDocFilters`, and the `oneOf` enum validator
   that was local and unexported. `doc list` keeps only what the two endpoints genuinely disagree
   about: `--q`, `--pinned`, `--sort`, `--offset`. `--pinned` has always sat between `--unread` and
   `--due`, so it is spliced back with `insertFlagAfter` rather than the shared list being cut in
   two — the same device the contract uses for `docFilterShape` around `pinned`, for the same
   reason (published order is load-bearing).
4. **`doc related` declares its own `--include-archived`**, not the shared one, mirroring
   CONTRACT-022's Recorded Decision 6: the shared wording is written around `--status`, which this
   verb does not take, so reusing it would document a flag that is not on the command. The rule is
   the same and the description says so.
5. **The degraded note is a `#`-prefixed human line**, printed above the results and suppressed
   under `--json` (where `semanticIndex` is already a field). It is gated on `!== "current"` with
   the state interpolated — no exhaustive match — which is the contract's published rule and is what
   lets a Phase B state a released CLI has never heard of still read as degraded.
6. **No tally line on either verb.** `doc list` ends in "showing 1–2 of 2" because it pages and a
   page must never read as the whole set; a ranked result is a top-k by contract (no `offset`, no
   `total`), so the equivalent honesty is stating the cap in the help text — which both verbs do —
   rather than inventing a count line inside the parse target.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 2026-07-31, sprint-019, branch `phase-7-retrieval-a`, main tree —
sole agent in it). Ports: **8807** for the real server (the orchestrator's dispatch assignment;
the sprint table says 8808, which was used only for the stub drill below — both were free before and
after). `8765` was never bound, never killed, never proxied into. Scratch:
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s019-cli/cli-019-WWZK6M` (workspace, seed file,
docs snapshots); nothing glob-deleted, nothing under `/tmp`, every drill run from a cwd **outside**
this repository (`pwd` pasted below). No git command was run by this agent.

### Checks

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 (contract → kit → apps), then `npm run build -w apps/cli` before the E2E drill |
| `npm run typecheck -w apps/cli` | exit 0 |
| `npm run lint` | exit 0, **0 warnings** |
| `npm run format:check` | exit 0 (`All matched files use Prettier code style`) |
| `VITEST_MAX_THREADS=4 vitest run apps/cli scripts/workspace-template.test.ts` | **74 files, 1126 tests, exit 0** |
| `VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts` | 96 tests, exit 0 — TEST-718's resolver gate, with `CLI_COMMANDS_PENDING_CLI_006` still empty |

New tests: `commands/columns.test.ts` (7), `commands/filters.test.ts` (11),
`commands/retrieval.test.ts` (7), `commands/search.test.ts` (17), `commands/doc/related.test.ts`
(14) — **56 new tests**. `commands/doc/list.test.ts` (24) and `commands/hygiene.test.ts` (12) pass
with no assertion weakened; hygiene gained the three new module paths in both pinned inventories,
which is how a new command module is supposed to show up.

### The extraction left `doc list` alone (C10's bar)

`docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`, diffed against the pre-change copy:

```
/usr/bin/diff cli.before.md docs/cli.md   →   17a18  28a30  198a201,264  263c329  643a710,721  644a723,724  645a726,758
lines removed (`^<`): 1   — and that one line is the `corpus doc` topic description, which this
                            issue deliberately edits to name `related`.
```

Every other hunk is an append: two contents entries, the `## corpus search` section, the
`### corpus doc related` section. The `corpus doc list` section is **byte-identical**:

```
/usr/bin/awk '/^### `corpus doc list`/,/^### `corpus doc move`/'  (before | after)
→ DOC-LIST SECTION BYTE-IDENTICAL
7aa0e6eadf5f4685952ead64aa3f3302e48720d0a6bb2260f58b68280ba06ffe   (both, 67 lines)
```

Regeneration is idempotent (`shasum -a 256 docs/cli.md` identical over two runs:
`d31eeb45b8174670b4e8b4e490f3d4a0d006bbe99de8b7d02684d378a08f30ab`).
`node --import tsx scripts/check-generated-artifacts.ts` reports the contract artifacts green and
`✗ CLI reference is stale: docs/cli.md` — that is the check **firing correctly**: it regenerates and
then runs `git diff --stat HEAD`, so an uncommitted regeneration always reads as drift, and this
agent commits nothing. It goes green when the orchestrator commits `docs/cli.md` with the code
(TEST-707). The invariant this agent can prove — working tree equals generator output — is the
byte-identical second run above.

One Prettier trap found and avoided: `` ` › ` `` inside a description is rewritten by Prettier to
`` `›` `` when it formats the generated markdown, which fails `format:check` on every regeneration.
The description now says "joined for display by a spaced `›`". Same family as the unescaped-`|`
gotcha from CLI-003.

### Real server, real bin, real corpus (TEST-711)

```
cd /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s019-cli/cli-019-WWZK6M/ws && pwd
corpus() { node /Users/theophanerupin/code/corpus/apps/cli/dist/bin/corpus.js "$@"; }

corpus init --port 8807      → port 8807, token in .corpus/config.json (mode 600); git initialized
corpus server start          → corpus 0.0.0 listening on http://127.0.0.1:8807 (pid 9410)
corpus health                → ok — corpus 0.0.0, up 0s, workspace …/cli-019-WWZK6M/ws
```

Seeded with `corpus doc create` / `thread create` / `thread reply` only — no file was written by
hand: `doc_yztybxg3` Survey timeline, `doc_zlkcpd7h` Mortgage options (nested `# → ## Rates →
### Rate lock`, a `[[doc_yztybxg3]]` link and a fenced `# Fake heading inside a fence`),
`doc_b6lbvtwz` Kitchen quotes, `doc_wtdpyztw` Lender research (**37 526 bytes**), and thread
`th_ycqhvxjh` anchored on the mortgage note with an agent reply.

**Ranked search, heading paths, one line per hit:**

```
$ corpus search "rate lock deadline"
doc_wtdpyztw  Lender research › Background          …notes on the rate lock deadline, fees, and comparable products across lenders…
doc_zlkcpd7h  Mortgage options › Rates › Rate lock  …survey dates. ## Rates ### Rate lock The rate lock deadline is 30 June…
th_ycqhvxjh   agent · 2026-07-31T16:24:43Z          …the rate lock deadline is unchanged, so 6.1% holds.
doc_b6lbvtwz  Kitchen quotes › Cabinets             …quotes ## Cabinets Three quotes, none of which mention a rate lock deadline.
doc_yztybxg3  Survey timeline › Risk                …Risk If the survey slips, the rate lock deadline is at risk.
```

Five hits, five lines, no bodies, no header, no blank lines. The nested path resolves three levels
deep; the turn hit's path is the turn's own heading (`agent · <ts>`, U+00B7); the fenced `# Fake
heading` never appears as a path.

**The discipline demo — retrieval and reading as two separate acts (TEST-710):**

```
$ corpus search "6.1% assumption for the whole term" --limit 3
doc_zlkcpd7h          Mortgage options › Rates › Rate lock  …the assumption we agreed is 6.1% for the whole term. ```md…
doc_skillcomment      Reply                                 …6.1% for a 30-year fixed today. Updated the assumption and…
doc_skillorchestrate  Progress and job logs                 …the change: `"edited [[doc_a1b2c3]] — updated the rate assumption to 6.4…

$ corpus doc show doc_zlkcpd7h          # ← the winner's id, read deliberately
Mortgage options
doc_zlkcpd7h · note · open
data/docs/finance/mortgage-options.md
created 2026-07-31T16:24:28Z · updated 2026-07-31T16:24:28Z
tags finance, housing
anchors:
  anc_5963c1ff → th_ycqhvxjh (open) · chars 114–147 · "The rate lock deadline is 30 June"

# Mortgage options
… (the body, which only this command printed)
```

Nothing between the two listed a directory or read a file. The search output contains no body; the
`doc show` output contains it.

**Expansion, with relation labels, both directions of the graph:**

```
$ corpus doc related doc_zlkcpd7h
doc_yztybxg3  linked  # Survey timeline ## Booking The surveyor is booked for the week of 12 June. ## Risk If the survey slips, …

$ corpus doc related doc_yztybxg3      # the incoming side of the same edge
doc_zlkcpd7h  linked  # Mortgage options Two lenders are in play; see [[doc_yztybxg3]] for the survey dates. ## Rates ### Rate lock …
```

**Empty results, `--json`, filters, the 404 path, the enum refusal:**

```
$ corpus search "unobtainium"        → no documents match.        exit=0
$ corpus doc related doc_b6lbvtwz    → no related documents.      exit=0

$ corpus search "rate lock deadline" --limit 1 --json
{"hits":[{"id":"doc_wtdpyztw","title":"Lender research","headingPath":"Lender research › Background","snippet":"…notes on the rate lock deadline, fees, and comparable products across lenders…"}]}
$ corpus doc related doc_zlkcpd7h --json
{"related":[{"id":"doc_yztybxg3","title":"Survey timeline","excerpt":"# Survey timeline ## Booking …","relation":"linked"}]}

$ corpus search "rate lock deadline" --folder finance --type note    → 3 hits (the thread and the
                                                                       home-folder note drop out)
$ corpus doc related doc_nope        → corpus: 404 not_found: no document with id doc_nope   exit=5
$ corpus doc related doc_nope --json → {"error":{"code":"not_found","message":"404 not_found: no document with id doc_nope"}}   exit=5
$ corpus search "rate" --status closed
                                     → corpus: --status must be one of: open, resolved, archived — got "closed".   exit=2  (no request sent)
```

Note the Phase A server omits `semanticIndex` entirely — absent, per the frozen contract — and the
CLI prints nothing about ranking.

**The frugal claim, measured (TEST-709):**

| What | Bytes |
| --- | --- |
| `corpus search "rate lock deadline"` (5 hits) | **631** (≈126 per hit) |
| `corpus search … --json` | **906** |
| `corpus doc list --q "rate lock deadline" --json` | **5 442** |
| `corpus doc show doc_wtdpyztw` (one matching document) | **37 679** |

The search output is a small multiple of the hit count and is unmoved by the 37 KB document, which
contributes one line. The enumerate-then-read path costs the list *plus* a body read — 60× the whole
ranked answer for a single document, and this corpus has five.

**Degraded-note gating through the real bin** — Phase A's server cannot produce a non-`current`
state (TEST-685 makes the field inert), so the third case was driven by pointing the real bin at a
stub workspace on 8808 whose server answers with the field set:

```
=== semanticIndex=current ===
doc_zlkcpd7h  Mortgage options › Rates  …the rate lock deadline is 30 June…          ← nothing printed

=== semanticIndex=indexing ===
# ranking is degraded — the semantic index is "indexing" (SPEC.md §9.1); these results are ranked on the lexical half alone.
doc_zlkcpd7h  Mortgage options › Rates  …the rate lock deadline is 30 June…

=== semanticIndex=indexing, with --json ===
{"hits":[…],"semanticIndex":"indexing"}                                              ← no note; the state is a field
```

The absent case is the real server above. `commands/retrieval.test.ts` covers all four contract
states plus one nobody has defined (`"reticulating"` → degraded), which is the forward-compatibility
the `!== "current"` rule exists for.

### Negative evidence (`/usr/bin/grep`, per Adjudication 13)

```
$ /usr/bin/grep -rn "padEnd" apps/cli/src
apps/cli/src/help.ts:113 …                       (help's two-column layout, pre-existing)
apps/cli/src/docs/generate.ts:189 …              (the markdown table generator, pre-existing)
apps/cli/src/commands/workspace/upgrade.ts:559,564 …  (upgrade's report, pre-existing)
apps/cli/src/commands/columns.ts:23 …            ← the one row renderer, now shared by three verbs

$ /usr/bin/grep -n 'name: "pinned"\|name: "sort"\|name: "offset"' apps/cli/src/commands/search.ts
(no match)
$ /usr/bin/grep -n "fetch(\|http://\|https://" apps/cli/src/commands/{search,filters,columns,retrieval}.ts apps/cli/src/commands/doc/related.ts
(no match)
$ /usr/bin/grep -n "client.request" apps/cli/src/commands/search.ts apps/cli/src/commands/doc/related.ts
search.ts:40    doc/related.ts:36                ← one typed call each, and nothing else (TEST-708)
$ /usr/bin/grep -n "corpus search" docs/cli.md | head -2
18:- [`corpus search`](#corpus-search)     201:## `corpus search`     (712: ### `corpus doc related`)
```

### Struck / deferred

- **The degraded note against a real Phase A server** — `DEFERRED → the field is inert in Phase A by
  contract (TEST-666, TEST-685)`. Substitute evidence: the real bin driven against a stub answering
  each state (above), plus the four-state unit test.
- **`check-generated-artifacts.ts` green** — `DEFERRED → the orchestrator's commit`. Reason and the
  substitute invariant (byte-identical regeneration) recorded above.
- Nothing else struck.

### Cleanup

```
$ corpus server stop                     → stopped (pid 9410)
$ lsof -nP -iTCP:8807 -sTCP:LISTEN       → (no listener)
$ lsof -nP -iTCP:8808 -sTCP:LISTEN       → (no listener)
$ ls -d /Users/theophanerupin/code/corpus/.corpus
  ls: /Users/theophanerupin/code/corpus/.corpus: No such file or directory
```

The stub process was started and killed by recorded pid in the same shell; no `pkill`, no `killall`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
