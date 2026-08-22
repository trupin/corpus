# [SHARED-004] Phase 5 spec pass: delegation, doc-abandon, context menu, view width, §12/§2.1 reconciliation

## Domain
shared

## Status
done

## Priority
P0

## Model
fable — spec authorship is judgment work; spec-writer is pinned fable regardless.

## Dependencies
- Depends on: —
- Blocks: AGENT-005, UI-017, UI-018, UI-019

## Spec References
- SPEC.md §7 (agent loop), §10 (board), §10 (documents/editor), §12 (todos), §2.1 (CLI lifecycle)

## Summary
One spec-writer pass covering everything Phase 5 needs signed off, so the user reviews a
single coherent set of SPEC.md amendments:

1. **§7 — delegation (AGENT-005)**: the orchestrator agent delegates queue jobs to
   subagents by default and returns to parking, so it stays open to new events;
   failure/deferral surfacing, trace + CLI-only invariants inside subagents,
   concurrency bounds. (User request 2026-07-29.)
2. **§10 — no empty untitled documents (UI-017)**: exiting a still-empty new document
   must leave nothing behind; specify create-then-delete vs. defer-creation semantics
   and the git-audit-trail consequences. (User request; the user's own workspace log
   shows the create-Untitled-then-delete-Untitled annoyance live.)
3. **§10/§10 — right-click context menu (UI-018)**: which surfaces, action parity with
   existing menus, native-menu preservation (text selection), keyboard accessibility.
   (User request.)
4. **§10 — view width (UI-019)**: user-adjustable view/column width; where the
   preference lives (no settings surface exists; mind the server-sole-writer rule if
   file-backed) and whether this seeds a settings panel. (User request.)
