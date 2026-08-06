# [SHARED-016] Mentions, invocations and bare document ids render as handles

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-012 (established "every composer" as the unit of statement)
- Blocks: the UI chain this rider implies (not yet filed) — and, if the composer
  half is signed, whatever it takes for a composer to know what a body resolves
  to, which is a contract question, not a UI one
- Ordering: **SHARED-020 appends after the same §11 Thread view sentence** as
  Amendment 1. Neither is signed; whichever lands second re-reads the bullet

## Spec References

- §5 The document model — id format, inline `[[refs]]`, unresolved refs
- §6 Threads and anchors — turn format; "a visible orphan beats a silent
  misattachment"
- §7 Event queue and agent loop — skills/agents as documents; "archiving a skill
  disables it"
- §8 Agent participation semantics — **owns** what mention tokens do; this rider
  does not touch it
- §9.1 Projection — the `links` table, backlinks, the `references:` filter
- §11 UI — the board → "Smart input everywhere", Thread view, Document view,
  Navigation history

---

## The user, verbatim (2026-08-05)

**First request — mentions and invocations:**

> "When instanciating a skill or an agent, I want it to show as such in the text
> rendering. Right now it shows as normal text. Ideally, we can even make the
> skills and agents invocation clickable and redirect to the corresponding skill
> / agent file"

**Second request, same day — bare document ids:**

> "When there's a doc_xxx ID in a text, I want corpus UI to automatically detect
> it's a doc and replace it with the actual doc handle (link + doc title)"

**Why one rider.** These are one feature seen twice. Both say: _a token in body
text that names something in the corpus should stop looking like prose and start
looking like the thing it names._ There are now **three token families** —
`@<subagent>` / `/<skill>` (§8), the bracketed `[[doc_a1b2c3]]` ref (§5), and the
bare id — and a rendering that treated them as three unrelated features would
produce three subtly different answers to the same three questions (what about
code? what about unresolved? what about archived?). Answering them once, here, is
the whole point. Where the families **do** differ, the difference is stated and
argued rather than left to fall out.

The one difference that drives most of what follows: **a mention has an effect
and an id does not.** `@agent` summons the agent; `doc_a1b2c3` names a document
and nothing else happens. So the mention half is deliberately conservative (a
false mark implies an action that will not happen) and the id half can afford to
be liberal (a false handle links to the document the text already named — the
worst case is a correct link nobody wanted).

---

## What already exists — this rider does not re-specify any of it

**This needs no new syntax.** Every token it renders already exists, is already
written by people and by the agent, and already means something; only the
rendering is missing.

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
- **§5 already defines ids and their bracketed form.** "`id` is the stable
  reference used everywhere"; "**Inline references** are id-based:
  `[[doc_a1b2c3]]` … in any body"; a ref "renders as a link showing the target's
  **current** title (rename/move-proof)"; refs "are extracted into the
  projection's `links` table at projection time, powering backlinks (§9, §11)";
  and "an unresolved ref renders visibly broken". So handle-rendering, title
  substitution and rename-proofness are all specified behaviour **for the
  bracketed form** — the bare id is the same target reached without the brackets.
- **The id shapes are fixed and enumerable** (verified 2026-08-05). Documents:
  `doc_*` (documents), `th_*` (threads), `skill_*` (skills, including archived
  ones) and `agentdef_*` (subagent definitions). **`anc_*` (anchors) and `evt_*`
  (queue events) are not documents** and have nothing to link to — a distinction
  the draft below makes explicit, because both appear in prose and in agent
  output.
- **The quoting hazard is already written down**, on the producer side, in the
  orchestrate skill: "a ripple comment or an acknowledgment that **quotes a
  user's line** carries whatever that line said, and a quoted `@agent` wakes the
  loop exactly as a written one does."

So both gaps are rendering gaps, in two places:

- **§8 says what mention tokens mean; §11 never says how they look.**
- **§5 says what a bracketed ref renders as; nothing says what a bare id
  renders as** — even though it names the same document by the same id, and even
  though the agent, the CLI's output and anyone pasting a URL or a log line
  produces bare ids constantly.

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

