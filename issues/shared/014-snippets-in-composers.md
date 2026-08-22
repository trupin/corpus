# [SHARED-014] Snippets in every composer

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-012 (established "every composer" as the unit of statement),
  AGENT-012 (established the fence-widening rule on the producer side)
- Blocks: the UI / kit / plugins chain this rider implies (not yet filed)

## Spec References

- §6 Threads and anchors — "Forms in turns", "Attachments"
- §10 UI — the board → Thread view (copyable canvases, riders signed 2026-08-02
  and 2026-08-03; "Every composer takes attachments", rider signed 2026-08-05)
- §10 → global composer key contract (SHARED-009 Amendment 1, signed 2026-08-03)

---

## The user, verbatim (2026-08-05)

> "In all of the text inputs (ask/capture and comments), I want to have the
> possibility to add snippets. Snippets are basically copy pasted content which
> in itself is considered as a kind of attachment. We should figure out a
> shortcut for it. Maybe \"```\" like for code? A snippet should be collapsed by
> default, since the idea is that it is somewhat long and not always easy to
> read."

## Decisions already made by the user — settled, not re-opened

1. **A snippet is an inline fenced block in the turn body, not a stored
   attachment.** Chosen deliberately over a real attachment and over a
   size-based hybrid. The reasoning on the record: the agent reads turns through
   the CLI, so an inline fence means it sees the content by reading the turn with
   no second fetch; the content is searchable by FTS; and it renders with
   machinery that already exists. The accepted cost is that a long paste lives in
   the markdown and in git.
2. **All three triggers, not one**: the ``` shortcut the user suggested, an offer
   when a long paste lands, and an explicit control in the composer chrome.

Note the user's framing — "a kind of attachment" — is a description of how it
*feels*, not of what it *is*. Decision 1 settles that it is text in the body.
The draft below says so plainly rather than letting the two readings coexist.

---

## What already exists — this rider does not re-specify it

- §10 already makes fenced blocks in rendered turns **copyable canvases**: a copy
  button putting the block's raw text on the clipboard, the info string rendering
  as the block's label, long lines wrapping rather than scrolling, and a block
  taller than a threshold rendering **clipped** behind a control that expands it
  and says how much is hidden.
- §10 already says **every composer takes attachments**, stated once for the
  whole set rather than per surface (SHARED-012).
- §6 already says a pasted image or file becomes an attachment rather than
  garbage text.
- The composer key contract: `↵` newline, `⌘↵` primary, `⇧⌘↵` secondary.
- `assets/workspace/claude/skills/comment/SKILL.md` states the fence-widening
  rule for the **agent**. This rider binds the **composer** to the same rule.

## The three hazards, and how the draft answers them

**Fence widening (AGENT-012).** A snippet is precisely the payload most likely to
contain its own fences — pasted markdown, a prompt, terminal output. A
three-backtick fence around such a paste splits into several blocks with the
writer's prose leaking between them, and each copy button then hands over a
fragment. The draft puts the widening rule in **§6**, where the turn format is
defined, and binds *every* writer of a turn to it — the composers and the agent —
rather than leaving it a producer-side convention one skill happens to know. The
rule is stated observably: open wider than the longest backtick run in the
content.

**The ``` trigger collides with markdown.** Answer: **there is no collision,
because they are the same object.** A fence typed in a composer is a snippet. The
draft makes this cost nothing by keying the collapse to the height threshold §10
already defines — below it a snippet renders open, exactly as a code block always
has, so a three-line paste is unaffected; above it, the collapse is the whole
point. Text typed after the fence becomes the snippet's label, so ```` ```python ````
still reads as "a python block", now with the collapse behaviour attached.

**What distinguishes a snippet from a code block.** Two things, both verifiable:

- _On disk / over the CLI_: the info string's first word is `snippet`, matched
  whole. That is the only place a mark can live, given decision 1 — nothing is
  stored, so the fence itself has to carry it.
- _In the rendered turn_: past the threshold, an ordinary fence **clips with a
  peek**; a snippet **collapses to a single row** showing no content at all. One
  threshold, two treatments, keyed by the mark.

