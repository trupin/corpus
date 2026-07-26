# [UI-004] Type-aware rows: badges, reasons, staleness ramp

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — the visual system is fully specified by the prototype (exact opacities, washes, and badge vocabulary) and the staleness rules are stated in SPEC.md §5; this is precise transcription plus small, well-defined mutations.

## Dependencies

- Depends on: UI-002
- Blocks: UI-005

## Spec References

- SPEC.md §5 — "The document model", staleness ("age runs from `max(updated, reviewed)` against global thresholds — defaults 30/90/180 days; the UI renders this as a gradual ramp; **Still current** sets `reviewed: <now>`; `evergreen: true` opts out entirely")
- SPEC.md §11 — "Type-aware rows" (thread rows show anchor quote, last-turn preview, unread and pending-agent indicators; plugin doc types render via their registered `ListItem`; the staleness ramp renders per row)
- SPEC.md §11 — "Attention" (each row carries a reason chip; handling the reason clears the row live via SSE)
- SPEC.md §7 — "Document locks" (a locked document renders read-only with a banner; lock state is projected and broadcast over SSE)
- SPEC.md §8 — pending-agent indicator ("no fake progress, no token streaming")
- SPEC.md §9.2 — `needs=me` as the Attention union; `PUT /api/docs/:id`; `POST /api/threads`
- `design/index.html` — **authoritative look & feel** (`.row`, `.row-top`, `.type-glyph`, `.row-title`, `.row-badges`, `.row-excerpt`, `.row-meta`, `.unread`, `.needs-you`, `.working-dot`, `.age`, `.row.age-1/2/3`, `.stale-actions`, `.reason`, `.r-chip`, `.row.leaving`)

## Summary

