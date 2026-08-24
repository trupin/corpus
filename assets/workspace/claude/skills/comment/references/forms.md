# Forms — the grammar, and the answer's shape

The comment skill says when to ask with a form and that the whole batch goes in one turn.
This file is the rest: how the fields are written, what the server refuses, and how the
answer comes back. Read it before you post a form fence, and again when a `form.respond`
event arrives.

## Writing the form

**Mark a field optional whenever you can proceed without it.** A field is required unless it
carries `optional: true`, so every field you leave unmarked is a gate the person has to get
past before they can submit anything at all. Mark generously: when a form feels like an
interrogation the fix is more optional fields, never fewer forms and never fewer questions.
Keep each question short enough to read as a control — one line, not a paragraph — and put the
detail in the prose above the fence.

**Say in the same turn what you will do with the answers.** The prose above the form is where
you commit to the work: what you will change, where, and what each answer decides. A form with
no such sentence asks the person to submit without telling them what they are authorising.

**The grammar.** The form is a fenced block whose info string is `form`, written with
backticks, and it comes last in the turn body you pass to
`corpus thread reply <id> --from agent --model <name>` — after the prose, with only a trace
line after it when the turn also wrote. Written out, the ask is one turn: the sentence that
commits to the work, then the fence. This one asks for a decision, a selection and a fact, with
the fact optional:

> I can finish filing this as soon as I know where it belongs and how you want it tagged — I'll
> move it, tag it, and write the renewal quarter into the document as the answer to the open
> question it already carries.

```form
fields:
  - question: Where should this note live?
    kind: choose one
    options:
      - finance
      - housing
      - leave it in inbox for now
  - question: What should it be tagged?
    kind: choose any
    options:
      - insurance
      - review
      - mortgage
  - question: Which quarter does the current policy renew in?
    kind: write
    optional: true
```

`fields` carries at least one entry. Each `question` is non-empty and **distinct within the
form** — an answer names its field by the question text, so two fields never ask the same
thing. `kind` is exactly one of `choose one`, `choose any` and `write`, spelled with the space
exactly as written here, and there is no fourth kind: `choose one` and `choose any` each carry
`options` (at least one, each non-empty, all distinct) and the person picks one or picks any
number; `write` carries no options and takes free text. `optional: true` marks a field the
person may leave blank, and a field with no `optional` line is required. **At most one form per
turn** — a form is identified by its turn's timestamp, so several questions are several fields
of one form, never two forms.

Every `question` and every option is **one line**, and no option is spelled `**Note:**`,
`_(left blank)_`, or one of this form's own questions wrapped in `**…**`. The answer turn writes
each question as a bold heading and each chosen option on a line of its own, so a newline or one
of those spellings would come back as something the person did not say.

Get any of that wrong — a fourth kind, a misspelled key, a repeated option, a question or option
carrying a newline, YAML that does not parse — and
**the server refuses the whole turn with a `400`** naming what it could not read. The turn does
not post at all, so fix the fence and post it again; nothing half-written reaches the thread
through it. That check is yours alone: it runs on turns **you** append to an existing thread,
which is where you ask, and a form fence anywhere else — in a turn somebody else wrote, or in
the first turn of a thread being created — reaches the file unchecked and is then drawn as a
broken code block instead of as controls, asking a question nobody can answer. Post your form as
a turn on the thread and read the `201` back. A turn carrying a form is never revised either:
when you need to ask something else, ask it in a **new** turn rather than rewriting the question
under the person answering it.

**You never answer a form — not the person's, and not your own.** Answering belongs to the
person alone, and the server refuses an answer from you.

## The answer: `form.respond`

The payload names the thread, the turn that carried the form, and what was given for
**every** field the form asked:

```json
{
  "threadId": "th_4b8e2c",
  "formTs": "2026-07-28T09:20:11Z",
  "answers": [
    {
      "question": "Where should this note live?",
      "kind": "choose one",
      "option": "finance",
      "options": null,
      "text": null
    },
    {
      "question": "Which quarter does the current policy renew in?",
      "kind": "write",
      "option": null,
      "options": null,
      "text": null
    }
  ],
  "note": null
}
```

`formTs` is the timestamp of the turn carrying the answered form. Every field of that form has
an entry, in the order the form asked them, and a field the person left blank is the entry
whose three value keys are all `null` — so a question they declined and a question you never
asked never look the same. `note` is `null` when the answerer added none. And there is no
`parentId` here: where the thread has a parent, it is re-derived with
`corpus thread show <threadId>`, as the skill body says.

**The answer is a continuation, not a new request.** Its `answers` list carries one entry per
field **of the form**, in the order the form asked them, each naming the `question` and its
`kind` and carrying exactly one of `option`, `options` or `text` — all three `null` when that
field was left blank — plus `note`, the free-text remark about the ask as a whole. Re-read the
thread with `corpus thread show <threadId>`, find the form you raised at `formTs`, and resume
from exactly there: do the work you had staged, and never re-ask, never re-explain from the
top, never restart the exchange. Because each answer arrives keyed to its question, resuming
is a matter of reading the list, not of matching prose to intent. Every optional field left
blank is a **complete** answer: proceed, and do not go back for the optional ones. And when
the person writes a prose reply instead of answering, the form is still unanswered and its
Attention row still stands — answer what they said, ask again in a new turn if you still need
those answers, and never resolve the thread to make the row go away.
