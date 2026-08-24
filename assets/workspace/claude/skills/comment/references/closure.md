# Closing a thread — when it is yours to close, and how

The comment skill says a settled matter may be closed and that the resolve rides on a reply.
This file is the whole of that judgment. Read it before you resolve any thread, and before
you suggest resolving one.

**Resolved is a closed door, not a locked one.** A turn a **person** writes on a resolved
thread sets it back to `open` in the same write that appends it, and engagement then
applies to it unchanged: on a thread you are engaged in, that reply reaches you again with no
`@agent` needed, and one posted "note only" reopens the conversation without waking you. A turn
**you** write reopens nothing, so a thread you closed stays closed until a person writes in it.
That is the whole cost of resolving — one reply restores the conversation — and knowing it is
what lets you close a settled matter instead of leaving it open in case.

**Close what you asked for and got.** You resolve the thread yourself when all four of these
hold at once:

1. you asked the person for feedback or information,
2. they **provided it** — a turn of their own in the thread is the evidence,
3. you have **used** it, and
4. nothing in the thread is still waiting on anyone.

Who opened the thread is irrelevant. The commonest shape is one the person started: they ask,
you need one clarification, they clarify, you finish and close. A settled sub-question inside a
still-live conversation is closed the same way, on its own.

**Four threads you never close**, each a rule rather than a call:

- **A thread the person never replied to.** An unanswered ask is exactly what the open state is
  for, and no amount of elapsed time turns silence into an answer.
- **A thread holding an unanswered form.** It stands in Attention as *awaiting your answer* —
  an outstanding ask by definition, whatever else in the thread has settled and however many of
  its other forms came back.
- **An unfinished piece of your own work.** The thread is open because you owe something, and
  closing it would be marking your own homework done.
- **A question the person put to you that you have not yet answered.** Answer it first: a turn
  that closes without answering is not a closing turn, it is the question going quiet.

Where none of the four applies but you still may not close — the person asked, you answered,
you needed nothing from them — **suggest resolving** and leave the control with them.

**The resolve rides on the reply that reports the work.** One reply and one resolve for the
same act, never a resolve with no readable turn attached:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
6.4% it is — applied to the projection in [[doc_a1b2c3]] and to the two figures
downstream of it. That settles the rate question, so I'm closing this thread.
Reply here if it turns out not to be settled.
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%; resolved this thread
CORPUS_EOF
corpus thread resolve th_4b8e2c --from agent
```

Which of the two commands runs first changes nothing — your own turn never reopens what you
just closed — but that there **is** a turn changes everything. A bare
`corpus thread resolve <id> --from agent` adds nothing anyone can read, and the board collapses
a resolved thread holding nothing unseen: the conversation would fold away without the person
ever seeing it end. So state the closing in the prose, in words, and name the resolve in the
trace line as the change to a document that it is. Resolving writes the thread, not the parent,
and it names its own delta, so it needs no key and nothing about the parent stands in its way —
neither a person editing it nor a key of yours that has gone stale.

**Resolving cascades nowhere.** A child thread is its own document with its own status: closing
a subthread leaves its parent open, and closing a parent leaves its children open. Resolve
exactly the thread whose matter is settled. Resolving one that is already resolved prints
"already resolved" and changes nothing — not an error, and not worth a second attempt.
