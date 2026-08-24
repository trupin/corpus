# Deliverable fences — widths, closings, and what each failure costs

The comment skill states the rule: one deliverable per labeled fence, prose outside it, and a
fence closes only on a line that is nothing but a backtick run at least as long as the one
that opened it. This file is the working detail of that one mechanism — how wide to open, how
to close, and what each of the two failures does to the person reading. Read it before you
write a fence into a turn.

**Open it wider than anything inside it.** Three backticks around a payload that itself
contains a fence closes early — the payload's own ``` line ends your block: one deliverable
becomes several, your prose spills out between them, and each copy button hands over a
fragment, which defeats the whole point of handing the thing over in one gesture. Before you
write the fence, find the **longest backtick run in the payload and open with one more than
that**: four around a payload containing three, five around one containing four, and so on.
The rule is the count, not the number four. Counting every run rather than only the ones
alone on a line is deliberate — a run in the middle of a sentence closes nothing, so the rule
is stricter than it strictly needs to be, and being one backtick too wide costs nothing while
being one too narrow splits the deliverable. This bites most often on what matters most: a
prompt written for another agent, which is itself markdown and routinely contains fenced
examples.

A prompt whose body contains a fence is handed over like this, four backticks outside and
three inside:

`````markdown
````prompt
## Output format

```
owner | action | topic
```

**Critical instruction:** answer only in that table.
````
`````

**Close it on a line of its own.** The closing run has to stand alone: write it at the end of
the payload's last content line — the last word and the backticks together — and it closes
nothing, because that line is not *nothing but* the run. The fence then stays open to the end
of the turn, and this is the failure that costs the most while looking like the least. A
thread is a sequence of turns delimited by a level-2 heading naming the author and the turn's
timestamp, and such a heading **inside a fence is deliberately not a delimiter** — that is
exactly what lets a turn quote the thread format without faking a turn. So an unclosed fence
swallows every heading after it: the next person's reply stops being a turn of its own and is
absorbed into the body of yours. They see your opening sentence, their own message is gone
from the conversation, and nothing anywhere reports an error — the same exchange that reads
as two turns with the run alone on its line reads as **one** with the run riding the content
line. It does not render badly; it makes the next message vanish. So: a newline after the
payload's last character, then the closing run by itself, every time.

Documents written before these rules are **not** repaired retroactively — a deliverable that
already split stays split until someone rewrites it. If you are asked why an old snippet
renders as several canvases, this is why, and the repair is to re-emit it with a wider fence.

So a prompt prepared for another agent is handed over like this — the sentence introducing it
above the fence, nothing but the prompt inside it, and the turn's trace line, if the turn
wrote, still last of all:

```prompt
Read [[doc_a1b2c3]] and [[doc_7e3a91]], then say in three sentences whether the
6.4% rate assumption still holds for the 2026 refinance.
```
