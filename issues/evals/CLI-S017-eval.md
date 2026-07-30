# Evaluation: CLI-017 · CLI-016 · CLI-012 (the sprint-017 CLI trio)

**Date**: 2026-07-30
**Sprint**: sprint-017 (wave 3), TEST-517–547 + applicable cross-issue TEST-572–579
**Verdict**: **PASS** (31 of 31 criteria)

Re-derived against real running applications: scratch workspaces under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-eval3/` (`wsP`, `wsC2`, `wsC3`, `wsU1`, `wsU2`),
all `corpus init`-ed from a cwd **outside** this repository, servers on `9181`/`9183`/`9185`, and —
for the criterion CLI-016 deferred — a real Vite dev server on `5293` with a **proved** proxy target.
No implementation source was read.

**Notable outcome up front:** CLI-016's log marked TEST-528's browser half **DEFERRED** and offered
substitute evidence. I ran it. **It passes** — see FINDING-1. The deferral is discharged.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | All three issues; no placeholders.                                                                                                 |
| Commands are specific and concrete       | PASS   | Exact invocations, exit codes, wire bodies, git output, manifest entries, SSE capture.                                             |
| Real E2E (not mocked)                    | PASS   | Real servers, real workspaces, a real `git clone`, real `CORPUS_PLUGINS_DIR` "newer tool" trees. Unit suites cited beside, not instead. |
| Scenarios cover acceptance criteria      | PASS   | One gap, declared: CLI-016's TEST-528 browser half (DEFERRED with reasons). Closed by this evaluation.                              |
| Application restarted after changes      | PASS   | CLI-017 explicitly rebuilds between the pre-fix and post-fix runs and pastes the `grep -c unarchive dist/…/edit.js → 0` proof of which binary produced which output. |
| Actual model recorded (implemented on:)  | PASS   | All three: `implemented on: opus`.                                                                                                 |
| Reproduction logged before fix (bugs)    | PASS   | CLI-017 is the bug-shaped one: the half-state is reproduced **pre-fix against the previously built binary** (frontmatter `open` while the folder stays in `skills-archived/`, a commit of the lie), then refused post-fix. Both runs pasted. |

---

## Criteria Results

### CLI-012 — plugin seed templates

| #        | Criterion                                     | Result | Observed                                                                                                                                                                                          |
| -------- | --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-517 | Fresh workspace arrives with the template     | PASS   | `corpus init --port 9181` → `installed 1 plugin seed template into data/docs/templates/`; `ls` shows `note.md todo-template.md`; `corpus doc list --type template --json` returns `doc_seedtemplatetodo` `type: template` with `extra={"for":"todo"}` and the task-list excerpt. **Both halves** — on disk *and* indexed. |
| TEST-518 | Installed copy byte-identical to the source   | PASS   | `diff data/docs/templates/todo-template.md plugins/todos/seeds/todo-template.md` → identical. No content is pinned by the CLI, so CLI-012 and PLUGINS-005 stayed order-independent as designed.       |
| TEST-519 | `corpus doc create --type todo` uses it       | PASS   | New `todo` doc body pre-filled: `## What this list is for` / `- [ ] First thing to do` / `- [ ] Something with a deadline (due: 2026-12-31)` / `## Notes`.                                            |
| TEST-520 | Manifest records the provenance                | PASS   | `.corpus/template-manifest.json` → `{"path":"data/docs/templates/todo-template.md","sha256":"e6486f98…","source":"plugin:todos"}` — the same marker `{"path":".claude/skills/todos/SKILL.md",…,"source":"plugin:todos"}` carries. |
| TEST-521 | Upgrade refreshes; never clobbers a user edit | PASS   | Stale copy: `update  data/docs/templates/todo-template.md [plugin:todos]` → `wrote 1 file`, file now ends `(v2: shipped by a newer tool)`. User-edited copy: `keep    … [plugin:todos] — modified here — 1 line only here, 1 line only in the new copy` → `wrote 0 files`, `- [ ] my own starter item` survives. Re-run → `already up to date.` |
| TEST-522 | No `seedTemplate` declared → nothing installed | PASS   | `types.yaml` reduced to `types: [{type: todo, label: Todo}]` with `seeds/` left in place: init prints **no** seed line, `ls templates/` → `note.md` only, manifest entries mentioning `todo-template`: `[]`, no error. Opt-in **by declaration**, not by directory presence. |
| TEST-523 | Declared-but-missing seed warns at the right time | PASS | `warning: plugin todos declares seedTemplate "seeds/does-not-exist.md", which does not exist — skipped; no template was installed for it`, init still succeeds, nothing installed, no manifest entry. Parity with the plugin-skill path (which I saw warn-and-continue for a broken command file in the same run). |
| TEST-524 | Upgrade heals a pre-CONTRACT-021 queue skeleton | PASS | See FINDING-2 — including the half that is the actual gap: a real `git clone` carries it.                                                                                                             |
| TEST-525 | Gitignore comment counts correctly             | PASS   | `assets/workspace/gitignore` now reads *"one directory per queue status — `corpus init` creates them all from the status list itself, so counting them here would only go stale"* — names no number. |
| TEST-526 | Blast radius, CLI surface unchanged            | PASS   | The CLI commit touches `apps/cli/**`, `docs/cli.md`, `assets/workspace/gitignore`. No new verb or flag from CLI-012; `docs/cli.md`'s only CLI-012 diff is `workspace upgrade`'s description. `git diff SPEC.md` / `packages/contract` empty. The declared out-of-radius additions (`yaml` dep, the `plugins.test.ts` verb pin) are reported in the log, not hidden. `docs/workspace-template.md`'s five-directory list — which CLI-012 flagged as a rider rather than fixing — **has since been fixed on the branch** and now names all six. |

