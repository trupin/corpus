# Evaluation: sprint-024 / phase-58 — "The workspace maintains itself honestly"

**Date**: 2026-09-06
**Sprint**: sprint-024 (`issues/sprints/sprint-024.md`)
**Issues covered**: CLI-081 · CLI-082 · CLI-083 · CLI-084 · UI-189 · SERVER-163 · SERVER-165 · UI-195 · SERVER-150 (AGENT-070 sampled)
**Verdict**: **PARTIAL** — 7 of 8 evaluated claims PASS. One claim fails against the sprint contract's own wording (TEST-1121).

---

## How this was tested

No source file was read. Everything below is a command's output, a file's bytes, a queue event,
a git log line, or a real browser session.

- `npm run build` at the repo root — exit 0.
- A tool copy staged outside the checkout at `…/scratchpad/tool` (`apps/cli/dist` + `assets/workspace`
  copied, `apps/server`/`apps/ui`/`node_modules` symlinked), so template edits that simulate a
  release never touched the user's tree. `git status --porcelain` on the repo is empty afterwards.
- Three real `corpus init` workspaces (`ws1`, `ws2`, `ws3`), a real server on **port 8791**
  (never 8765), real CLI invocations, real HTTP.
- The browser is real Chromium driven by the repo's Playwright, pointed at the **server-served UI**
  on 8791 (not the e2e suite's Vite — INFRA-028 makes that suite unable to reach a workspace server).
- Cleanup verified: every listener and server I started is dead, ports 8791/8792/8793 are free.

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | All nine issue files carry a filled "E2E Verification Log". |
| Commands are specific and concrete | PASS | Exact CLI invocations, JSON bodies, sha256 values, git subjects, port and pid numbers. |
| Real E2E (not mocked) | PASS | Real `corpus init` workspaces, real servers on 8767/8768/8791, real browsers. Unit suites are cited **beside** the E2E, never in place of it. |
| Scenarios cover acceptance criteria | PASS | Each criterion maps to a named TEST-#### with output pasted. |
| Application restarted after changes | PASS | Each log names the built CLI path or a staged installed layout, and its own server pid/port. |
| Actual model recorded (`implemented on:`) | PASS | CLI-083/UI-189 Fable 5 · CLI-081/CLI-082 Fable · CLI-084 Opus 5 · SERVER-165/163 Opus 5 · UI-195 opus · SERVER-150 Opus 5. |
| Reproduction logged before fix (bugs) | PASS, with one note | CLI-084 has a full pre-fix reproduction on the released 0.32.0 binary. CLI-081, CLI-082 and SERVER-150 reproduce live. **CLI-083/UI-189 cite the real 0.32.0→0.33.0 `cos` incident plus legacy-manifest unit tests rather than a fresh pre-fix E2E run** — a real-world reproduction, but not one re-run against a pre-fix binary. |

**Bookkeeping gap, not a proof gap.** CLI-081, CLI-082, SERVER-163, SERVER-165 and UI-195 still read
`## Status\n\ntodo` while carrying completed logs and ticked domain-agent checklists. The orchestrator
owns that field.

---

## Criteria Results

| # | Claim | Result | Evidence summary |
| --- | --- | --- | --- |
| 1 | Upgrades stop manufacturing conflicts (CLI-083 / UI-189) | **PASS** | Stamp-only and width-only deltas read `current`; both keys survive the write; a real edit still conflicts. |
| 2 | Deliberate divergence (CLI-081) | **PASS** | Keep silences the report, the summary line always prints, unkeep compares against the newest template. |
| 3 | The merge verb (CLI-082) | **PASS** | Exit 0/6/7 all observed; clean merge is one server-authored commit; conflicted and trap runs leave the file byte-identical. |
| 4 | Stale-verb scan (CLI-084) | **FAIL** | First half passes. **A template that teaches a verb no tool has is not flagged** — it is vouched, workspace-wide. See FAIL-1. |
| 5 | Designation engages (SERVER-165 / AGENT-070) | **PASS** | Plain creation engages and enqueues nothing; a plain turn reaches the parked listener on the thread's lane; release keeps `engaged` and routes to the orchestrator. |
| 6 | Stop from the console (UI-195, browser) | **PASS** | Consequence before the act, no request on arming, DELETE 200 on confirm, row held for the full 4 s the response was delayed, parked idle returned, thread menu agrees. |
| 7 | Launch-record absences (SERVER-163, browser) | **PASS** | Two distinct sentences for the two absences. One wording inaccuracy noted below. |
| 8 | Faster stop (SERVER-150) | **PASS** | 0.31 s and 0.32 s with a browser SSE attached, against a 0.47 s no-client baseline. |

---

## Claim-by-claim evidence

### 1 — Upgrades stop manufacturing conflicts — PASS

**A real server restamp.** `data/docs/views/inbox.md` was edited to `temporary body` and back to the
template's exact bytes through `corpus doc edit --key …`. `diff` against the template afterwards:

```
6c6
< updated: 2026-09-06T18:01:29Z
---
> updated: 2026-07-26T00:00:00Z
```

`corpus workspace diff data/docs/views/inbox.md` (exit 0) printed one line and no diff body:

```
  differs from the copy corpus 0.33.0 ships only in updated — server-stamped and presentation
  frontmatter, not an edit. An upgrade treats this file as current and keeps this workspace's
  values for those keys.
```

`--json`: `"action":"current"`, `"conflict":false`, `"diff":null`, `"ignoredKeyDelta":["updated"]`.

**A resize.** `corpus doc edit doc_seedattention --extra width=686` added exactly `width: 686` and
did **not** move `updated:` (still `2026-07-26T00:00:00Z`). The same one-line verdict, naming `width`.

**The upgrade.** With the staged tool's template changing all three views:

```
upgrade (tool 0.33.0 → 0.33.0):
  update  data/docs/views/attention.md
  update  data/docs/views/inbox.md
  keep    data/docs/views/open-threads.md — modified here — 2 lines only here, 2 lines only in the new copy
          unresolved — corpus workspace diff data/docs/views/open-threads.md
wrote 2 files in commit e5ba3e40ca13e88c188b1c00ce1289e60733ec17.
```

After the write (P5, TEST-1094/1099), read off disk:

- `inbox.md` carries the template's new sentence **and** `updated: 2026-09-06T18:01:29Z`. The
  template's fixed `2026-07-26T00:00:00Z` is absent.
- `attention.md` carries the template's new sentence **and** `width: 686`.
- `open-threads.md` (restamped **and** genuinely edited) is untouched — my own line is still the
  last line and the upstream sentence never arrived.

A second upgrade re-reports only `open-threads.md`.

**Legacy manifest, no migration (TEST-1100).** In `ws2` every `normalizedSha256` was stripped and
`width: 686` added by hand. `corpus workspace upgrade` → `already up to date.`, the manifest file
byte-identical (sha compared before/after), the width kept.

**Resize persists across a reload (TEST-1102).** In the real browser, dragging the Attention
column's resizer fired exactly one write — `PUT /api/docs/doc_seedattention {"extra":{"width":826}}` —
and `width: 826` landed in the file. On a **fresh page load**, that column renders at
`style="width: 826px;"`, measured 826 px.

**Observation, not a failure.** The O2 residual is real and reachable by a real user: with a
**legacy** manifest, a `width`/`updated` delta **plus** a changed template still reads
`keep-modified` (observed in `ws2`: `keep data/docs/views/attention.md — modified here`). A legacy
entry gains its `normalizedSha256` only when the upgrade actually writes that file — verified: after
one upgrade that wrote a single file, exactly 1 of 36 entries carried a normalized sha. So for a
workspace resized before this fix, the very release that changes that view is the one that still
conflicts on it once. The sprint contract's O2 permits this and requires only that it be recorded,
and CLI-083's log records it.

### 2 — Deliberate divergence — PASS

Board customized by hand, template changed, upgrade reported the eternal conflict. Then:

```
$ corpus workspace keep data/docs/boards/attention.md
kept data/docs/boards/attention.md — deliberately diverged. …
$ corpus workspace upgrade
upgrade (tool 0.33.0 → 0.33.0):
1 kept file deliberately diverged, skipped by this report — `corpus workspace keep` lists them, …
$ corpus workspace upgrade
already up to date.
1 kept file deliberately diverged, skipped by this report — …
```

The summary line prints on an "already up to date" run too. With three kept files the count reads
`3 kept files …` and bare `corpus workspace keep` lists all three by path. `corpus workspace keep
data/docs/notes/mine.md` exits **2** with `"…" is not template-tracked … Nothing was written.`

**Advance without write (TEST-1106).** While kept, the manifest entry advanced to each new template
sha (verified byte-equal to `shasum -a 256` of the template copy, twice) and `"kept": true`
persisted, while the workspace file's sha was unchanged before and after the upgrade.

**Unkeep compares against the current template (TEST-1105).** After two template advances,
`corpus workspace unkeep` then `corpus workspace diff` shows `baseline 5ea1e78de9db…` and a `+` side
naming the **newest** line, `A SECOND upstream change, newest template line.`

### 3 — The merge verb — PASS

Three genuinely divergent copies of `.claude/skills/comment/SKILL.md`: a local bullet written
through the server, a template paragraph appended, a baseline that is neither.

```
$ corpus workspace merge .claude/skills/comment/SKILL.md          # exit 0
merged .claude/skills/comment/SKILL.md: 1 change from corpus 0.33.0 joined 1 local change,
written through the server as user in one commit.
$ git show --name-only --format='%s' HEAD
doc edit: Comment (doc_skillcomment) by user
.claude/skills/comment/SKILL.md
```

Both additions are in the file (lines 27 and 642), one commit, one file, authored `user`. The next
upgrade says `already up to date.`

**Conflict (exit 6).** Same line edited on both sides: sha256 `3a8403ac…` identical before and after,
the hunk printed at the file-relative line `:20` with all three labelled sides
(`<<<<<<< workspace (your copy)` / `||||||| baseline (what the manifest recorded)` / `=======` /
`>>>>>>> tool (corpus 0.33.0)`).

**The trap (exit 6).** A six-line paragraph held by baseline and workspace, deleted from the tool's
copy:

```
undecidable at workspace/.claude/skills/converse/SKILL.md:42 — this block is in the recorded
baseline and in this workspace, and absent from the tool's copy. That is either an upstream
deletion or a local edit older than the recorded baseline, and the tool cannot tell which — so
no side is picked and the block stays:
```

The block printed in full, the file byte-identical, nothing written.

**Nothing to merge (exit 7)**: `…profile/SKILL.md is already identical to the tool's copy`.

**Composition with keep.** The trap run above was on a **kept** file — it merged on request. A clean
merge on a kept file printed `still kept: upgrades keep skipping it …`, and `corpus workspace keep`
still listed it afterwards.

**Note on TEST-1114's wording.** The contract asks for a commit "naming the merge". The subject is
`doc edit: Comment (doc_skillcomment) by user` — it names the server's write, not the merge. The
issue's own criterion ("git log shows the merge as one authored act") is met; the sprint sentence is
not, literally. Recording it rather than ruling on it.

### 4 — Stale-verb scan — **FAIL** (see FAIL-1)

The vouching half works. In `ws3`, initialized from a tool whose template `converse/SKILL.md` ends
with `` `corpus thread summarize th_4b8e2c --from agent` ``, `corpus workspace upgrade --dry-run`
reports **nothing**. The scan is demonstrably not disabled: two other citations in the same
workspace are flagged with file and line.

### 5 — Designation engages — PASS

```
$ corpus thread create --title "Herb planter" -m "Which herbs grow well together…" --json
id th_uurc2l2z | agent engaged | resident {"name":null,"designationId":"des_snvxan2gbv6p"} | eventId None
$ corpus job list --json      # only two pre-existing doc.edited rows; nothing for this thread
```

A listener parked (`corpus queue idle --thread th_uurc2l2z`) showed
`"lane":"th_uurc2l2z","live":true`. A **plain** reply — no mention, no `/skill`, no
`--requests-agent` — returned `eventId evt_mrztn5to3wqa`, the parked process **exited at once**
with that event in hand, and the event file on disk reads:

```json
{"id":"evt_mrztn5to3wqa","type":"comment.created",
 "payload":{"threadId":"th_uurc2l2z","mentions":[],"skills":[],"unresolved":[]},
 "lane":"th_uurc2l2z"}
```

After `corpus thread release th_uurc2l2z`: `"agent":"engaged","resident":null`, and the next plain
turn produced `evt_3n5gzxa32uwj` with `"lane": "orchestrator"`.

Shipped skill text sampled (AGENT-070): converse/SKILL.md:413 reads *"Every message in your
conversation reaches you, and no mention is needed."* No skill says a plain turn reaches nobody.

### 6 — Stop from the console — PASS

Real Chromium against the server-served UI on 8791.

- **The orchestrator's row offers nothing**: `[data-lane-release-panel]` count **0**.
- **A designated row offers the act**: resting button `Release the resident`, `title` =
  *"Releasing stops this lane's agent. The conversation stays open and engaged, so the ordinary
  agent answers it from now on."*
- **Consequence before the act**: the first press rendered that sentence in
  `[data-lane-release-consequence]` with **Confirm release** / **Keep the resident**, and sent
  **no** mutating request (recorded network list empty). Confirm sits at y ≈ 917 in a 950 px
  viewport — reachable without scrolling.
- **The DELETE fires only on confirm**: `DELETE /api/threads/th_ensc5o7t/resident -> 200`.
- **The row leaves on the server's answer, not optimistically**: with the DELETE held for 4 s by a
  route interceptor, the roster read `["orchestrator","th_arpi2i2r"]` at ~0.8, 1.6, 2.6, 3.6 and
  5.2 s, and dropped to `["orchestrator"]` only afterwards.
- **The parked idle returned**: the backgrounded `corpus queue idle --thread th_ensc5o7t` exited
  with `422 unknown_recipient: 'th_ensc5o7t' names no lane to consume`.
- Toast: *"Resident released — this conversation is back on the agent's own lane."*
- **The thread menu agrees**: the released thread's `⋯` offers `Designate a resident` and no release
  item, while a still-designated thread's `⋯` offers `Release the resident — back to ordinary
  routing — nothing already queued moves`.

### 7 — Launch-record absences — PASS

Two lanes, two sentences, read off the Residents detail in the browser:

- never-prompted (`th_aj6ljjix`, plainly created, nothing queued):
  *"This lane has not been launched: nothing has been queued on it, so there is no launch to record.
  A listener starts when the conversation has work waiting."*
- unrecorded (`th_52hkntso`, a `lane.waiting` on the queue, no launch logged):
  *"No launch record for this designation is on the queue — a job's log is runtime state, reaped
  with its event — so what it went out at is unknown here. Nothing is guessed in its place."*

`GET /api/jobs` also resolves the notice to its conversation —
`lane.waiting | lane=orchestrator | origin=th_52hkntso` — which is SERVER-163's `ORIGIN_KEYS` fix
observed from outside.

**Wording inaccuracy, recorded.** For `th_arpi2i2r` the pane said *"nothing has been queued on it"*
while `corpus job list` showed `comment.created lane= th_arpi2i2r … status= pending`. The sentence
means "no launch-**prompting** event", and as written it is false about that lane's queue. It is
still truer than "unknown", so TEST-1132 stands.

### 8 — Faster stop — PASS

Real daemon on 8791, real headless Chromium holding
`GET /events?token=…` (one SSE request observed).

| run | client | `corpus server stop` |
| --- | --- | --- |
| control | none | 0.47 s |
| 1 | browser, SSE connected | **0.31 s** |
| 2 | browser, SSE connected | **0.32 s** |

An attached stream now costs less than the CLI's own start-up. Far under the ~1.5 s bar, and nothing
like the ~4.5 s the issue reports for the old behaviour.

---

## Failures

### FAIL-1: a template that teaches a verb no tool has is not flagged

**Criterion**: sprint-024 **TEST-1121** — *"Given: A template skill referencing a verb the incoming
tool does not have. When: The upgrade's scan runs. Then: It is flagged, naming the file and line —
CLI-059's purpose survives."* Also the task's claim 4, second half.

**Expected**: the citation is flagged with its file and line.

**Observed**: it is not flagged — anywhere in the workspace. One template file citing a verb is
enough to vouch for that verb workspace-wide, so a stale citation the template itself carries is
silenced, and so is the same citation in a file the person wrote.

**Steps to reproduce**

1. Stage a tool copy (`apps/cli/dist` + `assets/workspace`) outside the checkout.
2. Append to the staged template's `assets/workspace/claude/skills/converse/SKILL.md`:
   `` To summarize a conversation run `corpus thread summarize th_4b8e2c --from agent`. ``
3. `node <tool>/apps/cli/dist/bin/corpus.js init ws3 --port 8793`
4. Confirm the tool has no such verb:
   `corpus thread --help=brief` → `create show context reply digest resolve reopen designate release scope`.
5. `cd ws3 && corpus workspace upgrade --dry-run` →

   ```
   already up to date.
   migrations: none — every document is written the way this tool reads it.
   ```

   No stale-reference section at all.
6. Append three lines to `ws3/CLAUDE.md`: `corpus skill rollback orchestrate`,
   `corpus thread frobnicate th_1`, and `corpus thread summarize th_9`.
7. `corpus workspace upgrade --dry-run` →

   ```
   2 stale command references — …
     CLAUDE.md:56: `corpus skill rollback`
     CLAUDE.md:58: `corpus thread frobnicate`
   ```

   `corpus thread summarize` at CLAUDE.md:60 is **absent** from the list, though the tool has no
   more `summarize` than it has `frobnicate`. The only difference is that one template file
   mentions it.

**Status of the finding.** CLI-084's issue file names this cost in writing — *"a verb the incoming
tool ships broken instructions for is not [flagged]"* — and mitigates it with a CI test over the
shipped template. So it is a disclosed trade-off rather than a surprise. But TEST-1121's Given is a
**template skill**, no orchestrator ruling struck it, and the shipped behaviour does not satisfy it.
The scan's protection now holds only for citations no template file happens to repeat. This needs
either an orchestrator ruling amending TEST-1121, or a change to the vouching rule.

---

## Summary

7 of 8 claims PASS on the running product. The upgrade comparison, the keep/unkeep mark, the merge
verb, designation-engages, the console's release control, the two launch-record absences, and the
sub-second server stop all do what the sprint says, verified through the real CLI, a real server, a
real workspace and a real browser.

The one failure is CLI-084's TEST-1121. The fix removes the false positive it was written for, and
in doing so it also silences the true positive that test protects, whenever the incoming template is
the thing citing the missing verb. Everything else in this batch is honest about what it does; this
one is silent about something it used to say.

Two lesser items are recorded rather than failed: the merge commit's subject does not name the merge
(TEST-1114's wording), and the Residents pane's never-launched sentence says "nothing has been
queued on it" about lanes that do have pending events.
