import {
  formAnswerRecord,
  formatFormAnswerBody,
  TURN_SEPARATOR,
  turnHeadings,
  unreadableAnswer,
  unterminatedFence,
  type Form,
  type FormAnswerRecord,
  type FormAnswerRequest,
  type OpenFence,
  type TurnAuthor,
} from "@corpus/contract";

/**
 * Whether the answer being typed could be written as **one** readable turn —
 * asked **before** the round trip, in the form, against the field at fault
 * (PR #28 re-review, MAJOR; UI-091).
 *
 * **Why the client asks at all.** `**Note:**` on its own line is ordinary
 * markdown in a documents app, a pasted code sample is how a person explains
 * what broke, and AGENT-017 pushes the agent toward `write` fields — so a text
 * box that can hijack one of the format's delimiters is a mainline event rather
 * than an exotic one. The server refuses those answers — `assertAppendableAnswer`
 * and `assertAppendableTurnText`, on the exact bytes about to be written — and it
 * must keep doing so: this module is a *second* line of defence, never a
 * replacement. What it changes is who finds out and how. Without it the refusal
 * arrives as an HTTP failure in a 360px toast that auto-dismisses after six
 * seconds, with nothing marking the field or the line; with it the form says
 * which question cannot be recorded and why, on the same terms §11 already
 * promises for a missing required field — "the form says which question is still
 * missing rather than letting the attempt fail silently".
 *
 * **No rule is restated here.** All three are the contract's, they are pure, and
 * `apps/ui` may import them, so this module *calls* them rather than carrying a
 * second reader's opinion about what is appendable:
 *
 *   - {@link unreadableAnswer} — a line spelled like one of this form's own
 *     answer-prose delimiters, which makes the record read back as something
 *     other than what was given.
 *   - {@link unterminatedFence} — a fence left open, which masks every turn
 *     heading after it and so makes every later turn in the thread invisible.
 *   - {@link turnHeadings} — a line that would *become* a turn delimiter,
 *     splitting the person's own message into two turns signed by whoever the
 *     line names.
 *
 * The last two were unreachable when this module was written: the fence scanner
 * and the heading grammar lived in `apps/server`, which `apps/ui` cannot import
 * (sibling applications, not a dependency edge), and a hand-rolled copy of either
 * would be free to drift from the server in both bad directions — a lenient copy
 * re-opens exactly the toast this fixes, and a strict one refuses answers the
 * server would happily take, with nothing to appeal to. CONTRACT-044 moved the
 * scanner and the grammar into `@corpus/contract` precisely so this file could
 * stop being a paragraph explaining an absence. What stayed in `apps/server` is
 * `parseTurns` — turn *mutation* belongs to the sole writer — and nothing here
 * wants it: a composer asks whether a text contains a line that would become a
 * delimiter, not what the turns are.
 *
 * **What this module adds is attribution.** Each rule answers about the whole
 * record — enough to print, not enough to point at a control. So the fault is
 * *located* by asking the same rule again with every other free text blanked:
 * {@link formatFormAnswerBody} emits a heading for **every** field whether or not
 * it was answered, so blanking a neighbour's text removes nothing a delimiter
 * could hide behind, and a text that is still refused on its own is refused
 * because of itself. That is a use of the authority, not a paraphrase of it —
 * nothing here decides which lines are delimiters, only which control's text the
 * contract objected to.
 *
 * **The gate is the whole record, always.** A rule fires only when the contract
 * refuses the record the server would actually be handed; the per-source pass
 * runs afterwards and only decides *where* to say it. That ordering is what
 * keeps this from being stricter than the server — a fence opened in one field
 * and closed in another leaves the *record* with no open fence, so nothing is
 * marked, exactly as nothing would be refused.
 */

