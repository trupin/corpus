# Launching and losing listeners — the case law

The orchestrate skill's body carries the decisions: the routing table's three rows that are
not jobs, the three-field launch decision, once a pass per lane, and launch before you
dispatch. This file carries the whole of the launch procedure and the case law that earned
it. Read it whenever a pass has a listener to launch or to account for — a
`resident.designated`, a `resident.released`, a `lane.waiting`, or a roster row that asks
for a launch — and when a launch decision reads odd: a live row with a leaver on it, a
re-designation that only changes the weight, a lane that will not take a listener. An
ordinary dispatch-only pass never needs this file.

- **A waiting lane is a request for a listener, and never a message to answer.** `lane.waiting`
  arrives when a conversation received work and nobody was listening on it — which is most of
  the time after you restart, since restarting you ends every listener you launched while their
  conversations keep accepting messages.

  **Do not dispatch it.** Everything else in the table above is work; this is a report that
  work exists somewhere you may not touch. Answering it would be you writing in a resident's
  name, which is the thing the rider signed 2026-08-25 removed the fallback to prevent — and it
  is why the payload carries **only** the lane. There is no thread to read, no turn to reply
  to, no author, no text: an instruction to answer it could not be followed even if you took
  one. Settle it by making sure a listener is running for the lane it names, then complete it.

  **A notice for a lane that is already live settles with no launch, and that is ordinary.** It
  is not a discrepancy and not worth a log line beyond the settle: the notice is raised when
  the work arrives and read when you next wake, and a listener may have started in between.

  **Several notices for one lane are one launch.** The once-per-pass-per-lane rule below covers
  them exactly as it covers several `resident.designated` for one lane — a conversation left
  unattended for an hour may have raised a dozen, and it still wants one listener.

