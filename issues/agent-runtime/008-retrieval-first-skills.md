# [AGENT-008] Retrieval-first stewardship rules in the product skills

## Domain
agent-runtime

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-019
- Blocks: AGENT-009

## Spec References
- SPEC.md §1 retrieval principle (SHARED-006 Edit 1), §7 Retrieval discipline rules (Edit 4)

## Summary
Bind the three signed rules into `assets/workspace/claude/skills/{orchestrate,comment}/SKILL.md`:
**search before reading** (locating content is `corpus search`/`corpus doc related`;
reading a body is a separate deliberate act on a retrieved id), **never enumerate the
corpus** (no wholesale listing/reading to find something), **subagents receive
anchors, not documents** (delegated dispatches carry task + top-k ids/heading
paths/snippets; the subagent retrieves what it needs itself). Rules bind the
orchestrator and every subagent (§7's "every invariant binds subagents"). Weave into
the existing delegation (N=10) and comment-handling text — don't bolt on a section
that contradicts the surrounding flow; update the subagent-dispatch brief template to
carry anchors.

## Acceptance Criteria
- [x] Both skills state the three rules and use the verbs in their worked examples; no remaining instruction tells the agent to list/read the corpus wholesale
- [x] Dispatch template passes top-k anchors; explicitly forbids forwarding whole documents — read per **C11**: there is no template, so the rule lands in the delegation prose (prompt-contents list, the "A dispatch carries anchors, not documents" paragraph, and the binds-inside-the-subagent list)
- [x] Skill text stays consistent with the delegation/defer/trace-line rules already there (read the whole files first)

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md`, `assets/workspace/claude/skills/comment/SKILL.md`

## Testing Strategy
Prose-only change: `/usr/bin/grep` audits for contradicting instructions; `npm run format:check` on the touched files. The workspace-template copy test (if one exists in apps/cli) still green.

## E2E Verification Plan
`corpus init` a scratch workspace (explicit path under the job tmp dir) and read the installed skills: rules present, examples use `corpus search`.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 2026-07-31, sprint-019, branch `phase-7-retrieval-a`, main tree —
sole agent in it). Port **8809**, passed explicitly to every `corpus init`; **no server was started**
(the drill is an install-and-read-back, TEST-720) and `8765` was never bound, killed or proxied into.
Scratch: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s019-agent/008-Ey2bGF` — created with
`mktemp -d` under the sprint's prefix, nothing under bare `/tmp`, nothing inside the repository,
nothing glob-deleted. The drill ran from a cwd **outside** this repository (`pwd` pasted below).

**Binding sources.** Sprint-019's premise corrections and Orchestrator adjudications override this
issue file: **C11** (there is no dispatch-brief template — the edit sites are `orchestrate/SKILL.md`
delegation prose), **C12** (`format:check` does not police `assets/workspace/`; the real gate is the
CLI-doc resolver), **C13**/Adjudication 15 (`corpus doc show`, never `doc get`), and
**Adjudication OC2** (the folder survey is reworded to retrieval-first filing; no tree verb is named
— that is CLI-023, backlog). SPEC §7's three signed rules are implemented, not paraphrased.

### What changed — `orchestrate/SKILL.md` (474 → 483 lines)

| Site | Change |
| --- | --- |
| Frontmatter `updated` | `2026-07-30` → `2026-07-31` (the template's own "updated tracks content" rule; `workspace-template.test.ts:141-154` requires the two skills' `updated` to exceed `created`) |
| **Invariants**, new item 6 (`:53-60`) | *"You retrieve; you never enumerate."* — all three rules in the one place the file already declares binds "every step below — and every subagent you dispatch, without dilution". Locating is `corpus search` / `corpus doc related`; reading a body is a separate deliberate act via `corpus doc show <id>`; the last sentence hands rule 3 to Delegation. No renumbering: 1–5 are untouched |
| **Delegation** `:156-164` (C11's first site) | the prompt-contents list gains "**the anchors it should start from**" beside the event id, payload ids, skill and binding rules |
| **Delegation**, new paragraph `:166-173` | *"A dispatch carries anchors, not documents."* — the payload's ids are already anchors; extra context is retrieved **before** dispatch (`corpus search "<the request's subject>" --limit 5`, or `corpus doc related <id>`) and pasted back verbatim as ids + heading paths + snippets; never a body, never a file, never a request that the subagent report the corpus's contents |
| **Delegation** invariant list `:196-199` (C11's second site) | new bullet: retrieval discipline binds inside the subagent — locate with the two verbs, open a body only with `corpus doc show` on a returned id, never list or sweep, never handed and never asks for a corpus dump |
| **Stewardship** charter `:386-390` | new bullet: *"What you steward, you found by retrieving."* — the near-duplicate and the better home are one `corpus search` away; `corpus doc related` walks out from the document in hand. Closes the one place the charter could have been read as licensing a sweep to *find* stewardship work (the existing "corpus-wide sweep is separate work" scope rule is unchanged and now consistent) |
| **Worked example** `:450-472` | the orchestrator runs `corpus search "rate assumption" --limit 5` between the *claimed* and *dispatched* job-log lines; two ranked lines shown in the real output shape (id, heading path, `…snippet…`), no bodies; the dispatch prose now says the prompt carries "those two retrieved lines as the anchors to start from"; inside the subagent the read is `corpus doc show doc_a1b2c3` — "the second line never read at all" |

Untouched, re-read line by line after editing (TEST-716): the loop block, claim/batch rules, the
routing table, the model-by-weight table and its three-question judgment rule, **N=10** concurrency
(`:246-250`), locks/deferral including `--blocked-on` and automatic re-entry, job-log rules, HALT,
skills-are-documents, operator recovery (`corpus skill rollback`). The single rewrap outside a change
site is in the same Delegation paragraph ("…then claim." / "Settlement never depends on…" moved to
its own line) — forced by `workspace-template.test.ts:452`, whose regex has no `\s+`; wording
identical.

### What changed — `comment/SKILL.md` (472 → 481 lines)

| Site | Change |
| --- | --- |
| Frontmatter `updated` | `2026-07-30` → `2026-07-31` |
| **Inherited invariants**, new item 6 (`:65-70`) | mirrors orchestrate's rule 6 and adds rule 3 in this skill's own terms: a subagent it spawns receives anchors — ids, heading paths, snippets — never a document body |
| **Gather context** `:81-87` — **TEST-713** | the *"Content may be read from the tree"* licence (old `:75-78`: "to survey which folders exist, or to skim a neighbouring document … is allowed") is **deleted** and replaced by *"Locating goes through retrieval."*: `corpus search` (one line per hit, never a body) and `corpus doc related`; "Never list `data/docs/`, never open files to find out what they are about"; reading "follows retrieval, one id at a time and only where the ranking pointed — and it is `corpus doc show <id>`, never the markdown on disk". **No direct-read carve-out survives.** The neighbouring "State goes through the CLI" bullet is unchanged |
| **Doing the work** → *Spawn a subagent* `:164-169` | the handoff now carries "the task and the anchors it starts from — the ids, heading paths and snippets `corpus search` printed, pasted as they printed — and never a document body" |
| **Inbox filing** step 4 `:209-216` — **TEST-714 / OC2(b)** | *"Survey the folders that already exist by reading `data/docs/`"* is **deleted**. Replaced by *"Choose a destination by finding its neighbours"*: `corpus search "<what the capture is about>" --limit 5`, then `corpus doc show <id>` on the closest hit — whose path names the folder — and "prefer one that already holds similar documents" (kept verbatim; it is pinned by `workspace-template.test.ts:652`), "Never go looking through the tree for folder names", and a nothing-related branch that names a new folder from the subject. **No tree verb is referenced** — none exists (CLI-023 is backlog) |
| **Skill genesis** → *Extend an existing skill* `:339-342` | *"Read what is installed under `.claude/skills/`"* → *"Find the skill whose job the pattern belongs to the way you find anything else — `corpus search "<the pattern>" --type skill`, since a skill is indexed like every other document"*. This was the second enumerate-to-find instruction in the file; `--type skill` is a documented `corpus search` filter (`docs/cli.md:229`) |
| **Worked example 3** (inbox capture) `:463-467` — **TEST-717** | after the retitle/expand, `corpus search "home and auto insurance policies" --limit 5` prints two ranked lines, then `corpus doc show doc_3f9a01  # its path is data/docs/finance/… — that is the folder`, then the existing `corpus doc move … --folder finance`. Retrieval, then one deliberate read, then the act |

Untouched (TEST-716): the payload contracts, the three thread shapes and their stopping rules, the
standalone-title obligation, routing directives, the `423` defer protocol (reply → job log → hand the
event back; no queue verb), reply/trace-line grammar, engagement, forms, stewardship-in-service,
the skill-create mechanics, edge cases, examples 1, 2 and 4.

### Tests (TEST-718, TEST-719)

`.prettierignore` excludes `assets/workspace/` ("its bytes are what `corpus init` installs … Prettier
must never rewrap or re-mark it"), so the issue's `npm run format:check` is a **no-op on these
files**, and `apps/cli/src/commands/init/scaffold.test.ts:76-90` is a **byte-fidelity copy** test,
not a content test — it cannot notice a wrong rule (C12). What was run instead:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts
 ✓ scripts/workspace-template.test.ts (96 tests) 20ms
 Test Files  1 passed (1)      Tests  96 passed (96)
```

Green **with `CLI_COMMANDS_PENDING_CLI_006` still empty** (Adjudication 8): every `corpus …`
invocation added here — `corpus search`, `corpus doc related`, `corpus doc show` — resolves against
CLI-019's regenerated `docs/cli.md` headings (`:201`, `:712`, `:759`). One intermediate failure and
its fix are recorded above (the `Settlement never depends…` rewrap). No test was edited, added or
weakened; this issue touched only the two skill files and this issue file.

### The installed workspace carries the rules (TEST-720)

```
$ mkdir -p …/tmp/s019-agent && WS=$(mktemp -d …/tmp/s019-agent/008-XXXXXX)   → 008-Ey2bGF
$ ( cd "$WS/ws" && pwd && node --import file://$REPO/node_modules/tsx/dist/loader.mjs \
      $REPO/apps/cli/src/bin/corpus.ts init --port 8809 )
/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s019-agent/008-Ey2bGF/ws
Initialized Corpus workspace at …/008-Ey2bGF/ws
  port 8809, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  installed 8 template files, recorded in .corpus/template-manifest.json
```

(The bin is `apps/cli/src/bin/corpus.ts` run from source; `--import tsx` resolves only inside the
repo, so the loader was addressed by absolute path — the workspace is outside this repository and
has no `node_modules`.)

Read back **from the installed copy**, not from `assets/`:

```
$ /usr/bin/grep -n "…" $WS/ws/.claude/skills/orchestrate/SKILL.md
53:6. **You retrieve; you never enumerate.** Locating something is always
167:**A dispatch carries anchors, not documents.** The payload's ids are anchors already; when
197:- Retrieval discipline binds inside the subagent exactly as it binds you: it locates with
386:- **What you steward, you found by retrieving.** The near-duplicate worth folding in and the
455:corpus search "rate assumption" --limit 5

$ /usr/bin/grep -n "…" $WS/ws/.claude/skills/comment/SKILL.md
65:6. **You retrieve; you never enumerate.** Locating something is `corpus search "<query>"` or
81:- **Locating goes through retrieval.** Finding *where* something is said is
166:  back; then hand off. Its prompt carries the task and the anchors it starts from — the ids,
209:4. **Choose a destination by finding its neighbours.** Search for the documents this capture
340:  the way you find anything else — `corpus search "<the pattern>" --type skill`, since a
463:corpus search "home and auto insurance policies" --limit 5

$ /usr/bin/grep -n -i "Survey the folders\|Content may be read from the tree" \
    $WS/ws/.claude/skills/comment/SKILL.md
(no match — both deleted)

$ /usr/bin/diff -q <installed> <assets/…>   → orchestrate-identical, comment-identical
```

The drill was **re-run against the final bytes** (`…/008-Ey2bGF/ws2`, again `--port 8809`, again from
a cwd outside the repository) after the last line-rewrap landed, so the byte-identity above is the
shipped text: `orchestrate-identical`, `comment-identical`, `corpus search` present 5× in the
installed orchestrate skill and 6× in the installed comment skill, and
`Survey the folders | Content may be read from the tree | corpus doc get` → **no match**.

### Negative evidence — `/usr/bin/grep` over both files (TEST-721, Adjudication 13)

```
$ cd assets/workspace/claude/skills && for t in 'data/docs/' 'read.*tree' 'survey' 'directory' \
    'enumerate' 'corpus doc list' 'folder' 'skim' '\bls\b' 'glob' 'installed under' 'browse' \
    'scan' 'sweep' 'whole corpus' 'each document' 'every document'; do
      /usr/bin/grep -n -i -E "$t" orchestrate/SKILL.md comment/SKILL.md; done
```

| Hit | Verdict |
| --- | --- |
| `comment:84` "Never list `data/docs/`, never open files to find out what they are about" | **rewritten** — the prohibition itself (replaces the old tree licence) |
| `comment:199` "land a new document in `data/docs/inbox/`" | **kept** — states where captures arrive; not a read instruction |
| `comment:467` `corpus doc show doc_3f9a01  # its path is data/docs/finance/…` | **kept** — the path printed by a deliberate read of a retrieved id; the retrieval-first filing evidence |
| `orchestrate:56` "Never list a folder, never sweep the tree, never read documents to find out what is in them" | **rewritten** — the prohibition |
| `comment:353` "Survey what changed this week…" | **kept, deliberately** — it is the *body of an example new skill* (`corpus skill create weekly-review`) passed through a heredoc, i.e. content the agent writes for a person, not an instruction to this agent; and a weekly review over what changed is a filtered query, not a find-by-sweeping. Changing it would edit an unrelated worked example that TEST-716 asks to leave alone. This is the only "survey" left in either file |
| `orchestrate:198,403-404`, `comment:67,324-325` "sweep" | **kept/added** — every one is a prohibition or the pre-existing "a corpus-wide sweep is separate work" scope rule, which the new rules reinforce |
| `directory`, `enumerate` (bar the two rule headings), `corpus doc list`, `skim`, `ls`, `glob`, `browse`, `scan`, `whole corpus` | **zero hits** — no instruction to list or read the corpus wholesale survives, and neither file names a verb that does not exist (`corpus doc get`: 0 hits; `corpus tree` / `corpus doc folders`: 0 hits) |

Verb check, both files, every `corpus …` invocation resolved by the suite above: only `search`,
`doc related`, `doc show`, `doc edit`, `doc create`, `doc move`, `doc archive`, `doc unarchive`,
`thread show|reply|resolve`, `job log`, `queue …`, `skill create|rollback`, `lock break|reap` —
all documented in `docs/cli.md`.

### Struck / deferred / disclosed

- **`npm run format:check` on the touched files — STRUCK → C12.** No-op: `.prettierignore` excludes
  `assets/workspace/`. Substitute evidence: TEST-718's resolver suite, the grep audit, the install
  drill. Line wrapping was hand-matched to the surrounding prose (~92 cols).
- **A live `corpus search` against a server — DEFERRED → not this issue's gate.** CLI-019's E2E log
  already walks the real seam end to end against a real server (`corpus search` → `corpus doc show`
  → `corpus doc related`, ports 8807/8808), and the sprint assigns the full replay to the evaluator
  (TEST-732, port 8810). This issue's E2E bar is TEST-720, the install drill, which is executed
  above; the example output shapes written into the skills were copied from CLI-019's pasted real
  output, not invented.
- **Disclosure (TEST-726):** no state-changing git command was run. One **read-only** `git status
  --porcelain` slipped into a compound cleanup check; it confirmed the only modified files are the
  two skills (plus a pre-existing untracked handoff file this agent did not create). Reported rather
  than omitted, since the house rule for this agent is "no git commands" at all.
- **Cleanup:** no process was started, so none was killed. `lsof -nP -iTCP:8809 -sTCP:LISTEN` → no
  listener; `8765` never bound, killed or proxied into. `ls -d /Users/theophanerupin/code/corpus/
  .corpus` → **No such file or directory** (TEST-728). The scratch workspace is left in place under
  `…/tmp/s019-agent/008-Ey2bGF` as evidence; nothing outside it was touched or deleted.

## Completion Checklist (domain agent)
- [x] Tests written and passing — no new test written (prose-only change, and Adjudication 10
  forbids weakening the ones that exist); the gate is `scripts/workspace-template.test.ts`, 96/96
  green, unmodified
- [x] `/lint` passes — **not run by this agent** (C12): these files are Prettier-ignored and hold no
  code, so eslint/prettier/tsc do not reach them; the repo-wide gate is the orchestrator's harvest run
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
