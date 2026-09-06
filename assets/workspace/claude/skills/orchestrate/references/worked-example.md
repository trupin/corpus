# Worked example — one `comment.created`, end to end

The orchestrate skill's body carries the loop; this file walks one pass of it, every step
in order, with the console story each step leaves. Read it when the loop's shape is
unclear — never as part of an ordinary pass, which needs only the body's steps.


One `comment.created`, end to end — the operator commented on a mortgage note and asked for
the rate assumption to be updated.

```bash
corpus queue claim-all
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"ui","payload":{"threadId":"th_4b8e2c","parentId":"doc_a1b2c3"}}],"inProgress":{"events":[],"total":0,"truncated":false}}
corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c"
corpus search "rate assumption" --limit 5
doc_a1b2c3  Mortgage options › Rates  …the working rate assumption is 6.1% as of 2026-05-02…
doc_7e3a91  Refinance plan › Costs    …every projection here assumes 6.1% for the whole term…
corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — judged, difficulty: one document, prescribed change)"
```

`inProgress` came back empty, so there is nothing to reconcile and nothing printed on
stderr — the ordinary shape of a loop that has been settling its events. Two ranked lines,
no bodies: that is the whole cost of finding out where the rate assumption lives.

The first pass ran and answered **no**: the figure lands in a note in this corpus, where a
wrong one is commented on and corrected, so nothing here is going out and nobody is deciding
on it. That is why the tier came from difficulty and why the dispatch line says so. Had the
same one-line change been to a letter going to the lender in the morning, the first pass
would have vetoed the light tier and that line would read `Opus 5 — judged, consequence`.

**Then the step that no command performs.** Launch the subagent in the background — its
prompt carries `evt_7c1d9a`, `th_4b8e2c`, `doc_a1b2c3`, those two retrieved lines as the
anchors to start from, and the comment skill — no restatement of the binding rules, because
that skill's own *Inherited invariants* section is what binds inside it (Delegation). Only once
it is out does the next command run, and it runs by itself: `corpus queue idle`, alone,
never appended to the claim above. Everything the claim printed has been read and acted on
by the time parking starts, which is the whole of what separates a dispatched batch from a
batch claimed into silence.

Inside the subagent, the comment skill briefs itself on the one thread that matters —
`corpus thread context th_4b8e2c`, one bounded pack carrying the anchored passage with its
enclosing section and whatever else bears on it, the second line never opened at all — reads
the map with `corpus thread show --index` and the request's turn verbatim, escalates to
`corpus doc show doc_a1b2c3 --section "Rates"` because the patch below quotes it byte for
byte — a quote is bytes you have seen, and that read
is also where a person's open session would have shown up had there been one — and does the
work: every mutation through the CLI, every progress line on the dispatched event's id.

```bash
export CORPUS_FROM=agent
corpus doc show doc_a1b2c3 --section "Rates"
## Rates
The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.
corpus doc patch doc_a1b2c3 --from agent --old '6.1% as of 2026-05-02, and every projection in
this document uses it.' --new '6.4% as of 2026-07-28 — see [[th_4b8e2c]]. Thirty-year fixed
offers currently cluster between 6.1% and 6.6%, and every projection in this document uses 6.4%.'
patched doc_a1b2c3 — 1 occurrence replaced — 1 anchor remapped
corpus job log evt_7c1d9a "edited [[doc_a1b2c3]] — updated the rate assumption to 6.4%"
corpus thread reply th_4b8e2c --from agent --model "Sonnet" <<'CORPUS_EOF'
Updated the rate assumption in [[doc_a1b2c3]] to 6.4% and reworded the
projection note to match. Changed: [[doc_a1b2c3]] (edited).
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%
CORPUS_EOF
```

The subagent reports what it did and exits. When `idle` returns — here on its rearm, with
no new event — read that return first: it says nothing is pending and nothing is held, and
the subagent's report is waiting alongside it. Verify the reply and the edit landed, then
record the outcome:

```bash
corpus job log evt_7c1d9a "completed — replied on th_4b8e2c"
corpus queue complete evt_7c1d9a
```

Then park again — `corpus queue idle`, on its own line and on its own. The moment the
operator replies in `th_4b8e2c`, or any new event lands, it returns; you read that return,
run `corpus queue claim-all`, dispatch what it gives you, and park again — new work going
out even while earlier subagents are still running.
