# [SHARED-003] PR #11 review — non-blocking MINOR/NIT findings ledger

## Domain
shared

## Status
todo

## Phase 41 triage — the plugin items, struck one at a time (2026-08-22)

**SHARED-065 swept this ledger for plugin and todos items.** SHARED-064 removed
the plugin surface and the todos plugin on the user's instruction — *"I want it
fully gone, no trace of it in the codebase or the specs"* — and `todo` is not a
document type.

**The method, because a ledger is a record and not a task list.** Every item that
loses its subject is struck through with `~~` and given a reason, exactly as this
file already does for items closed by INFRA-014 and by the 2026-07-31 sign-off
round. Nothing is deleted: a struck item still shows what PR #11 and PR #12 found,
which is what stops a reviewer re-litigating it. **Items whose subject is core
were kept and re-worded**, never struck — the plugin was sometimes the witness and
not the defect.

**What was struck**, in file order: the summary's finding-16 note
(`docs/PLUGINS.md`); MINOR 5, 7, 8 and 9; NIT 27, 28 and 29; the PR #12
`(plugins)` item whole; **half** of the PR #12 `(cli, NITs)` item; **two of three**
in the PR #12 `(server/plugins, NITs)` item; sub-item (c) of the second-half eval
observations; sub-item (a) of the dogfood-wave observations; the dev-init
`plugins/_fixture` item; and the kit-CSS placement item.

**Four items kept that a naive sweep would have struck**, each named here so the
judgment is auditable:

1. **The reveal-into-focus gap** (filed against PLUGINS-010) — the gap was in
   core `FocusMode`, and it is now **resolved**: `onOpenFocus` is wired at
   `apps/ui/src/board/Column.tsx:223-230` and carries an `OpenPayload` through to
   focus mode. Recorded as done rather than as moot.
2. **The mixed-list normalisation observation** — the dogfood item has two halves
   and only the first was a `/api/x/todos` route. The second is the core editor
   schema giving a plain bullet a checkbox, and it is untouched.
3. **The `\r\r\n` all-blank-CRLF body NIT** — filed under a `(server/plugins)`
   label beside two items that are plugin route semantics. Body normalisation is
   core, so it is kept while its two neighbours are struck.
4. **The PLUGINS-004 and PLUGINS-018 citations** in the summary and elsewhere —
   these say which *issue* fixed a finding. They are history, they are accurate,
   and rewriting them would falsify the record of what was fixed pre-merge.

**One item is retained deliberately even though its subject is gone**: Draft 1 of
the PR #12 spec amendments, `corpus todos migrate`. It is a **sign-off record** —
the user signed it on 2026-07-30 and it was applied. A note marks what SHARED-064
has since done to it. The signature is not edited.

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- Various — each finding cites its own.

## Summary
The 2026-07-29 pr-reviewer pass on PR #11 (verdict REQUEST_CHANGES) produced 15 MINOR
and 14 NIT findings beyond the three MAJORs. The MAJORs and MINORs 4/12/13/14/15 were
fixed pre-merge (CONTRACT-018/019, SERVER-034/035, PLUGINS-004, CLI-014); finding 24
(INFRA-010 AC text) and 32 (root `*.tgz` gitignore) were fixed as bookkeeping; finding
18 (PR body drift) was fixed on the PR; ~~finding 16 is already tracked by CLI-012 (add
a "not yet wired" note to docs/PLUGINS.md:88-93 there)~~ — **finding 16 struck by
SHARED-065 (Phase 41), 2026-08-22: INFRA-031 deletes `docs/PLUGINS.md`.** This ledger
holds the rest for triage into domain issues — do not let them silently expire.

## Findings to triage