### CLI-016 — `--extra`

| #        | Criterion                                    | Result | Observed                                                                                                                                                                                                                |
| -------- | -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-527 | Flag exists, repeats, looks like its neighbours | PASS | `corpus doc edit --help` documents `--extra <key=value> … (repeatable)` beside `--add-tag`. Two `--extra` in one invocation set both keys: `--extra k1=1 --extra k2=2` → `extra.k1 = 1, extra.k2 = 2` in one edit.        |
| TEST-528 | **A CLI-written width actually widens the column** | PASS | See FINDING-1. This is the criterion CLI-016 deferred; it passes.                                                                                                                                                        |
| TEST-529 | Value grammar total, documented, stated       | PASS   | See FINDING-3 — all 15 documented cases exercised and read back with their types.                                                                                                                                       |
| TEST-530 | `null` deletes per RFC 7386                   | PASS   | `--extra n_int=null --extra s_007=null` → both keys **gone** from `extra` (not `null`, not `"null"`); `esc_null` still the string `'null'` and `width` untouched.                                                        |
| TEST-531 | Merge, not replacement                        | PASS   | `--extra width=640` on a document carrying `pinned`, `order`, `query` and nine other extra keys → `diff -u` shows exactly two changed lines: the server's `updated:` stamp and `width: 760 → 640`. Everything else byte-identical. |
| TEST-532 | Reserved keys refused locally, naming the flag | PASS  | `title` → *"Use `--title` instead."*; `status` → `--status`; `due` → `--due`; `tags` → *"Use `--add-tag`/`--remove-tag` instead."*; `id`/`type`/`created`/`updated`/`anchors` → *"Core keys are not user-writable through `--extra`; `extra` may never shadow one."* All **exit 2**. Usage errors too: no `=` → exit 2 with an example; empty key → exit 2. |
| TEST-533 | Server backstop works, not relied on for UX   | PASS   | Forced past the guard: `PUT /api/docs/doc_seedattention -d '{"extra":{"title":"Nope"}}'` → **400** `{"code":"bad_request",…,"issues":[{"path":"json.extra.title","message":"`title` is a core frontmatter key; core keys cannot be set or shadowed through `extra`."}]}`. The log states the distinction explicitly. |
| TEST-534 | §11 promise kept in the agent's vocabulary    | PASS   | Walked as the agent, using only commands `docs/cli.md` documents: `corpus doc list --type view --json` to find `doc_seedattention`, then `corpus doc edit doc_seedattention --extra width=520 --from agent`. No HTTP call, no file edit. The column widened (FINDING-1). |
| TEST-535 | No contract change                            | PASS   | `git diff cb7825d..HEAD -- packages/contract` → empty.                                                                                                                                                                   |
| TEST-536 | `docs/cli.md` regenerates; inventories honest | PASS   | `node --import tsx scripts/check-generated-artifacts.ts` → `✓ CLI reference is up to date (docs/cli.md)`, exit 0. `--extra`'s full grammar is published in the generated flag table.                                        |
| TEST-537 | `edit.ts` collision reconciled, not fought    | PASS   | The shipped `doc edit` help carries **both**: *"`--status` refuses to move an archived document off `archived` … names `corpus doc unarchive <id>`"* **and** `--extra`'s merge grammar. Both behaviours verified live in the same binary (TEST-541 and TEST-529 below). CLI-017's guard is intact, unweakened. |

