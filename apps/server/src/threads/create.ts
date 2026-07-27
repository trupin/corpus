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
// living corpus, not a rejected request.

import {
  type Actor,
  type CreateThreadRequest,
  type TextQuoteSelector,
  type Thread,
} from "@corpus/contract";
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
import { DOCS_KEY, TREE_KEY, docKey, threadKey } from "../events/index.js";
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
import { enqueueComment } from "./events.js";
import { parseMentions } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toWireThread } from "./read.js";
import { deriveThreadTitle } from "./title.js";
import type { ThreadsWorkspace } from "./workspace.js";

export interface ThreadCreation {
  readonly thread: Thread;
  /** The anchor written into the parent, or `null` for the two unanchored modes. */
  readonly anchorId: string | null;
  readonly eventId: string | null;
  readonly result: MutationResult;
}

/**
 * The selector as it will be stored: **verbatim**, with absent context as the
 * empty string the contract documents. Nothing is trimmed or normalised — the
 * selection was captured from the real body and the resolver matches on those
 * exact characters, so "tidying" it here is how an anchor stops resolving.
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

const titleInput = (
  request: CreateThreadRequest,
  selector: TextQuoteSelector | null,
  parent: LoadedDocument | null,
): Parameters<typeof deriveThreadTitle>[0] => ({
  ...(request.title === undefined ? {} : { title: request.title }),
  ...(selector === null ? {} : { exact: selector.exact }),
  ...(parent === null ? {} : { parentTitle: parent.row.title }),
  body: request.body,
});

export async function createThread(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  request: CreateThreadRequest,
): Promise<ThreadCreation> {
  const parentId = request.parent ?? null;
  const selector = normalizeSelector(request.selector, parentId);

  // An unknown parent is a 404 before anything is written, and it is answered
  // from the read rather than from the projection alone so a row whose file
  // vanished answers the same way.
  if (parentId !== null) loadDocument(workspace.workspaceRoot, workspace.projection, parentId);

  // §7's edit lock, on the **parent's** id and only when the parent is actually
  // written (sprint-006 Adjudication 1). Commenting is not editing: a
  // whole-document or standalone thread never asks, and the contract declares no
  // `423` for either.
  if (selector !== null && parentId !== null) {
    await (workspace.assertWritable ?? ((): void => undefined))(parentId, actor);
  }

  // `CREATE_LANE` guards id minting, which is checked against the projection and
  // is therefore only sound while no other create is between its own write and
  // its re-projection. The parent's lane guards the read-modify-write of its
  // `anchors` map, which is what lets ten concurrent comments on one document
  // all survive. Order — reserved lane, then document — is never taken the other
  // way round anywhere, which is the deadlock discipline `runInLanes` documents.
  return runInLanes(mutex, [CREATE_LANE, parentId], async () => {
    const id = newId(ID_PREFIXES.thread, (candidate) => isIdTaken(workspace.projection, candidate));
    const stamp = formatInstant(workspace.now());
    // Re-read inside the lane: the copy the guard was run against may be one
    // anchor older than the file this write is about to rewrite.
    const parent =
      parentId === null
        ? null
        : loadDocument(workspace.workspaceRoot, workspace.projection, parentId);

    const existing = parent === null ? {} : anchorEntries(parent.parsed.data["anchors"]);
    const anchorId =
      selector === null
        ? null
        : newId(ID_PREFIXES.anchor, (candidate) => Object.hasOwn(existing, candidate));

    const parsed = parseMentions(workspace.projection, request.body);
    // A brand-new thread cannot be `engaged`, so an omitted `requestsAgent` is
    // mention-only here — which is exactly what the contract's
    // `THREAD_CREATE_OMITTED_BEHAVIOUR` promises its callers.
    const decision = decideParticipation({
      requestsAgent: request.requestsAgent,
      author: actor,
      parsed,
      thread: null,
    });

    const { body, turn } = appendTurn("", { author: actor, text: request.body, ts: stamp });
    const path = `${THREADS_ROOT}/${id}.md`;
    const text = serializeDocument(
      setFrontmatterFields(
        emptyDocument(body),
        threadFields({
          id,
          title: deriveThreadTitle(titleInput(request, selector, parent)),
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
    const keys = [DOCS_KEY, docKey(id), threadKey(id)];
    if (parent !== null && anchorId !== null && selector !== null) {
      const parentText = serializeDocument(
        setFrontmatterFields(parent.parsed, {
          anchors: withAnchorEntry(parent.parsed.data["anchors"], anchorId, selector),
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
    if (parentId !== null) {
      keys.push(docKey(parentId));
      // A thread counts in the folder its parent is filed in (`docs/tree.ts`),
      // so a parented thread moves a folder badge. A standalone one does not.
      keys.push(TREE_KEY);
    }

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations,
        stage,
        project,
        unproject: [],
        commit: {
          subject:
            parentId === null
              ? `comment: new standalone thread (${id}) by ${actor}`
              : `comment: new thread on ${parentId} (${id}) by ${actor}`,
        },
        keys,
      },
    });

    // After the write: an event may not name a thread that does not exist yet,
    // and the parked `queue idle` it wakes will read the thread immediately.
    const eventId = decision.enqueue
      ? await enqueueComment(workspace, {
          threadId: id,
          parentId,
          turnTs: turn.ts,
          parsed,
        })
      : null;

    return { thread: toWireThread(loadThread(workspace, id)), anchorId, eventId, result };
  });
}
