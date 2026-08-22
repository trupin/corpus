// Reading the ```` ```form ```` fence a turn body may carry (SPEC.md §6).
//
// **One reader, because three surfaces have to answer identically about the
// same bytes.** `POST …/turns/{ts}/form` decides whether an answer is
// acceptable; the projection's `needs=form` decides whether Attention says
// "awaiting your answer"; the UI decides whether to draw the controls. Before
// SERVER-029 the first two disagreed in three ways at once — the projection
// matched the fence with a SQL substring search while the route matched it with
// the contract's regex — and every disagreement was a stuck row:
//
//   - an **unterminated** fence: listed by `needs=form`, `404` from the route;
//   - a **trailing-space info string** (`` ```form␠␠ ``): answerable by the
//     route, never listed, so nobody was ever told to answer it;
//   - a fence whose **YAML is not a form**: listed, `404` from the route.
//
// Their common cause was having two definitions of "carries a form", so the fix
// is to have one. The grammar itself stays the contract's — `extractFormSource`
// / `findFormFence` for the fence, `FormSchema` for the fields — because
// the UI depends on it too and cannot import this module (CONTRACT-013). What
// lives here is only the *composition* of the contract's parser with a YAML
// parse, which the contract cannot do (it carries no YAML dependency).
//
// The projection consumes this through a `turns.has_form` column rather than
// through SQL of its own: SQLite can express neither the fence scan nor the
// YAML, and a second translation of the grammar is exactly what went wrong.
// CONTRACT-014 settled the grammar (a CommonMark subset — the settlement and
// its three restrictions are documented in the contract's `schemas/form.ts`);
// the change reached every consumer here with no code change beyond the
// `SCHEMA_VERSION` bump that recomputed `has_form` under the settled rules.

import type { Form } from "@corpus/contract";
import {
  FormSchema,
  describeFormFailure,
  extractFormSource,
  isFormAnswerBody,
  parseFormAnswerBody,
} from "@corpus/contract";
import * as YAML from "yaml";

/**
 * Why a turn body does not carry a form. Kept as distinct reasons because the
 * answer route reports each with its own message: the caller needs to know it
 * cannot answer, and whoever reads the log needs to know why.
 */
export type NoFormReason =
  /** No opening fence whose info string is exactly `form` (```` ```formula ```` is not one). */
  | "no-fence"
  /** A fence, whose contents are not YAML. */
  | "not-yaml"
  /** Valid YAML that is not a prompt plus options. */
  | "not-a-form";

export type FormReading =
  | { readonly ok: true; readonly form: Form }
  | { readonly ok: false; readonly reason: NoFormReason; readonly detail: string | null };

/**
 * The form a turn body carries, or why it carries none.
 *
 * A malformed fence is never an exception: the bytes came off a file a person or
 * an agent wrote, so bad YAML there is an ordinary state of the world — the
 * route degrades it to a `404`, the UI to a code block with a warning, and the
 * projection to "not awaiting an answer".
 */
export function readForm(body: string): FormReading {
  const source = extractFormSource(body);
  if (source === undefined) return { ok: false, reason: "no-fence", detail: null };

  let value: unknown;
  try {
    value = YAML.parse(source) ?? undefined;
  } catch (error) {
    return {
      ok: false,
      reason: "not-yaml",
      detail: error instanceof Error ? error.message : null,
    };
  }

  const parsed = FormSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "not-a-form",
      // The one sentence a malformed form is reported with — the route's `404`
      // detail and the write path's `400`. It is the contract's
      // `describeFormFailure` rather than a reader of its own, because the board
      // shows the *same* sentence for the same bytes (PR #28 finding 6).
      detail: describeFormFailure(parsed.error),
    };
  }
  return { ok: true, form: parsed.data };
}

/** What {@link readThreadForms} needs of a turn; the parsed thread's turns satisfy it. */
export interface FormTurn {
  readonly author: string;
  readonly ts: string;
  readonly body: string;
}

export type TurnFormState = {
  /** Whether the turn carries an answerable form, whoever wrote it. */
  readonly hasForm: boolean;
  /**
   * For an **agent** turn carrying a form: whether a later turn answered it.
   * `null` for every other turn — a form is something an agent turn carries
   * (SPEC.md §6), so nothing else has an answered state at all.
   */
  readonly answered: boolean | null;
};