**MINOR**
- ~~(5, infra) `scripts/pack-audit.ts:40` — no positive `REQUIRED_PACK_ENTRIES` entry for the todos plugin; if `npm run build` stops invoking `build-plugins.ts`, the tarball ships without the §12 reference plugin while `pack:check` stays green.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: there is no reference plugin to ship, and INFRA-031 deletes `build-plugins.ts` with the workspace. The *general* rule this instance illustrated — every artifact the installed tool resolves needs a positive `REQUIRED_PACK_ENTRIES` entry — is already `scripts/pack-audit.ts`'s stated contract and needs no ledger item.
- ~~(6, infra) `.github/workflows/release.yml:78-82` — only the absent `NPM_TOKEN` bars a `v*` tag from publishing; an `environment:` with required reviewers would make the no-publish decision structural. (User decision on record: no publish, ever — consider deleting the publish job instead.)~~ **CLOSED by INFRA-014** (sprint-020 Adjudication 1): the `publish` job is repurposed into a `release` job — `npm publish` and `id-token: write` are gone, and the tag flow now attaches the tarball to a GitHub Release. Nothing in `.github/` can publish.
- ~~(7, infra) `eslint.config.js:116-120` — core→plugin import ban enumerates only relative depths 3–5; shallower/deeper files slip through; boundary test probes depth 3 only.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: INFRA-031 deletes the core→plugin ban and its boundary test. A rule with nothing to ban cannot be under-enforced.
- ~~(8, kit) `packages/kit/src/client/createCorpusClient.ts:655-660` — `pluginRequest` claims plugin-namespace-only but only strips leading slashes; `../../` escapes with the bearer token attached. Reject dot segments or soften the claim.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: `pluginRequest` is deleted; it survives only in stale `apps/ui/dist` build output. **Verified this is not a live traversal hole elsewhere** — the finding was specific to the `/api/x/` path builder, and there is no `/api/x/` route space any more (SHARED-064 amendment 8).
- ~~(9, kit) `packages/kit/src/query/usePluginQuery.ts:26-30` — a query string in the path breaks cache-key matching against `broadcastInvalidate`, silently losing SSE invalidation; docblock promises "byte-identical" keys without that precondition.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: `usePluginQuery` is deleted, and so is `broadcastInvalidate` — the other half of the pairing the finding was about. Neither name appears in `packages/kit/src` or `apps/ui/src` any more. Whether any surviving kit query hook keys on a caller-supplied path string was **not** re-checked here, and is the one thing worth a look if this mechanism is ever suspected again.
- (10, ui) `apps/ui/src/editor/useAutosave.ts:346-349` — `beforeunload` guard calls `preventDefault()` but never sets `event.returnValue`; pre-119 Chromium/WebViews show no dialog and the parked buffer (only copy of user text) is destroyed unprompted.
- (11, agent-runtime) `assets/workspace/claude/skills/comment/SKILL.md:31,394-395` — documented `unresolved` payload examples strip the `@` sigil the server actually sends (`threads/mentions.ts:170`); sigil is the discriminator vs. skill invocations; file internally inconsistent (137-138 keeps it).
- (17, docs) `docs/workspace-template.md` (~line 140) — contradiction: manifest declared tracked (gitignore negation ships) but a later paragraph says it "is gitignored under `.corpus/*`".

**NIT**
- (19, contract) `packages/contract/src/schemas/form.ts` — `FormFenceMatch.end` doc comment imprecise for CRLF bodies.
- (20, ui) `apps/ui/src/thread/parseFormBlock.ts:157` — known-pairing tier skips the `options.includes(answered)` check the fallback tiers make.
- (21, kit) `packages/kit/src/row/useRowActions.ts:101` — `setLeaving(false)` in `onError` can fire post-unmount; relies on React 18 no-op.
- (22, agent-runtime) `orchestrate/SKILL.md:128-132` — touched-set rule for `form.respond` requires a parent doc id its payload doesn't carry (safe fallback: serialize); also :68-69 "no other knob" overlooks global `--json`.
- (23, infra) `scripts/merge-coverage.ts:149-156` — INFRA-009 guard wiring untested (deleting the call site keeps the suite green).
- (25, infra) `scripts/package-staging.ts:153` — `externalizeThirdParty` would externalize Node `#subpath` imports into a confusing (but loud) `PackagingError`.
- (26, infra) `scripts/check-pack.ts:70-80` — staged-name assertion inside the zero-violations branch; combined failures under-report; name-only mismatch prints success before failure (exit codes correct).
- ~~(27, server/cli) `apps/server/src/plugins/discover.ts:159` / `apps/cli/src/registry/plugins.ts:118` — `isDirectory()` false for symlinked plugin dirs while the UI glob matches them; three discovery surfaces disagree.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: all three discovery surfaces are deleted (SERVER-136, CLI-060, UI-150). Confirmed on disk: neither `apps/server/src/plugins/` nor `apps/cli/src/registry/plugins.ts` exists.
- ~~(28, plugins) `plugins/todos/ui/TodoView.tsx:153` — React key `${item.ts}:${item.text}` collides for identical texts in the same millisecond.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: INFRA-031 deletes `plugins/`. The collision was in that component's own item list and no core list is keyed that way.
- ~~(29, ui) `apps/ui/src/plugins/slots.tsx` — wrapped-component cache never observes a registry swap outside tests; fine until manifest hot-reload.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: UI-150 deletes the slot dispatch and the registry. `apps/ui/src/plugins/` no longer exists, and the hot-reload it was waiting on will never arrive.
- (30, cli) `apps/cli/src/commands/workspace/upgrade.ts:161-167` — version-only bump early-returns without refreshing the manifest's `tool` field (stale `fromVersion` later).
- (31, cli) `apps/cli/src/commands/init/git.ts` — `commitPaths` docstring overclaims ("index left alone"); `git add -- <paths>` does update those index entries.