**The id half is a legibility feature, and its own kind of honesty.** A bare
`doc_a1b2c3` in a turn is a reference the reader cannot follow and cannot read:
it names a document without saying which one. The agent produces these
constantly — the CLI speaks in ids — so the corpus accumulates text that is
correct and unreadable. Rendering the handle makes it say what it means, and the
title substitution inherits §5's rename-proofness for free: the handle shows the
target's **current** title, so a document renamed after the turn was written
still reads correctly, which the raw id never did.

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

### Which of those carry over to bare ids — each stated explicitly

**Code opacity: carries over, and matters more.** A token inside a fenced block
or an inline code span is never a handle. This is the load-bearing rule for ids:
pasted logs, JSON payloads, CLI transcripts and file listings are exactly where
bare ids appear in bulk, and they are exactly the content people put in code —
more so once snippets exist (SHARED-014). It also keeps documentation honest: a
skill that explains the id format, or a turn showing a command someone should
run, must be able to print `doc_a1b2c3` without turning it into someone's
mortgage note.

**Unresolved renders plain: carries over, and it is the same argument.** A bare
id with no document behind it — a deleted document, a truncated paste, a
lookalike string — renders as the plain text it is. No handle, no broken styling.
This deliberately **differs from §5's bracketed rule**, which says an unresolved
`[[ref]]` "renders visibly broken", and the asymmetry is the same one the mention
half already makes: an author who typed brackets **asserted** "this is a
reference", so flagging the failure is useful; a bare string asserted nothing, so
flagging it would be the app arguing with prose it does not understand. The
amendment says this in one sentence so the two rules do not read as a
contradiction.

**Archived third state: carries over unchanged.** An id resolving to an archived
document renders as a handle, links like any other, and carries the same archived
marking archived documents carry everywhere else. Nothing new: §11's board
already shows archived documents alongside everything else when asked, and
archiving is organisational, not deletion.

**Scope: deliberately diverges, and the divergence needs no apology.** Mentions
are excluded from document bodies because a body invokes nothing, so a live mark
there would assert an effect that does not exist. **That reasoning does not
transfer to ids at all**: an id is not an action, it is a reference, and §5
already renders references in bodies. So the id half applies **wherever body text
is rendered** — turns and document bodies alike. A reader who notices the two
scopes differ is noticing the real distinction: one family means "do something",
the other means "this thing here". The amendment states both scopes in the same
breath for exactly that reason.

**And a decision with no mention-half counterpart: the bracket keeps its job.**
Bare detection is a **reading** convenience; the bracketed `[[ref]]` remains the
**authored, indexed** form. Only bracketed refs feed the `links` table, and
therefore backlinks, the `references:` filter and `doc check` (§5, §9.1). So the
brackets are not made legacy by this — they are what makes a reference *count*,
while bare rendering only makes it *readable*. That answers "what is the bracket
still for?" with something a person can act on: if you want the target to know it
was referenced, use `[[`; the autocomplete inserts it, which is why §5 can say
nobody types ids by hand. (See Q5 — this is the sharpest new decision.)

**Render-only. Nothing rewrites the source.** A bare id is left exactly as
written, in the markdown, in git, and over the CLI. Silently converting it to
`[[doc_a1b2c3]]` on save would edit words the person did not choose to change,
turn a rendering feature into a write path, and produce auto-commit churn on
documents nobody edited — and it would erase the Q5 distinction the moment it
fired. §5's existing refs already resolve at render time; this is the same
contract.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

> **Ordering hazard.** SHARED-020 (also unsigned) appends after the **same** §11
> Thread view sentence Amendment 1 does. Whoever applies second must **re-read
> the bullet** and append after whatever is then last — pattern-matching on the
> quoted anchor will silently interleave the two riders' text.

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

### Amendment 3 — §5, APPEND after the inline-references bullet