Not a vibe: an evaluator can paste 200 lines into a reply, send it, read the turn
with the CLI and see one `snippet` fence, and see one collapsed row in the board.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

### Amendment 1 — §6, APPEND a paragraph immediately after "**Forms in turns.**"

> **Snippets in turns.** A **snippet** is pasted content someone wanted to hand
> over rather than say — an email, a log, a prompt, a page of notes — carried
> **inline in the turn body** as a fenced block, not as a stored attachment. It
> has no identity, no file and no wire call of its own: it is markdown in the
> turn, so the agent sees it by reading the turn, full-text search finds it, and
> git keeps it beside the conversation it belongs to. Attachments remain the path
> for **bytes** — images and files; a snippet is **text**. A snippet is marked by
> its info string: the first word is `snippet`, matched **whole** (```` ```snippets ````
> or ```` ```snippet-of ```` is an ordinary code block), optionally followed by
> free text that is the snippet's **label**. **The fence is opened wider than any
> backtick run in the content** — four backticks around content containing three,
> five around four, and so on — so a snippet that is itself markdown, or that
> quotes output containing fences, stays **one** block instead of splitting into
> several with the surrounding prose leaking between them. Every writer of a turn
> obeys this: the composers when a person makes a snippet, and the agent when it
> emits one. A turn may hold several snippets. A snippet that ends up in a
> **document** body (a Capture, §10) is preserved as a fenced block in that
> document's markdown and renders there as an ordinary code block — the collapse
> below is a property of **rendered turns**, where a reader is reading rather
> than editing.

### Amendment 2 — §10 Thread view, REPLACE the wrap/clip sentences

REPLACE, in §10's Thread view bullet, exactly this text:

> Long lines **wrap** inside the canvas rather than scrolling horizontally, so
> the whole block is readable without a second axis of navigation, and a block
> taller than a threshold renders **clipped** behind a control that expands it
> and says how much is hidden — wrapping makes a long block tall, and a block
> that swallows the column is its own kind of unreadable. The copy button always
> puts the **whole** block on the clipboard, collapsed or not. _(Rider signed
> 2026-08-03; the clipping half signed 2026-08-03 after the wrap, on a second
> report.)_

with:

> Long lines **wrap** inside the canvas rather than scrolling horizontally, so
> the whole block is readable without a second axis of navigation, and a block
> taller than a threshold renders **clipped** behind a control that expands it
> and says how much is hidden — wrapping makes a long block tall, and a block
> that swallows the column is its own kind of unreadable. **That threshold still
> governs every ordinary fence, unchanged.** A **snippet** (§6) past the same
> threshold is treated differently: it renders **collapsed to a single row** —
> its label, or "Snippet" when it has none, plus how much is hidden — showing
> none of its content until it is expanded, because a snippet is content someone
> handed over rather than wrote, and a peek at its first lines is neither the
> reading nor the summary anyone wanted. Expanding a snippet shows it whole and
> wrapped, with no second clip, and it can be collapsed again. Below the
> threshold a snippet renders open like any other canvas — collapsing three lines
> hides nothing worth hiding. The copy button always puts the **whole** block on
> the clipboard, collapsed, clipped or expanded, and expanding or collapsing is
> operable from the keyboard like every other affordance (§10 adds no
> exclusive-pointer capability). _(Rider signed 2026-08-03; the clipping half
> signed 2026-08-03 after the wrap, on a second report; the snippet collapse
> signed 2026-08-05.)_

### Amendment 3 — §10 Thread view, APPEND after the attachments statement

APPEND immediately after "…which surface it was written in decides nothing about
what it can carry. _(Rider signed 2026-08-05.)_":