**Post-review observations (cli-dev during CLI-014, 2026-07-29 — same triage rules)**
- (cli) `corpus server status` renders the `unowned` detail with the *pidfile's* port while the probe used the *configured* one — a re-pointed workspace reads "not answering on :9181" when :9182 was probed.
- (cli) `corpus workspace upgrade` with nothing to do but a manifest rewrite still commits ("wrote 0 files in commit …") because `installedAt` changes every run — no-op runs should not create commits.

**From the re-review of the fix head (65d546f, verdict APPROVE)**
- (infra) Manual `npm run e2e` outside the pre-push hook still targets a possibly-live 8765 — INFRA-011 pinned the origin in the hook only; decide whether playwright.config.ts should own the hermetic default (INFRA-011 AC 3).
- (spec, needs user sign-off) SPEC §2.1's status bullet "Stale pidfiles (dead or reused pid) are detected and cleaned" no longer matches CLI-014's shipped conservative semantics: a live pid's pidfile is kept (a reused pid is indistinguishable from a re-pointed daemon). Surfaced at the PR alongside the §12 decision.

**From the PR #12 review (2026-07-30, verdict REQUEST_CHANGES → fix round; MAJORs 1-3 and MINORs 6/13-16 fixed pre-merge, the rest queued here)**
- (contract+cli, wording) DeferEventRequestSchema.reason + `queue defer --reason` help promise the reason is "shown in the console" — it never reaches the wire (Job carries no reason field). Fix wording (regen openapi.json + docs/cli.md) or ship the field (CONTRACT rider).
- (server, TOCTOU) skills/create.ts:104-120 — create (CREATE_LANE) vs unarchive (doc lane) interleave lets create silently overwrite a just-unarchived skill; microsecond window, git preserves content; untested.
- (server+contract) FormSchema accepts non-trim-stable/multi-line options; answeredOption compares first-line-trimmed → permanently unclearable needs=form badge. Pin options single-line trim-stable (rider) or match the composed line.
- (agent-runtime) audit SPEC 35/36 remain open: the archived-collision 409 carries name not id while comment/SKILL.md instructs `doc unarchive <id>`; both skills' "reversible" clauses still name no verb. One skill-text pass.
- (agent-runtime) orchestrate/SKILL.md:428 worked example labels a Haiku-criterion dispatch "(Sonnet …)" — trains mis-tiering.
- ~~(plugins) blockquoted task items (`> - [ ]`) render as live checkboxes but are invisible to the plugin (same family as audit FIX 7/8); ISO_DATE_PATTERN accepts non-calendar dates (2026-02-30) with lexicographic overdue compare; `list --open --json` lacks an index field for machine consumers.~~ **STRUCK by SHARED-065 (Phase 41), 2026-08-22**: all three are todos-plugin behaviour — an item parser, a due-date pattern and a `corpus todos list` flag. SHARED-064 removed the derived `status`/`due` reading entirely, with the loss named and accepted by the user, so there is no parser left to be blind to a blockquoted checkbox. **The checkboxes themselves are core and unaffected** — SPEC §12's M6 requires a document of an unrecognised type to render with working checkboxes.
- (cli, NITs) ~~template symlink install (v1-trusted, textual `escapesPlugin`);~~ archived refusal drains a piped body before refusing. **Half struck by SHARED-065 (Phase 41), 2026-08-22**: CLI-060 deletes plugin template install and `escapesPlugin` with it. **The archived-refusal half is core `corpus` behaviour and stands.**
- (server/plugins, NITs) ~~status-alongside-body-edit refusal untested; drifted half-state PUT {status:open} 200-no-ops;~~ `\r\r\n` on an all-blank-CRLF body. **Two of three struck by SHARED-065 (Phase 41), 2026-08-22**: the first two are the todos item routes' status semantics, under the `/api/x/` space SHARED-064 amendment 8 deleted. **The CRLF item is kept**: body normalisation is core and has nothing to do with the label's `plugins` half. The split was a judgment call and is recorded as one.
- (ui, NIT residue) docActions Delete Esc-mid-flight notice; abandon registry pristine-map session leak (unless closed in the fix round).

**From sprint-016 contracting (2026-07-30)**
- (spec, phase-PR rider — RESOLVED by SHARED-005) SPEC §7's residual `deferred:`-prefix sentences were reworded with four coherence riders, user-signed-off, applied.
- (contract/server/cli chain to file) `agent.done` has no producer — §7 makes it load-bearing for delegation wake-back but no route/verb enqueues it (sprint-016 OC1; AGENT-005 ships without it, reconciling at idle returns). File the chain when delegation's reconcile-at-idle proves insufficient in practice.

