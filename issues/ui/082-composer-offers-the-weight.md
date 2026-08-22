# [UI-082] Composer offers the weight; the orchestrator honours it (SHARED-022)

## Domain

ui

## Status

done

## Priority

P2 (nice-to-have)

## Model

opus

## Dependencies

- Depends on: **SHARED-022** (signed by the user 2026-08-06; all three amendments
  applied to SPEC.md — verified in place)
- **Should depend on: AGENT-015** — the picker's levels are read from the
  orchestrate skill's declared set, which AGENT-015 produces. The plan row lists
  only SHARED-022; treat AGENT-015 as a hard prerequisite in practice and see
  "The gap in the chain" below.
- Related: **UI-070** (attachments in every composer) — the same enumeration of
  composer surfaces, and the same lesson about per-surface implementation.
  **AGENT-018** (SHARED-023) — the orchestrator-side judging rules.

## Spec References

- SPEC.md **§10**, "Smart input everywhere" — "**Every composer can choose how
  much thought the work gets.**" through "_(Rider signed 2026-08-06.)_": the
  surfaces, the unset default, the per-conversation starting point, the liveness
  coupling, and "claims **no key of its own**"
- SPEC.md **§7**, the Orchestrator skill paragraph — "**A request may choose the
  weight, and that choice is a directive**"; "choosing among the levels the skill
  itself defines"
- SPEC.md **§7**, the console bullet — "**A dispatch says what weight it went out
  at, and where that weight came from**". This is what makes the feature
  verifiable by an evaluator reading SPEC alone, and it is the surface this
  issue's E2E plan reads
- SPEC.md **§8** — owns what reaches the agent. Choosing a weight neither asks
  the agent nor stops it being asked

## Summary

SPEC now says every composer can choose the weight its work is done at, and that
the orchestrator honours the choice as a directive. Nothing in `apps/ui`
implements it.

The load-bearing constraint, and the reason this issue must not be built the
obvious way: **the levels the picker offers are read from the workspace's own
orchestrator skill**, not from a list in the UI. SHARED-022, Decision 1: "the
offered choices are **read from the skill's own table**, not hardcoded into the
UI. So editing the table changes both the routing *and* the picker, and the two
can never disagree — which a UI-side enum would guarantee they eventually do."

That is not a stylistic preference. §2.4 lets workspaces take template changes on
their own schedule, so a hardcoded list is wrong **per workspace** in a way no
single edit fixes: a workspace on an older template would be offered levels its
own skill does not implement, and the picker would be lying about what the agent
will do. It is the same defect class the repo keeps ruling out — a surface
asserting something the system did not do.

The skill is already reachable: `.claude/skills` is watched and projected
(`apps/server/src/watcher/paths.ts:22`) and `skill` is a core document type
(`packages/contract/src/schemas/doc.ts:14`), so the orchestrate skill is a
document the UI can already fetch through `GET /api/docs` — the same projection
the composers' three autocompletes already read (§10).

## Where the choice must be offered

§10 enumerates, and SHARED-012's lesson is that per-surface phrasing is exactly
how three of five composers ended up without attachments (UI-070). Enumerate in
the tests, not only in the spec:

| Surface | File |
| --- | --- |
| Global composer — **Ask** | `apps/ui/src/compose/ComposeOverlay.tsx` |
| Global composer — **Capture** | `apps/ui/src/compose/ComposeOverlay.tsx` |
| A thread's reply box | `apps/ui/src/thread/ThreadComposer.tsx` |
| A comment on a document selection | `apps/ui/src/anchors/CommentPopover.tsx` |
| A comment on a turn, or on a selection within one | `apps/ui/src/thread/NewChildThread.tsx` |
| Any composer a plugin contributes | via `@corpus/kit` |

The plugin row is why the control should land in `packages/kit` rather than being
written five times — the same move SHARED-009's key contract and UI-070's
attachment intake both made, and the reason PLUGINS-011 consumed the key contract
with one import and no copy.