export interface AnswerFault {
  /**
   * The question whose own text is at fault, or `null` when no single field is.
   *
   * `null` is not a "could not tell": it is the honest answer for a record whose
   * refusal comes from something other than a `write` field's text — the note,
   * which is one control beside the fields rather than one of them, or an option
   * spelled like a delimiter on a form that reached disk without passing
   * `FormSchema` (`POST /api/threads` writes a first turn unchecked —
   * SERVER-070). Neither has a field to mark, so it is said about the form.
   */
  readonly question: string | null;
  /**
   * The sentence to render verbatim. It names the line to rewrite wherever a
   * line can be pointed at, which is the only thing a person can act on;
   * summarising it is how the line stops being identifiable.
   */
  readonly reason: string;
}

/**
 * One place a person's arbitrary text reaches the answer turn, and the record
 * that text alone would write.
 *
 * There are exactly two kinds — a `write` field and the note — because they are
 * the only values that are not the form's own strings. An option came from the
 * fence the agent wrote and `FormSchema` already keeps it off the answer prose's
 * line-space, so it is not a source; when an option is nonetheless at fault the
 * form-level fallback is what says so.
 */
interface TextSource {
  /** The field to mark, or `null` for the note, which is not one of the fields. */
  readonly question: string | null;
  /**
   * How a sentence about this text opens — the composer's half of the server's
   * `TurnTextSubject`, so a refusal reads as a sentence about a control rather
   * than about the request.
   */
  readonly subject: string;
  /**
   * The text **as it will be recorded**, which is the draft with its blank edge
   * lines dropped (`formAnswerRecords` trims). Every line number below is
   * counted in this string, deliberately: it is the one the contract is asked
   * about, so a reported line always exists in the bytes that were judged.
   */
  readonly recorded: string;
  /** The record this text alone would write, every other free text blanked. */
  readonly alone: FormAnswerRecord;
}

function textSources(record: FormAnswerRecord): readonly TextSource[] {
  const blanked = record.answers.map((entry) => ({ ...entry, text: null }));
  const sources: TextSource[] = [];

  record.answers.forEach((entry, index) => {
    // Only a `write` answer is free text.
    if (entry.text === null) return;
    sources.push({
      question: entry.question,
      subject: "this answer",
      recorded: entry.text,
      alone: {
        answers: blanked.map((other, at) => (at === index ? entry : other)),
        note: null,
      },
    });
  });

  if (record.note !== null) {
    sources.push({
      question: null,
      subject: "the note",
      recorded: record.note,
      alone: { answers: blanked, note: record.note },
    });
  }

  return sources;
}

/**
 * One reason an answer cannot be written, asked two ways.
 *
 * `whole` is the gate — the contract's verdict on the record the server would be
 * handed. `own` is the same verdict re-asked about one control in isolation, and
 * is only ever consulted once `whole` has already refused.
 */
interface Rule {
  readonly whole: (form: Form, record: FormAnswerRecord) => string | undefined;
  readonly own: (form: Form, source: TextSource) => string | undefined;
}

/**
 * The open-fence sentence, with or without a line to point at.
 *
 * The marker is quoted bare rather than wrapped in backticks — a backtick run
 * inside backticks renders as a longer run, and the one thing this sentence has
 * to get across unambiguously is how many characters the closing line needs. It
 * is the same choice `apps/server/src/threads/fences.ts` makes about the same
 * fact, for the same reason.
 */
function fenceReason(subject: string, marker: string, line: number | null): string {
  const where = line === null ? `a ${marker} fence` : `the ${marker} on line ${line}`;
  return (
    `${subject} leaves a code fence open: ${where} is never closed, so everything below it reads ` +
    "as code and every later turn in the thread would become invisible. Close it with a line " +
    `holding nothing but ${marker}.`
  );
}

/** The fence a record's turn would leave open, or `null` when every fence closes. */
const recordFence = (record: FormAnswerRecord): OpenFence | null =>
  unterminatedFence(formatFormAnswerBody(record));