**From the wave-3 audit fix round (2026-07-30)**
- (contract, minor) `doctorDb` declares only 200/401, so the stamp-mismatch refusal (audit FIX 16) reaches the CLI as a bare `500 internal_error` (same shape as the pre-existing no-projection refusal). Surfacing the message needs a declared error response — small CONTRACT rider when the doctor surface is next touched.
- (ui, filed) UI-021: renderer `mapFormAnswers` diverges from the server's both-answer-and-form detector (server FIX 10's docblock has the one-line change).

**From sprint-015 implementation (2026-07-30)**
- (server, flaky test) `apps/server/src/queue/service.test.ts:518` "requeueDeferredFor … wakes a parked poll" raced once in a commit gate (parked poll returned 1 of 2 re-entered events; green on retry and in adjacent gates). Deterministic-ize the interleaving (gate the poll on both writes) before it costs more gate retries.
- (server, accepted design gap) an expired-but-unreaped lock lease does not re-enter deferred events on its own — no TTL sweeper; `corpus lock reap` and `job retry` are the escape hatches (SERVER-030's log has the reasoning: queue writes on a read path rejected). Revisit only if real usage shows deferrals stranded behind expired leases.
- (agent-runtime) `assets/workspace/gitignore` says "these five directories" about the queue skeleton — now six with `deferred/` (CONTRACT-021). Comment-only fix; fold into the next agent-runtime issue (AGENT-005).
- (server/cli, upgrade-path) `ensureLayoutSync` creates `.corpus/queue/deferred/` at boot but writes no tracked `.gitkeep`, so a pre-CONTRACT-021 workspace won't carry the directory through a clone until `corpus init`/`workspace upgrade` writes it — fold the `.gitkeep` into CLI-012 or the next upgrade-touching issue.
- (kit) whether `ACTIVE_JOB_STATUSES` includes `deferred` was deliberately NOT decided by the UI consumption rider — SERVER-030 files or decides it. **DECIDED by SERVER-030 (2026-07-30): no — `ACTIVE_JOB_STATUSES` stays `["pending", "in-progress"]`, and `packages/kit` is untouched.** The constant's only consumer is `useAgentActivity`, whose only output is `WorkingDot` — "a pulsing dot and nothing else… it claims only that something is running" (`badges.tsx:106-112`, `animation: pulse 1.4s infinite`). A deferred job is *not* running: it is parked on a lease a human holds, for as long as that human keeps editing, which can be days — and a dot that pulses for days is the same lie the console's separate `deferred` dot was added to avoid. The counter-argument (the work is genuinely outstanding, `pending` is not "running" either) is real but weaker on duration: a pending job is seconds from being claimed by the loop, and a deferral is not. The deferral is not hidden either — three honest surfaces already carry it, none of which claims motion: the console row (its own dot, its own count, `blockedOn`/`blockedOnTitle`), the agent's reply in the waiting thread (§7's protocol replies *before* deferring), and the lock chip on the blocked document, which the user put there themselves. If a distinct *parked* signal on document rows is ever wanted, that is a new kit affordance to design and file — never a silent widening of the running dot.

## PR #12 spec amendments — sign-off record

Three SPEC.md amendments from the PR #12 review.

- **Sign-off**: user, 2026-07-30 survey — verdict **"Approve all three"**.
- **Applied**: 2026-07-30, all three applied to SPEC.md on branch `phase-5-followups`, exactly as drafted below (§12 CLI bullet, §7 wake-back sentence + §237 matching touch, §9.2 `POST /api/skills` bullet inserted before the rollback bullet).
- The drafts below are retained verbatim as the record of what was signed and applied.

### Draft 1 (APPLIED, then removed with its section) — §12 (~line 405): the shipped `corpus todos migrate` verb

**Note added 2026-08-22 by SHARED-065 (Phase 41), and the signed text below is
left exactly as it was.** SHARED-064 deleted §12 (*Reference plugin: todos*)
entirely, so the sentence this amendment produced is no longer in SPEC.md and
`corpus todos migrate` is no longer a verb. **The record is retained unedited
because it is a signature**: the user approved these three drafts on 2026-07-30
and they were applied that day. Editing a sign-off record to match a later
decision would make the tracker unable to say what was actually agreed. Drafts 2
and 3 are unaffected by Phase 41.

**(a) Current text**

> - **CLI**: `corpus todos add|check|list`, registered through the declarative registry (§2.3) so they document themselves like core verbs.

**(b) Proposed text**

> - **CLI**: `corpus todos add|check|list|migrate`, registered through the declarative registry (§2.3) so they document themselves like core verbs. `migrate` converges any todo document still storing items in the legacy `items` frontmatter key into body task-lists — idempotent (a converted document is reported unchanged), with per-document conflicts reported and skipped rather than failing the run, and `--dry-run` reporting the same answer without writing.

**(c) Notes** — describes the shipped behavior verbatim from the verb's registry description (`plugins/todos/cli/commands/migrate.ts:22-30`) and `docs/cli.md` §`corpus todos migrate`: convergence half of the PLUGINS-005 migration policy (write-through verbs migrate lists on touch; this converts the untouched rest), archived lists included, dry-run predictions come from the same check a real write uses.