### CLI-017 — `corpus doc unarchive`

| #        | Criterion                                      | Result | Observed                                                                                                                                                                                                     |
| -------- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-538 | Verb exists, round-trips the shipped route      | PASS   | `corpus doc unarchive doc_gqyrzvto --from agent` → `unarchived doc_gqyrzvto`, exit 0. `--json` emits the shipped route's response in the same shape `doc archive --json` emits (`{doc, warnings}` — compared side by side). |
| TEST-539 | Folder moves back and the name is freed         | PASS   | See FINDING-4 — the 409 changes class, which is the evidence frontmatter alone cannot give.                                                                                                                    |
| TEST-540 | The instruction is executable verbatim          | PASS   | `/usr/bin/grep -rn 'unarchive' assets/workspace apps/server/src/skills docs/cli.md`: the comment skill says *"`409` means unarchive it with `corpus doc unarchive <id>`"*; the server's 409 says *"unarchive it to bring it back"*; `docs/cli.md:629` documents `corpus doc unarchive <id>` with two examples. An agent following the message word for word now succeeds. |
| TEST-541 | `doc edit --status open` on an archived doc refuses | PASS | `corpus: doc_gqyrzvto is archived; `--status open` would set the frontmatter without bringing the document back. / Run `corpus doc unarchive doc_gqyrzvto` — it restores the status and, for a skill, moves its folder back out of `.claude/skills-archived/` and frees the name.` exit **2**, no commit, tree clean. |
| TEST-541b| `--status resolved` refuses too (Adj 13 extended) | PASS  | Identical refusal shape with `--status resolved`, exit 2. Every non-`archived` status is covered, not just `open`.                                                                                             |
| TEST-542 | The half-state is unreachable by any route       | PASS   | `doc edit --status` is the only CLI path that writes `status`; both reachable values refuse before anything is sent. `git log` shows no new commit around the refusals and `git status` is clean of them. The pre-fix reproduction is in the log, against the previously built binary. |
| TEST-543 | Nothing else about `--status` changes            | PASS   | On a **non-archived** document, `--status open`, `--status resolved` and `--status archived` all print `edited …` and take effect; re-`--status archived` on an already-archived document still goes through. The guard is narrow. |
| TEST-544 | Unarchiving is sane at its edges                 | PASS   | (a) not archived → `doc_gqyrzvto is not archived`, **exit 0**, no commit; twice in a row → identical (the concurrent case). (b) unknown id → `corpus: 404 not_found: no document with id doc_nope`, exit 5 — **byte-identical to `corpus doc archive doc_nope`**, so the pair stays symmetric. |
| TEST-545 | Destination collision surfaces, does not crash   | PASS (against the recorded correction) | `corpus: 400 bad_request: the archive destination already exists` with the issue list intact (`{"path":"id","message":".claude/skills/weekly-review already exists; move or remove it first"}`), exit 5, no stack trace. The contract said `409`; the shipped guard raises `400` per a deliberate sprint-005 ruling, recorded as a correction in the log. Evaluated as instructed against the correction: the criterion is *"message intact, non-zero exit, no stack trace"*, and all three hold. |
| TEST-546 | `docs/cli.md` regenerates; inventories honest    | PASS   | Drift check green; `corpus doc unarchive` documented beside `corpus doc archive` with both examples.                                                                                                            |
| TEST-547 | Blast radius, no contract change                 | PASS   | The CLI commits touch `apps/cli/**`, `docs/cli.md`, `assets/workspace/gitignore` and **one clause** in `assets/workspace/claude/skills/comment/SKILL.md`. `git diff` of `packages/contract`, `apps/server`, `SPEC.md` across the batch: empty. |

