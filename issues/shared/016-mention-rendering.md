# [SHARED-016] Mentions and invocations render as what they are — DRAFT, awaiting sign-off

## Domain

shared (orchestrator-owned)

## Status

**awaiting user sign-off** (drafted 2026-08-05). No domain issue exists yet; the
implementing chain does not start before the text is in place — the same rule
SHARED-012, SHARED-013 and SHARED-014 are held to.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-012 (established "every composer" as the unit of statement)
- Blocks: the UI chain this rider implies (not yet filed) — and, if the composer
  half is signed, whatever it takes for a composer to know what a body resolves
  to, which is a contract question, not a UI one

## Spec References

- §5 The document model — inline `[[refs]]`, unresolved refs
- §6 Threads and anchors — turn format; "a visible orphan beats a silent
  misattachment"
- §7 Event queue and agent loop — skills/agents as documents; "archiving a skill
  disables it"
- §8 Agent participation semantics — **owns** what these tokens do; this rider
  does not touch it
- §11 UI — the board → "Smart input everywhere", Thread view, Navigation history

---

## The user, verbatim (2026-08-05)

> "When instanciating a skill or an agent, I want it to show as such in the text
> rendering. Right now it shows as normal text. Ideally, we can even make the
> skills and agents invocation clickable and redirect to the corresponding skill
> / agent file"

---

## What already exists — this rider does not re-specify any of it

**This needs no new syntax.** Everything it renders is already specified and
already implemented; only the rendering is missing.

- **§8 already defines the tokens.** "A comment **requests the agent** by any of:
  an `@agent` mention, a targeted `@<subagent>` mention, a `/<skill>`
  invocation, or an explicit toggle in the composer". `@<subagent>` and
  `/<skill>` are "a directive, not a hint" — the server "parses mentions and
  invocations at post time, validates them against the projection, and puts
  structured `mentions`/`skills` fields in the event payload". So these tokens
  are meaningful today, have an effect today, and are written today by people and
  by the agent.
- **The link targets already exist as documents.** The projection makes
  `.claude/skills/` and `.claude/skills-archived/` document roots (`type: skill`)
  and `.claude/agents/` a root (`type: agent-def`); both types are core document
  types. A mention therefore resolves to a real document with a real id, and
  following it can push onto the reader's navigation stack exactly the way a
  `[[ref]]` does (§11, "Navigation history").
- **The composers already resolve these tokens.** §11's "Smart input everywhere"
  gives every composer and the editor three autocompletes: `@` → agent +
  subagents, `/` → skills, `[[` → documents. The completion menu already knows
  what exists; nothing on screen says what will happen after the menu closes.
