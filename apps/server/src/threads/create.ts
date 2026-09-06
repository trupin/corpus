// `POST /api/threads` — the three creation modes (SPEC.md §6).
//
//   - **anchored**       `parent` + `selector`: the anchor entry is written into
//     the parent's frontmatter and the thread file is created **atomically**.
//   - **whole-document** `parent`, no selector: one file, no anchor.
//   - **standalone**     no `parent`: the composer's Ask. Neither parent nor
//     anchor; the conversation *is* the document.
//
// **Atomicity is the whole point of the anchored mode.** Two files change and §6
// forbids the intermediate state ("no highlight is ever left pointing at an
// empty conversation" — and its mirror, no anchor entry naming a thread that was
// never written). Both writes are one {@link MutationPlan}, so `runMutation`
// rolls the parent back if the thread file fails, and one auto-commit stages
// both paths. The parent is written **first** deliberately: it is the write that
// can be undone, and undoing it is what the undo stack below exists for.
//
// **Resolution is not a write-time gate.** A selector whose text is absent from
// the parent still creates the thread — §6 resolves anchors at projection/render
// time and calls an unresolvable one *orphaned*, which is a normal state of a
// living corpus, not a rejected request. The one refusal that looks like a gate
// and is not is *ambiguity*: a quote the parent contains more than once names no
// single passage, so there is nothing to be right or wrong about later. See
// `anchor-context.ts`, which also explains why the stored `prefix`/`suffix` are
// read off the parent rather than taken from the request.

