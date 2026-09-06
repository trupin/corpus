# Reflecting on a user edit — the reasoning behind the rules

The reflect-edit skill's body carries the rules; this file carries the reasoning that
earned them. Read the part you need when a rule seems wrong or a case reads odd —
never as part of an ordinary reflection. Nothing here softens a rule: the rule you act
on is always the body's.

## Why the no-`@agent` rule binds every turn, and whose lane a mention wakes

**The turn's lane is where it lands, and it is not always yours.** A turn carrying `@agent`
enqueues on the lane of the **thread it was posted in**. An agent turn posted into a
designated conversation wakes that conversation's resident and never appears on your claim;
one posted anywhere else wakes you. So the rule binds every turn any agent in this
workspace writes — yours, your subagents', a resident's — and it binds them all for the same
reason rather than because of who gets woken. What reaches you is the ordinary case, a turn in
a conversation nobody is resident in, and you triage it as you triage everything: it arrives
as a `comment.created` like any other, with no marker anywhere saying a machine wrote the
mention that produced it. That is exactly why the rule is *write no `@agent`* rather than
*detect one*.

## Why a first change diffs from the empty tree

**An empty-tree base is the ordinary shape of a first change, not an anomaly to report.**
`from` is git's empty tree whenever nothing before the range ever touched **this
document** — that is **any** document's first commit, not only one the repository's root
commit introduced. Both ends of a range walk this document's history, not the branch's, and
they have to: a commit window belongs to a party rather than to a document and gathers that
party's saves across documents, so the commit sitting immediately before a document's first
one is routinely somebody else's save to a different file — a commit at which this document
did not exist, and naming it as the base would be a false claim about where this document
came from. What comes back is the whole document as added, which is the truth about a
document with no earlier revision. Read it and judge it like any other change; a new
document being new is not something to raise with anyone.

## Why an observation is an entry and not a thread

Why the document rather than a thread: an open thread is this corpus's one signal that
something is waiting on the person, and an acknowledgment nobody needs to answer spends that
signal until the threads that do want an answer are buried among the ones that do not. The
entry instead lives where the change lives, is read by whoever next opens the document, and is
ordinary body text — commentable, anchorable, searchable, and the person's to edit exactly
like the rest of the body. **The changelog is yours to maintain and theirs to edit; neither of
you owns it.** Somebody remarking on an entry is an ordinary anchored comment and needs
nothing special from you. The cost is accepted rather than hidden: an observation nobody reads
is an observation nobody sees, and that trade was made deliberately against a corpus of
threads nobody needed to answer.

## Why the append never goes back as a patch

exactly. **This is the bounded change that does not go back as a patch**, and the reason is
the one *Writing a document* gives: this section is the last thing in the body, so the append
has nothing on its far side to quote. A patch quoting the tail of the last entry applies
perfectly well to a document somebody appended to while you were reading it, splicing your
entry above theirs and reporting success — because what the excerpt checks is that the entry
you quoted is unchanged, and what has to be true here is that it is still the **last** one.
The key is the check that covers the text you did not name: it makes the append safe rather
than hopeful, refusing a body that never saw the move instead of writing over it.

## `orphaned` against `remap`, in full

**The word to read in the anchor report is `orphaned`.** Appending at the end moves no
earlier offset, so nothing above the section shifts and an honest append orphans nothing. An
orphan after one means what you sent was not what you read: go back to `corpus doc show` and
redo the append from what the document actually says. A **remap** is a different thing and
not a warning — the first entry introduces the section directly under whatever text used to
end the body, so the anchor sitting on that text has its trailing context rewritten and is
reported as remapped while staying exactly where it was. Later appends land past the section
and report nothing at all.

## A cut diff — the recovery reads

**A cut diff is never reasoned about as if it were whole.** The size slot on the
counts line says which case you are in — `268 characters` when whole,
`showing 16000 of 61200 characters` when cut — and a `#` notice repeats it under the
body. When it is cut: say so in the entry, in the numbers the counts line printed;
never update another document off it, because the correction may sit in the part you
did not see; and when the session was more than one commit,
`corpus doc diff doc_a1b2c3` with no range reads its newest commit whole.
`corpus doc show doc_a1b2c3` gives the document
as it now stands whenever the ripple check needs the current text rather than the
change.