> **Every composer makes snippets.** The same set that takes attachments takes
> snippets — the global composer, a thread's reply box, a comment on a document
> selection, a comment on a turn or on a selection within one, and any composer a
> plugin contributes. There are **three ways in**, for the same reason
> attachments have three. Typing ```` ``` ```` at the **start of a line** opens a
> snippet and puts the cursor in it, with anything typed after the fence becoming
> its **label** — so a code block written in a composer *is* a snippet, which
> below the threshold looks exactly as a code block always has, and above it
> collapses. **Pasting text long enough to collapse** offers to make it a
> snippet: an offer, never automatic, that can be declined — declining leaves the
> pasted text exactly as it landed — and that never fires on a short paste. And a
> named control in the composer's chrome, beside the file picker, makes one from
> scratch or from what is currently selected in the composer. A snippet may be
> left unlabelled; naming one never blocks sending. Pasting an **image or file**
> still becomes an attachment (§6) — snippets are for text. The composer opens
> the fence wider than any backtick run in the content (§6), so a pasted document
> that itself contains fences arrives as **one** snippet rather than several
> blocks with the writer's own words spilling between them. The composer key
> contract is untouched: `↵` inserts a newline inside a snippet as everywhere
> else, and no snippet affordance claims `⌘↵` or `⇧⌘↵`. _(Rider signed
> 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Does a *short* snippet collapse?** The user said "collapsed by default"
flatly; the draft collapses only past §10's existing height threshold, on the
grounds that the user's own reason ("the idea is that it is somewhat long") does
not apply to three lines, and that a one-row placeholder hiding two lines of
content is worse than the content.

_Recommendation: keep the threshold (as drafted)._ If the user wants
unconditional collapse instead, the mechanical edit is to **delete one sentence**
from Amendment 2 — "Below the threshold a snippet renders open like any other
canvas — collapsing three lines hides nothing worth hiding." — and the rest
stands.

**Q2 — depends on Q1: is there still a way to write a plain, never-collapsing
code block in a comment?** As drafted, no separate object exists and none is
needed, because a short block renders open anyway. If Q1 goes to unconditional
collapse, this becomes a real gap: every code block a person writes in a comment
would arrive collapsed, including a two-line command. _Recommendation: settle Q1
in favour of the threshold and Q2 disappears._ If not, the answer would have to
be an explicit "keep open" affordance on the composer's snippet, which is a
control the user has not asked for.

**Q3 — Should long agent-authored deliverables collapse too?** A `prompt` or
`config` fence from the agent (AGENT-010) can be very long, and is exactly the
kind of thing this feature is about. The draft leaves them alone: they keep the
peek-clip, because AGENT-010's whole purpose is that a deliverable is *visible*
and liftable in one gesture, and collapsing it by default works against that.
_Recommendation: leave agent output unchanged (as drafted)._ It is a one-line
follow-up rider if the user disagrees after living with it.

**Q4 — Is the collapsed row's label worth prompting for?** The draft makes the
label optional and never blocking. A collapsed row with no label reads
"Snippet · N lines", which is thin when a turn carries three of them.
_Recommendation: optional as drafted, with the label editable while composing —
prompting on every paste is friction on the most common path, and the user asked
for a shortcut, not a dialog._

---

## Non-goals (state them so the chain does not drift)

- No new wire call, no new stored object, no attachment record. A snippet is
  characters in the turn body (decision 1).
- No change to the document editor. A snippet inside a document body is a code
  block there; collapse lives in rendered turns.
- No change to what the agent writes (subject to Q3).
- No syntax highlighting is promised by this rider; the info string is a label,
  as §10 already says.
- No retroactive repair: turns written before this exists are not rewritten into
  snippets.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q4 and the text is adjusted
- [ ] All three amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator
- [ ] Amendment 2 **replaces** the quoted sentences rather than duplicating them
      — the ordinary-fence threshold must survive exactly once in §10
- [ ] The implementing chain does not start before the text is in place
- [ ] The composer-side widening rule is checked against
      `assets/workspace/claude/skills/comment/SKILL.md`'s producer rule and the
      two are stated the same way (longest run + 1, counting every run)

## Technical Design

### Files to Create/Modify

- `SPEC.md` §6, §10

## Testing Strategy

None — spec text. The domain issues carry the tests. The notch worth fixturing
when they are filed: a snippet whose content contains a three-backtick fence
(must render as **one** collapsed row, and the copy button must return the whole
payload), and a block one line under / one line over the threshold.

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-014]` prefix
