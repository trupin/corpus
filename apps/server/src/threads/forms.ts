// `POST /api/threads/{id}/turns/{ts}/form` — answering the form an agent turn
// carries (SPEC.md §6, §7, §8).
//
// **An answer is a turn.** It goes through the same append the composer uses —
// same atomic write, same `updated`/`agent` frontmatter move, same auto-commit,
// same synchronous re-projection, same invalidation — via `turns.ts`'s
// {@link buildTurnAppend} and {@link commitTurnAppend}. Exactly two things are
// particular to this route: the event it enqueues (`form.respond`, never
// `comment.created`) and what its commit says.
//
// **The grammar is the contract's, and there is exactly one copy of it.** §6
// gives three words of form syntax; `@corpus/contract`'s `schemas/form.ts` pins
// the rest — `findFormFence` / `extractFormSource` for the fence,
// `FormSchema` for the fields, `validateFormAnswer` for the answer,
// `FormRespondPayloadSchema` for the event. A server that decided for itself
// what `` ```form `` means would disagree with the UI that renders the controls
// (CONTRACT-007). This route reaches all of it through `core/form.ts`'s
// {@link readForm}, and so does the projection, whose `needs=form` reads the
// answer off a `turns.has_form` column rather than re-deriving it in SQL. The
// SQL translation that used to stand there disagreed with this route in both
// directions — the finding `forms.ts` said to file, filed and fixed as
// SERVER-029.
//
// **Which failure is which.** `400` is reserved for the things the static schema
// cannot check — an answer that does not fit *this* form (an option no field
// offers, a question the form does not ask, a required field left blank), and an
// answer whose text would not survive being appended as a turn (below).
// Everything else the route can refuse is "there is no such form here": no turn
// at `ts`, a turn that is not the agent's, a turn with no fence, a fence whose
// info string is not exactly `form`, a fence whose YAML is not a form. All of
// those are `404`, the status the route's own description assigns to "the thread
// has no such turn, or that turn carries no form". Two more, each with §6 behind
// it: `403` when the actor is the **agent** — "only the person answers a form:
// the agent never answers a form, including its own" — and `409` when this form
// is **already answered**, because a form is answered once, as a whole, and
// changing your mind is an ordinary reply. The route declares
// `201 / 400 / 401 / 403 / 404 / 409` and nothing else — in particular **no
// `423`**: sprint-006 Adjudication 1 settled that commenting is not editing, and
// answering a question the agent asked is commenting (`turns.ts`).
//
// **The prose is a contract artefact, and this module does not spell it.** The
// answer turn is the only durable record of what was answered — the
// `form.respond` payload is reaped with its event — and §11 requires an answered
// form to render each question beside what was given for it after a reload. So
// the format and its reader are a **pair**, and the pair lives in
// `@corpus/contract` (`formatFormAnswerBody` / `parseFormAnswerBody`), where the
// UI can reach it: `apps/ui` cannot import `apps/server`, and a second spelling
// of the reader would be a second definition of what was answered
// (orchestrator decision 2026-08-07).