import {
  isMultipartThreadCreate,
  type Actor,
  type CreateThreadBody,
  type CreateThreadRequest,
  type TextQuoteSelector,
  type Lane,
  type Thread,
  type Resident,
} from "@corpus/contract";
import { stampedOrigin } from "../docs/create.js";
import {
  DEFAULT_ATTACHMENT_LIMITS,
  assertWithinLimits,
  attachmentReferences,
  withAttachmentReferences,
} from "../attachments/index.js";
import {
  ID_PREFIXES,
  appendTurn,
  emptyDocument,
  formatInstant,
  newId,
  serializeDocument,
  setFrontmatterFields,
  withAnchorEntry,
  anchorEntries,
  THREADS_ROOT,
  TURN_MODELS_FRONTMATTER_KEY,
} from "../core/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import {
  CREATE_LANE,
  isIdTaken,
  loadDocument,
  runInLanes,
  runMutation,
  validateBeforeWrite,
  validationError,
  type DocumentMutex,
  type FileOperation,
  type LoadedDocument,
  type MutationResult,
} from "../docs/index.js";
import { contextualizeSelector } from "./anchor-context.js";
import { enqueueComment } from "./events.js";
import { residentToStored } from "../core/resident.js";
import { residentDesignatedPayload, residentFor, RESIDENT_DESIGNATED } from "./resident.js";
import { TURN_SUBJECT, assertAppendableTurnText } from "./fences.js";
import { assertWritableForm } from "./forms.js";
import { parseMentions } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toWireThread } from "./read.js";
import { deriveThreadTitle } from "./title.js";
import { assertModelNamesAnAgentTurn, storeTurnFiles, whileUnreferenced } from "./turns.js";
import { EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

/**
 * A creation request, whichever of the route's two media types it arrived as —
 * the exact mirror of {@link TurnInput} for turn append.
 *
 * `text` is optional because a first turn may be attachment-only (SPEC.md §6);
 * the JSON branch's `body` is mandatory, so it simply always fills it. Keeping
 * the two forms behind one shape is what makes "the multipart branch does
 * everything the JSON branch does" a fact about the code rather than a claim:
 * there is one creation path below this type.
 */
export interface ThreadCreateInput {
  readonly parent: string | null;
  readonly selector: CreateThreadRequest["selector"];
  readonly title: string | undefined;
  /** Absent for an attachment-only first turn. */
  readonly text: string | undefined;
  /** The §8 tri-state, exactly as it arrived; `undefined` means *omitted*. */
  readonly requestsAgent: boolean | undefined;
  /** The model that wrote the first turn (SPEC.md §10); `undefined` when unstated. */
  readonly model: string | undefined;
  /**
   * The weight the request states its work should be done at (SPEC.md §7);
   * `undefined` when it states none, which means the orchestrator decides.
   * Carried to the queue event and interpreted nowhere — see `events.ts`.
   */
  readonly weight: string | undefined;
  /**
   * The queue event this creation is doing the work of (SPEC.md §9.2);
   * `undefined` when the caller names none. Resolved to the thread that work
   * came from and stamped as this thread's `origin`, which is how a subthread
   * the agent opens while working joins the scope it came from (§7).
   */
  readonly job: string | undefined;
  /**
   * The lane this message is addressed to (SPEC.md §7); `undefined` when it
   * names none, which is the ordinary case and means the lane follows from
   * where the thread was created. Routes **this message and nothing else**: a
   * thread created with a recipient is not thereby put in that agent's scope.
   */
  readonly recipient: Lane | undefined;
  /**
   * Who will **own** this conversation (SPEC.md §7's rider A, signed
   * 2026-08-25) — three states, and they are not the two {@link recipient} has.
   *
   * - **`undefined`** — the rider's default: a **general resident**. A
   *   conversation is a thing an agent owns, so owning it is what happens when
   *   nobody chose.
   * - **`null`** — explicitly **no resident**, which is what every thread was
   *   before the rider.
   * - **an object** — that profile, resolved exactly as the designate route
   *   resolves it.
   *
   * `undefined` and `null` mean different things here and nowhere else on this
   * input, which is why the contract says so in its own published description.
   *
   * **This is not `recipient`.** A recipient routes one message and rewires
   * nothing; a designation hands over the conversation and everything that
   * grows out of it. Both may ride one request.
   */
  readonly resident: CreateThreadRequest["resident"];
  readonly files: readonly File[];
}

/**
 * The request either media type carries. Both read `requestsAgent` the same way
 * — the JSON form as a boolean, the multipart form through `z.stringbool` — and
 * neither through a `??` that would turn "note only" into "omitted". `weight`
 * is read the same way in both for the same reason, and with no `??` either: a
 * default there would be the fixed tier §7's rider exists to prevent.
 */
export function threadRequestBody(body: CreateThreadBody): ThreadCreateInput {
  if (!isMultipartThreadCreate(body)) {
    return {
      parent: body.parent ?? null,
      selector: body.selector,
      title: body.title,
      text: body.body,
      requestsAgent: body.requestsAgent,
      model: body.model,
      weight: body.weight,
      job: body.job,
      recipient: body.recipient,
      resident: body.resident,
      files: [],
    };
  }
  return {
    parent: body.parent ?? null,
    selector: body.selector,
    title: body.title,
    text: body.text,
    requestsAgent: body.requestsAgent,
    model: body.model,
    weight: body.weight,
    job: body.job,
    recipient: body.recipient,
    resident: body.resident,
    files: body.files,
  };
}

export interface ThreadCreation {
  readonly thread: Thread;
  /** The anchor written into the parent, or `null` for the two unanchored modes. */
  readonly anchorId: string | null;
  readonly eventId: string | null;
  readonly result: MutationResult;
}

/**
 * The request's selector, shaped for the write path: `exact` **verbatim**, with
 * absent context as the empty string the contract documents. Nothing is trimmed
 * or normalised — the quote is matched against the file character for
 * character, so "tidying" it here is how an anchor stops resolving.
 *
 * The context that arrives here is only ever used to disambiguate a repeated
 * quote; what is *stored* is read off the parent's bytes by
 * {@link contextualizeSelector}, inside the lane, against the copy of the file
 * this write is about to rewrite.
 *
 * A blank `exact` is refused: it names no text, so it can never resolve and no
 * later edit can make it resolve — an anchor that is orphaned by construction.
 */
export function normalizeSelector(
  selector: CreateThreadRequest["selector"],
  parent: string | null,
): TextQuoteSelector | null {
  if (selector === undefined || selector === null) return null;
  if (selector.exact.trim() === "") {
    validationError("an anchor needs the text it quotes", [
      { path: "selector.exact", message: "must contain at least one non-whitespace character" },
    ]);
  }
  // A selection with no document to anchor it to cannot be honoured. Silently
  // dropping it would answer 201 with `anchorId: null` and lose the user's
  // selection without saying so.
  if (parent === null) {
    validationError("a selector needs a parent document to anchor to", [
      { path: "selector", message: "selector requires `parent`; omit it for a standalone thread" },
    ]);
  }
  return { exact: selector.exact, prefix: selector.prefix ?? "", suffix: selector.suffix ?? "" };
}

/**
 * The §6 frontmatter of a new thread, in the key order §6's example fixes.
 *
 * `turnModels` is written only when the request stated a model, and then holds
 * exactly one entry: the first turn's (SPEC.md §10, CONTRACT-043). A thread
 * created without one carries no key at all — the server records and never
 * invents, so there is nothing to write.
 */
/**
 * The designation a creation makes (SERVER-154; SPEC.md §7's rider A, signed
 * 2026-08-25).
 *
 * ## The three states, and which one absence is
 *
 * `undefined` designates a **general resident** — §7 calls naming no profile
 * *"the ordinary case"*, one that *"requires nothing to exist first"*, and the
 * rider makes it what happens when nobody chose. `null` designates nobody. An
 * object names a profile, resolved through the **same** `residentFor` the
 * designate route uses, so a name that resolves to nothing is the same `404`
 * from either door rather than two answers to one question.
 *
 * ## A thread with a parent designates nothing, and is not refused here
 *
 * §7 lets only a standalone thread designate. The contract refuses a `resident`
 * sent *with* a `parent` (CONTRACT-088), which is where a caller's mistake
 * belongs — but a thread with a parent and no `resident` at all is the ordinary
 * comment, and must not acquire one from the default. So the parent check comes
 * first and answers `null` for both.
 *
 * ## Nothing here starts a listener
 *
 * Rider A's lazy clause: *"A listener is started when its lane has something
 * pending and none is running, not when the thread is created."* Launching here
 * would run one background agent per thread anyone makes, and it is the
 * orchestrator's job besides — it reads the roster's `pending` count and starts
 * what is waiting.
 */
function designationFor(
  workspace: ThreadsWorkspace,
  input: ThreadCreateInput,
  parentId: string | null,
): Resident | null {
  if (parentId !== null) return null;
  if (input.resident === null) return null;
  const resolved = residentFor(workspace.projection, input.resident?.name, input.resident?.weight);
  // Every designation this server writes carries its own id (SERVER-147), and a
  // creation is a designation like any other.
  return { ...resolved, designationId: newId(ID_PREFIXES.designation) };
}

function threadFields(input: {
  readonly id: string;
  readonly title: string;
  readonly stamp: string;
  readonly parent: string | null;
  readonly anchor: string | null;
  readonly agent: string;
  readonly model: string | undefined;
  readonly origin: string | null;
  /** The designation this creation makes, or `null` for a thread with none. */
  readonly resident: Resident | null;
}): Record<string, unknown> {
  return {
    id: input.id,
    type: "thread",
    title: input.title,
    created: input.stamp,
    updated: input.stamp,
    tags: [],
    status: "open",
    parent: input.parent,
    anchor: input.anchor,
    agent: input.agent,
    // §9.2's provenance, slotted after the §6 thread keys. A thread created
    // from a job joins that job's scope — which is how a subthread the agent
    // opens while working stays in the conversation it came from (§7).
    origin: input.origin,
    /*
     * SPEC.md §7's rider A (SERVER-154): a new standalone thread designates a
     * general resident unless the person chose otherwise.
     *
     * Written **in the same frontmatter as the thread itself**, not by a second
     * call after it. A created thread is never briefly resident-less, and a
     * window in which the orchestrator saw its events as unowned is a window in
     * which it could take them — since SPEC.md §7's rider makes a released lane
     * the orchestrator's, and "not yet designated" is indistinguishable from
     * "released" to the predicate that decides.
     *
     * `residentToStored` is the one place the stored shape is produced, so the
     * key this writes and the key the designate route writes cannot drift.
     */
    ...(input.resident === null ? {} : { resident: residentToStored(input.resident) }),
    ...(input.model === undefined
      ? {}
      : { [TURN_MODELS_FRONTMATTER_KEY]: { [input.stamp]: input.model } }),
  };
}

/**
 * The title is derived from the author's **own** text, never from the reference
 * block the server appends: a thread titled
 * `![shot.png](attachments/th_…/2026-…/shot.png)` would put a URL on the board.
 * An attachment-only first turn therefore falls through to
 * {@link UNTITLED_THREAD}, which is exactly what that fallback is for — unless
 * the request named a `title`, or the thread is anchored or parented, in which
 * case the quote or the parent's title answers first.
 */
const titleInput = (
  input: ThreadCreateInput,
  selector: TextQuoteSelector | null,
  parent: LoadedDocument | null,
): Parameters<typeof deriveThreadTitle>[0] => ({
  ...(input.title === undefined ? {} : { title: input.title }),
  ...(selector === null ? {} : { exact: selector.exact }),
  ...(parent === null ? {} : { parentTitle: parent.row.title }),
  body: input.text ?? "",
});

export async function createThread(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  input: ThreadCreateInput,
): Promise<ThreadCreation> {
  const parentId = input.parent;
  const selector = normalizeSelector(input.selector, parentId);

  // Before the lanes and before a byte is written, exactly as turn append and
  // capture do it: a refused upload leaves no directory and takes no lock.
  assertWithinLimits(input.files, workspace.attachmentLimits ?? DEFAULT_ATTACHMENT_LIMITS);
  // This route is the *second* door onto a thread's turns, and a first turn that
  // leaves a fence open is the worst version of SERVER-075's defect: the whole
  // conversation that follows is invisible from its first reply onward. A first
  // turn fabricating a heading is the worst version of SERVER-076's for the same
  // reason — the thread opens already holding a turn nobody wrote. The reply path
  // being guarded and this one not is how SERVER-070 happened (malformed forms),
  // so the guards are placed together by design.
  assertAppendableTurnText(input.text, TURN_SUBJECT);
  // And the same for a `form` fence that does not parse (SERVER-070). The turn
  // path refused it and this one accepted it, which made the rule about which
  // door the same bytes arrived through rather than about the bytes — and an
  // arbitrary rule is one a later reader "simplifies" in whichever direction
  // they meet first. One implementation, called from every door: agent turns
  // only, because §6 makes a form something an agent asks and a person quoting a
  // fence is quoting.
  assertWritableForm(actor, input.text);
  // And likewise for an attribution nobody made: this route is the second door
  // onto a turn, so §10's "a person's turn names no model" is refused here too
  // rather than only on the reply path (SPEC.md §10, CONTRACT-043).
  assertModelNamesAnAgentTurn(actor, input.model);

  // An unknown parent is a 404 before anything is written, and it is answered
  // from the read rather than from the projection alone so a row whose file
  // vanished answers the same way.
  if (parentId !== null) loadDocument(workspace.workspaceRoot, workspace.projection, parentId);

  // `CREATE_LANE` guards id minting, which is checked against the projection and
  // is therefore only sound while no other create is between its own write and
  // its re-projection. The parent's lane guards the read-modify-write of its
  // `anchors` map, which is what lets ten concurrent comments on one document
  // all survive. Order — reserved lane, then document — is never taken the other
  // way round anywhere, which is the deadlock discipline `runInLanes` documents.
  return runInLanes(mutex, [CREATE_LANE, parentId], async () => {
    const id = newId(ID_PREFIXES.thread, (candidate) => isIdTaken(workspace.projection, candidate));
    const stamp = formatInstant(workspace.now());
    // Re-read inside the lane: the copy read outside it may be one anchor older
    // than the file this write is about to rewrite.
    const parent =
      parentId === null
        ? null
        : loadDocument(workspace.workspaceRoot, workspace.projection, parentId);

    // The stored selector's context comes from the parent's own bytes, not from
    // the request (SERVER-071) — and from *this* read of them, inside the lane,
    // so the context describes the body the anchor is being written against
    // rather than one an earlier request has since edited. A quote naming more
    // than one passage is refused here rather than guessed at.
    const anchorSelector =
      selector === null || parent === null
        ? selector
        : contextualizeSelector(parent.parsed.body, selector);

    const existing = parent === null ? {} : anchorEntries(parent.parsed.data["anchors"]);
    const anchorId =
      selector === null
        ? null
        : newId(ID_PREFIXES.anchor, (candidate) => Object.hasOwn(existing, candidate));

    // The author's own text decides participation and mentions — the reference
    // block the server appends is not something the user wrote, and must never
    // be able to summon the agent.
    const parsed = parseMentions(workspace.projection, input.text ?? "");
    // Hoisted out of `threadFields` because the announcement below needs it
    // *after* the write, and computing it twice would mint two designation ids
    // for one designation.
    const designated = designationFor(workspace, input, parentId);
    /*
     * **The creating turn is not a later turn** (SERVER-165, open question O1).
     *
     * §8's automatic clause reads *"Every **later** turn in a thread where the
     * agent is `engaged`"*, and the first message is posted **with** the thread,
     * not later than it. So an omitted `requestsAgent` is mention-only here even
     * now that the creation's own designation engages the thread — which is
     * exactly what the contract's `THREAD_CREATE_OMITTED_BEHAVIOUR` promises its
     * callers, and it is unchanged by the rider.
     *
     * Two of this spec's own rules would break under the other reading, which is
     * why it is settled here rather than left to taste:
     *
     *  - §7's rider A designates a general resident on **every** new standalone
     *    thread. If the creating turn enqueued on the strength of that
     *    designation, every `corpus thread create` would enqueue work — and
     *    §8's opening line, *"A plain comment is a passive note … Human-only
     *    threads are normal"*, would hold for no standalone thread at all.
     *  - §7's rider A also says *"The designation costs nothing until there is
     *    work. A listener is started when its lane has something pending and
     *    none is running, not when the thread is created."* An enqueue per
     *    creation is a listener per conversation, which is the cost that clause
     *    exists to refuse.
     *
     * A person who wants the agent on the first message says so, exactly as
     * before: `requestsAgent: true`, an `@agent` mention, or a `/skill`
     * directive. Every **later** plain turn then reaches the resident with no
     * mention, which is what the rider bought.
     *
     * `thread: null` is where that answer lives — `shouldEnqueue` returns false
     * for it before §8's engaged clause is reached — so nothing below needs a
     * branch and the ordering is stated rather than implied: the designation is
     * written with the thread, and the turn's enqueue decision never reads it.
     */
    const decision = decideParticipation({
      requestsAgent: input.requestsAgent,
      author: actor,
      parsed,
      thread: null,
    });

    // Bytes first, then the markdown that quotes them (SPEC.md §6): a committed
    // reference must never name a file that is not there. The turn's directory
    // is keyed by the thread id and this stamp, which the first turn owns.
    const stored = await storeTurnFiles(workspace, id, stamp, input.files);
    const path = `${THREADS_ROOT}/${id}.md`;

    const prepared = whileUnreferenced(workspace.attachmentsRoot, id, stamp, stored, () => {
      const turnText = withAttachmentReferences(
        input.text,
        attachmentReferences(
          id,
          stamp,
          stored.map((file) => file.name),
        ),
      );
      // The response is re-read from the file this write is about to make
      // (`toWireThread(workspace, loadThread(...))` below), so the turn's model reaches the
      // wire through the read join rather than from here; `turn` is used only
      // for the stamp the enqueued event names.
      const { body, turn } = appendTurn("", { author: actor, text: turnText, ts: stamp });
      const text = serializeDocument(
        setFrontmatterFields(
          emptyDocument(body),
          threadFields({
            id,
            title: deriveThreadTitle(titleInput(input, selector, parent)),
            stamp,
            parent: parentId,
            anchor: anchorId,
            // SPEC.md §8's rider signed 2026-09-06 (SERVER-165): designating a
            // conversation engages it, and a creation that designates is a
            // designation like any other. In **this** frontmatter, so a
            // designated thread is never a commit old before it is engaged —
            // the same reason `resident` itself is written here rather than by
            // a second call. It outranks `decision.agent` rather than racing
            // it: `engaged` is above `requested` on the one-way climb
            // `participation.ts` describes, so this can only ever raise the key.
            agent: designated === null ? decision.agent : "engaged",
            model: input.model,
            origin: stampedOrigin(workspace, input.job),
            resident: designated,
          }),
        ),
      );
      const warnings = [...validateBeforeWrite(workspace, path, text)];

      const operations: FileOperation[] = [];
      const stage = [path];
      const project = [path];
      if (parent !== null && anchorId !== null && anchorSelector !== null) {
        const parentText = serializeDocument(
          setFrontmatterFields(parent.parsed, {
            anchors: withAnchorEntry(parent.parsed.data["anchors"], anchorId, anchorSelector),
          }),
        );
        warnings.push(...validateBeforeWrite(workspace, parent.path, parentText));
        operations.push({ kind: "write", path: parent.path, content: parentText } as const);
        stage.push(parent.path);
        project.push(parent.path);
      }
      // Second, so the rollback has something to undo: the parent is restored when
      // this write is the one that fails.
      operations.push({ kind: "write", path, content: text } as const);

      return { turn, warnings, operations, stage, project };
    });

    const keys = [DOCS_KEY, docKey(id), threadKey(id)];
    if (parentId !== null) keys.push(docKey(parentId));

    // Outside the cleanup guard, deliberately (SERVER-021): once `runMutation`
    // has committed the thread, deleting the bytes it quotes would be the one
    // state §6 rules out.
    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings: prepared.warnings,
      plan: {
        operations: prepared.operations,
        stage: prepared.stage,
        project: prepared.project,
        unproject: [],
        commit: {
          subject:
            parentId === null
              ? `comment: new standalone thread (${id}) by ${actor}`
              : `comment: new thread on ${parentId} (${id}) by ${actor}`,
          /*
           * SPEC.md §4's first act — "a turn posted to a thread" — and the turn
           * posted *with* the thread is one of them (SERVER-101, orchestrator
           * ruling 2026-09-06; sprint-024 Ruling 2). No spec change was needed:
           * §4's existing words already cover it, and `commitTurnAppend`'s own
           * justification applies verbatim here. A person's comment is "a change
           * someone else can act on" — under §8 it is what wakes the agent — and
           * a thread's first turn is the *most* actionable of them, since it is
           * the one that starts the conversation. The party is deliberately not
           * read, exactly as on the reply path: every other entry in §4's list
           * names an act without one, and the user struck the word `agent` from
           * this entry on 2026-08-10.
           *
           * The observable defect this closes: a person commenting mid-edit had
           * `comment: new thread on doc_… (th_…) by user` overwritten by the
           * next save folding into the same window, and relabelled
           * `editing session: N documents by user` when it finally closed — a
           * subject §4 says an act's commit keeps.
           *
           * `"names-the-window"` and not `"commits-alone"`: §4 gives that shape
           * to a deletion and a bulk Save only. So the creation folds into the
           * open window — carrying the parent's frontmatter write with it, which
           * is why the anchored two-file act stays **one** commit (§6 forbids the
           * intermediate state, and two commits would publish it) — and the
           * window closes after, keeping this subject.
           */
          act: "names-the-window" as const,
        },
        keys,
        // A thread counts in the folder its parent is filed in
        // (`docs/tree.ts`), so a parented thread moves a folder badge — unless
        // its parent lives outside `data/docs/`, or is itself a thread. A
        // standalone thread moves nothing.
        mayChangeTree: true,
      },
    });

    // SPEC.md §7: "one **standalone thread** per reflection, the digest".
    // Recorded here because this is the only moment the two facts are in the
    // same place — which job this write serves, and which thread it made — and
    // the clock cannot ask for it later: a `workspace.reflect` payload names no
    // thread, so nothing about the finished event says which thread was its
    // digest. Only a standalone one: a thread with a parent is a comment the
    // reflection left on a document, not the digest of it.
    if (parentId === null) workspace.reflect?.observeThreadCreated(input.job, id);

    /*
     * **The launch instruction** (SERVER-160; SPEC.md §7's rider A, signed
     * 2026-08-25, and the `resident.designated` carve-out in `queue/lanes.ts`).
     *
     * A creation that designates a resident **and enqueues work for it**
     * announces the designation, exactly as `POST /api/threads/{id}/resident`
     * does. Without this, pressing **Ask** did nothing at all:
     *
     * - The thread's `comment.created` is stamped with the **thread's** lane,
     *   and the same rider removed the lapse fallback — `visibleTo` is exact
     *   equality, so the orchestrator's unscoped `claim-all` can never see it.
     * - The orchestrator waits in a parked `queue idle` on its own lane. A wake
     *   is not enough to reach it: `idle` re-parks on a wake whose work it
     *   cannot claim, by design, so only an event it *can* claim ends the park.
     * - Rider A's lazy clause hands the launch to the orchestrator, which starts
     *   listeners by reading the roster — and it reads the roster when it wakes.
     *
     * Measured on a real server before the fix: one `comment.created` on the new
     * lane, `queue claim-all` empty, and a parked `queue idle` holding its whole
     * window. A person pressed Ask and nothing whatever happened.
     *
     * **Gated on `decision.enqueue`, which is rider A's own condition** — *"a
     * listener is started when its lane has something pending and none is
     * running"*. A standalone thread created without asking for the agent still
     * designates a general resident, and announcing that would ask for a
     * listener for a conversation with nothing waiting in it: one background
     * agent per thread anybody makes, which is the thing the rider's laziness
     * exists to prevent.
     *
     * **Before the comment event**, so the instruction to start a listener
     * exists before the work it is being started for, and an orchestrator that
     * wakes and reads the roster in one pass sees the lane already carrying its
     * count.
     *
     * ## The silent creation is deliberate, and this is the record of it
     *
     * **SERVER-163**, filed from UI-186's drill: *"a plain `corpus thread
     * create` gives a general resident with no designation event at all, so a
     * very common lane has never had a launch record"*. The decision, taken
     * 2026-09-06, is that the gate above stays and the fix is on the reading
     * side. Three reasons, in order of weight:
     *
     * 1. **The event is a launch instruction, not a receipt.** The orchestrate
     *    skill launches a listener on `resident.designated`. Enqueuing one for
     *    every created thread starts one background agent per conversation,
     *    which is the exact cost §7's rider A refuses in its own words: *"The
     *    designation costs nothing until there is work. A listener is started
     *    when its lane has something pending and none is running, not when the
     *    thread is created."*
     * 2. **A launch record is not lost by this, it is deferred.** The
     *    orchestrate skill logs a launch on *whichever* event prompted it, and
     *    the other one that does is `lane.waiting` (§7's rider signed
     *    2026-08-27) — enqueued the first time work lands on this lane with no
     *    listener present. So the lane gets its account of itself at the first
     *    moment there is anything to account for. `jobs/project.ts` resolves a
     *    `lane.waiting` job's origin to the lane it names, which is what lets a
     *    surface find that record by conversation.
     * 3. **The absence therefore means something exact.** No launch-prompting
     *    event for a lane is *"this lane has never been launched"*, which is a
     *    true sentence and a different one from *"the record was reaped"*. The
     *    two are told apart by whether the queue holds such an event at all,
     *    and `apps/ui/src/console/launchRecord.ts` reports them as two states.
     *
     * **One event per creation path, never per code path** (SERVER-163's third
     * criterion): this is the only place a creation announces a designation, and
     * the designate route is the only other door. A thread created with a
     * resident named explicitly reaches exactly this line, so it announces once.
     */
    const designatedEventId =
      designated === null || !decision.enqueue
        ? null
        : (
            await workspace.enqueue({
              type: RESIDENT_DESIGNATED,
              source: EVENT_SOURCE.thread,
              payload: residentDesignatedPayload(id, designated),
            })
          ).id;

    // After the write: an event may not name a thread that does not exist yet,
    // and the parked `queue idle` it wakes will read the thread immediately.
    const eventId = decision.enqueue
      ? await enqueueComment(workspace, {
          threadId: id,
          parentId,
          turnTs: prepared.turn.ts,
          parsed,
          weight: input.weight,
          recipient: input.recipient,
        })
      : null;

    return {
      thread: toWireThread(workspace, loadThread(workspace, id)),
      anchorId,
      eventId,
      designatedEventId,
      result,
    };
  });
}