Build the `Row` component in `packages/kit` — the single list-item renderer every column uses (and the fallback that plugins' registered `ListItem` slots later replace). It implements the prototype's row anatomy and badge vocabulary, the Attention reason-chip line, thread-specific rendering (anchor quote + last-turn preview), the lock indicator, and the three-level staleness decay ladder with its inline quick actions (Archive · Still current · @agent triage) — each of which is a real, committed mutation, not a local UI flag.

## Acceptance Criteria

- [ ] `Row` lives in `packages/kit` and is exported from the kit's public surface (plugins replace it via their `ListItem`; core columns consume it through the contract UI-003 defined).
- [ ] Row anatomy matches `design/index.html`: a top line of mono `.type-glyph` (bordered, uppercase, the doc's `type`) + serif bold `.row-title` (14.5px/600) + right-aligned `.row-badges` cluster; a `.row-excerpt` clamped to 2 lines (`-webkit-line-clamp: 2`); a mono `.row-meta` line (folder/context · relative age). Hover fills `--surface-2`; the row is a `role="button"` with `tabindex="0"`.
- [ ] Badge vocabulary: **unread** = accent pill with a leading accent dot (`.unread`, count inside); **needs-you** = `--signal` pill with short text (e.g. `form`, `3 due`); **pending agent** = pulsing `.working-dot` (accent, `1.4s` pulse, respects `prefers-reduced-motion`); **age chip** = mono `.age`.
- [ ] Attention rows render a `.reason` line of `.r-chip`s driven by the `needs=me` reasons supplied by SERVER-011 — at minimum: "agent replied" (`.r-reply`, accent wash), "awaiting your answer" (`.r-form`, signal wash), "review: archive or act" and "getting stale" (`.r-stale`, sepia wash), "due today" and "failed job". The reason vocabulary is data-driven (a map from server reason code → label + chip class), not string-sniffed in the component.
- [ ] Thread rows (`type: thread`) show the **anchor quote** (serif italic) when the thread is anchored, plus a last-turn preview in the form `<author>: <text>` as the excerpt, plus unread and pending-agent indicators; standalone threads show "standalone" as context and whole-document threads show their parent's title.
- [ ] Staleness is computed from `max(updated, reviewed)` against 30 / 90 / 180-day thresholds (thresholds injected, not hard-coded literals scattered in the component) producing levels 0–3; documents with `evergreen: true` are always level 0.
- [ ] The decay ladder renders exactly as the prototype: **level 1** — `.row-title` opacity `0.92`, no rail; **level 2** — sepia left rail via `::before` at `opacity: 0.45`, title opacity `0.82`, `.age` in `--sepia-ink`; **level 3** — `--sepia-wash` row background with `--sepia-wash-2` border, full-opacity sepia rail, title opacity `0.72`, `.age` in `--sepia-ink` at weight 600.
- [ ] Level-3 (stale) rows grow an inline `.stale-actions` row with three buttons: **Archive** → `PUT /api/docs/:id` setting `status: archived`; **Still current** → `PUT` setting `reviewed: <now>` (a distinct committed act, **not** an edit of `updated`); **@agent triage** → `POST /api/threads` creating a whole-document, agent-requested thread on that doc.
- [ ] Archiving a row plays the slide-out animation (`.row.leaving`: `opacity: 0`, `translateX(24px)`, `0.3s`) before the row leaves the list, and the animation is skipped under `prefers-reduced-motion`.
- [ ] "Still current" visibly resets the row to level 0 after the mutation lands (via SSE-driven refetch, not local optimism alone).
- [ ] A document held by an agent lock (from `useLocks()`) renders a `🔒 agent editing` warn chip (`.chip.warn` treatment) in the badge cluster, and it appears/clears live over SSE.
- [ ] Rows are rendered without knowledge of any specific column; all column-specific behavior arrives via props.
- [ ] Vitest component tests cover every badge, every staleness level, each quick action's request, and the reason-chip mapping.

## Technical Design

### Files to Create/Modify

- `packages/kit/src/row/Row.tsx` + `Row.css` — the component and its styles (ported from the prototype)
- `packages/kit/src/row/staleness.ts` (+ `staleness.test.ts`) — `stalenessLevel(doc, thresholds, now)` and the age-label formatter
- `packages/kit/src/row/badges.tsx` (+ test) — `UnreadBadge`, `NeedsYouBadge`, `WorkingDot`, `AgeChip`, `LockChip`
- `packages/kit/src/row/reasons.ts` (+ test) — server reason code → `{ label, chipClass }` map
- `packages/kit/src/row/threadRow.ts` (+ test) — anchor quote / last-turn preview / context-line derivation
- `packages/kit/src/row/useRowActions.ts` (+ test) — archive / still-current / triage mutations
- `packages/kit/src/index.ts` — export `Row`, the badge primitives, `stalenessLevel`, and the row prop types (plugins need the types to write a conforming `ListItem`)
- `apps/ui/src/board/ColumnList.tsx` — render the kit `Row`, replacing UI-003's placeholder
- `apps/ui/e2e/rows.spec.ts` — Playwright

### Key Implementation Details

**Staleness math.** `age = now - max(updated, reviewed ?? updated)`. Levels: `< 30d` → 0, `≥ 30d` → 1, `≥ 90d` → 2, `≥ 180d` → 3. `evergreen: true` ⇒ 0 unconditionally. Thresholds come from configuration (server-provided or a kit default constant) so a workspace can retune them without a code change — but ship the spec defaults. The age **label** is the humanized elapsed time the prototype shows (`3mo`, `stale · 8mo`), formatted in one helper so every surface agrees.

**The sepia rule.** `--sepia` is the dedicated staleness axis (UI-001). Nothing in this component may use it for any other meaning, and staleness may not be expressed with `--signal` or `--accent`. The rail is the row's `::before` pseudo-element (`left: 4px; top/bottom: 10px; width: 3px; border-radius: 99px`) — already reserved in the prototype's `.row` base rule.

**Quick actions are real mutations.** Each button issues a request through kit hooks and lets SSE invalidation drive the list update:

- **Archive** — `PUT /api/docs/:id` with `status: archived`. Reversible; the toast should say so.
- **Still current** — `PUT /api/docs/:id` with `reviewed: <ISO now>`. This is the semantically distinct act from SPEC.md §5: it must **not** touch `updated`, and it must not be modeled as a body edit. Getting this wrong makes staleness lie.
- **@agent triage** — `POST /api/threads` with `parent: <docId>`, `anchor: null`, agent-requested, and a first turn asking the agent to review the document. This is what makes the ramp actionable rather than decorative.

Use optimistic UI only for the visual transition (the leaving animation); the authoritative state change comes back through invalidation. Narrate each with a toast per the prototype's convention.

**Pending-agent indicator.** The `.working-dot` reflects a real outstanding agent job for that document/thread (from the jobs/queue projection), not a timer. SPEC.md §8's escalating "working… → still working…" copy belongs to the reader/thread surfaces; on a row, the honest signal is just the pulsing dot with a `title` naming what is running.

**Read-state correctness.** The unread badge on a **document** row aggregates its threads: it clears only when **all** of that document's threads have been seen (SPEC.md §7 — "opening a parent document does not mark its collapsed-chip threads seen"). Derive this from projected read state; do not clear it as a side effect of opening the row.

**Plugin forward-compatibility.** Export the row prop types and treat `Row` as the default renderer: a registry lookup for a plugin `ListItem` by doc type belongs to PLUGINS-001, but the seam (a `ListItem?` prop or resolver hook) must exist here so that issue is additive.

**Accessibility.** Badges carry accessible text (`aria-label`/`title`) — a pulsing dot with no label is invisible to a screen reader. The three stale actions are real buttons reachable by keyboard, and the row itself must not swallow their clicks (stop propagation so a quick action does not also open the document).

### Edge Cases

- **`reviewed` in the future or newer than `updated`** — `max()` handles it; never produce a negative age.
- **Missing `updated`** — fall back to `created`; never render `NaN` or "Invalid Date".
- **`evergreen: true` on an ancient document** — level 0, no rail, no quick actions, plain age chip.
- **Stale **and** unread** — both treatments apply simultaneously; verify the accent unread pill stays legible on the level-3 sepia wash in **both** themes.
- **Stale thread rows** — quick actions target the thread document; "Archive" on a thread must not be confused with "Resolve" (resolve lives in the reader menu, UI-005).
- **Quick action while the document is agent-locked** — the mutation will be rejected by the server; surface the failure as a toast and leave the row unchanged rather than optimistically removing it.
- **Rapid double-click on Archive** — the mutation must be idempotent/guarded so it fires once.
- **Row removed by SSE mid-animation** — the leaving animation must not leave a ghost node or throw on unmount.
- **Long titles, long anchor quotes, many badges** — the title truncates before the badge cluster is squeezed; the excerpt stays at exactly 2 clamped lines.
- **`prefers-reduced-motion`** — pulse and leaving transitions are disabled (the rule already exists from UI-001); the row must still disappear on archive, just without the slide.
- **Reason codes the UI does not know** — render the raw code in a neutral chip rather than dropping the row's reason line.

## Testing Strategy

Vitest + React Testing Library in `packages/kit`:

- `stalenessLevel`: boundary table at 29/30/89/90/179/180 days; `reviewed` newer than `updated` resets the level; `evergreen` forces 0; missing `updated` falls back to `created`.
- Ladder rendering: snapshot/class assertions that level 1/2/3 apply exactly the prototype's classes, and that level 3 (and only level 3) renders `.stale-actions`.
- Badges: unread renders with a count and an accessible label; needs-you renders signal styling with the supplied short text; working dot renders with a title; lock chip renders when the doc id is in the lock set and disappears when it leaves.
- Aggregate unread: a document row with two threads, one seen, still shows unread; with both seen, it clears.
- Thread rows: anchored thread shows the quote; whole-document thread shows the parent title; standalone shows "standalone"; the excerpt is `author: text` from the last turn.
- Reason chips: each known reason code maps to the right label and chip class; an unknown code renders neutrally.
- `useRowActions`: Archive issues `PUT { status: "archived" }`; Still current issues `PUT { reviewed: <ISO> }` and **does not** include `updated`; triage issues `POST /api/threads` with `parent`, null anchor, and the agent flag; a rejected mutation leaves the row and surfaces an error.
- Click isolation: clicking a stale action does not fire the row's open handler.

## E2E Verification Plan

Against the **real running application** with a workspace containing documents of varied ages (per SPEC.md §15 M3, rows are what the board's checks observe).

### Verification Steps

1. Seed a workspace with documents whose `updated` values are ~10d, ~45d, ~120d, ~300d old, one with `evergreen: true` and an old `updated`, one thread with an unread agent reply, one thread with an unanswered form, and one document with a due date today. Start the server and the UI.
2. Assert the four aged rows render at levels 0/1/2/3 — check the computed styles (title opacity, rail background, row background) against the prototype values in **both** light and dark themes.
3. Assert the evergreen document renders at level 0 despite its age.
4. On the level-3 row, click **Still current** — then `cat` the document: assert `reviewed` is set to now and `updated` is **unchanged**; assert `git log -1` shows the auto-commit; assert the row visually returns to level 0 without a reload.
5. On another level-3 row, click **Archive** — observe the slide-out, then assert `status: archived` on disk and that the row is gone from default lists.
6. Click **@agent triage** on a stale row — assert a new thread file exists in `data/threads/` with `parent` set to that document, `anchor: null`, `agent: requested`, and that a `comment.created` event landed in `.corpus/queue/pending/`.
7. Open the Attention column — assert each row carries the correct reason chip (agent replied / awaiting your answer / due today / review: archive or act) matching the `needs=me` reasons the server returns for that row (compare against the raw `GET /api/docs?needs=me` response).
8. Mark the unread thread seen (open it, or `POST /api/threads/:id/seen`) — assert the unread pill clears live via SSE and the Attention row drops out.
9. Acquire a lock out-of-band (`corpus lock` / agent edit) on a visible document — assert the `🔒 agent editing` chip appears live; break the lock and assert it clears live.
10. Enable `prefers-reduced-motion` (Playwright `emulateMedia`) and repeat an archive — assert the row disappears with no animation and nothing throws.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable") — the audit trail for recalibrating Model recommendations. The
evaluator will reject issues without credible proof._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, kit surface consumed by plugins; writes corpus state)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-004]` prefix