- **Launching a listener.** `resident.designated` is one of the rows above that are not
  jobs. Everything else you dispatch is work that reports back and settles. This one starts an
  agent and gets out of its way. Launch a background subagent applying the **converse** skill,
  invoked as `/converse <the payload's threadId>`, and hand it the payload's `resident`
  **exactly as it came** — every field, whatever it holds — because a subagent inherits
  nothing and what you leave out of a prompt does not reach it. Most designations name no
  profile and choose no weight, and arrive as `{"name":null,"docId":null,"weight":null}`: an
  ordinary designation, and the nulls travel as nulls. **Invent nothing to fill
  them.** A word made up here arrives as the name of a profile, and sends the listener looking
  for a document nobody wrote. Where `name` is set it is a profile the designation was made
  for, and the id beside it goes with it. **What a listener does with either — a persona to
  read, or none — is the converse skill's to state, and it is stated there alone.** Then
  **complete the event as soon as the launch is
  made**. The listener's lifetime is not the job's: it runs for as long as the designation
  does, which may be weeks, and an event held open for it would sit in `in-progress/` for
  weeks beside it. You never wait on it, you never settle for it, and its lane's events are
  not yours — a report from it, if one ever arrives, is a sign-off rather than an outcome to
  verify. The one case that fails the event is a launch that did not happen, with the reason
  the launch gave.

  **The designation chooses the model, and `weight` is how it says so.** That field sits
  beside the two profile fields and carries a **Key** from the tier table in the skill body's Delegation.
  **Find the row whose Key cell holds it, and launch the listener at that row's model.** The
  launch is a Task call like any dispatch, and that row's model goes out as the call's
  `model` argument — the one act that chooses what answers this conversation (the skill
  body's Delegation states the argument and its spelling). Name
  that model in the launch prompt too, because a resident is told what it runs at and nothing
  else tells it — and be exact about which line does which: the prompt is how the resident
  learns its name, and the argument is how the runtime is chosen. A model named in the prose
  alone launches a listener on whatever model this session inherited, silently, which is the
  substitution a designation's weight exists to rule out.

  **A designation that chose no weight is judged on the conversation, at launch.**
  A `null` weight is still *you decide* — absence of a choice is a judgment, never a fixed
  default — but the two passes in the skill body's Delegation govern **dispatching a job**, and they do not govern
  **launching a listener**. The passes weigh one bounded piece of work by what its output
  touches, and a listener has no output to weigh — only a conversation that has not
  happened yet. So weigh the conversation itself: **what did the person open this lane for,
  and what would a poor turn cost them there?** Read what exists at the moment of launch —
  the thread's title, its opening message where one was posted (`corpus thread show --index` on the
  payload's `threadId`, `--turn 1` for the opening), and the designated profile's own document where the designation
  names one — and place the lane between the two ends of the tier table, read from the
  table itself and never from a model name remembered from anywhere else:

  - A lane opened to **fetch and relay** — quick factual lookups, status checks, bounded
    requests the person reads and moves on from — belongs at the lighter end. A poor turn
    there costs one exchange, and the next message corrects it.
  - A lane opened to **work something out** — a decision being weighed, wording that will
    leave the corpus, a project's thinking held across weeks — belongs at the stronger end.
    There the conversation is the deliverable, and a poor turn steers the person rather
    than merely delaying them.

  Be honest about how little you hold: a title and one message is a forecast, not a record,
  and the judgment is yours to make on that forecast. **Where what you read genuinely
  answers neither way — an empty thread, a title that names no purpose — lean stronger
  rather than lighter.** That is the tie-break the skill body's Delegation already gives you, and it earns
  more here: an over-weighted lane costs tokens while it is quiet, but an under-weighted
  one answers below its conversation until a person notices and re-designates, and the
  person who notices is the one those turns were spent on. Judge once, at launch, and never
  re-judge a running lane per message: a resident's weight is set at designation, and a
  change arrives as a re-designation, handled below. A person who knows what a lane is for
  says so by stating a weight when they designate it, and that choice is honoured, never
  judged at all.

  **Either way, log the launch on the designation's own event: the weight it went out at,
  and where that weight came from.** A key the designation stated is logged as `stated`. A
  designation that chose none is logged as `judged`, naming the tier the judgment picked
  and the read that picked it — `(Opus 5 — stated at designation: heavy)` against
  `(Opus 5 — judged: no weight chosen, the lane is for working out a plan)`, or
  `(Haiku — judged: no weight chosen, the lane is for quick factual lookups)` where the read
  went the other way. Those are different facts, and the two words keep them apart on the
  job's log, where an observer reads them without asking you. A listener answers for weeks,
  and a choice nobody recorded is a choice nobody can review.

  ```
  Task(
    model: "opus",
    description: "converse listener on th_4b8e2c",
    prompt: "/converse th_4b8e2c — you are this conversation's resident. Your designation,
             exactly as it came: {\"name\":null,\"docId\":null,\"weight\":null}. You are
             running as Opus 5 — judged: no weight chosen, the lane is for working out a plan."
  )
  ```

  **A weight you cannot meet is stated twice, and here the launch prompt is one of the two.**
  `references/weight.md` gives the three causes and the rule, and they bind a launch exactly as they
  bind a dispatch. Launch anyway, at what your own judgment gives you, and log the deviation
  on this event. Then put the same three things in the launch prompt in words: what was asked
  for, that it could not be met, and what runs instead. A listener posts no reply about its
  own launch, so this prompt is the only road those facts have into the conversation. **Where
  they land in it is the converse skill's to state, and it is stated there alone.**

  ```bash
  corpus queue claim-all
  {"events":[{"id":"evt_3f8c1a","type":"resident.designated","created":"2026-07-28T09:14:02Z","source":"thread","payload":{"threadId":"th_4b8e2c","resident":{"name":null,"docId":null,"weight":null}}}],"inProgress":{"events":[],"total":0,"truncated":false}}
  corpus agents
  orchestrator · waiting for a listener
  th_4b8e2c "Q3 planning" · a general resident · waiting for a listener · 1 waiting
  corpus job log evt_3f8c1a "launched a converse listener on th_4b8e2c — a general resident (Opus 5 — judged: no weight chosen, the lane is for working out a plan)"
  corpus queue complete evt_3f8c1a
  ```

  The judgment there read the one thing that existed — a thread titled "Q3 planning" is a
  lane for working something out — and the log line says so in the same breath as the tier.

  **The same pass on a different lane lands at the other end, and the shape is identical.**
  A thread titled "Where did the invoice numbers come from?" is a lane for fetching and
  relaying, so the read goes the other way and the tier goes with it:

  ```bash
  corpus job log evt_7d21b9 "launched a converse listener on th_1c9f04 — a general resident (Haiku — judged: no weight chosen, the lane is for quick factual lookups)"
  ```

  Both lines are the same act. **Neither tier is the one a judged launch reaches for by
  habit** — the tier is whatever that lane's read gave you, and a run of launches that all
  land on one end is a sign the read is not being made rather than a sign the lanes agreed.
  Had that designation named `researcher`, three things would read differently and nothing
  else would: the payload's two fields, the roster's `researcher (doc_b7c1d5)`, and the log
  line saying so. Had it also chosen a weight, three more would: the payload would carry
  `"weight":"heavy"`, the roster row would read `a general resident at heavy`, and the launch
  would go out at that row's model instead of at the one your judgment picked, logged as `stated`
  instead of `judged`. The launch is the same
  launch, and the row it came down is the same row.

- **Losing a listener.** `resident.released` is the other row above that is not a job. A
  resident has gone, and the payload's `reason` says how: `released` where a person released
  the thread, `resolved` where they resolved it, `replaced` where they designated the lane
  again. The payload's `resident` is the one that went, its weight included. Launch nothing
  and dispatch nothing. Log who left and the reason, complete the event, and go on. You never
  tell that listener and you never stand it down. It finds out on its own, and the converse
  skill says how. What the lane becomes wants no rule of its own: a conversation with nobody
  resident is worked on your lane again, under the routing every other thread gets. It stays
  **engaged** — designating it engaged it, and only resolving ends that — so its plain turns
  keep arriving as ordinary `comment.created` events of yours, mention or none.

  ```bash
  corpus queue claim-all
  {"events":[{"id":"evt_5d2a7b","type":"resident.released","created":"2026-07-28T09:31:04Z","source":"thread","payload":{"threadId":"th_4b8e2c","resident":{"name":null,"docId":null,"weight":"heavy"},"reason":"released"}}],"inProgress":{"events":[],"total":0,"truncated":false}}
  corpus job log evt_5d2a7b "th_4b8e2c released its resident — a general resident at heavy, reason: released"
  corpus queue complete evt_5d2a7b
  ```

  **`replaced` is the one reason that is not an ending**: a `resident.designated` for the
  same thread follows it, because re-designating a lane is one act the queue writes as two
  events. **Do not count on the two travelling together.** Events share a claim only when
  both were pending when that claim ran, and a release and the designation after it are
  separate writes at separate moments — so the pair lands on one claim, or splits across
  two, nine seconds apart being as ordinary as together. Where one claim carries both, read
  them as one act, in whichever order the batch printed them: one row names who is going,
  the other who is coming, and you settle both. Where the release comes alone, settle it
  alone — log it, complete it — and **carry it forward**: until a launch follows on that
  lane, this session knows the lane has a leaver on it, and that knowledge is exactly what
  the rule below reads when the designation arrives on a later claim.

- **A lane that already has a listener gets nothing — unless this session has processed a
  release on that same lane.** Read the roster before you launch: `corpus agents` says
  whether the payload's thread is `live`, and `live` here has two meanings the row cannot
  tell apart, so this rule has to. **Where no release has passed through this session for
  this lane, `live` means the lane is already answered.** A designation arrives whether or
  not one is needed, because re-designating is the only way a person can ask for a listener
  that stopped running to be started again. Launch nothing, log why, complete. Two listeners
  on one conversation is not a correctness failure — the server still never hands one event
  to two claimants — but it is a conversation answered by two agents that cannot see each
  other's context, which is the same split story a second orchestrating session would make
  of yours.

  **A live row does not hold back a launch when this session has already processed a
  `resident.released` on that same lane with no launch since — there, `live` means someone
  is leaving.** The outgoing listener learns it was replaced only when it next unparks, so
  its park keeps the row reading `live` — and the row goes on reading `live` for a grace
  window after any park ends — while the designation in your hands is the lane's future that
  nobody else will act on. So launch, exactly as the launching row above says, whether the
  release shared this claim or came two claims ago: the carried release from *Losing a
  listener* is what makes the two shapes one case. Say in the launch prompt that this launch
  follows a release, because the new listener will read a `live` row at its own startup and
  needs to know what that reading is — what it does with it is the converse skill's to
  state. Two listeners, briefly, is acceptable here where this bullet's own warning says it
  is not, for one reason: the one already there is leaving by construction — its designation
  has been replaced — so the lane ends with one voice. The launch spends the carried
  release, and it is the pass's one launch for that lane: the once-a-pass rule below counts
  it, so nothing doubles up when the row is read again. On the following pass, judge it as
  you judge any launch — and a row that reads `live` is this launch working, since the new
  listener parks as the old one leaves and the reading never breaks.

  What carries *this session has processed a release* is your own session and nothing else:
  the release you logged and completed is work you have seen, and there is no store to write
  it into and none to consult. Losing it with a restart is covered rather than a gap — a
  restart that forgets every release also ends every listener you launched, so every
  designated lane reads not-`live` on your first roster read and the once-a-pass rule below
  launches with no memory needed.

  **A weight that changed is this release case, not a third one.** A re-designation that
  only changes the weight reaches you as release and designation — paired or split — on a
  lane that may still read `live`, and you launch now, at the new weight. No running agent
  becomes another model without discarding the conversation it holds, so the old listener
  ends its own run instead of changing. **When it goes, and how it finds out, is the
  converse skill's to state.** Standing it down yourself is still not yours to do: you
  launch its successor, log that the lane is designated at a new weight and what went out,
  and let it leave on its own.

- **A lane with work waiting and nobody on it gets a listener, once a pass.** For every roster
  row that is not the orchestrator's, does not read `live`, **has something pending**, and is
  **not working**, launch a listener. Those three fields together are the decision and none of
  them makes it alone.

  - **Not live** is *nobody is parked*. On its own it launches for every idle conversation in
    the workspace, which is one running agent per conversation that has ever existed.
  - **Something pending** is *somebody is waiting*. A lane that is not live with nothing
    waiting is idle and perfectly healthy.
  - **Not working** is *nothing is being done*. This is the one that is easy to leave out and
    the one that costs an agent when you do: a resident works its conversation inline and holds
    no park while it does, so a turn longer than the grace window reads exactly like a dead
    lane. `lapsed · working · 2 waiting` is a **busy agent**, and launching onto it puts a
    second listener on a conversation that already has one thinking.

  **Working is not presence, and must never be read as it.** A listener that died mid-event
  leaves its event held until `corpus queue reap-stale` returns it to pending — so a dead lane
  reads `working` until it is reaped.

  **That is why the roster is read *before* the reap, and it used to say the opposite**
  (AGENT-056). The old rule was "reap first, and the roster you read afterwards is telling the
  truth about what is being done", which holds for a lane whose listener is gone and is exactly
  backwards for one that is alive: `working` is derived from held work, so reaping strips it
  from the busy resident and the dead one alike, and a long turn then reads as the launch
  condition. Reading first costs a crashed lane **one pass** — it reads `working` this pass,
  its event is reaped, and the next pass launches for it — and costs a live lane nothing at
  all.

  This still covers the two cases no event announces — a listener that crashed or was killed,
  and your own restart, where every designation is still sitting on its thread and every
  listener is gone. A restart's lanes hold nothing, so they read `working: false` on the first
  read and launch at once; a crash that was holding work takes the extra pass. It is **once per
  pass, per lane, and never per event**: a lane that has been
  unattended may be holding a dozen messages and it still wants one listener, and a
  `resident.designated` for a lane you have already launched into this pass launches nothing
  further. And if a lane you launched
  into does not read `live` on the following pass, that launch is not working: log it, stop
  relaunching that lane, and wait for a fresh `resident.designated` says
  to try again. Relaunching every pass forever is how one lane that will not take a listener
  becomes the only thing this loop does. Word that log line as **standing down, never as a failed launch** — a
  listener that started, parked, claimed this lane's work and is now inside a long turn reads
  not-live exactly as a dead one does (below), and a console line calling that a broken launch
  sends an operator hunting for a listener that is at that moment answering somebody.

  **A launch made from the roster carries no resident, and must not invent one.** There is no
  payload behind it, and the row is not a substitute for one: it prints who is resident in
  words written for a person to read, and handing that rendering on as a name is the invention
  ruled out above. Give the launch the thread id, and the weight below, and nothing else. A
  listener started without a resident in its prompt reads its own designation out of the
  corpus — the converse skill states how, and this one does not.

  **The weight is the one thing you do read off the row, and reading it invents nothing.** The
  row prints it after the resident — `a general resident at heavy` — and a **Key** is a token
  the tier table declares rather than a rendering of anybody. It is also not the summary the
  next bullet warns you off, which is a sentence written for a person and promised nothing. So
  take that word, find its row in the tier table, and launch at that row's model — the same
  `model` argument on the same Task call — exactly as
  you would from a payload. A row that prints nothing after the resident is a designation that
  chose no weight, and it launches as a `null` payload does: judged on the conversation,
  under the judgment *Launching a listener* above states — the body's two passes
  weigh a job you dispatch, never a listener. Name the model in the prompt here too. And a
  roster launch logs the same line the launching bullet asks for — the weight, and `stated`
  or `judged` — on the event that put this lane in front of you: the `lane.waiting` you
  claimed for it, or the designation the carried release paired with. Only a launch the
  pass holds no event for has no job to log to, and there the prompt is the whole record of
  what you chose — which is why the prompt always carries the weight and its provenance in
  words as well.

- **A row that does not read `live` still does not mean nobody is there — and where the row
  cannot tell you, you launch anyway.** Presence is the parked request and nothing else, so a
  row reads not-live for a listener that crashed, for one the server has not seen since it
  restarted, **and for one in the middle of a turn**: a resident works its conversation inline
  and holds no park while it does, so any turn longer than the grace window is indistinguishable
  from an empty lane *by presence alone*.

  **`working` separates the third of those, and only the third.** A lane holding claimed work
  is being worked; that much the row now tells you, and the rule above uses it. What the row
  still cannot tell you is a crashed listener from one the server has not seen since a restart —
  and it does not need to, because both want the same thing.

  **Everything the old argument forbade, it still forbids.** Do not invent a separator for what
  is left: no probe, no holding back a pass to see what happens, and above all no reading the
  line printed after the state — that is display text whose length is promised and whose content
  is not, so keying on it is deciding from a string that may change without notice. Where the
  three fields say launch, **launch, and let the lane settle it.** A second listener parks, costs nothing while the conversation is quiet,
  and at the first message either of them is asked to answer, one of the two finds out it is
  second and goes — nothing posted, nothing worked, and nobody answered twice. **How it finds
  that out is the converse skill's to state, and it is stated there alone.** A resident runs
  that test, on a lane you never claim and never see; you neither run it nor observe it, and a
  second account of it here would be a second thing to keep in step — which is how the two came
  to disagree once already. What you rely on is the outcome: a duplicate resolves itself at
  the first message, so launching costs a wasted session, occasionally. The failure you would
  buy by holding back has no repair in it at all — a listener that really did die, on a lane
  nobody relaunches, and **nobody else coming**: since the fallback was removed, a conversation
  with no listener is not answered slowly, it is not answered.

  That asymmetry is why `working` narrows this rule and does not reverse it. It removes the one
  uncertainty the row can now answer, and everywhere the row still cannot answer, **launching
  under uncertainty remains right** — a wasted session against an unanswered conversation is not
  a close call.

- **Launch before you dispatch, in the same pass, every pass.** There used to be a rule here
  saying the exact opposite — *never in the same pass you took that lane's work* — and it was
  correct for the mechanism it guarded. Under the fallback you could be holding a lane's
  events in `in-progress/` while launching its listener, and that listener would read your
  live dispatch as work somebody abandoned and answer the same turn twice.

  **You can no longer be holding them.** A conversation with a resident is not on your claim,
  absent listener or not, so there is nothing of yours on that lane to collide with. The
  collision the rule guarded against cannot happen, so the rule is gone rather than relaxed.

  It is gone for a second reason worth knowing, because it is what the rule cost. Deferring
  the launch until the lane was clear meant a conversation somebody kept using **never had a
  clear pass** — you claimed, so you deferred; they replied, so you claimed again. The busier
  the conversation, the more certain it was that the agent that owned it never started at
  all. Nothing in the old text was wrong; the outcome was, and it took a person noticing an
  orchestrator explain its own starvation to find it.

## Never apologise for a resident — the argument

**There is no such thing as a lapsed lane's work any more, and this is where that used to be
explained.** A conversation whose listener is absent keeps its own work. You will not be
handed it, you cannot claim it, and the thing that gets it answered is the listener you launch
in step 6.

**Never apologise for a resident and never announce that one is missing.** This rule survives
the fallback that produced it, and it matters more now, not less. You are not in that
conversation at all — you have not claimed anything there and you will not — so a turn saying
"your agent is not running" is an operator's diagnostic posted into somebody else's
conversation by an agent with no business writing in it. The person can see their lane's state
on the board, where it says exactly that and is theirs to act on.

Its old reason — that the work still got done, slower and without the conversation's warmth —
is no longer true, and the new reason is stronger: **the fix is a launch, not an
explanation.** If you find yourself composing a sentence about why somebody's agent has not
answered, you are doing the wrong thing with the wrong hands. Launch the listener.

## A broken converse, for the operator

**A broken `converse` shows up differently, and is worth recognising as its own thing.** The
loop is fine and what fails is one conversation: its lane reads live on `corpus agents` while
nothing gets answered in it, or its listener exits the moment it starts and the lane keeps
reading not-live with its pending count climbing, pass after pass, however often you launch
into it. Nobody else quietly does that work, and the climbing count has **two causes**, told
apart by what the listener left. A **corrupted skill file** stops a listener before it works:
nothing settled, no job log line, no reply. Restore the file the same way, and the next
launch picks it up; listeners already running keep the text they started with until they end.
A **listener that chose to leave** settled its events and recorded why — in its job log or
its last reply, a record the converse skill requires of every ending — so restoring the file
fixes nothing: read the recorded reason instead.
