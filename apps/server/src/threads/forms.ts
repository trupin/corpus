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
// **The grammar is the contract's, and there is no third copy of it.** §6 gives
// three words of form syntax; `@corpus/contract`'s `schemas/form.ts` pins the
// rest — `FORM_FENCE_PATTERN` / `extractFormSource` for the fence, `FormSchema`
// for the fields, `validateFormAnswer` for the answer, `FormRespondPayloadSchema`
// for the event. Every one of them is imported here rather than reimplemented,
// because a server that decided for itself what `` ```form `` means would
// disagree with the UI that renders the controls (CONTRACT-007). The projection's
// `needs=form` detector (`docs/needs.ts`) is the same grammar expressed in SQL,
// which SQLite cannot express any other way; it is a *translation* of this one,
// and if the two are ever found to disagree that is a finding to file, not a
// reason to grow a third parser.
//
// **Which failure is which.** `400` is reserved for the one thing the static
// schema cannot check — an `option` this form does not offer — because that is a
// well-formed request naming an answer that exists nowhere. Everything else the
// route can refuse is "there is no such form here": no turn at `ts`, a turn that
// is not the agent's, a turn with no fence, a fence whose info string is not
// exactly `form`, a fence whose YAML is not a form. All of those are `404`, the
// status the route's own description assigns to "the thread has no such turn, or
// that turn carries no form". The route declares `201 / 400 / 401 / 404` and
// nothing else — in particular **no `423`**: sprint-006 Adjudication 1 settled
// that commenting is not editing, and answering a question the agent asked is
// commenting (`turns.ts`).

