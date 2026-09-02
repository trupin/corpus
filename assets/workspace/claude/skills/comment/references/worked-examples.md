# Worked examples — the comment skill

Four events worked end to end, exactly as the comment skill's sections direct them. Read the
one whose shape matches the event in hand. Nothing here adds a rule: when an example and the
skill seem to disagree, the skill is right and this file has drifted.

Each of these runs fewer invocations than it does commands, because a run whose entries want
nothing from each other goes as one. Where a run is split, the split is the boundary rather
than a preference, and the prose under the example says which value crossed it.

**1 — Anchored comment that edits the parent.** The person selected "6.1%" in a mortgage note
and commented `@agent is this still right?`. Seven commands, three invocations.

```bash
corpus batch --from agent <<'CORPUS_EOF'
[["thread","context","th_4b8e2c"],
 ["thread","show","th_4b8e2c"],
 ["job","log","evt_7c1d9a","briefed on th_4b8e2c from its context pack"]]
CORPUS_EOF
parent doc_a1b2c3 · Mortgage options · Mortgage options › Rates

> 6.1%

## Rates

The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.

# related excerpts
doc_7e3a91  Refinance plan › Costs  linked  every projection here assumes 6.1% for the whole term
corpus doc show doc_a1b2c3  # escalation: the patch below quotes this document byte for byte
The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.
corpus batch --from agent <<'CORPUS_EOF'
[["doc","patch","doc_a1b2c3","--old","6.1% as of 2026-05-02, and every projection in\nthis document uses it.","--new","6.4% as of 2026-07-28. Thirty-year fixed offers currently\ncluster between 6.1% and 6.6%, and every projection in this document uses 6.4%."],
 ["job","log","evt_7c1d9a","edited [[doc_a1b2c3]] — rate assumption 6.1% to 6.4%"],
 ["thread","reply","th_4b8e2c","--model","claude-sonnet-4-5","-m","Not any more — 6.4% is the representative 30-year fixed rate today. Updated the\nassumption and the projection note in [[doc_a1b2c3]]. The anchored sentence is\nthe one that changed.\n↳ updated the rate assumption in [[doc_a1b2c3]] from 6.1% to 6.4%"]]
CORPUS_EOF
patched doc_a1b2c3 — 1 occurrence replaced — 1 anchor remapped
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
```

The read of the parent sits between the two batches and not inside either. The patch quotes
that document line for line, and a quote is exactly the sort of value an entry cannot get from
the entry above it.

**2 — Standalone Ask that gets a title and a document.** `parentId` was `null` and the payload
carried `"unresolved": ["researcher"]`. The work ran in two stages: a lighter model gathered
what the corpus already held on the subject, and this session judged it and wrote the answer.
So the turn names the **deciding** stage and the job log carries both. Five commands, four
invocations.

Their question becomes the thread's title, so it is their words: write
`/tmp/corpus-title-evt_5a2b7c.txt` (`Why does my espresso taste sour?`) with your
file-writing tool first.

**The name is the event's, never the thread's** — a thread id is one two agents can hold at once, so it protects nothing. Where you hold no event, add something only this invocation knows. Orchestrate states the rule and why.

```bash
corpus thread show th_9f21c4
corpus doc create --type note --title "Espresso extraction troubleshooting" --folder kitchen --tags coffee --from agent <<'CORPUS_EOF'
# Espresso extraction troubleshooting

Sour and fast means under-extraction: grind finer before changing dose.
Bitter and slow means the opposite.
CORPUS_EOF
created doc_7e3a91 — data/docs/kitchen/espresso-extraction-troubleshooting.md
corpus doc edit th_9f21c4 --flag-file title=/tmp/corpus-title-evt_5a2b7c.txt --from agent
corpus batch --from agent <<'CORPUS_EOF'
[["job","log","evt_5a2b7c","gathered on claude-haiku-4-5; concluded and wrote the reply on claude-opus-4-1"],
 ["thread","reply","th_9f21c4","--model","claude-opus-4-1","-m","Sour usually means under-extraction — the shot ran too fast. Grind one step\nfiner and keep everything else fixed.\n\n`@researcher` isn't defined in this workspace, so I answered this directly. The\nfull troubleshooting sequence is durable enough to keep, so I wrote it down in\n[[doc_7e3a91]] and titled this thread.\n↳ created [[doc_7e3a91]] in kitchen/ and titled this thread"]]
CORPUS_EOF
```

