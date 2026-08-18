# [SHARED-041] A key you must present, not a lock you can forget

## Domain

shared (orchestrator-handled — SPEC.md rider)

## Status

done — **AUTHORIZED 2026-08-11 and applied to SPEC.md §7.** The user
answered seven design questions across three rounds, then directed that the
rider be applied and built without a separate read-aloud sign-off.

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: the CONTRACT/SERVER/CLI/UI chain that replaces locks (filed once signed)
- Related: SHARED-040 (commit windows — §4 references locks in three places),
  SHARED-037 (`corpus doc patch`, which carries its own staleness check)

## Spec References

Everything this rider touches, so the sweep is checkable:

- §2.1 line 123 — `.corpus/locks/<docId>.json` in the workspace layout
- §7 lines 334–339 — **the whole "Document locks" section**, replaced
- §7 line 314 — `deferred`, defined as "claimed work waiting on a document's
  edit lock"
- §7 line 320 — `corpus queue defer <id> --blocked-on <doc>`
- §4 line 157 — "acquiring, renewing or releasing an edit lock" among what does
  not close a commit window
- §4 line 161 — "**A force unlock** (§7) records its audit entry alone"
- §4 line 177 — "An event deferred on a lock (§7) ends the agent's window"
- §9.2 — `423` on every write route, and the lock endpoints themselves
- §9.2 line 398 — the `locks(...)` projection table
- §11 line 509 — "If the document is **locked**, it renders read-only with a
  banner naming the holder and a **Force unlock** action"
- §15 M5 line 577 — "Locks: an agent-held lock renders the doc read-only…"

## Summary

**The user's report, 2026-08-11: the lock does not work in practice, and most of
the time agents forget to lock the document.**

Verified, and the code is worse than the report. §7 line 336 claims "the CLI's
edit verbs do this implicitly". **They do not** — `corpus doc edit` acquires
nothing, and `assets/workspace/claude/skills/orchestrate/SKILL.md` (lines 39,
745) instructs the agent to run `corpus lock acquire` by hand. The user's live
workspace holds **zero** lock files against a git log full of agent edits.

The failure is structural, not a matter of discipline: **a lock is forgettable
because forgetting it still lets the write through.** Nothing in the write path
requires one. A key is not forgettable, because a write without a valid one is
refused — the enforcement moves from the agent's memory into the write path.

Seven decisions were settled by the user before drafting, in two rounds. Recorded
here so the implementer does not reopen them:

1. **The agent carries the key explicitly.** A read prints it; a write presents
   it. Not cached invisibly by the CLI — CLI invocations are separate processes,
   so a cache needs shared state, and one agent's read would then satisfy another
   agent's write, which is exactly the thing being prevented.
2. **Both writers participate.** The board sends a key too and adopts-then-retries
   on refusal, reusing the external-change handling its editor already has. Your
   edits and the agent's are protected symmetrically.
3. **An advisory "being edited" signal, not a gate.** Keys give correctness but
   not politeness: without something to tell it, the agent re-reads and rewrites
   in a loop against a person who is actively typing. The read reports that a
   session is open; the agent decides. Forgetting it costs politeness, never
   correctness — which is the opposite of the lock's failure mode.
4. **Blind overwrites need a key; a named delta does not.** A write that replaces
   a block without saying what it changes (`PUT {body}`, a whole-frontmatter
   rewrite) needs one. A write naming its own delta (`--add-tag finance`, archive,
   move, a status flip) merges safely and needs none.
5. **A refusal carries the current content and a fresh key.** One round trip
   rather than two: the agent has everything it needs to merge and retry.
6. **`deferred` survives, re-triggered by the advisory signal.** The agent defers
   because it saw someone editing, not because a lock refused it. §4's signed
   "a queue event finished, however it finished" keeps all its members and the
   console keeps the state.
7. **The whole lock mechanism goes.** Not deprecated alongside the new one —
   removed. `corpus lock` in full, `.corpus/locks/`, the projection table, the
   `423`, the read-only banner, the force break and its audit entry.

---

## AUTHORIZED 2026-08-11 — §7 replacement text, applied

This **replaces** §7's "Document locks" section (lines 334–339) in full.

