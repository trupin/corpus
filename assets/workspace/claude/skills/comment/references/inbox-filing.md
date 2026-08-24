# Inbox filing — the procedure

The comment skill says what a capture is and the two rules that bind before anything else.
This file is the procedure itself. Follow it end to end, in order.

1. **Read it whole** — `corpus doc show <parentId>`. The pack briefed you on the capture; step
   3 rewrites its body, which is the escalation earning the full read — and the read is where
   the key that write presents comes from. One line of text is normal.
2. **Give it a real title.** "Mortgage rates?" becomes "Mortgage rate assumptions for the 2026
   refinance". The title is what makes it findable.
3. **Expand it into something usable.** Add the structure a reader needs: a heading or two, the
   context the capture assumed, and an open-questions section for what it left dangling.
   **Expansion adds structure, never content** — do not invent a number, a date, a name or a
   decision the capture did not contain. When the intent itself is unclear, ask instead of
   guessing, and leave the document where it is until you have the answer.
4. **Choose a destination by finding its neighbours.** Search for the documents this capture
   belongs beside — `corpus search "<what the capture is about>" --limit 5` — then
   `corpus doc show <id>` on the closest hit, whose path names the folder it lives in, and
   prefer one that already holds similar documents — an existing `finance/` beats a new
   `money/` every time. Never go looking through the tree for folder names. When the search
   comes back with nothing related, the document is a genuine category the corpus does not
   have yet: name the new folder from its subject. The folder comes into being on the move,
   so there is no separate step.
5. **Move it out of `inbox/`** — `corpus doc move <id> --folder finance --from agent`.
6. **Tag it** — `corpus doc edit <id> --add-tag finance --add-tag housing --from agent`.
7. **Reply with what it became and where it lives**, naming the document by `[[id]]`.

**When the right home is genuinely ambiguous, leave it in `inbox/` and ask** — with a form, and
with every question the filing still needs in it: the destination, the tags, the fact the
capture assumed and did not state. One form finishes the filing; three separate questions
across three turns finish nothing three times. The document stays in `inbox/` until the answer
arrives — a wrong filing is harder to notice than an unfiled one.