const FENCE_RULE: Rule = {
  whole: (_form, record) => {
    const fence = recordFence(record);
    return fence === null ? undefined : fenceReason("this answer", fence.marker, null);
  },
  own: (_form, source) => {
    const isolated = recordFence(source.alone);
    if (isolated === null) return undefined;
    // The coordinate comes from the control's own text, which is the string the
    // person is looking at; the record's line number counts prose they never saw.
    const own = unterminatedFence(source.recorded);
    return fenceReason(source.subject, own?.marker ?? isolated.marker, own?.line ?? null);
  },
};

/**
 * The fabricated-heading sentence. The remedies are §6's own, and the list is
 * exhaustive on purpose: every way of writing the turn format down survives, so
 * a person being refused is being told to move the line rather than drop it.
 */
function headingReason(
  subject: string,
  author: TurnAuthor,
  located: { line: number; text: string } | null,
): string {
  const opening =
    located === null
      ? `${subject} contains a line that reads as a turn heading`
      : `line ${located.line} of ${subject} is \`${located.text}\`, which reads as a turn heading`;
  return (
    `${opening}: §6 makes \`## <author> ${TURN_SEPARATOR} <timestamp>\` a turn delimiter, so ` +
    `everything below it would be split off into a separate turn signed by ${author}. Reword ` +
    "that line, or quote it inside a code fence, an inline code span or a block quote, none of " +
    "which delimit anything."
  );
}

/** The first line of `text` starting at `offset`, which is the heading as written. */
const lineAt = (text: string, offset: number): string =>
  text.slice(offset).split(/\r?\n/, 1)[0] ?? "";

const HEADING_RULE: Rule = {
  whole: (_form, record) => {
    const heading = turnHeadings(formatFormAnswerBody(record))[0];
    return heading === undefined ? undefined : headingReason("this answer", heading.author, null);
  },
  own: (_form, source) => {
    const isolated = turnHeadings(formatFormAnswerBody(source.alone))[0];
    if (isolated === undefined) return undefined;
    const own = turnHeadings(source.recorded)[0];
    return headingReason(
      source.subject,
      own?.author ?? isolated.author,
      own === undefined ? null : { line: own.line, text: lineAt(source.recorded, own.start) },
    );
  },
};

const READ_BACK_RULE: Rule = {
  whole: (form, record) => unreadableAnswer(form, record),
  own: (form, source) => unreadableAnswer(form, source.alone),
};

/**
 * In the server's order (`assertAppendableAnswer` → `assertAppendableTurnText`),
 * and not arbitrarily.
 *
 * The fence goes first because an unterminated fence masks everything after it:
 * a heading below one is invisible to the heading rule, so reporting the fence
 * is reporting the fault that has to be fixed before the other can even be seen.
 * The read-back check goes last because an open fence or a fabricated heading
 * usually breaks it too, and "this answer cannot be read back" is the vaguest of
 * the three sentences — saying it over a fault with a line number attached would
 * bury the actionable message under the general one.
 */
const RULES: readonly Rule[] = [FENCE_RULE, HEADING_RULE, READ_BACK_RULE];

/**
 * Everything about this draft that would stop the answer being written, one
 * entry per control at fault (or a single form-level entry). Empty means the
 * contract accepts it, which is the gate `FormBlock` submits on.
 *
 * `formAnswerRecord` is the same composition the write path performs, note
 * trimming included, so what is checked here is the record the server would
 * check and not an approximation of it. Only the **first** failing rule is
 * reported, exactly as the server throws on the first: the three are ordered so
 * that the one reported is the one that has to be fixed first.
 */
export function answerFaults(form: Form, request: FormAnswerRequest): readonly AnswerFault[] {
  const record = formAnswerRecord(form, request);
  const sources = textSources(record);

  for (const rule of RULES) {
    const reason = rule.whole(form, record);
    if (reason === undefined) continue;
    const located = sources.flatMap<AnswerFault>((source) => {
      const own = rule.own(form, source);
      return own === undefined ? [] : [{ question: source.question, reason: own }];
    });
    return located.length > 0 ? located : [{ question: null, reason }];
  }

  return [];
}
