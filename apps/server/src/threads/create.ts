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
// can be undone, and undoing it is what the rollback exists for.
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
  type Thread,
} from "@corpus/contract";
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
import { TURN_SUBJECT, assertClosedFences } from "./fences.js";
import { parseMentions } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toWireThread } from "./read.js";
import { deriveThreadTitle } from "./title.js";
import { storeTurnFiles, whileUnreferenced } from "./turns.js";
import type { ThreadsWorkspace } from "./workspace.js";

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
  readonly files: readonly File[];
}

/**
 * The request either media type carries. Both read `requestsAgent` the same way
 * — the JSON form as a boolean, the multipart form through `z.stringbool` — and
 * neither through a `??` that would turn "note only" into "omitted".
 */
export function threadRequestBody(body: CreateThreadBody): ThreadCreateInput {
  if (!isMultipartThreadCreate(body)) {
    return {
      parent: body.parent ?? null,
      selector: body.selector,
      title: body.title,
      text: body.body,
      requestsAgent: body.requestsAgent,
      files: [],
    };
  }
  return {
    parent: body.parent ?? null,
    selector: body.selector,
    title: body.title,
    text: body.text,
    requestsAgent: body.requestsAgent,
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

/** The §6 frontmatter of a new thread, in the key order §6's example fixes. */
function threadFields(input: {
  readonly id: string;
  readonly title: string;
  readonly stamp: string;
  readonly parent: string | null;
  readonly anchor: string | null;
  readonly agent: string;
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
  // conversation that follows is invisible from its first reply onward. The
  // reply path being guarded and this one not is how SERVER-070 happened
  // (malformed forms), so the guards are placed together by design.
  assertClosedFences(input.text, TURN_SUBJECT);

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
    // §7's edit lock, on the **parent's** id and only when the parent is
    // actually written (sprint-006 Adjudication 1). Commenting is not editing: a
    // whole-document or standalone thread never asks, and the contract declares
    // no `423` for either. Checked inside the lanes, so a lease the other party
    // acquires while this comment is queued behind another one still refuses it
    // (SERVER-022 finding 7).
    if (selector !== null && parentId !== null) {
      await (workspace.assertWritable ?? ((): void => undefined))(parentId, actor);
    }

    const id = newId(ID_PREFIXES.thread, (candidate) => isIdTaken(workspace.projection, candidate));
    const stamp = formatInstant(workspace.now());
    // Re-read inside the lane: the copy the guard was run against may be one
    // anchor older than the file this write is about to rewrite.
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
    // A brand-new thread cannot be `engaged`, so an omitted `requestsAgent` is
    // mention-only here — which is exactly what the contract's
    // `THREAD_CREATE_OMITTED_BEHAVIOUR` promises its callers.
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
            agent: decision.agent,
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
        },
        keys,
        // A thread counts in the folder its parent is filed in
        // (`docs/tree.ts`), so a parented thread moves a folder badge — unless
        // its parent lives outside `data/docs/`, or is itself a thread. A
        // standalone thread moves nothing.
        mayChangeTree: true,
      },
    });

    // After the write: an event may not name a thread that does not exist yet,
    // and the parked `queue idle` it wakes will read the thread immediately.
    const eventId = decision.enqueue
      ? await enqueueComment(workspace, {
          threadId: id,
          parentId,
          turnTs: prepared.turn.ts,
          parsed,
        })
      : null;

    return { thread: toWireThread(loadThread(workspace, id)), anchorId, eventId, result };
  });
}