APPEND, as a **new bullet immediately after** §5's existing bullet that begins
"**Inline references** are id-based" and ends:

> An unresolved ref renders visibly broken and is a `doc check` warning, not a
> failure (referencing a not-yet-created document is legitimate).

the following bullet:

> - **A bare id renders as a handle too.** A document id written on its own in
>   body text — `doc_a1b2c3`, `th_x9y8`, and the ids of skills and subagent
>   definitions — renders as that document's **handle**: its current title, as a
>   link, following the same rename-proof rule the bracketed form follows and
>   opening the target in the reader by pushing onto its navigation stack (§11).
>   This holds **wherever body text is rendered** — a turn and a document body
>   alike — because an id is a reference and a reference reads the same
>   everywhere; where the body is editable, the handle stays editable: putting
>   the caret in it reveals the id it was written as, so it can be changed or
>   deleted like the text it is. **Nothing rewrites the source.** The id stays
>   exactly as written, on disk, in git and over the CLI — rendering is a reading
>   convenience, never an edit. **The bracketed form keeps its own job**: only
>   `[[refs]]` are extracted into the `links` table, so only they produce
>   backlinks, answer the `references:` filter and are checked by `doc check`. A
>   bare id is **read** as a reference; a bracketed one is **recorded** as one —
>   which is why `[[` autocompletes and nobody types ids by hand. Only ids that
>   name **documents** become handles: an anchor id (`anc_*`) and an event id
>   (`evt_*`) name no document and stay plain text. A well-formed id is a handle
>   only when it stands as its own token — an id inside a path, a filename, a URL
>   or a longer identifier is part of that thing and renders as written, so
>   `data/threads/th_x9y8.md` stays a path — and, as everywhere else, **a token
>   inside a fenced block or an inline code span is never a handle**: pasted
>   logs, payloads and command lines must be able to contain ids without
>   sprouting links. An id with no document behind it — deleted, mistyped,
>   truncated — renders as the **plain text it is**, not as a broken reference:
>   the sentence above is about a ref someone deliberately bracketed, and a bare
>   string claims nothing to be broken about. A handle whose target is
>   **archived** links like any other and carries the same archived marking
>   archived documents carry elsewhere. _(Rider signed 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Should an unresolved token be visibly flagged in a rendered turn?**
(Applies to both halves: an unresolved `@`/`/` mention and a bare id with no
document behind it are drafted the same way, and should be answered the same way
— a flag on one and silence on the other is the incoherence to avoid. Note the
answer does **not** touch §5's existing rule for unresolved *bracketed* refs,
which stays "visibly broken" either way.) As
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

**Q2 — Do document bodies get the *mention* half too?** (Ids do: Amendment 3 puts
them in bodies deliberately — see the scope divergence above. This question is
about `@`/`/` only.) The user said "text rendering", which in the app most
naturally means rendered turns. The draft explicitly excludes document bodies (a
body invokes nothing) and therefore also the always-editable document view.

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

**Q5 — Should a bare id count as a reference, or only read as one?** As drafted,
only bracketed `[[refs]]` feed the `links` table, so a turn full of bare ids
produces no backlinks and does not answer `references:`. The alternative is to
index bare ids too, which makes the two forms fully equivalent and reduces the
brackets to a typing artefact.

_Recommendation: read-only, as drafted._ Three reasons. It gives the bracket a
real, explainable job ("`[[` means *record* this reference"), which the user's
request otherwise dissolves. It keeps backlinks meaningful: the agent quotes ids
in passing constantly — job logs, trace lines, "filed from doc_x" — and indexing
all of it would fill every document's "referenced by" panel with mentions in
passing, which is the fastest way to make a backlinks panel worthless. And it
keeps §5's existing sentences true as written, so this rider adds a bullet rather
than editing the ref rule. _If the user wants the gap closed the other way_, the
cheap bridge is an affordance on a rendered bare-id handle — "make this a
reference" — which converts it in place, on purpose, by a person. That is a
follow-up rider, not a line in this one.

**Q6 — Does the always-editable document view really get handle substitution?**
As drafted, yes: the id half applies wherever body text renders, and §11 gives
documents no read-only mode, so excluding the editor would mean excluding
document bodies entirely and answering the user's request only for turns. The
draft therefore states the editing rule — the caret reveals the id — which is a
real constraint on that surface, not a free-form one.

_Recommendation: include it, as drafted._ The fallback, if the caret rule proves
too costly to build well, is to ship turns first and bodies second **as one
signed behaviour delivered in two issues**, rather than to narrow the spec —
because a handle that appears in a turn and not in the document the turn is about
is precisely the incoherence this rider exists to prevent. That sequencing is a
decomposition call, and I would make it at `/decompose` time rather than write it
into SPEC.

---

## Non-goals (state them so the chain does not drift)

- **No new syntax.** The mention tokens are §8's and the ids are §5's, both
  unchanged: no new sigil, no new bracket form, no new frontmatter field.
- **No change to what triggers the agent.** §8 owns that rule entirely; this
  rider must be applicable without altering a single triggering behaviour.
- **No rename tracking for mentions.** A mention is literal text a person typed,
  not an id ref: renaming a skill breaks mentions of its old name, and they then
  render unmarked. `[[refs]]` are the rename-proof construct (§5) — and a bare id
  inherits that property, because it is an id; a mention does not.
- **No source rewriting, ever.** Nothing in this rider converts a bare id to a
  bracketed ref, normalises a mention, or edits a body on save.
- **No new indexing.** The `links` table, backlinks, the `references:` filter and
  `doc check` are untouched: bare ids do not enter them (Q5).
- **No mention decoration outside rendered turns**: row previews, search results
  and the console keep showing plain text. (Bare-id handles follow body text,
  per Amendment 3; row previews and the console are not body text and are not in
  scope for either half.)
- **No document-editor change for the mention half** (subject to Q2); the id
  half's editor behaviour is Amendment 3 and Q6.
- **No retroactive rewriting.** Turns written before this exists render under the
  new rules like any other; nothing on disk changes.
- **Not a routing or permissions feature.** Nothing here mutes, blocks, or
  redirects a mention.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q6 and the text is adjusted
- [ ] All three amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator, each appended after the quoted existing text rather than
      replacing it — nothing in §5 or §11 is deleted by this rider
- [ ] **Amendment 1's anchor is re-read, not pattern-matched**: SHARED-020
      appends after the same §11 Thread view sentence, so whichever applies
      second appends after whatever is last in the bullet at that moment
- [ ] Amendment 3 lands as a **new bullet** in §5, leaving the existing
      inline-references bullet — including "an unresolved ref renders visibly
      broken" — untouched
- [ ] §8 is **not** edited
- [ ] The implementing chain does not start before the text is in place
- [ ] The mention rules are checked against the server's mention parsing before
      the UI issue is filed, and the two agree on all four: the boundary rule,
      code opacity, unresolved-does-not-summon, and archived-does
- [ ] The id rules are checked against the id shapes the server actually mints
      (`doc`, `th`, `skill`, `agentdef` are documents; `anc`, `evt` are not)

## Technical Design

### Files to Create/Modify

- `SPEC.md` §11 (two appends) and §5 (one new bullet)

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

And for the id half:

- a bare `doc_*` id in a turn **and** the same id in a document body — both
  render the target's current title as a link; renaming the target updates both
- `data/threads/th_x9y8.md` and a URL ending in an id in prose — plain text
- a bare id inside a fence and inside an inline span — plain text
- an `anc_*` and an `evt_*` id in prose — plain text, no handle
- an id whose document was deleted — plain text, **not** the broken styling an
  unresolved `[[ref]]` gets, and the difference is visible side by side in one
  turn
- a bare id in a body, saved and re-read through the CLI — **the markdown still
  contains the bare id**, byte for byte, and the target's backlinks panel does
  **not** list the referring document (Q5)
- an id naming an archived document — handle, link, archived marking

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-016]` prefix
