import {
  formAnswerRecord,
  unreadableAnswer,
  type Form,
  type FormAnswerRecord,
  type FormAnswerRequest,
} from "@corpus/contract";

/**
 * Whether the answer being typed could be read back from the turn it would
 * write — asked **before** the round trip, in the form, against the field at
 * fault (PR #28 re-review, MAJOR).
 *
 * **Why the client asks at all.** `**Note:**` on its own line is ordinary
 * markdown in a documents app, and AGENT-017 pushes the agent toward `write`
 * fields, so a person typing one into a text box is a mainline event rather than
 * an exotic one. The server refuses that answer — `assertAppendableAnswer`, on
 * the exact bytes about to be written — and it must keep doing so: this module
 * is a *second* line of defence, never a replacement. What it changes is who
 * finds out and how. Without it the refusal arrives as an HTTP failure in a
 * 360px toast that auto-dismisses after six seconds, with nothing marking the
 * field or the line; with it the form says which question cannot be recorded and
 * why, on the same terms §11 already promises for a missing required field —
 * "the form says which question is still missing rather than letting the attempt
 * fail silently".
 *
 * **The rule is not restated here.** {@link unreadableAnswer} is the contract's,
 * it is pure, and `apps/ui` may import it, so this module *calls* it rather than
 * carrying a second reader's opinion about what round-trips. A copy would be
 * free to drift from the server in either direction, and both directions are
 * bad: a lenient copy re-opens exactly the toast this fixes, and a strict one
 * refuses answers the server would happily take, with nothing to appeal to.
 *
 * **What it adds is attribution.** `unreadableAnswer` returns one sentence about
 * the whole record — enough to print, not enough to point at a control. So the
 * fault is *located* by asking the same function again with every other `write`
 * answer blanked: {@link formatFormAnswerBody} emits a heading for **every**
 * field whether or not it was answered, so blanking a neighbour's text removes
 * nothing a delimiter could hide behind, and an answer that is still unreadable
 * on its own is unreadable because of its own text. That is a use of the
 * authority, not a paraphrase of it — nothing here knows *which* lines are
 * delimiters, only that the contract refuses this one.
 *
 * It does **not** cover the other two refusals `assertAppendableAnswer` makes —
 * an unterminated fence and a fabricated `## user · <ts>` turn heading. Those
 * are `apps/server`'s `unterminatedFence` / `parseTurns`, which `apps/ui` cannot
 * import (sibling applications, not a dependency edge), and a hand-rolled fence
 * scanner here would be precisely the drifting copy the paragraph above refuses.
 * They stay server-side, and the toast they produce is now the server's own
 * sentence rather than a route template (`CorpusRequestError`). Moving
 * `unterminatedFence` into `@corpus/contract` is what would close it; that is
 * contract-dev's call and is filed rather than guessed at here.
 */

export interface AnswerFault {
  /**
   * The question whose own text is at fault, or `null` when no single field is.
   *
   * `null` is not a "could not tell": it is the honest answer for a record whose
   * unreadability comes from something other than a person's `write` text —
   * an option spelled like a delimiter, say, on a form that reached disk without
   * passing `FormSchema` (`POST /api/threads` writes a first turn unchecked —
   * SERVER-070). Nothing in the form can be marked for it, so it is said about
   * the form.
   */
  readonly question: string | null;
  /**
   * The contract's own sentence, which names the offending line. Rendered
   * verbatim: it is a person's sentence, it says which line to rewrite, and
   * summarising it is how the line stops being identifiable.
   */
  readonly reason: string;
}

/**
 * Everything about this draft that would make the answer turn unreadable, one
 * entry per field at fault (or a single form-level entry). Empty means the
 * contract accepts it, which is the gate `FormBlock` submits on.
 *
 * `formAnswerRecord` is the same composition the write path performs, note
 * trimming included, so what is checked here is the record the server would
 * check and not an approximation of it.
 */
export function answerFaults(form: Form, request: FormAnswerRequest): readonly AnswerFault[] {
  const record = formAnswerRecord(form, request);
  const reason = unreadableAnswer(form, record);
  if (reason === undefined) return [];

  const faults: AnswerFault[] = [];
  record.answers.forEach((entry, index) => {
    // Only a `write` answer is free text; an option is the form's own string and
    // `FormSchema` already keeps it off the delimiter line-space.
    if (entry.text === null) return;
    const alone: FormAnswerRecord = {
      answers: record.answers.map((other, at) => (at === index ? other : { ...other, text: null })),
      note: null,
    };
    const own = unreadableAnswer(form, alone);
    if (own !== undefined) faults.push({ question: entry.question, reason: own });
  });

  return faults.length > 0 ? faults : [{ question: null, reason }];
}
