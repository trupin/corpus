# [SHARED-005] Wave-3 spec pass: §12 body-checkbox todos + residual §7 deferral sentences

## Domain
shared

## Status
done

## Priority
P0

## Model
fable

## Dependencies
- Depends on: SHARED-004 (done)
- Blocks: PLUGINS-005, PLUGINS-006, PLUGINS-007

## Spec References
- SPEC.md §12 (todos), §6 (anchors), §12 (plugins/M6), §7 (residual deferral sentences)

## Summary
Two bundles, one sign-off round:

**A. §12 — the PLUGINS-003 design (2026-07-30, plugins-dev; full analysis in
issues/plugins/003-item-level-commenting.md Technical Design).** Item text moves into
the document body as GFM task-list lines; the todos plugin stops registering a `View`,
so the core editor + the entire shipped anchor layer handle items natively and
item-level commenting is an ordinary text-quote anchor. Amend §12 accordingly: retire
the `[TBD: PLUGINS-003]` note, select the body-checkbox representation, restate the
"Renderer" clause and the "toggling PUTs through a plugin route" clause, and the §12 M6
drill clause. **User decisions needed:**
1. **Per-item `due`**: the body has no per-item field. Options: drop to document-level
   `due`, or an inline convention `- [ ] text (due: 2026-08-01)` (recommended,
   tolerating absence). `corpus todos add --due` and the overdue treatment are shipped.
2. **The toggle path**: UI checkbox toggle becomes an ordinary body edit through the
   core editor; the plugin route remains the CLI/agent path and format owner — confirm.