> **A key, not a lock.** Two writers share every document — the person at the
> board and the agent — and they are kept from overwriting each other by a **key**
> rather than by a lock. Reading a document gives you its key. Writing it back
> means presenting that key, and the write is refused if the document has changed
> since: the key names the version you saw, so a stale one is exactly the
> statement "I am about to overwrite something I never read". Every write that
> lands gives you a fresh key for the next one.
>
> This replaces the per-document edit lock entirely, for a reason worth stating
> plainly: **a lock is forgettable, because forgetting it still lets the write
> through.** It asked every writer to volunteer, and in practice the agent did
> not. A key cannot be forgotten, because a write without a valid one does not
> happen. The enforcement lives in the write path rather than in anyone's
> discipline.
>
> **What needs a key.** A write that replaces a block without naming what it
> changes: the body, or a whole-frontmatter rewrite. These are the writes that can
> destroy something silently, because they carry no statement of what they meant
> to change. A write that names its own delta does **not** need one — adding a
> tag, filing a document in a folder, archiving it, flipping its status, marking
> it still current. Those say what they change, so they merge with whatever else
> happened rather than overwriting it. An anchored patch (§9.2) needs no key
> either: it names the text it expects to find, which is the same check by another
> route, and a patch whose text has moved is refused on its own terms.
>
> **What a refusal says.** A refused write comes back with the document as it now
> stands and a fresh key for it — not merely "no". One exchange, so the writer can
> see what changed, decide, and write again. A refusal is never a lost edit: the
> content the writer tried to save is theirs to resend, and nothing has been
> written.
>
> **What a key does not do.** It stops a writer overwriting something it never
> read. It does not coordinate two writers who both did read: two agents working
> the same document are the same problem as two processes editing the same file
> in a directory, and a key does not solve that — it only makes the loser find
> out instead of losing the edit in silence. What is guaranteed is that no change
> is lost without someone being told. Who *should* have written what is a
> question for whoever set two writers on one document.
>
> **Someone is editing this.** A key keeps two writers correct; it does not keep
> them polite. So a read also says whether a person has a **session open** on the
> document (§4's edit session — the same one that ends in an acknowledgment).
> That is information, not a gate: the agent is expected to leave the document
> alone and come back, and can defer its queue event to say so (below). Nothing
> refuses a write for it, and nothing has to be released. Where the lock's failure
> mode was that forgetting it cost correctness, this one's is that ignoring it
> costs only politeness — which is the trade being made deliberately.
>
> The signal is asymmetric on purpose, because the two writers are. A person's
> editing is a **session**, which the server already tracks; the agent's writing
> is a sequence of one-shot commands with no session to report. So the agent is
> told when a person is editing, and the person sees the agent's writes land live
> as they always have (§9.2). Neither is a lock in the other direction.
>
> **Nothing to acquire, nothing to release, nothing to break.** There is no lock
> to be held, so there is none to leak, expire, reap or force. A crashed editor
> wedges nothing; a killed agent wedges nothing; there is no escape hatch to
> document because there is nothing to escape. Whatever a writer has read, they
> hold no claim on.
>
> **A deferred event still waits, on a judgement rather than a refusal.** An agent
> that finds a person editing may defer its claimed event (§7's queue) rather than
> write beside them. It re-enters the queue on its own once the session ends, the
> deferral stays visible in the console beside the document it waits on, and
> `corpus job retry` remains the manual override. What changed is only the trigger:
> the agent defers because it saw, not because it was refused.

---

## Consequential edits elsewhere — drafted, and part of the same signature

Nine of them. Listed rather than folded into the text above, because a reader of
the sweep should be able to check each one.

1. **§2.1 line 123** — strike `locks/<docId>.json  # per-document edit locks (§7)`
   from the workspace layout.
2. **§7 line 314** — `deferred` is redefined:
   > `deferred` is the one non-terminal outcome — claimed work the agent parked
   > because a person was editing the document (§7 keys), returned to `pending`
   > automatically when that session ends.
3. **§7 line 320** — `corpus queue defer <id> --blocked-on <doc>` keeps its shape
   and its flag; only its gloss changes, from "park on a document's edit lock" to
   "park while a person is editing that document — it returns on its own".
4. **§4 line 157** — "acquiring, renewing or releasing an edit lock" is struck
   from the list of what does not close a commit window. Nothing replaces it:
   reading a key is a read, and §4's "any read that does not touch git history"
   already covers it.
5. **§4 line 161** — the force-unlock sentence goes. "Three acts commit alone"
   becomes **two** — a deletion and a bulk Save. _(Note for the record: this
   deletes behaviour SERVER-092 implemented on 2026-08-10, which is the correct
   outcome and not waste — it was right under the mechanism it was written for.)_
6. **§4 line 177** — "An event deferred on a lock (§7)" → "An event the agent
   defers while a person is editing (§7)". The cost it states — one act that
   resumes later lands as two commits — is unchanged.
7. **§9.2** — the lock endpoints go. `423 Locked` is replaced on the write routes
   by a **`409`** naming the current key and carrying the document as it stands.
   The exact shape is CONTRACT's to design; what this rider fixes is that a
   refusal is never bare.
8. **§9.2 line 398** — the `locks(doc_id, holder, acquired, ttl)` projection table
   goes. Nothing replaces it: a key is derived from the document, not stored, and
   the editing signal comes from the edit-session tracker, which is in memory.
9. **§11 line 509** — "If the document is **locked**, it renders read-only with a
   banner naming the holder and a **Force unlock** action" is struck. **The board
   is never read-only.** A document the agent is writing stays editable; the
   person's write presents its key like any other, and the refusal path is the
   editor's existing adopt-an-external-change behaviour.
10. **§15 M5 line 577** — the milestone check's lock clause becomes: two writers
    editing one document, where the second write is refused, shown what changed,
    and lands on retry.

## Orchestrator adjudications (not user decisions — flag if you disagree)

- **The key is derived, not issued.** It is a function of the document's current
  content, so there is no registry to keep, nothing to expire, and nothing to
  revoke. It survives a server restart for free, and an **out-of-band edit
  invalidates it for free** — you edit a file in an external editor, and the
  agent's key goes stale without the watcher having to remember anything. An
  issued token would need every one of those mechanisms built and kept correct.
- **A move does not invalidate a key.** A move rewrites the path, not the content
  (§9.2: the id never changes), so a writer who read before the move can still
  write after it. That is correct — nothing they read has changed.
- **The exact derivation is CONTRACT's to choose**, not this rider's. What the
  spec guarantees is the behaviour: a key names the version you read, and changes
  when the document does. Whether that is a content hash or something else is an
  implementation choice, and pinning it here would put an algorithm in a
  behavioural spec.

## Open questions the implementer must not settle alone

- ~~**Concurrent writes by the same party.**~~ **Resolved 2026-08-11, by scoping
  it out rather than answering it.** The user's point, and it is right: two agents
  on one document are the same problem as two processes editing one file in a
  directory, and this mechanism does not fix that class. The rider now says so in
  *What a key does not do*. Two lesser cases fold in with it — an agent reusing a
  key its own previous write invalidated is a correctable slip (the key comes back
  in the write's own output, and the refusal hands it the current one), and a
  retry after an ambiguous failure is diagnosable from the content the refusal
  already carries. An earlier draft proposed naming the *acting party* on a
  refusal; that was withdrawn, because both writers in the subagent case are
  `agent`, so it distinguishes nothing there.
- **What a bulk Save presents.** §11's staged Save writes many documents in one
  act, and gathering a key per row before saving is a different UX from the one
  §11 describes. Most likely a bulk Save is a named delta throughout (archive,
  tag, resolve) and needs no key at all — but a staged Save that carries a body
  edit would. Settle before UI work starts.

## Acceptance Criteria

- [ ] Read aloud to the user, on its own, separately from the riders already held
- [ ] User signs off, or amends
- [ ] Applied to §7 with the signature marker, plus all nine consequential edits
- [ ] Contradiction sweep recorded here
- [ ] Follow-on CONTRACT/SERVER/CLI/UI issues filed against the signed text
- [ ] The removal is verified as a removal: no `corpus lock` verb, no
      `.corpus/locks/`, no `423` on a write route, no lock projection table

## Technical Design

Spec text only — no code in this issue.

### Files to Create/Modify

- `SPEC.md` — **only after sign-off**, and by the orchestrator.

### Notes for the follow-on chain

- The surface being deleted is large and is the easy half: `apps/server/src/locks/`
  (11 files), the CLI's `lock` verb family, the UI's banner and force-unlock
  action, the contract's lock routes and `423` responses, and the projection's
  `locks` table.
- `apps/server/src/edit/sessions.ts` already knows when a person has a session
  open — that is what the "someone is editing" signal reads. It needs no new
  tracking, only exposure.
- The agent-facing half is documentation as much as code:
  `assets/workspace/claude/skills/orchestrate/SKILL.md` instructs the agent to
  acquire locks in four places, and those instructions are what made the old
  mechanism forgettable. They are replaced by a key the CLI refuses to write
  without.

## Testing Strategy

N/A for this issue — spec text. The follow-on issues carry it.

## E2E Verification Log

_N/A — spec rider, no code._

## Contradiction Sweep — run 2026-08-11, after applying

Fourteen edits, not the nine drafted: a `grep` for `lock` across the whole of
SPEC.md after the planned ten found four more the draft had missed. Recorded
because "I edited the places I listed" is not the same as "no reference
survives", and only the second one is checkable.

**The four the draft missed**, each a place a lock was referred to without the
word appearing in a heading:

- **§9.2's route list** carried a `Locks (§7): acquire / release / break · reap`
  bullet with the `423` behaviour attached. Replaced by the key's own bullet,
  including the `409` shape.
- **§9.3** listed `lock` among the resources `packages/contract` holds schemas
  for. Struck.
- **§7's orchestrator-skill invariants** told every subagent to "acquire and
  release document locks around edits". This is the instruction that made the
  old mechanism forgettable; it now says to present the document's key.
- **§7's subagent-outcome paragraph** described "a lock deferral … re-enters the
  queue on its own when the lock clears". Re-based on the editing session.
- **§11's bulk Save** referred to locked documents three times (a Save staying
  available "when some of them are locked", a refusal "naming the holder",
  retrying "after clearing a lock"). Re-based on content having moved.
- **§15's M2 and M3** listed `locks` among the backbone and the CLI verb
  families, and M2's check exercised a lock refusal and a force break.

**Confirmed clear:**

- §4's three references are all edited, and "Three acts commit alone" now reads
  **two** — a deletion and a bulk Save. Checked that the paragraph still parses
  as a list of two rather than leaving a dangling "and".
- §7's "Every change leaves a visible trace" is unaffected: the force-break audit
  entry was one such trace, and deleting the act deletes the trace with it rather
  than leaving a claim about a commit nobody makes.
- §11's "Autosave, no save button" is untouched and does not contradict the board
  presenting a key: a key is not a user action, and §11's sentence is about what
  the person has to do.
- SHARED-037's `corpus doc patch` language holds against "a patch needs no key" —
  that rider already defines a patch as naming the text it expects to find, so
  the staleness check is the patch's own.
- The final sweep for `lock` returns only two hits, both inside the new text and
  both deliberate: the sentence naming what this replaces, and "there is no lock
  to be held". Everything else matching is `block`/`blocked`.

## Superseded sweep plan (kept for the record)

- §4's three lock references: confirm items 4, 5 and 6 above leave the commit-window
  rules coherent, and that "Three acts commit alone" reads correctly as two.
- §7's own "Every change leaves a visible trace": the force-break audit entry was
  one such trace and is being deleted. Confirm nothing else claimed it.
- §9.2's `423` appears on many routes; confirm none is left orphaned.
- §11's autosave: confirm the board presenting a key does not contradict
  "Autosave, no save button" — it should not, since a key is not a user action.
- SHARED-037's `corpus doc patch`: confirm the "a patch needs no key" claim holds
  against that rider's own staleness language.

## Completion Checklist (orchestrator)

- [ ] Read aloud verbatim, on its own
- [ ] Signed by user
- [ ] Applied to SPEC.md with signature marker
- [ ] Contradiction sweep recorded here
- [ ] Follow-on issues filed
- [ ] Committed with `[SHARED-041]` prefix
