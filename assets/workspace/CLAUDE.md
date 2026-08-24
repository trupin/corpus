# CLAUDE.md

This file is read at the start of every session in this workspace. It holds the
rules that apply to everything the agent does here, whatever skill is running.

## How the agent writes

**Every text you produce for a person follows the STE-flavored rules below, taken from `.claude/skills/asd-ste100/SKILL.md`.** A thread reply, a comment answer, a status line, a job log, a refusal, a form's question. All of it.

This is a standing rule, not a skill you wait to be asked for. That skill's own triggers are on-demand — *"disambiguate"*, *"STE100 rewrite"*, *"apply Simplified Technical English"* — so nothing in the ordinary act of answering a comment would invoke it. This page is what makes it apply.

**This digest is the rule, not a summary of one you still owe a read.** For ordinary writing, the rules on this page are the whole obligation, and you do not open the skill file to follow them. Read the skill body itself in exactly two cases: a person invoked it by its triggers above, or the task is itself a rewrite that needs the dictionary-level rules and the scan checklist. Skipping the read never means skipping the rules — everything below binds every text you write, in every context, digest or no digest.

Apply every **structural** rule. Treat the **lexical** rules as a direction of travel, and never claim ASD-STE100 compliance: the standard's approved dictionary is not redistributable and is not in this workspace. `PROVENANCE.md` beside the skill has the detail.

In practice, on everything you write:

- **Active voice.** Name who acts.
- **One instruction per sentence**, at most 25 words for prose and 20 for a procedure.
- **No semicolons at all.** STE Rule 8.1 bans the mark, not only the clause join. Every other mark is permitted, the em dash included — though an em dash usually marks a sentence that wants splitting.
- **No phrasal verbs.** Write `start`, not `spin up`. Write `read`, not `dive into`.
- **No nominalization.** Write `analyze the log`, not `perform an analysis of the log`.
- **No adjectives that claim quality instead of showing it.** Delete `seamless`, `robust`, `powerful`, or replace one with the measurement that earns it.
- **Noun clusters of at most 3 words.** One topic per paragraph, at most 6 sentences.
- **A list for 3 or more steps or conditions**, never a sentence that buries a sequence.

### Two rules that matter more than the rest

**A hedge keeps its strength.** `may have failed` never becomes `failed`. `could be caused by X` never becomes `X is the cause`. A shorter sentence that promotes a hedge to a fact is a **different claim**, and a length cap is exactly what tempts an author to cut one. The skill calls this the most common way a well-meant rewrite goes wrong.

**You never rewrite a quotation.** This rule governs your own prose. It stops at the edge of anything you are quoting:

- a passage from a document, anchored or not
- frontmatter, a diff, a command's output, a document key
- an error string the server returned
- a person's own words, from a comment or a form answer

Rewriting any of those corrupts what somebody else wrote. That is worse than dense prose, and it is the one failure this rule can cause that the reader cannot see.

### What the rule is for

The point is the reader, not the word count. **Stop when a sentence has one possible reading, not when it is shortest.**

STE fixes the form of a text and never its substance. A hollow paragraph rewritten under these rules becomes a clean, short, well-punctuated hollow paragraph. If you have nothing to say, say that instead of polishing it.

### What it costs, stated rather than denied

The skill warns against applying STE where voice is the point, and a reply to a person about their own document is arguably such a place. A reply written this way is flatter than one written for voice.

That trade was made deliberately by this workspace's owner. Corpus is a place where an agent and a person read each other's writing carefully, often days apart, and a sentence with one reading is worth more there than a sentence with a pleasing shape.

## Where the rules live

Everything else is in the skills under `.claude/skills/`. Each one states what it is for in its own frontmatter description, and `corpus init` reported what it installed. This file holds only what applies to all of them.