- **The resolution rules are already settled in the write path** (verified in the
  server's mention parsing, 2026-08-05). Four of them matter to rendering, and
  the draft below is written to agree with each:
  1. A token only counts at a boundary that is not inside a word, a path or an
     address — `me@agent.example` and `path/comment/x` are not tokens.
  2. **Code is opaque.** A token inside a fenced block or an inline code span
     resolves to nothing and requests nothing — which is why the seeded skills
     can document this syntax without summoning anyone.
  3. **An unresolved token never wakes the agent on its own.** `@here`, `/tmp/x`
     and a mistyped `/researchr` are ordinary prose to the server.
  4. **An archived target *does* wake the agent**, with its status attached,
     because §8 hands the "missing or archived" case to the orchestrator to
     answer in its reply.
- **The quoting hazard is already written down**, on the producer side, in the
  orchestrate skill: "a ripple comment or an acknowledgment that **quotes a
  user's line** carries whatever that line said, and a quoted `@agent` wakes the
  loop exactly as a written one does."

So the gap is **§11 rendering only**: §8 says what these tokens mean, §11 never
says how they look.

---

## What this rider is for

**It is an honesty feature, not decoration.** These tokens summon the agent.
Today nothing on screen distinguishes a comment that will wake the loop from one
that will not — the thing with the largest consequence in a turn is the thing
rendered most plainly. Two consequences follow, and the draft takes both:

- **A reader should see it.** Marked tokens make "this turn asked for the agent"
  legible at a glance, and make the quoting hazard **visible**: an agent
  acknowledgment that quotes a line containing `@agent` shows a live mark inside
  the quote, which is exactly what it is.
- **A writer should see it earlier.** A person typing `@agent` deserves to know
  before sending, not after. Marking rendered turns tells you what you did;
  telling the composer tells you what you are about to do, while the typo in
  `/researchr` can still be fixed. Amendment 2 is that half, and it is separable
  — Amendment 1 stands alone if the user wants only the rendering.

---

## The decisions this draft makes, and why

**Unresolved renders as nothing, not as broken.** §5 says "an unresolved ref
renders visibly broken", and the temptation is to copy that. The draft
deliberately does not, because the two cases are not alike: an unresolved
`[[ref]]` is a legitimate forward reference to a document that will exist, so
flagging it is useful; an unresolved `@word` is almost always **just prose**, and
error-styling every `@here` and `/tmp/x` would litter ordinary writing with
warnings. It stays plain text — which still satisfies "must not look live",
since it is visibly distinguishable from a marked, live one by carrying no mark
at all. The cost is a silent typo, and the answer to that cost is Amendment 2:
the composer names what it could not resolve, before sending. (See Q1 — this is
the one the user may want to overturn.)

**Archived resolves, links, and says it is disabled.** Archiving a skill *is*
moving its folder to `.claude/skills-archived/`, which is still a document root,
so an archived skill is a document that exists and is reachable and is off. The
draft renders it as a link like any other, carrying the same archived marking
archived documents carry elsewhere. It does **not** render as unresolved: it
still wakes the agent, and §8 already says the orchestrator "deviat[es] only when
the target is missing or archived (and then says so in its reply)".

**The mark is keyed to the token, not the author.** A mention inside an agent
turn — including one inside quoted text — renders exactly as it does in a
person's turn. That is what surfaces the quoting hazard rather than hiding it,
and it does not restate §8's rule; it just declines to contradict it.

**Code is never marked.** Non-negotiable and load-bearing: the workspace's own
skill documents explain this syntax in prose, and a rendering that marked those
occurrences would show a live invocation on a page that invokes nothing.

**Document bodies stay plain.** Skills are editable documents that discuss other
skills, and in a **body** these tokens have no effect at all — marking them there
would assert liveness that does not exist, the opposite error from the one this
rider fixes. A document that wants to point at a skill already has `[[ref]]`,
which links. This also keeps the always-editable document view (§11) out of
scope, which matters independently: it is a live editing surface where caret,
selection and markdown serialization constrain what decoration can do, and it is
not the surface the user was looking at.

**The composer states, it does not restyle.** §11's own newline rider notes a
composer "offers no other way to write" a line break — the composers are plain
text inputs. Inline decoration *inside* them would mean a rich editor in every
composer, which is a large change the user did not ask for. A statement in the
composer's chrome gets the whole benefit at none of that cost, and can say things
inline styling could not: that a note-only toggle beats a typed mention, or that
an engaged thread will wake the agent even with no token in the body.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

### Amendment 1 — §11 Thread view, APPEND after the newlines sentence

APPEND immediately after, in §11's **Thread view** bullet, exactly this existing
text:

> **Newlines in a turn written by a person render as line breaks** — a textarea
> offers no other way to write one — while a turn written by the agent renders as
> ordinary markdown, where a single newline is a space and a break is written as
> markdown spells it. _(Rider signed 2026-08-03.)_

the following:

> **Mentions and invocations render as what they are.** In a rendered turn, an
> `@agent` mention, a targeted `@<subagent>` mention and a `/<skill>` invocation
> (§8) are **marked** — visibly distinct from the prose around them — because
> these are the tokens that summon the agent, and a reader who cannot see them
> cannot tell a note from a request. A mark that names a document is a **link**:
> following it opens that subagent or skill document in the reader, pushing onto
> the reader's navigation stack exactly like following a `[[ref]]`. Generic
> `@agent` is marked but names no document, so it links nowhere. A token this
> workspace has no target for — `@here`, `/tmp/x`, a mistyped skill name — is
> **not marked at all** and renders as the ordinary text it is: it summons
> nobody, and marking it would promise an effect it does not have (the composer
> is where that typo is caught, while it can still be fixed). A token resolving
> to an **archived** skill or subagent (§7) is marked and links like any other,
> and carries the same archived marking archived documents carry everywhere else
> — the target exists and is reachable, and is disabled. Marks follow the token,
> not the author: a token in an agent turn, **including one inside quoted text**,
> renders exactly as it does in a person's turn, because what the token does
> never depended on who typed it (§8) — an acknowledgment that quotes a line
> containing a mention shows that mention live, which is what it is. A token
> inside a fenced block or an inline code span is **never** marked: code is
> quoted material, and a turn or a skill document explaining this syntax must be
> able to write it down without appearing to summon anyone. **In a document body
> these tokens are ordinary text and stay that way** — a body invokes nothing, so
> a mark there would assert an effect that does not exist; a document that wants
> to point at a skill or subagent uses a `[[ref]]` (§5), which already links to
> it. _(Rider signed 2026-08-05.)_

### Amendment 2 — §11 "Smart input everywhere", APPEND at the end of the bullet

APPEND immediately after, in §11's **Smart input everywhere** bullet, exactly
this existing text:

> This holds wherever a completion menu appears — the three composer triggers,
> the document editor's `[[`, and the column query editor — so the same keys
> always do the same thing. _(Rider signed 2026-08-03.)_

the following:

> **A composer says who it will reach, before you send.** Those same tokens take
> effect the moment a turn is posted (§8), so every composer — the global
> composer, a thread's reply box, a comment on a document selection, a comment on
> a turn or on a selection within one, and any composer a plugin contributes —
> says, while you are still typing, **whether sending will ask the agent** and
> **which targets it named**: each subagent and skill it resolved, and each
> `@`/`/` token it could not resolve, so a mistyped skill name is visible before
> it quietly does nothing instead of after. The statement is about the
> **outcome**, not about the text: it accounts for the composer's own ask-agent /
> note-only toggle and for a thread the agent is already engaged in, so a
> composer that says the agent will be asked when no token is typed at all, or
> that says it will not be when the body carries one, is being accurate rather
> than inconsistent — §8 owns which of those wins. The statement never blocks
> sending, never rewrites what was typed, and claims no key of its own: the
> composer key contract is untouched. _(Rider signed 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Should an unresolved token be visibly flagged in a rendered turn?** As
drafted it renders as plain text, on the grounds that most `@word` and `/word`
tokens in prose are prose, and that error-styling them would make ordinary
writing look broken. The cost is that `/researchr` in a posted turn looks like
nothing happened, because nothing did.

_Recommendation: keep it plain (as drafted), and rely on Amendment 2 to catch it
at writing time._ If the user wants a flag anyway, the narrower version worth
having is: mark an unresolved token **only in a turn that woke the agent for
another reason** — there the payload already carries the unresolved list and §8
already expects the agent to say so in its reply, so the flag and the reply
agree. Flagging every unresolved token in every turn is the version to avoid.

**Q2 — Do document bodies get this too?** The user said "text rendering", which
in the app most naturally means rendered turns. The draft explicitly excludes
document bodies (a body invokes nothing) and therefore also the always-editable
document view.

_Recommendation: turns only (as drafted)._ If the user wants a skill document's
prose reference to `/comment` to be clickable, the honest form is **linked but
not marked as live** — clickable, styled as a reference rather than an
invocation — and that is a separate rider, because it lands in the editor, where
decoration has to survive typing, selection and round-tripping to markdown.

**Q3 — Amendment 2 at all, and in what form?** The user asked for rendering; the
composer half is the draft's own addition, argued above as the half that prevents
the mistake rather than explaining it afterwards. It is separable: signing
Amendment 1 alone is coherent.

_Recommendation: sign both._ If Amendment 2 is signed, note it likely needs the
server to answer "what does this body resolve to" for text that has not been
posted — a contract addition, filed as its own issue, not something the UI should
re-derive with its own copy of the matching rules. A UI that re-implemented them
would drift from the write path, and the whole point of the statement is that it
is right.

**Q4 — Should generic `@agent` link somewhere?** As drafted it is marked but not
clickable, because it names no single document — §8 leaves its routing to
triage. The plausible alternative is linking it to the orchestrate skill
document, which is real and reachable.

_Recommendation: not clickable (as drafted)._ Linking `@agent` to orchestrate
asserts a routing that §8 deliberately leaves open, and orchestrate is the loop's
machinery rather than the answer to "who did I just ask".

---

## Non-goals (state them so the chain does not drift)

- **No new syntax.** The tokens are §8's, unchanged, and no new sigil is added.
- **No change to what triggers the agent.** §8 owns that rule entirely; this
  rider must be applicable without altering a single triggering behaviour.
- **No rename tracking.** A mention is literal text a person typed, not an id
  ref: renaming a skill breaks mentions of its old name, and they then render
  unmarked. `[[refs]]` are the rename-proof construct (§5); this rider does not
  make mentions into refs.
- **No decoration outside rendered turns**: row previews, search results and the
  console keep showing plain text.
- **No document-editor change** (subject to Q2).
- **No retroactive rewriting.** Turns written before this exists render under the
  new rules like any other; nothing on disk changes.
- **Not a routing or permissions feature.** Nothing here mutes, blocks, or
  redirects a mention.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q4 and the text is adjusted
- [ ] Both amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator, each appended after the quoted existing text rather than
      replacing it — nothing in §11 is deleted by this rider
- [ ] §8 is **not** edited
- [ ] The implementing chain does not start before the text is in place
- [ ] The rendering rules are checked against the server's mention parsing before
      the UI issue is filed, and the two agree on all four: the boundary rule,
      code opacity, unresolved-does-not-summon, and archived-does

## Technical Design

### Files to Create/Modify

- `SPEC.md` §11 (two appends)

## Testing Strategy

None — spec text. The domain issues carry the tests. The notches worth fixturing
when they are filed:

- a turn containing `` `@agent` `` in an inline span and in a fenced block —
  **no** mark, and it must not have enqueued anything either
- `me@agent.example` and `docs/comment/README` — no marks
- a mention of an archived skill — marked, linked, archived marking present
- an agent turn quoting a user line containing `@agent` — marked inside the quote
- a mention of a skill that exists, followed by renaming the skill's folder —
  the old mention renders unmarked, and nothing pretends otherwise

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-016]` prefix
