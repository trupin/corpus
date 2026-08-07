# [UI-082] Composer offers the weight; the orchestrator honours it (SHARED-022)

## Domain

ui

## Status

todo

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

- SPEC.md **§11**, "Smart input everywhere" — "**Every composer can choose how
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
the composers' three autocompletes already read (§11).

## Where the choice must be offered

§11 enumerates, and SHARED-012's lesson is that per-surface phrasing is exactly
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
  act on" when it says it will not. §11 is explicit: "a presentation rule only:
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
2. **Transporting the choice** is not. §11 says the choice "**rides with the
   request to whatever does the work** (§7)", and there is no field on any post,
   no field on the queue event, and nothing in the dispatch to carry it. The UI
   alone cannot satisfy that sentence.

So either the missing contract/server issue is filed first, or this issue ships
the control without the transport — in which case say so explicitly in its scope,
because an evaluator reading §7's console bullet will test for the dispatch line
and fail it.

## Acceptance Criteria

- [ ] Every surface in the table above offers the control, and the test
      **enumerates them** rather than testing one and asserting the rest by
      inspection (UI-070's lesson)
- [ ] The offered levels are **read from the workspace's orchestrate skill**, in
      the order and with the names that document defines. No enum, no constant, no
      fallback list anywhere in `apps/ui`, `packages/kit` or the contract
- [ ] Renaming a level in the skill changes what the composer offers with **no
      code change**; adding a fourth level adds a fourth option; removing one
      removes it
- [ ] A workspace whose skill declares **no** parseable levels offers no control
      at all and behaves exactly as today — never a hardcoded fallback
- [ ] **Nothing is preselected.** A composer never touched shows no chosen level,
      and sending from it produces a request that states no weight
- [ ] After sending with a level chosen, the **same conversation's** composer
      starts from that level, visibly, changeable in one gesture
- [ ] That starting point is **browser-local**: reload clears it, a second browser
      is unaffected, and no thread or document gains a field
- [ ] The control is live exactly when the composer says sending will reach the
      agent, and shows as having nothing to act on otherwise — **without** altering
      what reaches the agent
- [ ] The composer key contract is unchanged and the control claims **no key**;
      it is nonetheless operable from the keyboard like every other affordance
      (§11 adds no pointer-exclusive capability)
- [ ] Sending is never blocked and typed text is never rewritten
- [ ] A note-only turn with a level chosen enqueues nothing, produces no job and
      no dispatch line — and the composer said so before sending
- [ ] The control is published from `@corpus/kit` so a plugin composer gets it
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
§11 puts it in the same class as reader width and collapse state; look at how
`threadCollapse.ts` / `ThreadCollapseContext.tsx` scope and persist per-thread
browser-local state and follow that shape rather than inventing storage. Note the
scope is "the same conversation" — the global composer's Ask is not a
conversation, so decide and document what its scope is (SHARED-022 does not say;
this is a genuine gap worth raising rather than guessing silently).

**Liveness couples to a statement that does not exist yet.** §11's "A composer
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
- **A capture** — §11 names Capture explicitly. It is a request, and a request is a
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

_Filled in by the implementing agent as proof-of-work. State which model the
implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills: workspace path, port, per-surface observations, dispatch lines
quoted from `corpus job log`, the rename round trip, and the on-disk diff showing
no document gained a field.]_

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

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-082]` prefix