5. **§12 reconciliation (PR #11 review MAJOR 3, held at merge)**: §12 promises each
   todo item "can be commented on (anchored to the item text)"; shipped v1 defers this
   to PLUGINS-003 — which is IN Phase 5 scope. Reconcile: if PLUGINS-003 lands this
   phase, the sentence may only need a transitional note or nothing; coordinate with
   that issue's timing rather than blindly rewording.
6. **§2.1 stale-pidfile wording (PR #11 re-review MINOR 1)**: "Stale pidfiles (dead or
   reused pid) are detected and cleaned" → match CLI-014's shipped conservative
   semantics (dead pid cleaned; live pid's pidfile always kept, with a report).
7. **§7 clauses spent by sprint-015 (Open Conflicts 3+6, added 2026-07-30)**: the
   genesis clause "until `corpus skill create` ships (CLI-011)" is spent when CLI-011
   lands; SERVER-030 spends the deferral clause, the force-unlock retry promise, and
   the status enumeration. Draft the post-landing §7 text for both so the whole Phase 5
   spec delta is one sign-off; no implementing agent touches SPEC.md.

## Drafts for sign-off

_Drafted 2026-07-29 by spec-writer (fable). DRAFT text only — SPEC.md is untouched until
the user signs off. Note on numbering: the summary above says "§10 (board), §10
(documents/editor)"; in the current SPEC.md the board **and** the document view/editor are
both **§10**, plugins are §10, todos §12. Drafts below cite the file's actual numbering._

### 1. §7 — Orchestrator delegates jobs to subagents by default (AGENT-005)

**(a) Replaces** — §7, the "Orchestrator skill" paragraph, currently:

> **Orchestrator skill** (`.claude/skills/orchestrate/SKILL.md`, installed into the workspace by `corpus init`). The operator starts `claude` in the workspace and invokes `/orchestrate`. Loop: `claim-all` → for each event, handle it (directly or by delegating to a skill/subagent) → `complete`/`fail` → `idle` → repeat. Events touching the same document run serially; independent documents may be parallelized. The skill must state: reply and mutate **only via the `corpus` CLI**, never by hand-editing workspace files.

**(b) Proposed text**

> **Orchestrator skill** (`.claude/skills/orchestrate/SKILL.md`, installed into the workspace by `corpus init`). The operator starts `claude` in the workspace and invokes `/orchestrate`. Loop: `claim-all` → dispatch each event → `idle` → repeat. **Delegation is the default**: each claimed event is handed to a subagent that does the work, and the orchestrator returns to parking as soon as the batch is dispatched — it stays open to new events while jobs run, so independent jobs proceed concurrently and a long job never blocks the queue. The orchestrator handles an event inline only when that is faster than delegating and does not meaningfully delay its return to parking (a one-line reply, a queue-hygiene action); anything involving document edits, skill/subagent routing (§8), or open-ended work is delegated.
>
> Delegation changes who does the work, never the contract around it:
>
> - **Every invariant that binds the orchestrator binds its subagents**: reply and mutate **only via the `corpus` CLI**, never by hand-editing workspace files; acquire and release document locks around edits; emit job-log progress lines to the job's console feed; close with a trace line (§6) when documents changed.
> - **Outcomes are never assumed.** An event is marked `complete`/`fail` only from its subagent's reported outcome, never at dispatch. The orchestrator parks while subagents run and is woken by their completion — the `agent.done` core event (above) exists for exactly this. A subagent failure fails the event with the subagent's reason; a lock deferral surfaces exactly as an inline deferral does (`deferred:`-prefixed failure, retryable via `corpus job retry`); a subagent that dies without reporting leaves its event `in-progress`, recovered by `corpus queue reap-stale`. No path loses a job silently.
> - **Ordering is preserved across the delegation boundary**: events touching the same document still run serially — a later event on a document is dispatched only after the earlier one's outcome is recorded. Independent documents run concurrently, bounded to at most **N** concurrent subagents (machine-load bound; further claimed events simply wait their turn).
> - **The console stays honest**: a delegated job's log shows its dispatch, the subagent's progress lines, and the recorded outcome — the operator watches delegated work exactly as inline work.

**(c) Open questions**

- [DECISION NEEDED] **Concurrency bound N.** Recommendation: **3** (matches this project's own machine-load discipline; the skill states the number so the operator can tune it). Confirm the default.
- [DECISION NEEDED] **Inline-handling rule.** The draft allows a narrow inline path ("faster than delegating, doesn't delay re-parking"). Alternative: delegate unconditionally — simpler invariant, slightly wasteful for trivial replies. Confirm the narrow-inline rule or force delegate-everything.

### 2. §10 — Never persist an empty untitled document (UI-017)

**(a) Extends** — §10, the "Creating documents — zero-form, inbox-first" bullet, whose last sentence is currently:

> The new document opens immediately in its column, title selected, ready to type — the agent files inbox arrivals per its skill.

**(b) Proposed text** (appended to that bullet; recommendation is **defer-creation**, see (c)):

> The new document opens immediately in its column, title selected, ready to type — the agent files inbox arrivals per its skill. **An abandoned blank never persists**: quick creation opens the editor at once, but the document itself comes into existence only with its first content (a title or a non-blank body). Leaving a still-blank new document by any route — back, closing the reader, switching columns, closing the tab — leaves nothing behind: nothing on the board, in search, on disk, or in git history. From the first content onward it is a document like any other (autosave, locks, comments, SSE). Until then it exists only in the creating browser session — it has no id, cannot be commented on, and is invisible to the agent, which is fine: it is blank. The composer's **Capture** and Ask always carry content at creation and are unaffected.

**(c) Open questions**

- [DECISION NEEDED] **Defer-creation (recommended) vs create-then-delete.**
  - *Defer-creation* (drafted above): git history stays clean (no create/delete commit pairs), and abandonment-by-crash/tab-close is safe by construction — nothing existed yet. Cost: the doc id does not exist until first content, so during the blank instant the doc is not visible to other browsers or the agent (judged acceptable — it is blank).
  - *Create-then-delete*: the doc exists immediately (today's model, id available at once), and the UI deletes it on empty exit. Costs: every abandoned blank writes a create commit + a delete commit into the audit trail; tab-close/crash paths can miss the cleanup and leave the blank behind (needs a sweep); and it introduces an automatic deletion into a system where deletion is otherwise an explicit user act (§7: "deletion is user-only" — arguably still user-intent, but it is the spec's only non-explicit delete).
- [DECISION NEEDED] **Typed, then fully deleted, then exited.** Under defer-creation the document was created at first content; if the user blanks it again and leaves, does it persist (empty doc, deletable via ⋯) or is the rule "blank when the editing session ends → gone" (requires a real delete for this one sub-case, with the create/delete commit pair)? Recommendation: the strict rule — "a document created in this session that is blank when the session ends does not persist" — it matches the stated intent ("never persist an empty + untitled document from the UI create flow"); the commit-pair noise applies only to this rare path.

### 3. §10 — Right-click context menu (UI-018)

**(a) Insertion point** — §10, a new bullet inserted immediately before the "Keyboard scheme (v1)" bullet.

**(b) Proposed text**

> - **Right-click context menu.** Right-clicking an actionable item opens a Corpus context menu listing exactly that item's existing actions — the same set its ⋯ / header menu offers, nothing invented: document and thread rows (open, open in focus, archive, delete, resolve/reopen, the staleness quick actions where shown), column headers (the column's configure/move/remove set), the open reader (its ⋯ menu set), console job rows (retry/abandon, open the originating document/thread). The menu targets the item under the cursor, even when that item is not the current keyboard highlight. The native browser menu remains reachable wherever it is the useful one: on a text selection, inside the editor and any editable field, and anywhere no Corpus item is under the cursor. The menu follows the app's existing menu conventions — `esc` dismisses, arrows navigate, `↵` activates — and adds no exclusive capability: every action it offers stays reachable without a pointer through the existing ⋯ menus.

**(c) Open questions**

- [DECISION NEEDED] **Plugin-rendered surfaces (e.g. rows inside the todos column) in v1 scope?** Recommendation: **out** for v1 — core surfaces only; a kit-provided affordance for plugin views is a follow-up, so plugins are not half-covered by accident. Confirm.
- [DECISION NEEDED] **Keyboard opening.** Should the menu key / `⇧F10` open the context menu on the highlighted row (true keyboard parity for the menu itself, not just for its actions)? Recommendation: yes — it is the platform-native expectation and costs one binding in the `?` cheat-sheet. Confirm or drop.

### 4. §10 — User-adjustable view/column width (UI-019)

**(a) Insertion point** — §10, appended to the "**Columns are pinned view documents**" bullet (whose current text ends "…The seed data ships starter columns (Attention, Inbox, Open threads) — deletable like any document, nothing hardwired.").

**(b) Proposed text**

> **Column width is part of the column**: every column's width is user-adjustable by dragging its edge (the same direct-manipulation pattern as the console's resizable height), within sane min/max bounds; the reader-open widening applies relative to the chosen base width. Like `order`, the chosen width lives in the view document's frontmatter — synced to every browser, auto-committed (squashed on idle like editor autosaves, so a drag is one history entry, not fifty), and agent-stewardable ("@agent make the finance column wider" just works). Snap scrolling and narrow-window behavior are unchanged: the board shows as many columns as fit at their chosen widths. There is no settings panel — width is a property of each view, adjusted in place.

**(c) Open questions**

- [DECISION NEEDED] **Per-view drag (recommended) vs a global width setting vs both.** Per-view fits the existing model exactly (columns are already documents whose frontmatter holds their board properties — `order` is the precedent) and needs no new settings surface. A global setting would require the settings panel that doesn't exist. If "both", the global default becomes a real settings-surface decision — recommendation: per-view only; revisit a global default if per-view proves tedious.
- [DECISION NEEDED] **Where the preference lives: view-doc frontmatter (drafted) vs browser-local.** §10 currently draws the line at "only browser-local state stays local: scroll positions, open readers, per-reader navigation stacks". Frontmatter means cross-browser sync, agent adjustability, and server-sole-writer compliance for free — but every resize writes the corpus (mitigated by idle-squash). Browser-local means zero commits but no sync and no agent stewardship. Recommendation: frontmatter — width describes the view, not the viewer.
- [DECISION NEEDED] **Confirm: this does not seed a settings panel.** The draft deliberately keeps v1 panel-free.

### 5. §12 — Item-level todo commenting: reconcile with shipped v1 (PR #11 MAJOR 3)

**(a) Replaces** — §12, second bullet, currently:

> - **Renderer**: checkbox list view; toggling a box PUTs through a plugin route; each item can be commented on (anchored to the item text — the core anchor mechanism, unchanged).

**(b) Proposed text**

> - **Renderer**: checkbox list view; toggling a box PUTs through a plugin route; each item can be commented on, anchored to that item _[TBD: PLUGINS-003 — anchoring on plugin-rendered content needs its own design; until it lands, whole-document commenting is the behavior on todo documents]_.

**(c) Rationale and open question**

PLUGINS-003 **is** in Phase 5 scope, so the promise itself stays. But the shipped v1 defers it, and the old parenthetical — "the core anchor mechanism, **unchanged**" — prejudges exactly the design question PLUGINS-003 is filed to answer (its candidate designs include an item-keyed anchor variant, i.e. a *changed* mechanism). The draft keeps the WHAT, drops the mechanism claim, and marks the transitional state with the same `[TBD: ISSUE]` convention §2.1 already uses. When PLUGINS-003 lands, its amendment removes the TBD.

- [DECISION NEEDED] Confirm the transitional `[TBD]` (recommended) vs leaving §12 untouched and betting PLUGINS-003 lands this phase. Recommendation: take the TBD — it costs one clause, keeps the spec honest if PLUGINS-003 slips, and the "unchanged" claim should go either way.

### 6. §2.1 — Stale-pidfile wording matches CLI-014's shipped semantics (PR #11 re-review MINOR 1)

**(a) Replaces** — §2.1, the `corpus server status` bullet's last sentence, currently:

> Stale pidfiles (dead or reused pid) are detected and cleaned, never reported as "running".

**(b) Proposed text**

> A pidfile whose pid is **dead** is stale: detected, cleaned, never reported as "running". A pidfile whose pid is **alive** but not answering as this workspace's server is never deleted: a live pid is indistinguishable from this workspace's own daemon on a previously configured port (or one wedged mid-shutdown), and removing its pidfile would strand a running server. Instead, both `status` and `stop` report the situation — the pid, the port it was started on, and the port actually probed — with the remedy that applies (re-point the configured port and retry, or check and stop the pid directly); `stop` leaves the process and the file alone and exits successfully (there is nothing it can safely stop), while `status` still reports not-running through its state-reflecting exit code. Once that pid dies, the pidfile is ordinary stale cleanup again.

**(c) Open questions**

None — this records shipped, orchestrator-adjudicated behavior (CLI-014, mirroring CLI-009's `foreign`-branch precedent); sign-off is confirmation. The known `status` blemish (it names the pidfile's port where the probe used the configured one) is a SHARED-003 ledger finding against the *implementation*, not the spec — the spec text above states the correct behavior (`status` reports both ports), which that fix will meet.

## Sign-off record

**Date: 2026-07-30** — user sign-off received via the orchestrator (survey round); all amendments applied to SPEC.md on branch `phase-5-followups` the same day. Item numbering below follows the sign-off message (it differs from the draft section's: sign-off item 3 = draft 4 view width, item 4 = draft 3 context menu; item 7 is new).

**Per-item verdicts:**

1. **§7 delegation — MODIFIED, applied.** User modifications, verbatim in substance: (a) **delegate everything** — no inline-handling path at all; (b) concurrency bound **N = 10**; (c) **only non-overlapping tasks parallelize** — overlapping tasks run serially, with "overlap" generalized from same-document to same document(s) **or otherwise conflicting touched-sets**; (d) the skill picks the subagent **model by task size** — small/mechanical tasks to a smaller/faster model, larger judgment work to a stronger one, **with Opus 5 added to the available mix**. Applied to §7 as behavioral text: the spec states that model selection scales with task weight and that the skill carries the concrete tier guidance — exact model names (including Opus 5) belong in the skill, per the sign-off, so they do not appear in SPEC.md; AGENT-005's implementation adds Opus 5 to the skill's tier table.
2. **§10 empty documents — MODIFIED, applied.** User's behavioral rule, verbatim: "if any doc is left empty, it is automatically deleted on exiting the doc. empty means: no title and no content. This means it works if I start typing but then change my mind, remove what I was typing and leave." Applied to §10 exactly so — auto-delete on exit whenever title and content are both empty, regardless of history, for **any** document; the defer-creation vs create-then-delete mechanism question is dropped from the spec (implementation's choice), while the no-orphans / no-leak-by-any-exit-route language is kept.
3. **§10 view width — APPROVED as drafted, applied** (per-view edge drag, width in the view document's frontmatter, no settings panel).
4. **§10 context menu — APPROVED as drafted, applied** (accept-all bundle, including the draft's recommendations: plugin-rendered surfaces out of v1 scope; menu key / ⇧F10 opens the menu on the keyboard highlight).
5. **§12 transitional note — APPROVED as drafted, applied** (`[TBD: PLUGINS-003]`, mechanism claim dropped).
6. **§2.1 stale pidfiles — APPROVED as drafted, applied** (CLI-014's conservative shipped semantics).
7. **§7 spent transitional clauses — APPROVED; APPLIED 2026-07-30 by the orchestrator** in the same commit round that lands CLI-011 and SERVER-030 (both implemented, tree-green). Original pending texts, now in SPEC.md verbatim:
   - **When CLI-011 lands** — §7 skill-genesis clause, replace "Concretely: it **extends an existing skill** through the CLI when the pattern fits one; for a genuinely new skill it **proposes** it — a reply naming the recurring pattern plus an inbox write-up the operator can act on — until `corpus skill create` ships (CLI-011), at which point the agent creates the skill directly." with: "Concretely: it **extends an existing skill** through the CLI when the pattern fits one, and **creates a genuinely new skill directly** (`corpus skill create`), announcing what it codified — and why — in its reply."
   - **When SERVER-030 lands** — §7 locks bullet, replace "A dedicated defer/requeue queue state that re-enters automatically on lock release is planned (SERVER-030); until then the deferral is visible as an actionable failed job, never silently dropped." with: "A deferred edit re-enters the queue automatically when the lock clears; until it does, the deferral stays visible in the console — never silently dropped."

**Wording judgments made within the sign-off's bounds:**

- **Item 1**: kept the draft's "Outcomes are never assumed" / console-honesty / invariant bullets unchanged; rewrote the loop sentence to "the orchestrator never works a job inline" and folded the overlap generalization into the ordering bullet ("touch the same document(s) or otherwise conflict in what they touch"). "(§7 locks)" became "(below)" since the text sits inside §7.
- **Item 2**: dropped the draft's "no commits in git history" claim — whether an abandoned blank leaves a create/delete commit pair depends on the mechanism, which the sign-off explicitly keeps out of the spec; the observable guarantee (board, search, disk, threads, locks all clean) is what the spec now states.
- **Item 4**: "accept all" was read as accepting the draft's two recommendations, so the applied bullet includes the ⇧F10/menu-key clause and an explicit "plugin surfaces out of scope in v1" sentence (both were recommendation-level in the draft, not in its quoted text).
- **Item 7**: chose the "pending texts in SHARED-004" branch (both trigger issues unlanded; current spec wording still true), as invited by the sign-off.

**Not applied / out of my lane:** the fourth acceptance criterion (updating AGENT-005 / UI-017 / UI-018 / UI-019 with the signed-off spec references) — the sign-off constrains me to SPEC.md and this file; the orchestrator unblocks those issues. Committing is the orchestrator's.

## Acceptance Criteria
- [x] Draft amendments for all six items as behavioral spec text (WHAT, not HOW), each traceable to its SPEC section
- [x] Ambiguities surfaced as explicit questions rather than guessed
- [x] The full set presented to the user for sign-off in one round; applied to SPEC.md only after sign-off
- [ ] AGENT-005 / UI-017 / UI-018 / UI-019 unblocked (their issues updated with the signed-off spec references)

## Technical Design
spec-writer produces the drafts; the orchestrator runs the sign-off round with the user; amendments are applied on the phase branch after sign-off.

## Testing Strategy
n/a (spec text). Downstream issues carry the tests.

## E2E Verification Plan
n/a.

## E2E Verification Log
_Filled by the spec-writer / orchestrator: drafts produced, sign-off record, application commit._

- 2026-07-29 — spec-writer (fable): all six drafts produced under "Drafts for sign-off" above; SPEC.md untouched. Awaiting user sign-off in one round.
- 2026-07-30 — spec-writer (fable): sign-off received; amendments applied to SPEC.md (§2.1, §7, §10 ×3, §12) on branch `phase-5-followups`; item 7's rewords held as pending texts (CLI-011/SERVER-030 unlanded). Full record in "Sign-off record" above. Commit pending (orchestrator).

## Completion Checklist (orchestrator)
- [ ] User sign-off recorded
- [ ] SPEC.md amended on the phase branch
- [ ] Committed with `[SHARED-004]` prefix