### Draft 2 (APPLIED, incl. the §237 matching touch) — §7 delegation block: settlement at idle returns, not `agent.done` wake-back

**(b1) — the false sentence (SPEC.md:248, "Outcomes are never assumed" bullet)**

**(a) Current text**

> The orchestrator parks while subagents run and is woken by their completion — the `agent.done` core event (above) exists for exactly this.

**(b) Proposed text**

> The orchestrator parks while subagents run and settles reported outcomes whenever parking returns — on a new event, or on `idle`'s ~8-minute rearm; the subagent's report itself is the signal, and settlement never depends on any queue event announcing it. (Wiring completion to wake parking immediately — a producer chain for the `agent.done` core event, above — is a named future improvement: sprint-016 OC1, tracked in this ledger's `agent.done` entry.)

**(b2) — the matching touch on the earlier definition (SPEC.md:237)**

**(a) Current text**

> `agent.done` (background subagent wake-back)

**(b) Proposed text**

> `agent.done` (background subagent wake-back — reserved: nothing produces it yet, and an arriving one is settled like a report)

**(c) Notes** — nothing in the shipped product enqueues `agent.done` (sprint-016 OC1; the producer chain is unfiled until reconcile-at-idle proves insufficient — see this ledger's "From sprint-016 contracting" entry). The proposed wording matches what actually ships and what the skill honestly states: orchestrate/SKILL.md:115 (routing row: "Nothing produces this event today … an arriving one is handled like a report") and :153-156 ("reports are waiting whenever parking returns … the report itself is the signal"). The §237 touch is needed because b1's "(above)" leans on that definition — without it, the definition would still imply an active wake-back mechanism.

### Draft 3 (APPLIED) — §9.2 (~line 329): add `POST /api/skills` to the API-surface enumeration

**(a) Current text** — no entry; the enumeration jumps from `POST /api/check` to `POST /api/skills/:name/rollback` (SPEC.md:328-329).

**(b) Proposed text** — insert before the rollback bullet:

> - `POST /api/skills` — creates `.claude/skills/<name>/SKILL.md` (§7 skill genesis, `corpus skill create`): body carries the name (which is also the traversal guard — no `/`, `.`, or whitespace), description, and optional title/tags; the created file carries both frontmatter vocabularies (Claude Code's `name`/`description` plus the server-assigned core document keys). `409` when the name is already installed. Lands as a normal auto-commit and carries the acting party like any mutation; the skill is edited afterwards through `PUT /api/docs/:id` like any document.

**(c) Notes** — the endpoint shipped in CONTRACT-020 and is in the contract's endpoint inventory, whose own comment records the gap: "§9.2 does not list it yet — that amendment is routed with the rest of the §7 set" (`packages/contract/src/routes/inventory.ts:13-16`). Both prior SHARED passes missed this routing promise. Wording condensed from the route definition (`packages/contract/src/routes/skills.ts:65-95`).

## Polish-eval ledger additions (2026-07-30, evaluator pass on UI-022/023/024)

Promoted to issues (not ledgered): anchor highlights never render (UI-027, §10
violation); ↵ never activates any Corpus menu item (UI-028, §10 violation).

- **Reading-width ceiling is a constant while `62ch` is font-dependent** (UI-023
  eval note 4): 560px carries ~13px slack over the strictly-measured 547.2px on the
  reference font, and the body sits ~13px off-center (15px left vs 27.8px right
  gutter). Runtime-measured ceiling would be exact; decide at triage whether the
  polish is worth the moving part.
- ~~esc dead after focus close~~ — **RULED 2026-07-31 (user): ignore the pointer
  until it moves.** Filed as UI-031.
- **UI-024 issue prose corrected in place** (eval LEDGER-3): a selection in a thread
  turn opens the reader's item menu (correct per §10), it does not fall through to
  the native menu as the "As built" note claimed; behavior right, text fixed.
- ~~§11 doctor report-only warnings rider~~ — **SIGNED AND APPLIED 2026-07-31**
  (user sign-off round; SPEC.md §11 updated).

## Wave-1 harvest ledger additions (2026-07-31, sprint-018)

- ~~§10 ⋯-menu Unarchive rider~~ — **SIGNED AND APPLIED 2026-07-31** (user sign-off
  round; SPEC.md §10 updated).
- **Column ⋯ → Unpin still archives its view doc via `PUT {status}`** (UI-020
  deliberate deferral; independently confirmed as PR #14 review MINOR 1,
  Board.tsx:598-604): never a skill, no folder move, so harmless — but it is now the
  only archive path off the POST route, and asymmetric with its own inverse (that
  column unarchives via POST from the reader). Consistency follow-up at triage.
- **Doctor's per-finding git spawn is synchronous in the request handler** (PR #14
  review MINOR 2, unindexable.ts:94-126): bounded 50 × 5s, so a pathological
  workspace can block the single-threaded server ~250s worst case (SSE heartbeats
  stall). Healthy workspaces spawn nothing; fix shape at triage (async exec, or
  resolve commits lazily/CLI-side).
- **PR #14 review NITs**: `normalizeBody`'s docblock overstates the invariant for the
  extra-trailing-newlines direction (behavior safe — clamped, tail highlight drops);
  `unarchivedMessage` uses typographic quotes where `archivedMessage` uses straight
  ones.
- **Thread-create warnings are document-scoped, not call-scoped** (Phase 6 eval
  LEDGER-P6-2): a create response carries every unresolved anchor on the parent, so
  the CLI's warning suffix can list other threads' orphans. Either scope the printed
  list to the new anchor id or document the semantics in the verb help. (§11
  validates the whole rewritten frontmatter — server behavior is by design.)
- **UI-021 eval methodology caveat** (recorded, not waived): pre-fix reproduction was
  unit-level (pure function), live leg post-fix only — fine here, not precedent for
  bugs with runtime surface.
- **`db doctor`'s `--json` description is stale** (SERVER-038 deferral): still says
  `{ok, drift, stats}`; one-line fix regenerates `docs/cli.md` — fold into the next
  CLI docs regeneration.
- **`unindexable_files_truncated` is a server-only warning kind** (SERVER-038): legal
  under CONTRACT-025's open kind space; publishing it in `DOCTOR_WARNING_KINDS` is an
  optional CONTRACT rider at triage.
- **In-column margin mode: RULED 2026-07-31 (user)** — focus-only is the intended
  reading of §10; no numbers change. Remaining triage item: remove or annotate the
  unreachable `.reader-scroll.with-margin` in-column CSS path.
- **SERVER-033 honest-scope note**: the @hono/node-server advisory was Windows-only
  and 1.19.17 already carried the identical traversal regex — the bump closes the
  audit finding, not a live hole; v2 adds `Last-Modified` on static asset hits
  (additive, no test asserted its absence). State plainly in the phase PR.

## Acceptance Criteria
- [ ] Each finding above is either fixed, converted to a domain issue, or explicitly waived with a note here.

## Technical Design
Triage task — batch by domain (a `pr11-minor-findings` batch issue per domain mirrors the SERVER-029/UI-013 precedent).

## Testing Strategy
Per finding, once triaged.

## E2E Verification Plan
Per finding, once triaged.

## E2E Verification Log
_n/a until triage._

## Completion Checklist (orchestrator)
- [ ] All findings dispositioned

## Phase 7 eval ledger additions (2026-07-31)

- **`/openapi.json` and `/doc` fall through to the SPA shell** — a 200 with HTML
  (carrying the runtime-config bearer token, by SERVER-024 design) answers what a
  tool meant as an API request; the real document lives at `/api/openapi.json`.
  Consider a 404 or redirect for well-known API-ish paths at triage. Localhost-only;
  not urgent.
- **`docs/cli.md`'s `doc related --json` example shows `"semanticIndex":"current"`**,
  which Phase A servers never emit (contract-legal, illustrative of Phase B) —
  recorded so it isn't re-litigated as drift.
- EPIPE on piped output → filed as CLI-024.

## PR #15 review residue (2026-07-31, verdict APPROVE)

- (cli, wording) `doc` topic description still frames `list` as "the agent surveys
  the corpus" — tension with §7's never-enumerate; reword at the next docs/cli.md
  regeneration.
- (server, NIT) search's doc-vs-own-turn bm25 tie-break is by `ref` not `id`
  (deterministic, tested); the code comment slightly overstates — comment fix only.
- (server, MINOR→SERVER-042) repeated-passage first-occurrence addressing — note
  added to SERVER-042's design; superseded by chunk addressing.

## Phase 7b eval notes (2026-07-31)

- Process: three E2E logs phrase the model datum as "Model: opus" vs the contract's
  literal; UI-031's drill reused UI-030's ports rather than its assigned row (no
  collision). Both cosmetic; noted for sprint-021's wording.
- INFRA-014 TEST-819/820/821 are orchestrator-live on the batch PR/merge (sticky
  comment, no-release negative, artifact-download install).

## PR #16 review residue (2026-07-31, verdict APPROVE)

- Finding 1 (release.yml tag interpolation) FIXED pre-merge (env indirection).
- Finding 3 (+2 folded) → INFRA-015 (checker overflow/spawn fail-closed + advisory
  text sanitization).
- Finding 4: fork PRs' read-only GITHUB_TOKEN makes the sticky comment fail red
  (non-required job) — revisit if/when outside contributions start.
- Finding 5 (spec, needs user sign-off): one-sentence §10 rider making UI-031's
  signed pointer rule spec text ("the active column ignores a stationary pointer
  across programmatic closes; hover re-adopts on real movement") — queue for the
  next sign-off round.

## Phase 8 harvest note (2026-07-31)

- **worker-host.test.ts crash-drill flake — RESOLVED (2026-08-01), and the ledger's
  hypothesis was wrong.** Cause was a cross-port delivery race, not an unhandled
  rejection: error/exit arrive on the internal port while ready arrives on the
  public one, so under a starved loop the death could pre-empt a queued ready
  (measured 1.8% of spawns; 4% of loads through the real path), rejecting a load
  that had succeeded. Fixed by deferring only lose()'s ready.reject with
  setImmediate (check phase runs after queued port callbacks — 11/11; a microtask
  0/11). deferred()'s pre-existing .catch() already made unhandled rejections
  impossible (0 in 400 probed runs). Residual note: the abort test holds pending
  across an await before attaching its handler — harmless today, a genuine
  unhandled-rejection window under extreme memory pressure.

## Phase 8 eval ledger additions (2026-08-01)

- FAIL SERVER-048 AC2 → fixed in-phase (download progress + cooldown window; see the
  fix commit). Remaining ledger items:
- **`related`'s `similar` label is uninformative at the tail on small corpora** (gate
  0.15 admits "Bicycle brake pads" as similar to a physician note; ordering correct).
  Options at triage: raise gate / cap similar rows / carry the score.
- **`corpus index rebuild` has no guard against discarding an index it cannot
  rebuild** (unreachable configured provider → 561 valid vectors gone, spec-correct
  but unrecoverable-by-waiting). Consider a refusal or --force when resolution is
  currently error/disabled.
- **`failed > 0` remains unverified end-to-end by anyone** (needs ~12 min of ladder;
  unit substitutes only). Candidate for a long-run soak eval someday.
- **TEST-930's literal two-build diff** still unrun (evaluator can't git); substitute
  evidence strong. Optional orchestrator follow-up.

- **SEMANTIC_MIN_SIMILARITY fails open for configured providers** (PR #17 review
  MINOR 5): 0.15 is measured for MiniLM; OpenAI-family cosine scales score unrelated
  pairs ~0.6-0.8, so the gate excludes nothing and `similar` becomes a false claim.
  Design follow-up at triage: per-identity gate, score-carrying rows, or a documented
  caveat. (Compounds the small-corpus tail item above.)

- **anchor-layer.spec.ts UI-031 parked-pointer test is load-flaky** (2026-08-01:
  blocked two pre-push runs; its own build log documented the boundary-event race
  and a two-frame settle() that is evidently marginal under load). Harden at triage:
  wait for the hover-adoption observable itself (class state poll with timeout)
  rather than counted frames.

## Phase 9 in-flight notes (2026-08-02)

- **Search snippets include raw heading markup** ("## Rate assumptions The base…") —
  server-side cosmetic (UI-026 observation); strip heading markers at snippet
  composition at triage.
- **Blank-query chips search nothing** on the hybrid overlay ("Type to search…") —
  ACCEPTED as correct per the signed §10 amendment (q required for ranked search;
  chips-only browsing is saved views' job). Recorded so it isn't re-litigated.
- TEST-1032 naming deviation (searchCorpus/useCorpusSearch vs "one search method") —
  orchestrator-directed, flag to the evaluator.

## Phase 9 eval residue (2026-08-02, five PASS + one PARTIAL fixed in-phase)

- Pack degrade note says "ranked on the lexical half alone" while already-embedded
  rows are present under `indexing` — honest state word, overstated sentence;
  reword at triage (matches shipped search behavior, not drift).
  - PR #18 review (2026-08-03, MINOR): the ⌘K overlay's note has the same defect —
    `searchApi.ts` prefixes "Ranked on text alone —" for `stale`/`indexing`, where
    embedded rows still contribute; only `disabled` is truly text-alone. Reword
    both surfaces in the same triage pass, one shared phrasing.
- Truncated section windows can open mid-word — legal (§6 governs anchor quotes,
  not pack windows), escalation printed; craft nit.
- Evaluator note for the record: Phase 9 proof-of-work rated the best audited on
  this repo; zero re-dos.

- Second-half eval observations (2026-08-02, 8/8 PASS, recorded in eval
  files): (a) UI-042's PLAIN flavor emits `[[id|Title]]`, not bare titles —
  rider-compliant (it governs rich-text receivers; HTML carries title-only)
  and the id is the Corpus→Corpus round-trip carrier, but the issue log's
  "markdown byte for byte" claim is imprecise; decide at triage whether the
  plain flavor should title-strip for external plain-text targets. (b) UI-040:
  `stale`/`disabled` pill states verified stub-only (a real disabled drained
  to current before paint); `failed`>0 not producible live. ~~(c) PLUGINS-009's
  "Mark as open" branch unreachable from the column (spec-correct: checked
  items never render rows) — untested in the real app by construction.~~
  **(c) STRUCK by SHARED-065 (Phase 41), 2026-08-22**: the todos item menu is
  deleted. (a) and (b) are core and stand.
- ~~Reveal-into-focus gap (PLUGINS-010, 2026-08-02): FocusMode honours reveal
  payloads (UI-037, unit-pinned) but no producer can reach it — Column.tsx
  hands plugin bodies `onOpen` only, and every core focus path passes a bare
  id. Wire `onOpenFocus` (or widen the focus path) when a producer wants it;
  until then the honouring code is contracted but unreachable.~~ **RESOLVED, not
  moot — verified 2026-08-22 by SHARED-065 (Phase 41).** The gap was in **core**
  `FocusMode`, not in the plugin that found it, so it was checked rather than
  struck. `onOpenFocus` is now wired: `apps/ui/src/board/Column.tsx:223-230`
  takes an `OpenPayload` and passes it to both the column reader and focus mode,
  *"so a reveal rides along to both"*. The honouring code has a producer.
- Dogfood-wave eval observations (2026-08-02, recorded in the eval files, both
  outside any issue's criteria): ~~(a) `PUT /api/x/todos/<id>/items/0` on a
  frontmatter-ONLY legacy doc succeeds and silently self-migrates it (dual and
  malformed correctly refuse) — decide whether silent self-migration is a
  feature or should refuse like its siblings;~~ **(a) STRUCK by SHARED-065 (Phase
  41), 2026-08-22**: the `/api/x/` route space is deleted (SHARED-064 amendment
  8), and with it the item routes and the legacy `items:` migration. **(b) is
  core and stands**: the editor schema normalises a list mixing a plain bullet
  with a task item into a full task list, giving the plain bullet a checkbox —
  decide whether mixed lists should be preserved. It is now more load-bearing
  than when filed, because SPEC §12's M6 makes checkbox rendering on an
  unrecognised type the guarantee protecting existing `type: todo` documents.
- ~~(low-confidence, dev-only) `corpus init` from a source checkout installs
  plugins/_fixture's fixture-notes skill, which then surfaces as a type:skill doc in
  search — packaged installs are clean (underscore plugins excluded; pack:check
  guards). Consider a dev-init exclusion at triage.~~ **STRUCK by SHARED-065
  (Phase 41), 2026-08-22**: INFRA-031 deletes `plugins/_fixture` with the
  workspace, so a source-checkout `init` has no fixture skill to install.
- Orchestrator ruling, no rider needed (2026-08-03, PR #19 review question):
  the Fable reviewer asked whether UI-039's query editor (autocomplete + syntax
  help) needed its own signed SPEC rider, noting that four comparable UI
  additions on the same branch each got one. Ruling: **no**. The four that got
  riders each introduced something the spec did not describe or reversed a
  prior signed decision — a new console surface (index pill), a new copy
  affordance (canvases), a changed clipboard contract, and plugin-contributed
  menus (reversing SHARED-004 item 4). UI-039 adds an *affordance over the
  existing documented filter vocabulary* (§5/§9.2) and changes no behavior: the
  same queries were expressible before, and the completion source is
  `DocsQuerySchema` plus the contract enums, so the editor cannot describe a
  grammar the spec does not already define. Recorded here rather than silently,
  because the asymmetry is a fair question and the next reviewer will ask it
  again. Revisit if the editor ever gains grammar of its own.
  **Note (SHARED-065, Phase 41, 2026-08-22)**: one of the four cited precedents,
  plugin-contributed menus, no longer exists — SHARED-064 removed it along with
  the §10 sentence it added. **The ruling is unaffected and stays as written.**
  It turns on what UI-039 did, not on what the four comparators were, and the
  four are named as history rather than as live examples.
- ~~Kit CSS placement deviation (2026-08-03, PR #19 review MINOR): sprint-023's
  Out of Scope said UI-034's task-list CSS lands in `apps/ui`; it landed in
  `packages/kit/src/markdown/markdown.css`. The kit renders markdown, so
  rendered task lists plausibly belong there — but the TipTap-editor-shaped
  selectors ship to plugins that can never emit that markup. Resolution
  recorded with the ui-dev fix pass; triage should confirm the split.~~
  **STRUCK by SHARED-065 (Phase 41), 2026-08-22.** The deviation is a fact and
  the CSS is still in the kit, but the *harm* was that editor-shaped selectors
  shipped to plugins that could never emit that markup. `packages/kit` is kept
  (SHARED-064 amendment 3) with exactly one consumer, `apps/ui`, which does run
  the TipTap editor. Nothing is shipped to a consumer that cannot use it, so
  there is no split left to confirm.