3. **The Renderer seam**: the reference plugin stops shipping a `View`; confirm
   `ListItem` + `DocPanel` + `validate` adequately prove the `docTypes` seam for §12's
   purposes (else the rejected 3b design's cost re-opens).

**B. §7 residual deferral sentences (sprint-016 Open Conflict 2, ledgered).** Three
sentences (~SPEC.md:248, :257, :325) still teach the interim `deferred:`-prefix
protocol that SHARED-004 item 7 retired elsewhere — the spec currently contradicts
itself and the shipped `corpus queue defer`. Reword to the shipped protocol.

## Drafts for sign-off

_Drafted 2026-07-30 by spec-writer (fable). DRAFT text only — SPEC.md is untouched until the
user signs off. Design basis for Bundle A: issues/plugins/003-item-level-commenting.md
Technical Design (Candidate 3, no-View variant). Line numbers cite the current SPEC.md._

### Bundle A — §12 body-checkbox todos (+ §12 M6, §6/§10 no-ops)

#### A1. §12 — items live in the document body (storage selection + per-item due)

**(a) Replaces** — §12, first bullet (SPEC.md:403), currently:

> - **Doc type** `todo`: frontmatter gains `items: [{ text, done, ts }]` (or items as markdown checkboxes in the body — builder's choice, but the server must own the format).

**(b) Proposed text**

> - **Doc type** `todo`: items are **checkbox lines in the document body** — standard markdown task-list items (`- [ ] text` / `- [x] text`), in body order. The plugin owns the item format, and every item mutation reaches the file through the server like any other body edit — but a todo document is otherwise an ordinary document: same core frontmatter, same lifecycle, and its type's template can ship starter items in its body like any template pre-fill (§10). An item may carry an inline due date — `(due: YYYY-MM-DD)` at the end of its line; open items past their date get the overdue treatment wherever items are shown. An item without the marker simply has no due date, and text that doesn't parse as the marker is ordinary item text — never an error.

**(c) Open questions and notes**

- [DECISION NEEDED — user question 1] **Per-item `due`.** The body form has no per-item field. (a) Drop to the document-level `due` core field (§5) — loses shipped behavior: `corpus todos add --due` and per-item overdue display. (b) The inline convention drafted above, tolerating absence and malformation (**recommended** — it keeps the shipped behavior, and the failure mode of a user editing the marker is graceful: the text just stops being a due date). (c) A frontmatter sidecar keyed by item text — rejected in the design as re-inventing anchoring in plugin space. The draft assumes (b); choosing (a) deletes the due sentences from (b) above and files the removal of `corpus todos add --due` into the wave-3 chain.
- **Per-item `ts` is dropped, deliberately** (design open question 5): body order becomes the order; the spec stops promising a per-item timestamp. Flagged so its absence from (b) is read as a decision, not an oversight.
- **Migration of existing frontmatter-items documents is not spec'd** — mechanism (bulk verb vs. tolerant reads) is the implementation's choice, per the SHARED-004 item-2 precedent of keeping mechanism questions out of the spec. The behavioral floor already in the spec covers the transition: whole-document commenting keeps working on every todo document throughout.

#### A2. §12 — rendering, item commenting, and the toggle path (retires the `[TBD: PLUGINS-003]`)

**(a) Replaces** — §12, second bullet (SPEC.md:404), currently:

> - **Renderer**: checkbox list view; toggling a box PUTs through a plugin route; each item can be commented on, anchored to that item _[TBD: PLUGINS-003 — anchoring on plugin-rendered content needs its own design; until it lands, whole-document commenting is the behavior on todo documents]_.

**(b) Proposed text**

> - **Rendering and item comments**: todo documents render in the **core document view** — the standard editor shows the checkbox list natively, so a todo document gets the entire §10 editing surface, and **each item can be commented on**: selecting an item's text and commenting creates an ordinary text-quote anchor (§6, unchanged — no special item anchoring exists). The thread follows its item through checks, renames, and reorders, and detaches (orphaned, quote preserved) when the item is deleted. In the UI, toggling a box is an ordinary body edit saved like any other; the plugin's routes remain the item-level write path for the CLI and the agent, and the plugin remains the format owner behind them. The plugin registers no custom document renderer.

**(c) Open questions and notes**

- [DECISION NEEDED — user question 2] **The toggle path.** Under this text the UI checkbox toggle is a core body edit (autosave, locks, reconciliation — all §10/§6 machinery), while `corpus todos add|check` and the plugin routes stay the CLI/agent path and the one place that knows the item format. Confirm this restatement of "toggling a box PUTs through a plugin route" — the WHAT (a toggle persists, is attributed, and syncs live) is unchanged; which door the UI's write goes through is what changes.
- [DECISION NEEDED — user question 3] **The renderer seam.** The reference plugin stops shipping a `View`, so §12's opening claim ("proves all four extension points") rests on `docTypes` being exercised through `ListItem` + `DocPanel` + `validate` (plus the underscore fixture plugin covering `View` itself, and §13's publish plugin as its natural first real consumer). Confirm this is adequate proof of the seam for §12's purposes. If instead a **shipped** `View` consumer is required, the design's rejected Candidate 3b (items in body, plugin keeps a View) re-opens with its full cost: a kit capture affordance, kit-exported thread rendering, and a rewritten anchoring ban.
- The bullet is retitled (**Renderer** → **Rendering and item comments**) because the plugin no longer renders; if the user prefers keeping the §12 bullet-name symmetry with §10's extension points, the title can stay "Renderer" with the same body text.

#### A3. §12 M6 — the deletion drill without a custom renderer

**(a) Replaces** — §12, milestone 6 (SPEC.md:460), currently:

> 6. **M6 — plugin system + todos plugin**: discovery, `@corpus/kit`, todos end-to-end. _Check_: delete `plugins/todos` → app still boots and renders todo docs as plain markdown (its column shows a "plugin missing" card); restore → custom renderer, DocPanel, and Todos column return; the kit-only import rule is lint-enforced (a direct UI-internals import from a plugin fails lint); a deliberately throwing plugin column shows an error card while the rest of the board keeps working.

**(b) Proposed text**

> 6. **M6 — plugin system + todos plugin**: discovery, `@corpus/kit`, todos end-to-end. _Check_: delete `plugins/todos` → app still boots and todo docs render as ordinary markdown **with working checkboxes** (items are body text — degradation costs the stats panel, the list-row treatment, and the column, never the document); its column shows a "plugin missing" card; restore → the DocPanel, the todo list rows, and the Todos column return; item-level commenting works identically in both states (it is core anchoring, not plugin surface); the kit-only import rule is lint-enforced (a direct UI-internals import from a plugin fails lint); a deliberately throwing plugin column shows an error card while the rest of the board keeps working.

**(c) Open questions**

None beyond A2's question 3 — this clause just follows it.

#### A4. §6 and §10 — deliberately untouched (recorded, not amended)

No draft. The design's load-bearing property is that item commenting is an **ordinary** §6
text-quote anchor — no new anchor kind, no resolution-ladder change, no reconciliation
change — so §6 gains nothing and must not be edited. §10 likewise: the `View` extension
point stays contracted exactly as written ("a doc whose `type` has a registered `View`
renders with it, falling back to the standard markdown view" — todos now simply takes the
fallback), and §10's degradation rule ("its documents remain, rendered as plain markdown")
is what A3 verifies. §12's Column/DocPanel/CLI/Skill bullets also stand unchanged — their
behavior is unaffected by where items are stored.

### Bundle B — §7/§9.2 residual `deferred:`-prefix sentences (sprint-016 Open Conflict 2)

The shipped protocol these sentences must match (CONTRACT-021/SERVER-030, already partially
in §7's locks bullet via SHARED-004 item 7): a claimed event blocked on a user-held lock is
**deferred on that document** (`corpus queue defer --blocked-on <doc>`) — a dedicated
waiting state, not a failure; clearing the lock (release, force-break, or expiry reap)
returns it to `pending` automatically and unparks `corpus queue idle`; `corpus job retry`
remains the manual override for a deferral whose lock never clears.

#### B1. §7 orchestrator skill — the delegated-deferral clause

**(a) Replaces** — §7, "Outcomes are never assumed" bullet (SPEC.md:248), the middle clause of:

> A subagent failure fails the event with the subagent's reason; a lock deferral surfaces exactly as an inline deferral would (a `deferred:`-prefixed failure, retryable via `corpus job retry`); a subagent that dies without reporting leaves its event `in-progress`, recovered by `corpus queue reap-stale`.

**(b) Proposed text**

> A subagent failure fails the event with the subagent's reason; a lock deferral surfaces exactly as an inline deferral would (the event is **deferred** on the locked document — waiting, not failed — and re-enters the queue on its own when the lock clears); a subagent that dies without reporting leaves its event `in-progress`, recovered by `corpus queue reap-stale`.

#### B2. §7 document locks — the user-locked-document deferral

**(a) Replaces** — §7, locks bullet on the user's editor session (SPEC.md:257), from "The orchestrator defers edits" to the end of the bullet, currently:

> The orchestrator defers edits to user-locked documents — it replies to the waiting thread ("you're editing X — I'll apply this when the lock clears"), fails the event with a `deferred:`-prefixed reason, and the work re-enters the queue via `corpus job retry` (from the console's failed-job row, or by the agent once the lock clears). A deferred edit re-enters the queue automatically when the lock clears; until it does, the deferral stays visible in the console — never silently dropped.

**(b) Proposed text**

> The orchestrator defers edits to user-locked documents — it replies to the waiting thread ("you're editing X — I'll apply this when the lock clears") and **defers the event on the locked document** (`corpus queue defer --blocked-on`): the event enters a dedicated **deferred** state — waiting, not failed — and is not handed out again while it waits. A deferred edit re-enters the queue automatically when the lock clears; until it does, the deferral stays visible in the console beside the document it waits on — never silently dropped — and `corpus job retry` stays the manual override for a deferral whose lock never clears.

#### B3. §9.2 lock routes — the deferral cross-reference

**(a) Replaces** — §9.2, the Locks route bullet (SPEC.md:325), currently:

> - Locks (§7): per-document **acquire / release / break** (break records the audit-trail entry; a deferred edit stays retryable via job retry — automatic re-enqueue arrives with the planned defer state, §7) · **reap** (clear expired). Document write paths refuse edits to a document locked by the other party, identifying the holder.

**(b) Proposed text**

> - Locks (§7): per-document **acquire / release / break** (break records the audit-trail entry and automatically re-enters any event deferred on the document, §7 — job retry stays the manual override) · **reap** (clear expired locks; also re-enters their deferrals). Document write paths refuse edits to a document locked by the other party, identifying the holder.

#### B4. Adjacent residuals (recommended riders — beyond the three ledgered sentences)

[DECISION NEEDED] The three sentences above name a state (`deferred`) and a verb
(`corpus queue defer`) that the spec's own enumerations still omit — reworded in isolation,
§7 would reference a status its status list doesn't contain and a verb its verb list never
introduces. Four one-line riders close that; each is severable if the user prefers the
strictly-ledgered scope:

1. **§7 queue statuses (SPEC.md:237)** — replace "Statuses: `pending → in-progress → processed | failed`; `abandoned` via UI/CLI." with:
   > Statuses: `pending → in-progress → processed | failed | deferred`; `abandoned` via UI/CLI. `deferred` is the one non-terminal outcome — claimed work waiting on a document's edit lock (§7 locks), returned to `pending` automatically when the lock clears.
2. **§7 CLI queue verbs (SPEC.md:243)** — in the bullet "`corpus queue complete|fail <id>`, `corpus queue abandon <id>`, …", insert after `complete|fail <id>`:
   > `corpus queue defer <id> --blocked-on <doc>` (park claimed work on a document's edit lock — it returns on its own, §7 locks),
3. **§9.2 queue routes (SPEC.md:324)** — "per-event **complete / fail / abandon**" becomes "per-event **complete / fail / defer / abandon**".
4. **§7 force-unlock bullet (SPEC.md:258)** — SHARED-004's summary flagged this "force-unlock retry promise" as spent by SERVER-030 but its applied pending-text didn't cover it. Replace "Breaks are recorded in the audit trail (commit message), and the agent's deferred edit stays retryable (`corpus job retry`) rather than being lost." with:
   > Breaks are recorded in the audit trail (commit message), and an edit deferred on the document re-enters the queue automatically on the break — never lost (`corpus job retry` stays the manual override).

## Sign-off record

**Date: 2026-07-30** — user sign-off received via the orchestrator (survey round); all
amendments applied to SPEC.md on branch `phase-5-followups` the same day.

**Per-question verdicts:**

1. **Q1 per-item `due` — APPROVED as recommended**: the inline `(due: YYYY-MM-DD)`
   convention at the end of the item line, tolerating absence and malformation (unparseable
   markers are ordinary item text, never an error). Applied in the §12 doc-type bullet (A1).
2. **Q2 toggle path — CONFIRMED as drafted**: the UI checkbox toggle is an ordinary core
   body edit; the plugin's routes remain the CLI/agent item-level write path and the plugin
   remains the format owner. Applied in the §12 rendering bullet (A2).
3. **Q3 renderer seam — CONFIRMED adequate**: no shipped `View` consumer required; the
   `docTypes` seam is proved by `ListItem` + `DocPanel` + `validate` (plus the fixture
   plugin, and §13's publish plugin as the natural first real `View` consumer). Candidate
   3b stays closed. Applied via A2/A3; §12's "proves all four extension points" opener
   stands.
4. **Bundle B — ACCEPTED IN FULL, including all four B4 coherence riders**: the three
   ledgered rewords (§7:248 delegated-deferral clause, §7:257 locks bullet, §9.2:325 lock
   routes) plus the riders (§7 status enumeration now lists `deferred` as the one
   non-terminal outcome; `corpus queue defer <id> --blocked-on <doc>` added to the §7 CLI
   queue-verb list; §9.2 queue routes now read "complete / fail / defer / abandon"; the §7
   force-unlock bullet now states automatic re-entry on break with `job retry` as the
   manual override).

**Sections touched in SPEC.md:** §7 (five places: statuses :237, queue verbs :243,
orchestrator-skill outcomes bullet :248, locks/user-editor bullet :257, force-unlock bullet
:258), §9.2 (two places: queue routes :324, lock routes :325), §12 (doc-type and rendering
bullets — `[TBD: PLUGINS-003]` retired), §12 (M6 drill). §6 and §10 untouched by design
(A4). Line numbers cite the pre-amendment file.

**Wording judgments made within the sign-off's bounds:**

- **A2 bullet title**: applied the draft's retitle (**Renderer** → **Rendering and item
  comments**) — the plugin no longer renders, so the old name would misdescribe the bullet;
  the draft's (c) note offered keeping "Renderer" and the sign-off did not ask for it.
- All quoted (b) texts were applied verbatim; no other deviations.

## Acceptance Criteria
- [x] Drafts for both bundles produced (behavioral, WHAT not HOW), user questions surfaced explicitly
- [x] User sign-off recorded here; SPEC.md amended on the phase branch only after
- [ ] PLUGINS-005/006/007 unblocked with the signed text cited

## Technical Design
spec-writer drafts; orchestrator runs sign-off; applied post-sign-off.

## E2E Verification Plan
n/a (spec text).

## E2E Verification Log
_Sign-off record goes here._

- 2026-07-30 — spec-writer (fable): both bundles drafted under "Drafts for sign-off" above;
  SPEC.md untouched, no git commands. Grounding read: PLUGINS-003 Technical Design,
  SPEC.md §6/§7/§9.2/§10/§12/§12, SHARED-004 (format + item-7 pending texts), and the
  shipped defer surface (`packages/contract/src/schemas/queue.ts`,
  `apps/cli/src/commands/queue/defer.ts`). Awaiting user sign-off in one round.
- 2026-07-30 — spec-writer (fable): sign-off received (all recommendations accepted; B4
  riders in full); all nine amendments applied to SPEC.md (§7 ×5, §9.2 ×2, §12 ×2, §12 M6)
  on branch `phase-5-followups`; sign-off record above; status flipped to done. No git
  commands run — committing and unblocking PLUGINS-005/006/007 are the orchestrator's.

## Completion Checklist (orchestrator)
- [x] User sign-off recorded
- [x] SPEC.md amended
- [ ] Committed with `[SHARED-005]` prefix
