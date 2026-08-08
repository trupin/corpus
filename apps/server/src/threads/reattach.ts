// `POST /api/threads/{id}/reattach` — a person pointing an orphaned comment at
// the text it was always about (SPEC.md §6, §4; SERVER-059 phase B).
//
// ## Why a selector may be rewritten here with no diff behind it
//
// Every other write that touches a selector holds evidence about *where the text
// went*. Creation holds the document and matches the quote against it.
// Reconciliation holds the edit: it can see which characters the save deleted,
// inserted and moved, and it rewrites a selector only where that diff says the
// anchor's own bytes were carried forward. This path holds neither — and that is
// not an oversight to be repaired with a cleverer reader.
//
// SERVER-059 established the impossibility as a construction rather than a
// measurement: deleting `- Review the Q2 report by Friday` from a Q1–Q4 list,
// and renaming that same line to `Q3` while deleting the old Q3 line, produce the
// **same** before-state and the **same** after-state while demanding opposite
// correct answers. A reader sees one body, so the evidence that separates them
// does not exist at read time and never will. SERVER-055 put a similarity score
// on the read path anyway and was reverted for misattaching 8 of 12 shapes; §6
// settles the tie in one direction — "a visible orphan beats a silent
// misattachment" — which is why a thread whose selector never byte-matched stays
// detached for the life of its document.
//
// What this route adds is not a better inference. It is **evidence that was
// never in the corpus**: the person who wrote the comment remembers what they
// were commenting on, and this is the wire that carries their answer. The
// selector is therefore rewritten from the range they named, which is admissible
// here for exactly the reason it is inadmissible everywhere else — the deciding
// fact came from outside the bytes. Nothing about the range is re-derived
// server-side: a candidate index would oblige the server to regenerate the list
// the UI showed and count into it, so the moment the two lists differ the same
// index silently means a different passage (CONTRACT-041).
//
// **The agent may not call it** (`403`). The route's whole justification is that
// the deciding evidence does not exist at read time, so an agent calling it
// supplies a judgment it provably cannot make — and the result is permanent and
// invisible, because a repaired anchor is indistinguishable from a healthy one.
// The agent also never needs it: every case where a machine *does* hold the
// evidence is an edit, and edits already reconcile on the save path.
//
// **Nothing the caller sends is stored.** `expectedText` is a guard — the same
// role `prefix`/`suffix` play on thread creation — consulted to establish that
// the person is looking at the bytes that are there now, then discarded. The
// stored selector is read off the parent's own bytes by `selectorForRange`, the
// same computation creation uses (SERVER-071), so a repaired anchor is in the
// shape a save would have left it in and resolves on rung 1 of the §6 ladder.