### Cross-issue, as applicable

| #        | Criterion                            | Result | Observed                                                                                                          |
| -------- | ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
| TEST-572 | No `SPEC.md` edit                    | PASS   | `git diff cb7825d..HEAD -- SPEC.md` empty.                                                                          |
| TEST-573 | No workspace scaffolded into the repo | PASS  | `ls -d /Users/theophanerupin/code/corpus/.corpus` → `No such file or directory`. Every `corpus init` ran from scratch dirs. |
| TEST-574 | No in-place contract amendment       | PASS   | Empty.                                                                                                             |
| TEST-576 | Repo clean of scratch escape          | PASS   | `git status --porcelain` empty at the end.                                                                          |
| TEST-577 | Ports clean; 8765 untouched          | PASS   | 9181/9183/9185/9189/9191/9193/5293 free; 8765 unbound throughout; proxy proved at `9181`.                            |
| TEST-579 | Generated artifacts regenerate cleanly | PASS | Drift check green for `docs/cli.md` **and** `openapi.json` on the merged tree — the one regeneration carries CLI-016's `--extra`, CLI-017's `doc unarchive` and the todos plugin's `migrate`. `openapi.json` has not moved. |

---

## Load-bearing evidence

### FINDING-1 — TEST-528, the deferred half, executed

CLI-016's log deferred the browser check ("a dev server on `5292` would have been a second Vite
against a shared machine") and offered the SSE frame plus the JSON number type as substitutes. Those
substitutes are necessary but not sufficient — the criterion is *"the column actually widens"*. Run:

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9181"     # before vite
$ curl -s http://localhost:5293/api/health
{"status":"ok",…,"workspace":".../s017-eval3/wsP"}        # my server, proved
$ lsof -nP -iTCP:8765 -sTCP:LISTEN → (unbound)

board open, no reload at any point:

  before          <section class="col" data-col="doc_seedattention" style="width: 520px;">   → 520px
  $ corpus doc edit doc_seedattention --extra width=760 --from agent
    edited doc_seedattention
  after (6 s)     <section class="col" data-col="doc_seedattention" style="width: 760px;">   → 760px

  requests in between:  GET /api/docs?pinned=true&sort=order&type=view   (the board's column query,
                                                                          refetched from the write's
                                                                          ["docs"] invalidation)
```

The value arrives as the JSON **number** the board's reader requires, the column re-renders live over
SSE, and `git diff apps/ui` is empty — no UI change. `SPEC.md:377`'s *"@agent make the finance column
wider"* is now reachable by a CLI-only agent, end to end.

### FINDING-2 — TEST-524, the gap that is a clone, not a directory

A workspace put into the genuine pre-`deferred` shape (directory removed **and the removal
committed**, so it is absent from the index too):

```
$ ls .corpus/queue/            abandoned failed in-progress pending processed        (five)
$ git ls-files .corpus/queue/  five .gitkeep entries, no deferred/

$ corpus workspace upgrade --from user
upgrade (tool 0.0.0 → 0.0.0):
  update  data/docs/templates/todo-template.md [plugin:todos]
  create  .corpus/queue/deferred/.gitkeep — queue status directory this workspace predates; it has
          to be tracked or a clone arrives without it
wrote 2 files in commit ff73eac5…