import type { Actor, Form, FormAnswerRequest, FormRespondPayload } from "@corpus/contract";
import {
  FORM_ANSWER_LABEL,
  FORM_RESPOND_EVENT_TYPE,
  FormSchema,
  extractFormSource,
  validateFormAnswer,
} from "@corpus/contract";
import * as YAML from "yaml";
import { formatInstant, nextTurnTs, normalizeInstant } from "../core/index.js";
import type { DocumentMutex } from "../docs/index.js";
import { badRequest, notFound } from "../errors.js";
import { NO_MENTIONS } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toThreadSummary, type LoadedThread } from "./read.js";
import { buildTurnAppend, commitTurnAppend, type TurnAppend } from "./turns.js";
import { EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

/**
 * The answer turn's lead-in, the contract's like the rest of the grammar: the
 * UI matches turn bodies against it to tell an answered form from an open one,
 * and it cannot import this module (CONTRACT-013). Re-exported so `threads/`'s
 * surface still names it for the callers that compose an answer.
 */
export { FORM_ANSWER_LABEL };

/** The turn body an answer writes: the chosen option, then any note (SPEC.md §6). */
export function formAnswerBody(answer: FormAnswerRequest): string {
  const chosen = `${FORM_ANSWER_LABEL} ${answer.option}`;
  return answer.note === undefined ? chosen : `${chosen}\n\n${answer.note}`;
}

/**
 * The auto-commit subject, a deliberate sibling of the turn path's
 * `comment: turn on <id> by <actor>`: same shape, different verb, so `git log`
 * distinguishes an answer from a reply without opening the diff.
 */
export const formCommitSubject = (threadId: string, actor: Actor): string =>
  `form: answer on ${threadId} by ${actor}`;

/**
 * The form the turn at `ts` carries, or the contract's `404`.
 *
 * Four separate ways to have no form, deliberately given one status and four
 * messages: the caller needs to know it cannot answer, and whoever reads the log
 * needs to know why. The author check is not incidental — §6 says a form is
 * something *an agent turn* carries, and `docs/needs.ts` keys `needs=form` on
 * `last_author = 'agent'`, so a user turn that happens to quote a form fence must
 * not become answerable here either.
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

  // The contract's parser, matched whole: ```formula and ```form-builder open
  // ordinary code blocks and are not forms.
  const source = extractFormSource(turn.body);
  if (source === undefined) throw notFound(`${where} carries no form`);

  const parsed = parseFormYaml(source);
  if (parsed === undefined) throw notFound(`the form in ${where} is not valid YAML`);

  const form = FormSchema.safeParse(parsed);
  if (!form.success) {
    const detail = form.error.issues[0]?.message ?? "unknown error";
    throw notFound(`the form in ${where} is not a valid form: ${detail}`);
  }
  return { form: form.data, ts: normalized };
}

/**
 * The fence's YAML as a plain value, or `undefined` when it does not parse. A
 * malformed fence is a `404` from {@link requireForm}, never a 500: the bytes
 * came off a file a person or an agent wrote, so bad YAML there is an ordinary
 * state of the world.
 */
function parseFormYaml(source: string): unknown {
  try {
    return YAML.parse(source) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `payload` of the `form.respond` event (SPEC.md §7).
 *
 * Typed as the contract's own `FormRespondPayload` so the compiler enforces the
 * pinned shape — in particular that `note` is **present and null** when no note
 * was given rather than omitted, which is the difference between a consumer
 * reading "no note" and reading "this server is older than the field".
 */
export function formRespondPayload(input: {
  readonly threadId: string;
  readonly formTs: string;
  readonly answer: FormAnswerRequest;
}): FormRespondPayload {
  return {
    threadId: input.threadId,
    formTs: input.formTs,
    option: input.answer.option,
    note: input.answer.note ?? null,
  };
}

/**
 * Answer a form: append the answer turn, then re-trigger the agent if §8 says
 * this turn re-triggers it.
 *
 * **The §8 decision is `decideParticipation`, not a rule written here.** The
 * form path calls it with the tri-state *omitted* and no parsed mentions, so it
 * lands on §8's automatic clause: an engaged, unresolved thread re-triggers on a
 * user's turn, and everything else does not. That is what makes the resolved
 * case (`eventId: null`, nothing enqueued) fall out of the same matrix the reply
 * path obeys instead of out of a second `if (status === "resolved")` that would
 * be free to drift from it. The consequences, stated because they are corners:
 *
 *   - **A resolved thread** answers `201`, writes the turn, and enqueues
 *     nothing. §8: resolving stops the automatic re-trigger, and the contract's
 *     own `eventId` description spells it out.
 *   - **A thread the agent is not `engaged` in** likewise enqueues nothing. A
 *     form-carrying agent turn normally leaves the thread `engaged` (the server
 *     moves `requested → engaged` on the agent's first turn), so this is the
 *     already-detached conversation, and waking the agent for it would contradict
 *     §8's opt-in premise as squarely as ignoring a resolved thread would.
 *   - **The agent answering its own form** does not re-trigger the agent, for
 *     the reason `participation.ts` gives: it would hand the agent its own reply
 *     to answer, forever.
 *
 * In every one of them the response's `eventId` is `null` *because* nothing was
 * enqueued — one decision, reported once.
 *
 * **Answering twice is allowed**, and appends a second turn with a second event.
 * §6 defines no once-only rule and turns are append-only, so a person who
 * changes their mind reaches the agent the same way they would by replying; the
 * alternative would need an "answered" marker in the turn format, which §6
 * explicitly does not have ("no form id, no per-option types, no required
 * markers"). It is also self-limiting: the first answer moves `last_author` to
 * `user`, so the thread leaves `needs=form` and the UI stops offering the
 * controls.
 */
export async function answerThreadForm(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  ts: string,
  answer: FormAnswerRequest,
): Promise<TurnAppend> {
  return mutex.run(id, async () => {
    const thread = loadThread(workspace, id);
    const { form, ts: formTs } = requireForm(thread, ts);

    // The contract's validator, not a membership test written here: the legal
    // values are whatever the agent wrote into the fence, so the wire's own
    // definition of a valid answer is the only one that can be right.
    const invalid = validateFormAnswer(form, answer);
    if (invalid !== undefined) throw badRequest(invalid.message, [...invalid.issues]);

    const decision = decideParticipation({
      requestsAgent: undefined,
      author: actor,
      parsed: NO_MENTIONS,
      thread: { agent: thread.agent, status: thread.status },
    });

    const prepared = buildTurnAppend(workspace, thread, {
      author: actor,
      text: formAnswerBody(answer),
      ts: nextTurnTs(thread.loaded.parsed.body, formatInstant(workspace.now())),
      agent: decision.agent,
    });

    // From here on the turn stays on disk, whatever fails after it.
    const result = await commitTurnAppend(
      workspace,
      thread,
      actor,
      prepared,
      formCommitSubject(id, actor),
    );

    const eventId = decision.enqueue
      ? (
          await workspace.enqueue({
            type: FORM_RESPOND_EVENT_TYPE,
            source: EVENT_SOURCE.thread,
            // `formTs` is the *answered* turn's stamp, never the answer's: the
            // form's identity is the turn carrying it (SPEC.md §6).
            payload: { ...formRespondPayload({ threadId: id, formTs, answer }) },
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