import type {
  Actor,
  ConflictError,
  ReattachRefusalReason,
  ReattachThreadRequest,
  ResolvedAnchor,
  ThreadSummary,
} from "@corpus/contract";
import { snapRange } from "../anchors/index.js";
import { serializeDocument, setFrontmatterFields, withAnchorEntry } from "../core/index.js";
import {
  loadDocument,
  resolveDocumentAnchors,
  runInLanes,
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { HttpError, forbidden } from "../errors.js";
import { selectorForRange } from "./anchor-context.js";
import { loadThread, toThreadSummary, type LoadedThread } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

export const AGENT_REATTACH_MESSAGE =
  "re-attaching a thread is user-only; the evidence a repair runs on is the person's memory of " +
  "what they commented on, which does not exist at read time";

export const NOT_ANCHORED_MESSAGE =
  "this thread has no anchor to repair — it is standalone or comments on the whole document, and " +
  "giving one an anchor changes the scope of somebody's comment rather than repairing it";

export const RANGE_CHANGED_MESSAGE =
  "the parent document no longer holds that text at that range; re-read the document and choose " +
  "again";

/**
 * The route's `409`, narrowed by a machine-readable `reason` exactly as
 * `LockConflictError` narrows the same envelope with `lock`: an extra field on
 * `{code, message}`, never an eighth `ERROR_CODES` member, so every consumer that
 * switches on `code` keeps working unchanged.
 */
export function reattachConflict(reason: ReattachRefusalReason, message: string): HttpError {
  const body: ConflictError & { readonly reason: ReattachRefusalReason } = {
    code: "conflict",
    message,
    reason,
  };
  return new HttpError(409, body);
}

/**
 * The thread's anchor and the document it hangs on, or the `not-anchored`
 * refusal. Both fields are required together: an anchor id with no parent names
 * an entry in no document, which is the same "nothing to repair" state.
 */
function requireAnchored(thread: LoadedThread): {
  readonly anchorId: string;
  readonly parentId: string;
} {
  const { anchor, parent } = thread;
  if (anchor === null || parent === null) {
    throw reattachConflict("not-anchored", NOT_ANCHORED_MESSAGE);
  }
  return { anchorId: anchor, parentId: parent };
}

export interface ThreadReattachment {
  readonly thread: ThreadSummary;
  /** The repaired anchor, as `GET /api/docs/{id}` will now report it. */
  readonly anchor: ResolvedAnchor;
  readonly result: MutationResult;
}

export async function reattachThread(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  request: ReattachThreadRequest,
): Promise<ThreadReattachment> {
  if (actor === "agent") throw forbidden(AGENT_REATTACH_MESSAGE);

  // Read and refuse before any lane, so a request that can never write does not
  // queue behind somebody's save — and read again inside the lane, because that
  // copy is the one this write acts on (the pattern SERVER-035 settled: check
  // existence twice rather than trust a pre-lane read).
  const preview = loadThread(workspace, id);
  const { parentId: previewParent } = requireAnchored(preview);

  // `[threadId, parentId]`, the fixed order every composite thread mutation
  // takes. The parent's lane is what matters — its `anchors` map is the
  // read-modify-write — and the thread's is held for the read that answers.
  return runInLanes(mutex, [id, previewParent], async () => {
    const thread = loadThread(workspace, id);
    const { anchorId, parentId } = requireAnchored(thread);
    const parent = loadDocument(workspace.workspaceRoot, workspace.projection, parentId);

    // §7's edit lock, on the **parent's** id: the parent is the file this repair
    // writes, and the route declares the `423` for exactly that reason. Taken
    // inside the lane so a lease acquired while this request was queued still
    // refuses it, and before the state refusals below because "the right party,
    // wrong moment" is not something re-reading and choosing again can fix.
    await (workspace.assertWritable ?? ((): void => undefined))(parentId, actor);

    const body = parent.parsed.body;

    // The guard. The document is live: the agent may have saved it between the
    // person seeing the candidate sites and choosing one, and offsets computed
    // against yesterday's bytes designate today's bytes silently and wrongly. A
    // range running past the end of the body is the same fact — the slice is
    // simply shorter than what the caller says is there — and is reported the
    // same way rather than approximated to whatever survives.
    if (body.slice(request.range.start, request.range.end) !== request.expectedText) {
      throw reattachConflict("range-changed", RANGE_CHANGED_MESSAGE);
    }

    // A range that splits a character is widened to the whole one, the same
    // outward snap every resolution performs. A selector holding half a
    // surrogate pair quotes a character that is in no document, so it could
    // never resolve — an anchor orphaned by construction, which is precisely
    // what this route exists to undo.
    const range = snapRange(body, request.range);

    // §6: two threads on disjoint text never end up claiming overlapping text.
    // Measured against the same resolver `GET /api/docs/{id}` publishes, so
    // "occupied" means what the reader shows rather than a second opinion about
    // it; the thread's own entry is skipped, since an anchor does not overlap
    // itself and re-attaching a thread to where it already sits is a no-op, not
    // a conflict.
    for (const other of resolveDocumentAnchors(workspace.projection, parentId, parent.parsed)) {
      const occupied = other.range;
      if (other.anchorId === anchorId || occupied === null) continue;
      if (occupied.start < range.end && range.start < occupied.end) {
        throw reattachConflict(
          "range-overlaps",
          `that range overlaps text thread ${other.threadId} is already anchored to; ` +
            "choose a range that does not",
        );
      }
    }

    const selector = selectorForRange(body, range.start, range.end);
    // Only the one `anchors` entry moves. The parent's `updated` stamp is
    // deliberately untouched: the document did not change, its reader did not
    // edit it, and stamping it would report somebody's comment repair as a save.
    const text = serializeDocument(
      setFrontmatterFields(parent.parsed, {
        anchors: withAnchorEntry(parent.parsed.data["anchors"], anchorId, selector),
      }),
    );
    const warnings = validateBeforeWrite(workspace, parent.path, text);

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations: [{ kind: "write", path: parent.path, content: text }],
        stage: [parent.path],
        project: [parent.path],
        unproject: [],
        commit: {
          // Named for the act, and authored by the acting party — which is always
          // the person, since the agent is refused above. `git log` therefore
          // shows a repair as somebody's decision rather than as a save's
          // reconciliation, and the `Corpus-Anchors` trailer is deliberately not
          // set: that is reconciliation's vocabulary for what a *diff* moved.
          subject: `comment: re-attach ${id} on ${parentId} by ${actor}`,
          // Out of §4's session folding, for the reason skill rollback is: a
          // repair is not a continuation of the edit that made it necessary, it
          // is the answer to it. Folding two repairs of one thread into one
          // commit would erase the first decision from history — and a write
          // whose evidence is unrecoverable is the last one whose record should
          // be.
          squash: false,
        },
        // An orphan becoming attached changes what every list and the parent's
        // reader show, so both documents are announced. `["tree"]` is not: an
        // anchor entry cannot move a folder badge, which is why `mayChangeTree`
        // is left unset and the tree query stays off this path.
        keys: [DOCS_KEY, docKey(id), docKey(parentId)],
      },
    });

    return {
      thread: toThreadSummary(loadThread(workspace, id)),
      anchor: {
        anchorId,
        selector,
        threadId: id,
        threadStatus: thread.status,
        range,
        orphaned: false,
      },
      result,
    };
  });
}