$ git ls-files .corpus/queue/  → now six, including .corpus/queue/deferred/.gitkeep   (TRACKED)
$ git clone -q <workspace> <clone> && ls <clone>/.corpus/queue/
abandoned deferred failed in-progress pending processed                              (the clone carries it)
$ corpus workspace upgrade --from user
already up to date.                                                                   (idempotent)
```

"The directory exists" and "a clone carries it" are different claims; only the second is the gap, and
it is the one that holds.

### FINDING-3 — TEST-529, the value grammar, total and read back with types

One invocation setting 14 keys, then read back through `GET /api/docs/{id}`:

```
n_int    = 520        (int)      ← canonical JSON number
n_neg    = -1.5       (float)
n_exp    = 1000       (int)      ← 1e3
s_007    = '007'      (str)      ← NOT canonical JSON → stays a string
s_dot    = '1.'       (str)
s_plus   = '+1'       (str)
s_hex    = '0x10'     (str)
s_inf    = 'Infinity' (str)
b_true   = True       (bool)
b_false  = False      (bool)
s_empty  = ''         (str)      ← the empty string is stored, not dropped
esc      = '520'      (str)      ← --extra esc='"520"', the documented escape hatch
esc_null = 'null'     (str)      ← the only way to store the characters `null`
bad_json = '{"a":1}'  (str)      ← invalid as a string literal → falls through to rule 5, no error
```

On disk the YAML is correspondingly typed (`width: 760`, `s_007: "007"`, `b_true: true`). Nothing is
silently dropped and nothing is coerced into something unwritten. Rule 3 is the load-bearing one and
FINDING-1 is why.

### FINDING-4 — TEST-539, the name is genuinely freed

```
before   .claude/skills/            comment  fixture-notes  orchestrate  todos
         .claude/skills-archived/   weekly-review
         $ corpus skill create weekly-review …
         corpus: 409 conflict: the name `weekly-review` belongs to an archived skill
                 (.claude/skills-archived/weekly-review exists) — unarchive it to bring it back …

$ corpus doc unarchive doc_gqyrzvto --from agent   →  unarchived doc_gqyrzvto   (exit 0)

after    .claude/skills/            comment  fixture-notes  orchestrate  todos  weekly-review
         .claude/skills-archived/   (empty)
         one auto-commit:  265abc2 doc unarchive: weekly-review (doc_gqyrzvto) by agent
         $ corpus skill create weekly-review …
         corpus: 409 conflict: a skill named `weekly-review` is already installed
                 (.claude/skills/weekly-review exists) — edit it with `PUT /api/docs/{id}` …
```

The 409 changed **class** — archived-name → already-installed. Frontmatter alone could not tell those
apart, which is exactly why the half-state was a lie.

---

## Refuted / corrected claims

1. **CLI-016, TEST-528 "DEFERRED".** Not refuted — **discharged**. The criterion the agent could not
   run does pass, and the log should no longer be read as leaving it open.
2. **CLI-012, `docs/workspace-template.md` "left alone".** The log flags the stale five-directory list
   as a rider for the orchestrator. It has since been fixed on this branch (the file now names all
   six). The log's statement is stale rather than wrong; no action needed.
3. **TEST-545's `409`.** The contract text is wrong and the log's correction is right: the shipped
   guard raises `400 bad_request`. Evaluated against the correction, per the evaluation brief.

Nothing else the three logs claim was refuted. Every exit code, message, wire body, manifest entry
and git outcome I checked matched what was written down.

---

## Summary

**31 of 31 criteria pass.** The agent's promised recovery path exists and works (`corpus doc
unarchive` frees the name, not just the frontmatter field); the half-state it used to reach instead is
now a refusal that names the verb, for **every** status, with nothing written and nothing committed;
the agent can finally write an arbitrary `extra` key with a total, documented grammar, and the §11
column-width promise is kept live in a real browser; and declared plugin seed templates are installed,
provenance-marked, refreshed on upgrade without clobbering user edits, and a pre-CONTRACT-021 queue
skeleton is repaired in a way that survives a real `git clone`.

The one criterion the batch left open — TEST-528's browser half — was executed here and passes.