**The creation stays outside the batch, and that is the boundary rather than an oversight:**
the reply names `[[doc_7e3a91]]`, which is the id the creation printed. Written into the array
beside it, that ref would have had nothing to be. This is the shape that saves least, and the
example is here because the run splits where the values say it does, never where the saving
would prefer.

**3 — Inbox capture, filed end to end.** The payload's `parentId` was the captured document.
Eight commands, five invocations.

```bash
corpus doc show doc_5c8b2f
key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa
corpus doc edit doc_5c8b2f --key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa --title "Quarterly insurance review" --from agent <<'CORPUS_EOF'
# Quarterly insurance review

Check the home and auto policies against current replacement costs each quarter.

## Open questions

- Which quarter does the current policy renew in?
CORPUS_EOF
corpus search "home and auto insurance policies" --limit 5
doc_3f9a01  Home policy renewal › Replacement cost  …the home policy's replacement cost was last checked in March…
doc_c14be7  Auto policy notes › Premiums            …the auto premium rose 8% at the last renewal…
corpus doc show doc_3f9a01  # its path is data/docs/finance/home-policy-renewal.md — that is the folder
corpus batch --from agent <<'CORPUS_EOF'
[["doc","move","doc_5c8b2f","--folder","finance"],
 ["doc","edit","doc_5c8b2f","--add-tag","insurance","--add-tag","review"],
 ["job","log","evt_2e4f8b","filed [[doc_5c8b2f]] into finance/"],
 ["thread","reply","th_1a7d33","--model","claude-sonnet-4-5","-m","Filed this as [[doc_5c8b2f]] — \"Quarterly insurance review\", now in `finance/`,\ntagged insurance and review. I added the structure and left one open question in\nit: I don't know which quarter the policy renews in.\n↳ retitled, expanded and filed [[doc_5c8b2f]] into finance/, tagged insurance and review"]]
CORPUS_EOF
```

Only the first write there carried a key, and that is not an oversight: it replaced the
body. The move and the two tags name their own deltas, so they merge with anything else that
touched the document while the filing was under way and need no key at all. That is also why
the four of them settle in one invocation and the body edit does not: a keyed write presents
the key of the read above it, and a second one would want the key the first printed.

**4 — A `form.respond` continuation.** The three-field form worked in `references/forms.md`
was answered on `th_6c0a18`: `finance` for the destination, `insurance` and `review` for the
tags, the renewal quarter left blank, and `note: "put it with the mortgage stuff"`. Three
answers, one submit, one event. Five commands, two invocations.

```bash
corpus thread show th_6c0a18
corpus batch --from agent <<'CORPUS_EOF'
[["doc","move","doc_2f7b91","--folder","finance"],
 ["doc","edit","doc_2f7b91","--add-tag","insurance","--add-tag","review"],
 ["job","log","evt_9b4c02","form answered — filed [[doc_2f7b91]] into finance/, tagged insurance and review"],
 ["thread","reply","th_6c0a18","--model","claude-sonnet-4-5","-m","Finance it is — [[doc_2f7b91]] now lives in `finance/` next to the mortgage\nnotes, tagged insurance and review. You left the renewal quarter blank, so it\nstays the open question already written into the document. That closes the\nfiling I paused on. Nothing else is outstanding here.\n↳ moved [[doc_2f7b91]] into finance/ and tagged it insurance, review"]]
CORPUS_EOF
```
