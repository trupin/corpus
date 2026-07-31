# [SHARED-003] PR #11 review — non-blocking MINOR/NIT findings ledger

## Domain
shared

## Status
todo

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
18 (PR body drift) was fixed on the PR; finding 16 is already tracked by CLI-012 (add
a "not yet wired" note to docs/PLUGINS.md:88-93 there). This ledger holds the rest for
triage into domain issues — do not let them silently expire.

## Findings to triage

**MINOR**
- (5, infra) `scripts/pack-audit.ts:40` — no positive `REQUIRED_PACK_ENTRIES` entry for the todos plugin; if `npm run build` stops invoking `build-plugins.ts`, the tarball ships without the §15 reference plugin while `pack:check` stays green.
- ~~(6, infra) `.github/workflows/release.yml:78-82` — only the absent `NPM_TOKEN` bars a `v*` tag from publishing; an `environment:` with required reviewers would make the no-publish decision structural. (User decision on record: no publish, ever — consider deleting the publish job instead.)~~ **CLOSED by INFRA-014** (sprint-020 Adjudication 1): the `publish` job is repurposed into a `release` job — `npm publish` and `id-token: write` are gone, and the tag flow now attaches the tarball to a GitHub Release. Nothing in `.github/` can publish.
- (7, infra) `eslint.config.js:116-120` — core→plugin import ban enumerates only relative depths 3–5; shallower/deeper files slip through; boundary test probes depth 3 only.
- (8, kit) `packages/kit/src/client/createCorpusClient.ts:655-660` — `pluginRequest` claims plugin-namespace-only but only strips leading slashes; `../../` escapes with the bearer token attached. Reject dot segments or soften the claim.
- (9, kit) `packages/kit/src/query/usePluginQuery.ts:26-30` — a query string in the path breaks cache-key matching against `broadcastInvalidate`, silently losing SSE invalidation; docblock promises "byte-identical" keys without that precondition.
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
- (27, server/cli) `apps/server/src/plugins/discover.ts:159` / `apps/cli/src/registry/plugins.ts:118` — `isDirectory()` false for symlinked plugin dirs while the UI glob matches them; three discovery surfaces disagree.
- (28, plugins) `plugins/todos/ui/TodoView.tsx:153` — React key `${item.ts}:${item.text}` collides for identical texts in the same millisecond.
- (29, ui) `apps/ui/src/plugins/slots.tsx` — wrapped-component cache never observes a registry swap outside tests; fine until manifest hot-reload.
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
- (plugins) blockquoted task items (`> - [ ]`) render as live checkboxes but are invisible to the plugin (same family as audit FIX 7/8); ISO_DATE_PATTERN accepts non-calendar dates (2026-02-30) with lexicographic overdue compare; `list --open --json` lacks an index field for machine consumers.
- (cli, NITs) template symlink install (v1-trusted, textual escapesPlugin); archived refusal drains a piped body before refusing.
- (server/plugins, NITs) status-alongside-body-edit refusal untested; drifted half-state PUT {status:open} 200-no-ops; `\r\r\n` on an all-blank-CRLF body.
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

### Draft 1 (APPLIED) — §12 (~line 405): the shipped `corpus todos migrate` verb

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

Promoted to issues (not ledgered): anchor highlights never render (UI-027, §11
violation); ↵ never activates any Corpus menu item (UI-028, §11 violation).

- **Reading-width ceiling is a constant while `62ch` is font-dependent** (UI-023
  eval note 4): 560px carries ~13px slack over the strictly-measured 547.2px on the
  reference font, and the body sits ~13px off-center (15px left vs 27.8px right
  gutter). Runtime-measured ceiling would be exact; decide at triage whether the
  polish is worth the moving part.
- ~~esc dead after focus close~~ — **RULED 2026-07-31 (user): ignore the pointer
  until it moves.** Filed as UI-031.
- **UI-024 issue prose corrected in place** (eval LEDGER-3): a selection in a thread
  turn opens the reader's item menu (correct per §11), it does not fall through to
  the native menu as the "As built" note claimed; behavior right, text fixed.
- ~~§14 doctor report-only warnings rider~~ — **SIGNED AND APPLIED 2026-07-31**
  (user sign-off round; SPEC.md §14 updated).

## Wave-1 harvest ledger additions (2026-07-31, sprint-018)

- ~~§11 ⋯-menu Unarchive rider~~ — **SIGNED AND APPLIED 2026-07-31** (user sign-off
  round; SPEC.md §11 updated).
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
  list to the new anchor id or document the semantics in the verb help. (§14
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
  reading of §11; no numbers change. Remaining triage item: remove or annotate the
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
