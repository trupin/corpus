# Worked examples — the comment skill

Four events worked end to end, exactly as the comment skill's sections direct them. Read the
one whose shape matches the event in hand. Nothing here adds a rule: when an example and the
skill seem to disagree, the skill is right and this file has drifted.

**1 — Anchored comment that edits the parent.** The person selected "6.1%" in a mortgage note
and commented `@agent is this still right?`.

```bash
corpus thread context th_4b8e2c
parent doc_a1b2c3 · Mortgage options · Mortgage options › Rates

> 6.1%

## Rates

The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.

# related excerpts
doc_7e3a91  Refinance plan › Costs  linked  every projection here assumes 6.1% for the whole term
corpus thread show th_4b8e2c
corpus job log evt_7c1d9a "briefed on th_4b8e2c from its context pack"
corpus doc show doc_a1b2c3  # escalation: the patch below quotes this document byte for byte
The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.
corpus doc patch doc_a1b2c3 --from agent --old '6.1% as of 2026-05-02, and every projection in
this document uses it.' --new '6.4% as of 2026-07-28. Thirty-year fixed offers currently
cluster between 6.1% and 6.6%, and every projection in this document uses 6.4%.'
patched doc_a1b2c3 — 1 occurrence replaced — 1 anchor remapped
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
corpus job log evt_7c1d9a "edited [[doc_a1b2c3]] — rate assumption 6.1% to 6.4%"
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
Not any more — 6.4% is the representative 30-year fixed rate today. Updated the
assumption and the projection note in [[doc_a1b2c3]]. The anchored sentence is
the one that changed.
↳ updated the rate assumption in [[doc_a1b2c3]] from 6.1% to 6.4%
CORPUS_EOF
```

**2 — Standalone Ask that gets a title and a document.** `parentId` was `null` and the payload
carried `"unresolved": ["researcher"]`. The work ran in two stages: a lighter model gathered
what the corpus already held on the subject, and this session judged it and wrote the answer.
So the turn names the **deciding** stage and the job log carries both.

```bash
corpus thread show th_9f21c4
corpus doc create --type note --title "Espresso extraction troubleshooting" --folder kitchen --tags coffee --from agent <<'CORPUS_EOF'
# Espresso extraction troubleshooting

Sour and fast means under-extraction: grind finer before changing dose.
Bitter and slow means the opposite.
CORPUS_EOF
title=$(cat <<'CORPUS_EOF'
Why does my espresso taste sour?
CORPUS_EOF
)
corpus doc edit th_9f21c4 --title "$title" --from agent
corpus job log evt_5a2b7c "gathered on claude-haiku-4-5; concluded and wrote the reply on claude-opus-4-1"
corpus thread reply th_9f21c4 --from agent --model claude-opus-4-1 <<'CORPUS_EOF'
Sour usually means under-extraction — the shot ran too fast. Grind one step
finer and keep everything else fixed.

`@researcher` isn't defined in this workspace, so I answered this directly. The
full troubleshooting sequence is durable enough to keep, so I wrote it down in
[[doc_7e3a91]] and titled this thread.
↳ created [[doc_7e3a91]] in kitchen/ and titled this thread
CORPUS_EOF
```

**3 — Inbox capture, filed end to end.** The payload's `parentId` was the captured document.

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
corpus doc move doc_5c8b2f --folder finance --from agent
corpus doc edit doc_5c8b2f --add-tag insurance --add-tag review --from agent
corpus job log evt_2e4f8b "filed [[doc_5c8b2f]] into finance/"
corpus thread reply th_1a7d33 --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
Filed this as [[doc_5c8b2f]] — "Quarterly insurance review", now in `finance/`,
tagged insurance and review. I added the structure and left one open question in
it: I don't know which quarter the policy renews in.
↳ retitled, expanded and filed [[doc_5c8b2f]] into finance/, tagged insurance and review
CORPUS_EOF
```

Only the first write there carried a key, and that is not an oversight: it replaced the
body. The move and the two tags name their own deltas, so they merge with anything else that
touched the document while the filing was under way and need no key at all.

**4 — A `form.respond` continuation.** The three-field form worked in `references/forms.md`
was answered on `th_6c0a18`: `finance` for the destination, `insurance` and `review` for the
tags, the renewal quarter left blank, and `note: "put it with the mortgage stuff"`. Three
answers, one submit, one event.

```bash
corpus thread show th_6c0a18
corpus doc move doc_2f7b91 --folder finance --from agent
corpus doc edit doc_2f7b91 --add-tag insurance --add-tag review --from agent
corpus job log evt_9b4c02 "form answered — filed [[doc_2f7b91]] into finance/, tagged insurance and review"
corpus thread reply th_6c0a18 --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
Finance it is — [[doc_2f7b91]] now lives in `finance/` next to the mortgage
notes, tagged insurance and review. You left the renewal quarter blank, so it
stays the open question already written into the document. That closes the
filing I paused on. Nothing else is outstanding here.
↳ moved [[doc_2f7b91]] into finance/ and tagged it insurance, review
CORPUS_EOF
```