## The rules that are easy to get wrong

Each is signed text, and each has a failure mode that looks like a reasonable
implementation:

- **No preselection.** "Choosing nothing is the ordinary case and means the agent
  decides — the control has no preselected level, and a composer that has never
  been touched behaves exactly as it does today." A picker that defaults to
  "Standard" because a select element needs a value has deleted the feature's
  premise (SHARED-022 non-goals: "Any implementation that preselects a level for a
  person who has never chosen one has broken the feature's premise").
- **Per-conversation starting point, not sticky state.** The choice applies to the
  one request being sent; the composer then *starts from* that choice next time in
  the **same conversation**, "as a visible starting point that can be changed in
  one gesture, never as a setting that acts on you unseen". Browser-local — like
  reader width and collapse state — written to no document, and it does not follow
  you to another browser. A per-thread value written to the thread document is the
  wrong design and SHARED-022's Decision 3 rejects it by name.
- **Liveness is a presentation rule only.** The control is live exactly when the
  composer says sending **will** reach the agent, and "shows as having nothing to
  act on" when it says it will not. §10 is explicit: "a presentation rule only:
  §8 alone decides what reaches the agent, and choosing a weight neither asks the
  agent nor stops it being asked." So the control must not enable/disable the
  ask-agent toggle, and must not be wired into the send decision.
- **No key of its own.** "The composer key contract is untouched." `↵` newline,
  `⌘↵` send, and the autocomplete key contract all stay exactly as they are.
- **Never blocks sending, never rewrites what was typed.**

## The gap in the chain — flag for the orchestrator before starting

SHARED-022's "Chain this implies" names three domains: agent-runtime (AGENT-015),
**contract + server** — "a chosen level travels from a post to the queue event and
into the dispatch; a way for a composer to learn what levels this workspace
defines" — and ui (this issue). **The contract and server issues do not exist.**
`issues/PLAN.md` carries no row for them.

Consequences, stated so the scope is a decision and not a discovery:

1. **Reading the levels** may be doable with no new contract: the skill is already
   a projected document, so the UI can fetch it and parse the set AGENT-015
   declares. Whether the parse belongs in the UI, in `@corpus/kit`, or on the
   server is a real design question — put it to the orchestrator rather than
   settling it inside a UI issue.
2. **Transporting the choice** is not. §10 says the choice "**rides with the
   request to whatever does the work** (§7)", and there is no field on any post,
   no field on the queue event, and nothing in the dispatch to carry it. The UI
   alone cannot satisfy that sentence.

So either the missing contract/server issue is filed first, or this issue ships
the control without the transport — in which case say so explicitly in its scope,
because an evaluator reading §7's console bullet will test for the dispatch line
and fail it.

### Orchestrator adjudication (2026-08-08) — both halves resolved

**Transport: filed and built.** CONTRACT-039 and SERVER-069 were filed as the
missing middle and land on the same branch as this issue. The field is `weight`,
the same spelling on the request body and in the queue event payload, defined in
`packages/contract/src/schemas/weight.ts`. It is an **opaque string**,
shape-validated only (non-blank, single-line, ≤ 100 chars), on all five composer
request bodies including the multipart variants. **Absence is modelled as
absence** — `.optional()` with no `.default()`, not nullable, `""` is a `400`, and
the payload helper `requestedWeightPayload()` cannot construct the key. Build the
request the same way: state nothing rather than state a null. So step 4 of the
E2E plan is testable rather than pre-failed.

**Reading the levels: the parse lives in `packages/kit`, over the projected skill
document. No new route, no server parse.** The three candidates were the UI,
`@corpus/kit`, and a server endpoint; kit wins on both counts that matter:

- **One parser, five surfaces plus plugins.** A plugin composer must offer the
  same levels as a first-party one, and kit is already how a plugin gets a
  first-party affordance without a copy (SHARED-009's key contract, UI-070's
  attachment intake, consumed by PLUGINS-011 with one import). A parser in
  `apps/ui` cannot be reached from a plugin; a second copy in kit is the enum
  problem again with extra steps.
- **A server endpoint would make the server a party to the vocabulary.** §7 keeps
  model names in the skill, and SERVER-069 is under an explicit instruction to
  record a level and never interpret one. A route publishing "the levels this
  workspace defines" is the server reading the skill's table — the same coupling
  the rider spent its Decision 1 removing. It also costs a contract issue, a
  route, and a §9.2 line for something the existing projection already answers.

The skill is already a projected `skill` document reachable through
`GET /api/docs` — the same projection the composers' three autocompletes read. So:
fetch it once at app level (TanStack Query), parse in kit, read from cache in each
composer. That keeps `CommentPopover` off a blocking fetch, which this issue's own
Key Implementation Details require.

**The degradation is unchanged and is the part to get right**: a parse that finds
nothing yields **no control at all**, never a fallback list. That includes a
workspace on an older template whose skill predates AGENT-015 — §2.4 makes that a
real state, not a hypothetical.

## Acceptance Criteria

- [x] Every surface in the table above offers the control, and the test
      **enumerates them** rather than testing one and asserting the rest by
      inspection (UI-070's lesson)
- [x] The offered levels are **read from the workspace's orchestrate skill**, in
      the order and with the names that document defines. No enum, no constant, no
      fallback list anywhere in `apps/ui`, `packages/kit` or the contract
- [x] Renaming a level in the skill changes what the composer offers with **no
      code change**; adding a fourth level adds a fourth option; removing one
      removes it
- [x] A workspace whose skill declares **no** parseable levels offers no control
      at all and behaves exactly as today — never a hardcoded fallback
- [x] **Nothing is preselected.** A composer never touched shows no chosen level,
      and sending from it produces a request that states no weight
- [x] After sending with a level chosen, the **same conversation's** composer
      starts from that level, visibly, changeable in one gesture
- [x] That starting point is **browser-local**: reload clears it, a second browser
      is unaffected, and no thread or document gains a field
- [x] The control is live exactly when the composer says sending will reach the
      agent, and shows as having nothing to act on otherwise — **without** altering
      what reaches the agent
- [x] The composer key contract is unchanged and the control claims **no key**;
      it is nonetheless operable from the keyboard like every other affordance
      (§10 adds no pointer-exclusive capability)
- [x] Sending is never blocked and typed text is never rewritten
- [x] A note-only turn with a level chosen enqueues nothing, produces no job and
      no dispatch line — and the composer said so before sending
- [x] The control is published from `@corpus/kit` so a plugin composer gets it
      without a copy — verified the way UI-070 verifies its intake

## Technical Design

### Files to Create/Modify

- `packages/kit` — the control and whatever reads the level set; a new
  `RUNTIME_SURFACE` entry in `packages/kit/src/index.test.ts`
- `apps/ui/src/compose/ComposeOverlay.tsx` (Ask **and** Capture),
  `apps/ui/src/compose/useCompose.ts`
- `apps/ui/src/thread/ThreadComposer.tsx`
- `apps/ui/src/anchors/CommentPopover.tsx`
- `apps/ui/src/thread/NewChildThread.tsx`
- Tests alongside each, plus an e2e spec in `apps/ui/e2e/`

**Not modified here**: `assets/workspace/claude/skills/orchestrate/SKILL.md` — that
is AGENT-015. If this issue finds itself editing the skill to make the parse work,
the two issues have been sequenced wrong; stop and escalate.

### Key Implementation Details

**Read the skill, do not restate it.** The parse should target exactly the
declared shape AGENT-015 produces, and should treat anything else as "no levels"
— degrading to the unset case, which is the ordinary behaviour, rather than to a
default. A parser that guesses at prose will silently disagree with the router the
first time someone edits the table, which is the failure this whole design exists
to prevent.

**Where the levels are fetched matters for `CommentPopover`.** The popover is
small and appears on selection; blocking its render on a document fetch would make
a fast gesture feel slow. The level set changes rarely and is shared by five
surfaces, so fetch it once at the app level (TanStack Query, like everything else)
and let each composer read from cache. UI-073 and UI-074 are the standing warning
about a surface that renders late and moves things under the pointer — a control
that pops into a popover after it opens is that bug again.

**The unset state needs a real representation, not a sentinel.** "No choice" is
distinct from every level, must survive a round trip through the per-conversation
memory, and must produce a request that carries *nothing* rather than a null the
server has to interpret. Model it as absence.

**The per-conversation memory is browser-local state with an existing precedent.**
§10 puts it in the same class as reader width and collapse state; look at how
`threadCollapse.ts` / `ThreadCollapseContext.tsx` scope and persist per-thread
browser-local state and follow that shape rather than inventing storage. Note the
scope is "the same conversation" — the global composer's Ask is not a
conversation, so decide and document what its scope is (SHARED-022 does not say;
this is a genuine gap worth raising rather than guessing silently).

**Liveness couples to a statement that does not exist yet.** §10's "A composer
says who it will reach, before you send" rider is signed (2026-08-05, SHARED-016)
but a grep of `apps/ui/src` finds no implementation of it, and no UI issue is
filed for it. So the coupling this issue's liveness rule depends on has no
component to couple to. Derive liveness from the same inputs §8 uses — the
composer's ask-agent / note-only toggle and whether the agent is already engaged —
and keep that derivation in **one** place so it can be shared with the reach
statement when it is built, rather than becoming a second, divergent answer to the
same question.

### Edge Cases

- **A level chosen, then the workspace's guidance edited to remove it, then send.**
  The unhonourable path — the request still goes, and the disclosure is the
  agent's job (AGENT-015). The UI must not silently rewrite the choice to a
  surviving level.
- **Two columns showing the same thread.** The per-conversation starting point is
  one value for one conversation; both should reflect it, exactly as collapse
  state does.
- **A capture** — §10 names Capture explicitly. It is a request, and a request is a
  request wherever it starts.
- **A composer whose ask-agent toggle is flipped after a level is chosen.** The
  choice survives; only its liveness presentation changes. It is not cleared —
  clearing would be the control acting on the person unseen.
- **A plugin composer that does not opt in.** It simply has no control; nothing
  breaks.
- **`prefers-reduced-motion` / narrow columns.** The control lives inside
  composers that already appear in a popover and in narrow columns; it must not
  force a reflow of `CommentPopover` into a panel (UI-070's criterion for the same
  surface).

## Testing Strategy

- Component tests, **one per surface** in the enumeration table, for: the control
  is present; nothing is preselected; a choice is carried on the request; the
  choice is cleared on a fresh conversation.
- A test that drives the level set from a **fixture skill document** and asserts
  the offered options match it — then a second fixture with renamed and with four
  levels, asserting the picker follows with no code change. This is the test that
  makes "one source" real.
- A test with a malformed/absent level block: no control, no fallback list.
- A test that the per-conversation starting point is browser-local: it survives
  within a session and is gone after a reload.
- A key-contract regression test per surface: `↵`, `⌘↵` and the autocomplete keys
  are unchanged, and the control claims none.
- `packages/kit/src/index.test.ts` — `RUNTIME_SURFACE` covers the new export.

## E2E Verification Plan

Against a real server and a real workspace — the level set comes from a real
skill document, which a stub cannot honestly provide.

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port; start the real server
   and the UI.
2. Open the global composer. Expected: the weight control is present, **nothing
   selected**, and its options are exactly the levels the workspace's
   `orchestrate/SKILL.md` declares, in that order and with those names.
3. Send an Ask with **no** level chosen. Expected: the request carries no weight
   and the console's dispatch line reads exactly as it does today (an
   orchestrator-judged weight) — §7's console bullet.
4. Send an Ask with a **light** level chosen. Expected: the dispatch line names
   that level and that the **request stated it**. This is the evaluator-visible
   proof that the choice travelled (and the step that fails if the missing
   contract/server transport was never built).
5. Reply again in the same conversation. Expected: the composer starts from the
   previous level, visibly. Change it in one gesture; send; confirm the new level
   in the dispatch line.
6. Reload. Expected: the starting point is gone; the *sent* requests' dispatch
   lines are unchanged.
7. Open the same conversation in a second browser. Expected: no starting point
   there.
8. **Edit the skill through the app**, renaming a level. Expected: the composer
   offers the new name with no rebuild, and a dispatch at that level uses it.
9. Repeat steps 2 and 4 for **all** surfaces: Capture, a thread reply, a comment
   on a document selection, a comment on a turn, and the todos plugin composer.
10. Set the composer to **note-only** with a level chosen and send. Expected: the
    control shows as having nothing to act on, nothing enqueues, no job, no
    dispatch line — and sending was never blocked.
11. Confirm no thread or document on disk gained a field (`git diff` over `data/`).

## E2E Verification Log

**implemented on: opus** (ui-dev, 2026-08-08).

### Post-Implementation Verification

**Setup.** `corpus init /tmp/corpus-w082 --port 8791`, real server started
(`corpus server start` → pid 16082, `/api/health` → `{"status":"ok", "workspace":
"/private/tmp/corpus-w082"}`), real Vite on `CORPUS_UI_PORT=5291` with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` and `VITE_CORPUS_TOKEN` from the
workspace's own `.corpus/config.json`. Ports 8765 and 5173 were never bound.
Real headless Chromium (Playwright's), real clicks, real drag selection. Both
processes torn down at the end; `lsof` on 5291 and 8791 confirms both free.

**Step 1 — the levels come from the workspace's own skill.**
`GET /api/docs?type=skill` on the real workspace lists
`doc_skillorchestrate → .claude/skills/orchestrate/SKILL.md`; its projected body
is 68 625 bytes and `parseWeightLevels` over **that body** yields exactly:

```json
[{ "label": "Small and mechanical", "key": "light" },
 { "label": "Standard",             "key": "standard" },
 { "label": "Heavy or judgment-laden", "key": "heavy" }]
```

**Step 2 — the global composer.** Observed in the browser:
`offers: ["Small and mechanical","Standard","Heavy or judgment-laden"]`,
`keys: ["light","standard","heavy"]`, `preselected: 0`, `live: true`,
`names a model? false`.

**Steps 3–4 — the choice travels, and absence stays absence.** Ask with `light`
chosen posted, verbatim off the wire:

```json
POST /api/threads {"parent":null,"selector":null,"body":"Please tidy the inbox note titles.","requestsAgent":true,"weight":"light"}
```

and the server's own record, from `.corpus/queue/pending/evt_erjkvtoz7gbc.json`
and `.corpus/jobs/evt_erjkvtoz7gbc.jsonl`:

```json
"payload": { "threadId": "th_qmyjilsy", …, "weight": "light" }
{"ts":"2026-08-08T23:04:55Z","source":"server","line":"weight stated by the request: light"}
```

A send with nothing chosen posted a body with **no `weight` key at all** (see
step 10's quote) — absence, not a null and not an empty string.

**Step 5 — the per-conversation starting point.** After the `heavy` reply the
reply box read `starts from: ["heavy"]` with no further gesture; changing it is
one click. The reopened global composer read `starts from: ["light"]`.

**Step 6 — reload.** After `page.reload()` the thread's reply box read
`preselected after reload: 0`, and the already-sent requests are unchanged on
disk.

**Step 7 — a second browser.** A fresh Chromium context (`drive082b`) opened the
composer and read `preselected in a fresh browser: 0` while the first browser's
choices had been `light`/`heavy` — nothing crossed.

**Step 8 — the rename round trip, with no code change and no rebuild.** The
orchestrate skill was edited through the server (the same write path the app's
editor uses; the server is the sole writer):

```text
BEFORE row: "| Standard                | standard | **Sonnet** | Most comment work: … |"
AFTER  row: "| Ordinary                | standard | **Sonnet** | Most comment work: … |"
PUT /api/docs/doc_skillorchestrate → 200
```

The very next browser load, unchanged binary, read
`offers: ["Small and mechanical","Ordinary","Heavy or judgment-laden"]` with
`keys (unchanged by the rename): ["light","standard","heavy"]`, and a dispatch at
the renamed level travelled as its **Key**:

```json
POST /api/threads {…,"body":"A dispatch at the renamed level.","requestsAgent":true,"weight":"standard"}
```

**Step 9 — all five surfaces, against the real server.**

| Surface | Observed |
| --- | --- |
| Global — **Ask** | offers the three real levels, nothing preselected, live; `POST /api/threads … "weight":"light"` |
| Global — **Capture** | same control; `POST /api/capture` multipart with a `name="weight"` part carrying `light` |
| A thread's **reply box** | `POST /api/threads/th_qmyjilsy/turns {"body":"Actually, please restructure the whole note.","requestsAgent":true,"weight":"heavy"}` |
| A comment on a **document selection** | real drag-select + right-click → popover offers the (renamed) levels, `preselected: 0`, `live: true`; `POST /api/threads {"parent":"doc_yw5bbh62","selector":{"exact":"We assume a 30-year fixed at 6.1% today.",…},"body":"Is this still right?","requestsAgent":true,"weight":"heavy"}` |
| A comment on a **turn** | offers the levels, `live: false` (this composer never asks the agent); `POST /api/threads {"parent":"th_kn2evdpv","selector":{"exact":"A stray thought about the rate."},"body":"A comment on this turn.","requestsAgent":false,"weight":"light"}` |

Every dispatched event carried its level into the payload and earned exactly one
server line — eight events, eight lines, no others:

```text
evt_bspa6aj52kiy → weight stated by the request: standard
evt_ctvbz2ptr4mh → weight stated by the request: light
evt_dbbimyfqjqzl → weight stated by the request: standard
evt_erjkvtoz7gbc → weight stated by the request: light
evt_hspuknz4rmte → weight stated by the request: heavy
evt_nrtv2xgpaorc → weight stated by the request: heavy
evt_ykbfh7vheanj → weight stated by the request: standard
evt_ynjzb7xzddyg → weight stated by the request: standard
```

**Step 10 — a note-only turn with a level chosen.** Flipping to `○ note only`
turned the control's `data-weight-live` to `false` (the composer said so **before**
sending) and **kept** the choice (`["heavy"]`). Sending was not blocked and the
text was not rewritten:

```json
POST /api/threads/th_qmyjilsy/turns {"body":"A note to self, weighted but going nowhere.","requestsAgent":false,"weight":"heavy"}
```

The thread then held three turns and the queue held **two** events — the
note-only turn enqueued nothing, produced no job file and therefore no dispatch
line. The unweighted send earlier in the same run likewise posted a body with no
`weight` key.

**Step 11 — nothing on disk gained a field.** Every `data/**.md` frontmatter, key
by key, after the whole run:

```text
data/threads/*.md            id type title created updated tags status parent anchor agent [anchors …]
data/docs/inbox/*.md         id type title created updated tags status anchors [exact prefix suffix] due reviewed evergreen
data/docs/views/*.md         id type title created updated tags status anchors evergreen pinned order query …
grep -rn "^weight:" data/  → NONE
git status --porcelain     → (empty)
```

No thread and no document carries a `weight`; the working tree is clean, so
every write is accounted for and none is pending. The choice lived only in the
browser.

**Automated checks.** `npm run build`; `npm run typecheck` (5 workspaces, clean);
`npm run lint` (clean); `npm run format:check` (clean); unit suites
`apps/ui/src` + `packages/kit/src` — **192 files, 3235 tests, all passing**;
Playwright — **349 passed**, plus the new `apps/ui/e2e/weight.spec.ts` (8 tests).

**Known environmental failures, not regressions.** `smoke.spec.ts:241` ("a
failing health check fails soft…") and `console.spec.ts:62` ("keeps the
failed-job count off the health notice's class") both assert the console strip
reads exactly `server unreachable`, which is only true while **nothing** is
listening on `127.0.0.1:8765`. The user's live corpus server holds that port on
this machine, so both fail here and only here; they pass in CI, and neither
touches anything this issue changed. Diagnosed, not chased.

### PR #35 review round (2026-08-08, ui-dev on **opus**)

Four findings from the pr-reviewer's pass, plus three gaps in the
`workspace-template.test.ts` level-list guard. All fixed on the branch.

**Finding 1 (MAJOR) — the declaration was located inside one sorted page.**

_Reproduction, real workspace, real server._ `corpus init /tmp/corpus-w091
--port 8792`, then 264 `type: skill` documents in `.claude/skills/` (the four
`corpus init` installs plus 260 filler skills, projected by the watcher). Ports
8765 and 5173 never bound.

```
GET /api/docs?type=skill                 → page.total 264, items 50,
                                           orchestrate on page one? false
```

That is the pre-fix lookup: `useDocs({ type: "skill" })` with no `limit` and no
`sort`, so the server applied `limit=50` and `sort=-updated`. The orchestrate
skill was **not** in the answer, `findOrchestrateSkill` returned `undefined`,
and every composer offered no control at all — indistinguishable from a §2.4
workspace that declares nothing, with the table sitting in the skill in plain
sight.

_What the lookup does now, and what bounds it._ `useWeightLevels` no longer
calls `useDocs`. It runs its own query, `["docs", "skill", "orchestrate"]`,
whose `queryFn` (`scanForOrchestrateSkill`) walks the **whole** `type: skill`
listing page by page until it finds the skill or has seen every row:

```
?type=skill&limit=200&offset=0&sort=created
?type=skill&limit=200&offset=200&sort=created   (only if the first missed)
…
```

- `limit` is the contract's `MAX_PAGE_LIMIT` (200) — the fewest requests the
  grammar allows, not a raised cliff.
- `sort=created` because `created` is the one sort key a document does not
  rewrite (`title` moves on a rename, `-updated` on every edit) and the server
  tiebreaks it `d.id ASC`, so the scan walks a total order that does not
  reshuffle between pages.
- **Nothing bounds it but the workspace's own skill count.** Termination has two
  independent guards: an empty page, and rows-seen reaching the reported
  `page.total`. In an ordinary workspace it is one request — the same one
  request the old code issued.
- The alternatives were checked and rejected: the query grammar has no `path`
  filter, `folder` addresses `data/docs/` only, and the document id is not
  derivable from the skill's name, so no single-request precise lookup exists.
  A bigger `limit` only moves the cliff, so it was not taken.

_Proof in a real browser._ The 264-skill workspace was re-timed so the
orchestrate skill sorts onto **scan page two** (`offset=200` holds it,
`offset=0` does not — confirmed against the running server). Headless Chromium
against the real server's own served UI at `http://127.0.0.1:8792/` (real token
injection, no Vite, no stubs), global composer opened with `c`:

```json
{
  "labels": ["Small and mechanical", "Standard", "Heavy or judgment-laden"],
  "keys": ["light", "standard", "heavy"],
  "preselected": 0,
  "skillScanRequests": [
    "?type=skill&limit=200&offset=0&sort=created",
    "?type=skill&limit=200&offset=200&sort=created"
  ],
  "readOrchestrate": ["/api/docs/doc_skillorchestrate"],
  "pageErrors": []
}
```

Exactly two scan requests, stopping at the page that held it, then one document
read. Server stopped, workspace deleted, 8792 and 5391 verified free.

_The docblock's incorrect claim is corrected._ It said the two queries were
"ordinary TanStack queries under the keys every other surface uses". They are
not: the autocomplete's directory query is keyed `{ type: "skill", limit:
DIRECTORY_LIMIT }`, so this is a **second** list query, and saying otherwise is
why nobody noticed the two paths disagreed about paging. Both still sit under
the `["docs"]` prefix, so SSE invalidation reaches them.

_Test added._ `useWeightLevels.test.tsx` now drives a paging transport: the
skill beyond page one, the skill on page three (and no page asked for past it),
no page holding it at all, and an empty page arriving while `total` still claims
more.

**Finding 2 (MINOR) — the parse is now fence-aware.** `parseWeightLevels` skips
any line inside a code fence, using the contract's own `fencedCodeRanges` — the
repo's one fence scanner, so "is this inside code" has a single grammar in
shipped code. `readWeightLevels` in `scripts/workspace-template.ts` does the
same with a local scanner: `scripts/` is repo tooling and imports nothing out of
a workspace's `dist/`, so a template check is never blocked on a build. Both
sides gained cases for a plain fence, an info string, a tilde fence, a longer
fence, an unterminated fence (declares nothing — the honest reading), and a
fence *below* the real table.

**Finding 3 (MINOR) — the child composer has a scope of its own.**
`childThreadWeightScope(parentThreadId)` (`child:<id>`), documented at the
definition with why: the box always sends `requestsAgent: false`, so its control
provably governs nothing, and under `threadWeightScope` that dead control seeded
the parent thread's reply box, which does reach the agent. The
`startingPoint.test.tsx` case that asserted the old sharing now asserts the
separation in both directions.

**Finding 4 (MINOR) — `resetWeightChoices` is off the plugin surface.** It is
exported from `@corpus/kit/testing` only; `index.test.ts`'s pinned runtime
surface records its deliberate absence, and the four `apps/ui` suites plus the
kit's own now import it from the testing subpath.

**The level-list guard, three gaps closed.** It now scans `apps/server/src` and
`plugins/` as well; `packages/kit/src/testing` is no longer exempt (it is a
published subpath, and the test asserts by name that it is scanned) with only
the private `apps/ui/src/testing` exempted; and it matches **keys** as `"…"`/
`'…'` string literals as well as labels, so a hardcoded `["light", "standard",
"heavy"]` no longer passes. Backticks are deliberately not a delimiter — a
markdown code span is how every docblock names a key, and `weight.ts`
legitimately names all three while justifying a length bound. The key matcher is
proven inside the test on the exact form it exists to catch.

**Checks.** `npm run build`; `npm run typecheck` (clean); `npm run lint`
(clean); `npx prettier --check` over `packages/kit/src`, `apps/ui/src`,
`scripts` (clean); unit suites `packages/kit/src` + `apps/ui/src` +
`scripts/workspace-template.test.ts` + `plugins` — **214 files, 3876 tests, all
passing**; full Playwright run — **350 passed, 2 failed**, the same two known
environmental failures above (`smoke.spec.ts:241`, `console.spec.ts:62`), which
need nothing listening on 8765 and fail only on this machine. Diagnosed, not
chased.

## Non-goals

From SHARED-022:

- **Not a change to what wakes the agent.** §8 owns that entirely.
- **No model names in the UI**, and none in SPEC. Weight levels only.
- **No default level.**
- **No new turn format.** The choice is request-time; nothing is written into a
  turn on disk.
- **No new key binding.**
- **No CLI flag.**
- **Not a budget, quota or cost feature.**
- **No retroactive anything.** Work already dispatched is unaffected.
- **Not a settings panel.** The durable half of the control is editing the agent
  guidance document.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-082]` prefix