import type { Actor, Form, FormAnswerRequest, FormRespondPayload } from "@corpus/contract";
import {
  FORM_ANSWER_LABEL,
  FORM_RESPOND_EVENT_TYPE,
  formAnswerRecord,
  formatFormAnswerBody,
  unreadableAnswer,
  validateFormAnswer,
} from "@corpus/contract";
import {
  formatInstant,
  isFormAnswered,
  nextTurnTs,
  normalizeInstant,
  parseTurns,
  readForm,
} from "../core/index.js";
import type { DocumentMutex } from "../docs/index.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { ANSWER_SUBJECT, assertClosedFences } from "./fences.js";
import { NO_MENTIONS } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toThreadSummary, type LoadedThread } from "./read.js";
import { buildTurnAppend, commitTurnAppend, turnCommitSubject, type TurnAppend } from "./turns.js";
import { EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

/**
 * The answer turn's lead-in, the contract's like the rest of the grammar: the
 * UI matches turn bodies against it to tell an answered form from an open one,
 * and it cannot import this module (CONTRACT-013). Re-exported so `threads/`'s
 * surface still names it for the callers that compose an answer.
 */
export { FORM_ANSWER_LABEL };

/**
 * The turn body an answer writes: every field the form asked, in the form's
 * order, each named with what was given for it and blanks said out loud, then
 * any note (SPEC.md §6).
 *
 * It takes the **form** as well as the answer because the answer alone cannot
 * produce this text — a field left blank has no entry in `answers` at all — and
 * "they declined" and "it was never asked" must never be the same bytes. The
 * bytes themselves are the contract's ({@link formatFormAnswerBody}); this
 * function exists so the composition with {@link formAnswerRecord} is written
 * once, on the path that writes the file.
 */
export function formAnswerBody(form: Form, answer: FormAnswerRequest): string {
  return formatFormAnswerBody(formAnswerRecord(form, answer));
}

/**
 * A synthetic turn heading, used only to ask what the append will really do with
 * these bytes. The stamp is irrelevant — nothing is written with it.
 */
const PROBE_HEADING = "## user · 2000-01-01T00:00:00Z\n";

/**
 * Refuse an answer whose own text would not survive being appended as **one**
 * turn, or would not read back as the answer it records (SPEC.md §6, §11, §14;
 * SERVER-066; PR #28 finding 2).
 *
 * A `write` answer and the note are the two places a person's arbitrary text
 * reaches this file, and it can hijack **three** delimiters, not two. Two belong
 * to the thread: §6's `## <author> · <ts>` heading, which *is* the turn
 * delimiter, and a fenced block, inside which `core/code.ts` masks headings —
 * so an unterminated fence silently swallows every turn written after it. Either
 * one destroys turns rather than merely rendering oddly, which is why this is a
 * refusal and not a warning: the alternative postures are worse in both
 * directions. Rewriting the person's words to make them safe would record an
 * answer they did not give, and letting the bytes through would make the corpus
 * lose a conversation because somebody pasted a code sample into a text field.
 *
 * The third belongs to the answer prose itself: a line spelled exactly like one
 * of this form's bold question headings, or like `**Note:**`, splits the record
 * in the wrong place — the answer truncates there and the rest lands under the
 * wrong question, while the *parse still succeeds*, so nothing later flags it.
 * That failure has the same shape as the other two (content imitating a
 * delimiter) and the same remedy, so it is refused in the same place rather
 * than left to nobody: the contract owns the format and therefore owns the
 * question, and {@link unreadableAnswer} answers it by performing the round
 * trip on the exact record about to be written.
 *
 * The first two questions are asked of the *rendered* body rather than of the
 * request, because that is the string that lands on disk — the prose format is
 * the contract's and may grow, and a check written against the request would
 * stop covering it the moment it does. The probe heading is thrown away; it
 * exists only so `parseTurns` sees the same shape the append will produce.
 */
export function assertAppendableAnswer(body: string, form: Form, answer: FormAnswerRequest): void {
  // The fence half is `fences.ts`'s, shared with the reply, create and capture
  // doors (SERVER-075). It used to be spelled out here, which is why for a long
  // while the *answer* route was the only one that asked — and why the message
  // now names the line the fence opened on, which the local copy discarded.
  assertClosedFences(body, ANSWER_SUBJECT);
  if (parseTurns(`${PROBE_HEADING}${body}`).length !== 1) {
    throw badRequest(
      "this answer contains a line that reads as a turn heading (`## user · <timestamp>`), which " +
        "would split it into several turns; rewrite that line",
      [{ path: "body", message: "the answer would fabricate a turn heading" }],
    );
  }
  const unreadable = unreadableAnswer(form, formAnswerRecord(form, answer));
  if (unreadable !== undefined) {
    throw badRequest(unreadable, [
      { path: "body", message: "the answer turn would not read back as this answer" },
    ]);
  }
}

/**
 * The auto-commit subject, a deliberate sibling of the turn path's
 * `comment: turn on <id> by <actor>`: same shape, different verb, so `git log`
 * distinguishes an answer from a reply without opening the diff. Built by the
 * turn path's own {@link turnCommitSubject} so the two cannot disagree about
 * the shape — or about §8's `(reopened)` marker, which an answer earns on
 * exactly the same terms a reply does.
 */
export const formCommitSubject = (threadId: string, actor: Actor, reopened = false): string =>
  turnCommitSubject({ act: "form: answer", threadId, actor, reopened });

/**
 * Refuse an **agent** turn whose ```` ```form ```` fence does not parse against
 * §6's grammar, before it reaches disk (SPEC.md §6; CONTRACT-038).
 *
 * §6 says forms are "written only through the server's thread endpoints", which
 * is what makes this the **agent's** first line of defence rather than a second
 * one: two fields asking the same question, a `choose one` listing a duplicate
 * option, a fourth kind however spelled, a question or option carrying a
 * newline, an option spelled like one of the answer prose's delimiters,
 * unreadable YAML — the agent learns at write time instead of the person
 * discovering it when they try to answer.
 *
 * It is not, and cannot be, a guarantee that no unreadable fence is on disk:
 * this route is not the only door (`POST /api/threads` writes a first turn
 * without this check — SERVER-070), and a turn from any other actor is
 * deliberately not checked (below). That is why §11's rule — an unreadable form
 * renders as the visibly broken code block it is, never as a partial set of
 * controls — is load-bearing rather than decorative, and why the grammar refuses
 * a form that could not be answered rather than leaving it to the answer route:
 * a fence that does not parse is inert in every consumer at once, whichever door
 * it came through.
 *
 * **Agent turns only.** §6 makes a form something an agent turn carries, so a
 * person quoting a form fence in a reply is quoting, not asking — the same
 * reason `requireForm` and `docs/needs.ts` both check the author. Refusing there
 * would refuse a person's ordinary code block for looking like a question.
 */
export function assertWritableForm(actor: Actor, text: string | undefined): void {
  if (actor !== "agent" || text === undefined) return;
  const reading = readForm(text);
  if (reading.ok || reading.reason === "no-fence") return;
  const detail = reading.detail ?? "unknown error";
  throw badRequest(
    reading.reason === "not-yaml"
      ? `the \`form\` block in this turn is not valid YAML: ${detail}`
      : `the \`form\` block in this turn is not a valid form: ${detail}`,
    [{ path: "body", message: detail }],
  );
}

/**
 * The form the turn at `ts` carries, or the contract's `404`.
 *
 * Four separate ways to have no form, deliberately given one status and four
 * messages: the caller needs to know it cannot answer, and whoever reads the log
 * needs to know why. The author check is not incidental — §6 says a form is
 * something *an agent turn* carries, and `docs/needs.ts` asks the same of the
 * turn it counts (`tu.author = 'agent'`), so a user turn that happens to quote a
 * form fence must not become answerable here either.
 */
export function requireForm(
  thread: LoadedThread,
  ts: string,
): { readonly form: Form; readonly ts: string } {
  const normalized = normalizeInstant(ts);
  const turn =
    normalized === null ? undefined : thread.turns.find((candidate) => candidate.ts === normalized);
  if (turn === undefined || normalized === null) {
    throw notFound(`no turn at ${ts} in thread ${thread.id}`);
  }
  const where = `the turn at ${normalized} in thread ${thread.id}`;
  if (turn.author !== "agent") throw notFound(`${where} is not an agent turn and carries no form`);

  // `core/form.ts`, which is also what the projection stored in `turns.has_form`
  // — so a turn this route refuses is a turn `needs=form` never advertised, and
  // vice versa (SERVER-029). ```formula and ```form-builder open ordinary code
  // blocks and land on `no-fence` here, because the info string is matched whole.
  const reading = readForm(turn.body);
  if (reading.ok) return { form: reading.form, ts: normalized };

  const detail = reading.detail ?? "unknown error";
  throw notFound(
    reading.reason === "no-fence"
      ? `${where} carries no form`
      : reading.reason === "not-yaml"
        ? `the form in ${where} is not valid YAML`
        : `the form in ${where} is not a valid form: ${detail}`,
  );
}

/**
 * The `payload` of the `form.respond` event (SPEC.md §7).
 *
 * Typed as the contract's own `FormRespondPayload` so the compiler enforces the
 * pinned shape — in particular that `note` is **present and null** when no note
 * was given rather than omitted, which is the difference between a consumer
 * reading "no note" and reading "this server is older than the field".
 *
 * `answers` is one entry per field **of the form**, in the form's order, not one
 * per field answered: a blank field is present with every value key null, so the
 * agent never has to guess whether a question went unanswered or unasked. It is
 * built by the contract's {@link formAnswerRecord} — the same call that feeds
 * the prose, down to the note's whitespace — so the event and the turn cannot
 * disagree about what was given.
 */
export function formRespondPayload(input: {
  readonly threadId: string;
  readonly formTs: string;
  readonly form: Form;
  readonly answer: FormAnswerRequest;
}): FormRespondPayload {
  const record = formAnswerRecord(input.form, input.answer);
  return {
    threadId: input.threadId,
    formTs: input.formTs,
    answers: [...record.answers],
    note: record.note,
  };
}

/**
 * Answer a form: append the answer turn, then re-trigger the agent if §8 says
 * this turn re-triggers it.
 *
 * **The §8 decision is `decideParticipation`, not a rule written here.** The
 * form path calls it with the tri-state *omitted* and no parsed mentions, so it
 * lands on §8's automatic clause: an engaged, unresolved thread re-triggers on a
 * user's turn, and everything else does not. That is what makes every corner
 * below fall out of the same matrix the reply path obeys instead of out of a
 * second `if (status === "resolved")` that would be free to drift from it. The
 * consequences, stated because they are corners:
 *
 *   - **A resolved thread** is *reopened* by the answer, which then re-triggers
 *     on §8's ordinary terms — an answer is a turn a person wrote, and §8's
 *     reopen names no exception for the shape of the turn (SHARED-019
 *     Amendment 1, and SERVER-062, which is where the claim that a resolved
 *     thread stays silent was falsified).
 *   - **A thread the agent is not `engaged` in** enqueues nothing. A
 *     form-carrying agent turn normally leaves the thread `engaged` (the server
 *     moves `requested → engaged` on the agent's first turn), so this is the
 *     already-detached conversation, and waking the agent for it would contradict
 *     §8's opt-in premise as squarely as ignoring a resolved thread would. Since
 *     only the person answers, it is now the **only** case in which nothing is
 *     enqueued, and therefore the only way `eventId` is null.
 *
 * The agent-author row of §8's matrix is unreachable from here (see the refusal
 * below) and is not restated: `decideParticipation` still owns it, for the reply
 * path, and duplicating it here is how the two would come to disagree.
 *
 * **Only the person answers a form** (SPEC.md §6). An agent actor is refused
 * with `403`, on its own form and on any other, following §9.2's user-only
 * precedent (deletion) exactly rather than inventing a third posture: a signal
 * the agent can clear for you is not a signal, and an agent handed an opaque
 * error retries. It is a refusal, not a silent no-op, so the message says why.
 *
 * **A form is answered once, as a whole** (SPEC.md §6, §11). A second answer is
 * a `409` — the request is well formed and the state refuses it, so retrying
 * with a different body will not help. What already happened is not undone:
 * turns are append-only, and "changing your mind is an ordinary reply, not a
 * second answer to the same question", so the reply route is where that goes.
 * Whether this form is answered is {@link isFormAnswered}, i.e.
 * `readThreadForms` — the same reading `needs=form` projects — so the form this
 * refuses is exactly the form the board has stopped asking about.
 */
export async function answerThreadForm(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  ts: string,
  answer: FormAnswerRequest,
): Promise<TurnAppend> {
  // Before the lane: who is asking is not a question about the file, and an
  // agent that is refused should not first queue behind somebody's save.
  if (actor === "agent") {
    throw forbidden(
      "answering a form is user-only: the agent never answers a form, including its own " +
        "(SPEC.md §6). Reply on the thread instead.",
    );
  }

  return mutex.run(id, async () => {
    const thread = loadThread(workspace, id);
    const { form, ts: formTs } = requireForm(thread, ts);

    if (isFormAnswered(thread.turns, formTs)) {
      throw conflict(
        `the form in the turn at ${formTs} in thread ${thread.id} is already answered; a form is ` +
          "answered once, and changing your mind is an ordinary reply",
      );
    }

    // The contract's validator, not a membership test written here: the legal
    // values are whatever the agent wrote into the fence, so the wire's own
    // definition of a valid answer is the only one that can be right.
    const invalid = validateFormAnswer(form, answer);
    if (invalid !== undefined) throw badRequest(invalid.message, [...invalid.issues]);

    const text = formAnswerBody(form, answer);
    assertAppendableAnswer(text, form, answer);

    const decision = decideParticipation({
      requestsAgent: undefined,
      author: actor,
      parsed: NO_MENTIONS,
      thread: { agent: thread.agent, status: thread.status },
    });

    const prepared = buildTurnAppend(workspace, thread, {
      author: actor,
      text,
      ts: nextTurnTs(thread.loaded.parsed.body, formatInstant(workspace.now())),
      agent: decision.agent,
      status: decision.status,
    });

    // From here on the turn stays on disk, whatever fails after it.
    const result = await commitTurnAppend(
      workspace,
      thread,
      actor,
      prepared,
      formCommitSubject(id, actor, decision.status !== thread.status),
    );

    const eventId = decision.enqueue
      ? (
          await workspace.enqueue({
            type: FORM_RESPOND_EVENT_TYPE,
            source: EVENT_SOURCE.thread,
            // `formTs` is the *answered* turn's stamp, never the answer's: the
            // form's identity is the turn carrying it (SPEC.md §6).
            payload: { ...formRespondPayload({ threadId: id, formTs, form, answer }) },
          })
        ).id
      : null;

    return {
      thread: toThreadSummary(loadThread(workspace, id)),
      turn: prepared.appended.turn,
      eventId,
      result,
    };
  });
}