/**
 * Which of a thread's forms have been answered, one state per turn, in turn
 * order (SPEC.md §6; SERVER-032).
 *
 * **Why per form and not per thread.** §6: "A form has no identity of its own:
 * it is identified by the timestamp of the turn carrying it, so a turn carries
 * at most one form, and answering a form addresses the turn that carries it."
 * A thread may therefore hold several forms, each independently answerable —
 * which is what `POST /api/threads/{id}/turns/{ts}/form` already encodes and
 * what the renderer already draws. `needs=form` used to ask a thread-level
 * question instead ("is the *last* turn an agent turn carrying a form?"), so
 * answering any one form moved `last_author` to `user` and dropped the whole
 * thread out of Attention while its other forms were still live.
 *
 * **Attribution is by content, because the answer now names its questions**
 * (SERVER-068). §6 requires the answer turn to name, for every field the form
 * asked, the question and what was given for it — so a thread read off disk
 * pairs an answer with a form by asking the contract's own reader,
 * `parseFormAnswerBody(body, form)`, whether that body is an answer to *that*
 * form. It is, exactly when it names that form's questions and each block fits
 * its field's kind. The **earliest still-open** form that accepts it wins, which
 * matters only where two of them would accept the same body.
 *
 * That replaced an order rule over a single option string, whose failure was
 * routine rather than exotic: an answer closed the earliest open form *offering
 * that option*, so two forms sharing an option string were a coin toss. The
 * pairing is now wrong only for two open forms in one thread asking a
 * **literally identical** question — and multi-field forms make several open
 * forms rarer, because the reason to open a second one is now a field.
 *
 * **The short spelling is still an answer.** `**Answered:** Yes` is what every
 * form answered before SERVER-068 says, and those turns are on disk: the
 * contract's reader pairs one with a form that is a single required choose-one
 * field offering exactly that option — the only shape that spelling was ever
 * written for — so no historical thread changes meaning and nothing on disk is
 * rewritten. An answer naming an option no open form offers belongs to none of
 * them and is left alone; it is an ordinary turn that happens to start with the
 * label.
 *
 * **Why the residual is not closed here.** The exact attribution exists but is
 * not reachable from this module: the answer *route* knows which form it
 * addressed — the `:ts` in `POST /api/threads/{id}/turns/{ts}/form` is the
 * form's identity (§6) — and does not write it down, because §6 gives the prose
 * no identifier to write it with ("no form id, no per-option types, no required
 * markers"). Recovering it means changing SPEC §6's turn grammar, the contract's
 * format and the renderer's reader at once, and every column the projection
 * stores must stay rebuildable from the file alone. Accepted rather than
 * improvised (SHARED-021 Q7); until §6 revises, this is the rule *both* sides
 * apply, so the badge and the controls agree even where both of them are
 * guessing.
 *
 * **A turn that both answers a form and carries one counts as both** (wave-3
 * audit FIX 10). The server never writes such a turn — the answer route writes
 * the label and the note, nothing else — so it only ever comes off a
 * hand-edited file, and until this fix it was the one shape whose form the
 * server would *accept an answer for and never mention*: the turn closed the
 * earlier form and returned, leaving its own state at `answered: null`, which
 * is the value meaning "nothing to answer here". `POST …/turns/{ts}/form`
 * disagreed — it asks only whether an agent turn's body parses as a form
 * (`threads/forms.ts`'s `requireForm`) — so the form was answerable while
 * `needs=form` said the thread was waiting on nobody. Having one reader exists
 * precisely to stop that, so the turn now does both jobs in order: it closes
 * the earliest open form its body answers, then opens its own.
 *
 * The alternative — `answered: false` without opening it — advertises the form
 * but makes it unclearable, because no later answer could ever be paired with a
 * form that was never open. §10's reasons must have an action that clears them
 * (SERVER-022 finding 3), so that one was rejected.
 *
 * The renderer's `mapFormAnswers` (`apps/ui/src/thread/parseFormBlock.ts`) read
 * this shape differently until UI-021: it `continue`d past its own registration
 * on such a turn, so the form stayed live forever — after answering it the board
 * went quiet and the controls stayed. It now falls through and registers, which
 * is the clearable behaviour of the two, so the badge and the controls agree
 * here as they do everywhere else. The test below pins the agreement rather than
 * the divergence.
 */
export function readThreadForms(turns: readonly FormTurn[]): readonly TurnFormState[] {
  const states: TurnFormState[] = [];
  const open: { readonly index: number; readonly form: Form }[] = [];

  turns.forEach((turn, index) => {
    const reading = readForm(turn.body);
    states.push({ hasForm: reading.ok, answered: null });

    // `isFormAnswerBody` first so an ordinary turn costs one `startsWith`
    // rather than one parse attempt per open form.
    if (isFormAnswerBody(turn.body)) {
      const at = open.findIndex(
        (candidate) => parseFormAnswerBody(turn.body, candidate.form) !== undefined,
      );
      if (at !== -1) {
        const [closed] = open.splice(at, 1);
        if (closed !== undefined) states[closed.index] = { hasForm: true, answered: true };
      }
    }

    // Never its own answer: the turn's form is opened *after* the answer above
    // has already chosen among the forms that were open before this turn.
    if (turn.author !== "agent" || !reading.ok) return;
    states[index] = { hasForm: true, answered: false };
    open.push({ index, form: reading.form });
  });

  return states;
}

/**
 * Whether the form the turn at `formTs` carries has already been answered — the
 * `409` the answer route owes §6's "a form is answered once, as a whole".
 *
 * It asks {@link readThreadForms} rather than counting labels, so the route and
 * `needs=form` agree by construction: the form this refuses a second answer for
 * is exactly the form the board has stopped asking about.
 */
export function isFormAnswered(turns: readonly FormTurn[], formTs: string): boolean {
  const states = readThreadForms(turns);
  const at = turns.findIndex((turn) => turn.ts === formTs);
  return at !== -1 && states[at]?.answered === true;
}
