// `POST /api/docs/bulk` — one action, over a selection, as **one act and one
// commit** (SPEC.md §4's "One action, one commit", §11's actions on a selection;
// both riders signed 2026-08-05).
//
// **Why this is not a loop.** Every single-document verb takes one `{id}`, and
// the auto-committer folds saves by document plus actor, so archiving twenty
// documents through twenty calls is twenty commits *by construction* — the one
// thing §4 now forbids, and the one failure mode a loop would reproduce while
// looking like it worked. What this file does instead is separate the two halves
// the pipeline already has:
//
//   per document: guard → load → plan → validate → write   (N times, isolated)
//   once:         commit → re-project → announce           (`finishMutation`)
//
// so the act has exactly one commit boundary. The committer is *told* the writes
// are one act — `docIds` on the `CommitRequest` — rather than left to infer it,
// which is what makes the commit stand alone in both directions §4 names: it
// never folds into a preceding editing session, and no later save folds into it.
//
// **The act's report and the commit are one computation — containment, in one
// direction.** Only a write that landed puts an id in `changed`, and only those
// writes are staged, so **every document `changed` names has a file in that
// commit** and `git show --name-only` lists it, while a document that was
// refused or was already in the target state wrote nothing and appears nowhere
// in it — `git log` never records an effect the caller was told did not happen.
// When nothing changed there is no commit object at all, not an empty one.
//
// It is **not** set equality, and the reason is structural rather than a defect
// to be tidied away: the result's three parts partition the **requested** ids and
// nothing else, so a file for a document the act did not name has no part to go
// in. Two things do that today, both required by the spec and both shared with
// the single-document routes — reached here through *their* planners rather than
// re-derived:
//
//   1. §6's **anchor cascade** — deleting an anchored thread rewrites its
//      parent's `anchors` map "in the same commit", exactly as
//      `DELETE /api/docs/{id}` does. That parent survives the act, need not even
//      have been requested, and must not be in `changed`: the act did not delete
//      it.
//   2. §7's **skill folder move** — archiving or unarchiving a skill moves its
//      whole folder, carrying every file under it, because what disables a skill
//      is where its folder lives. A skill folder may nest another skill (see
//      `skillDocumentsUnder`), and the move disables that nested `SKILL.md`
//      without the act ever naming it. `POST /api/docs/{id}/archive` moves
//      exactly the same folder; this is that verb's shape, not a bulk-only one.
//
// Both are pinned by tests, so the exceptions are documented by something that
// fails when they change rather than by this sentence.
//
// **Per-document outcomes stay per-document** (§11: a bulk action "applies to
// what it can and reports what it could not", and "never refuses the whole set
// because of one document"). A lock, an unknown id, a not-applicable act and a
// failed write are entries in `refused`; none of them is a verdict on the
// request. The single whole-request refusal is an agent asking to `delete`, which
// is `403` before anything is read or written (§9.2 — the agent archives, never
// deletes).
//
// **Atomicity, stated rather than assumed** (the issue asks for a decision here).
// Each document's file operations are one all-or-nothing group, so a failure
// mid-group restores that document and refuses it as `write-failed` while the
// rest of the act proceeds. Across documents the guarantee is *no half-commit*,
// not *no half-write*: the writes land before the single `git commit`, so a
// process killed between them leaves changed files on disk uncommitted — exactly
// the state §14 already defines for a hook that rejects a commit ("the file is
// the source of truth", the mutation stands). Git offers nothing stronger short
// of writing the tree by hand; what it does guarantee is that the commit is one
// object containing exactly what landed, so a partially-applied act is never
// half-recorded in the history.

import type {
  Actor,
  BulkAction,
  BulkActionRefusal,
  BulkActionRequest,
  BulkActionResult,
  BulkRefusalReason,
  Lock,
  QueryKey,
  Warning,
} from "@corpus/contract";
import { removeThreadAttachments } from "../attachments/index.js";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import { DOCS_KEY, dedupeKeys, docKey, threadKey } from "../events/index.js";
import { HttpError, forbidden } from "../errors.js";
import { planSetArchived } from "./archive.js";
import { AGENT_DELETE_MESSAGE, anchoredThreadParent, planDelete } from "./delete.js";
import { assertMovable, planMove } from "./move.js";
import { loadDocument, type LoadedDocument } from "./read.js";
import {
  DestinationOccupiedError,
  applyOperations,
  commitWarnings,
  finishMutation,
  resolveFolder,
  runInLanes,
  validateBeforeWrite,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
  type WriteGuard,
} from "./write.js";

/**
 * What one document's share of the act comes to: the files to write, what to
 * validate first, and what the act owes the projection and the bus for it.
 *
 * `null` from a planner means **already in that state** — §11's second part,
 * "explicitly a no-op and not a failure".
 */
type DocumentPlan = {
  readonly operations: readonly FileOperation[];
  readonly stage: readonly string[];
  readonly project: readonly string[];
  readonly unproject: readonly string[];
  readonly keys: readonly QueryKey[];
  /** `null` when nothing new is written — a skill folder that only moved. */
  readonly validate: { readonly path: string; readonly text: string } | null;
  /**
   * Threads left behind by this document's deletion, **as the projection saw
   * them when the plan was made** — which is one write behind by construction
   * inside an act, and is why {@link runBulk} filters the union rather than
   * trusting it. See the note there.
   */
  readonly orphanedThreadIds?: readonly string[];
  /** Set for a deleted thread, whose attachment directory is swept after the commit. */
  readonly deletedThreadId?: string | undefined;
};

/**
 * Which acts can move a folder badge, decided the same way `MutationPlan`'s
 * `mayChangeTree` is: `runMutation` measures `GET /api/tree`'s answer either
 * side of the projection, and this only says whether it is worth measuring.
 *
 * `resolve` and `reopen` are absent on purpose. `docs/tree.ts` excludes a
 * document only when it is **archived**, so a thread moving between `open` and
 * `resolved` is counted either way; `tag` and `review` are invisible to it
 * outright.
 */
const TREE_MOVING_ACTIONS: ReadonlySet<BulkAction["action"]> = new Set([
  "archive",
  "unarchive",
  "move",
  "delete",
]);

/** The two acts that are only meaningful on a thread (SPEC.md §6). */
const THREAD_ONLY_STATUS: Partial<Record<BulkAction["action"], "resolved" | "open">> = {
  resolve: "resolved",
  reopen: "open",
};

/** Ids as the act will answer about them: request order, each named once. */
const collapse = (ids: readonly string[]): string[] => [...new Set(ids)];

const docKeys = (loaded: LoadedDocument): QueryKey[] => {
  const keys: QueryKey[] = [DOCS_KEY, docKey(loaded.row.id)];
  if (loaded.row.type === "thread") {
    keys.push(threadKey(loaded.row.id));
    const parent = loaded.parsed.data["parent"];
    if (typeof parent === "string" && parent !== "") keys.push(docKey(parent));
  }
  return keys;
};

/**
 * A frontmatter-only act, as a plan — or `null` when the file's bytes would not
 * move, which is what "already in that state" means for every act that writes
 * frontmatter.
 *
 * Comparing the *serialized* result rather than the field is what makes the
 * answer agree with the commit: `setFrontmatterFields` leaves an unchanged key's
 * source bytes alone, so equal text is precisely "this document contributes
 * nothing to the diff". It is also why `review` can land here despite the
 * contract calling it never-already-in-state: instants are second-precision
 * (`core/time.ts`), so a review repeated inside one second genuinely writes the
 * same bytes, and reporting it as changed would put an id in `changed` that
 * `git show --name-only` does not list.
 */
function planFrontmatter(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  patch: Readonly<Record<string, unknown>>,
  options: { readonly stampUpdated: boolean },
): DocumentPlan | null {
  const patched = setFrontmatterFields(loaded.parsed, patch);
  const stamped =
    patched === loaded.parsed || !options.stampUpdated
      ? patched
      : setFrontmatterFields(patched, { updated: formatInstant(workspace.now()) });
  const text = serializeDocument(stamped);
  if (text === loaded.text) return null;

  return {
    operations: [{ kind: "write", path: loaded.path, content: text }],
    stage: [loaded.path],
    project: [loaded.path],
    unproject: [],
    keys: docKeys(loaded),
    validate: { path: loaded.path, text },
  };
}

/**
 * §11's tag act: **a delta, never a replacement** — "adds or removes the named
 * tags and never replaces a document's tag set". Existing order is preserved and
 * additions are appended, so tagging twenty documents leaves twenty tag sets
 * that still differ from each other.
 */
function nextTags(current: unknown, add: readonly string[], remove: readonly string[]): string[] {
  const removed = new Set(remove);
  const tags = (Array.isArray(current) ? current : [])
    .filter((tag): tag is string => typeof tag === "string")
    .filter((tag) => !removed.has(tag));
  for (const tag of add) {
    if (!removed.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** A refusal the act reports for one document rather than failing over. */
class Refusal extends Error {
  constructor(
    readonly reason: BulkRefusalReason,
    message: string,
    readonly lock: Lock | null = null,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

/**
 * One document's outcome, from an error the step it was in produced.
 *
 * The **class of refusal is decided by which step failed**, not by re-reading a
 * message: `planFor` raises "this act does not apply here" (a `not-applicable`,
 * §11's "the corpus changed between selecting and acting"), while
 * `validateBeforeWrite` raises §14's own finding (`invalid`). Both are `400`s, so
 * nothing about the error itself could tell them apart — the caller's `fallback`
 * is what carries that knowledge, and it is the reason the two are separate
 * `try` blocks below.
 *
 * An error that is **neither** — a genuine defect rather than a refusal anything
 * here anticipated — is still reported per document rather than aborting the
 * act, because aborting would leave the documents already written on disk and
 * uncommitted. It is **logged** as well, so "never hide a defect" survives the
 * one wire vocabulary that has no bucket for a server bug.
 */
function refusalFor(
  workspace: DocsWorkspace,
  id: string,
  error: unknown,
  fallback: BulkRefusalReason,
): BulkActionRefusal {
  if (error instanceof Refusal) {
    return { id, reason: error.reason, message: error.message, lock: error.lock };
  }
  if (error instanceof HttpError) {
    if (error.status === 423 && "lock" in error.body && error.body.lock !== undefined) {
      return { id, reason: "locked", message: error.message, lock: error.body.lock };
    }
    if (error.status === 404)
      return { id, reason: "not-found", message: error.message, lock: null };
    if (error.status < 500) return { id, reason: fallback, message: error.message, lock: null };
  }
  workspace.logger.error("a bulk act could not apply to a document", {
    docId: id,
    reason: fallback,
    error: String(error),
  });
  return {
    id,
    reason: fallback,
    message: error instanceof Error ? error.message : String(error),
    lock: null,
  };
}

/**
 * A destination path that is already taken, as this act's third part.
 *
 * `write-failed` is the one published reason both of whose clauses are true here
 * — "the file could not be written; nothing about this document reached the
 * commit" — where `not-applicable` would tell the user to refresh the board and
 * `invalid` would claim the document fails §14 validation, which it does not.
 *
 * The path itself lives in the error's `issues`, and a refusal row has no
 * `issues` field to carry it, so it is folded into the message: §11 requires
 * every entry in this part to carry its reason, and "the destination is already
 * occupied" without the destination is not one a person can act on.
 */
function occupiedRefusal(id: string, error: DestinationOccupiedError): BulkActionRefusal {
  const detail = "issues" in error.body ? error.body.issues[0]?.message : undefined;
  return {
    id,
    reason: "write-failed",
    message: detail === undefined ? error.message : `${error.message}: ${detail}`,
    lock: null,
  };
}

/**
 * The lock guard on the §6 cascade's **parent**, reported so the row says which
 * document is actually locked.
 *
 * The refusal stays filed under the *thread's* id — the three parts partition
 * the requested ids, and the parent need not even be among them — but everything
 * in that row that names a document has to name the parent, or a person reads
 * "locked" beside the thread and clears the thread's lock, which changes
 * nothing. `lock` already does (`Lock` carries its own `docId`, and this is the
 * lease whose clearing unblocks the deletion); the message now says so in words
 * instead of leaving a reader to notice that the id in the sentence is not the
 * id in the row (SERVER-077 review, finding 5).
 */
async function guardCascadeParent(
  guard: WriteGuard,
  id: string,
  parentId: string,
  actor: Actor,
): Promise<void> {
  try {
    await guard(parentId, actor);
  } catch (error) {
    if (error instanceof HttpError && error.status === 423 && "lock" in error.body) {
      const lock = error.body.lock;
      if (lock !== undefined) {
        throw new Refusal(
          "locked",
          `deleting ${id} rewrites its parent ${parentId}'s anchors in the same commit ` +
            `(SPEC.md §6), and ${parentId} is being edited by ${lock.holder}; the lock to clear ` +
            `is ${parentId}'s, not ${id}'s`,
          lock,
        );
      }
    }
    throw error;
  }
}

/** The one act, as it applies to one document. */
function planFor(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  action: BulkAction,
  destination: string | null,
): DocumentPlan | null {
  switch (action.action) {
    case "archive":
    case "unarchive": {
      const plan = planSetArchived(workspace, loaded, action.action === "archive");
      if (plan === null) return null;
      return {
        operations: plan.operations,
        stage: plan.stage,
        project: plan.project,
        unproject: plan.unproject,
        keys: docKeys(loaded),
        validate: plan.text === null ? null : { path: plan.path, text: plan.text },
      };
    }
    case "resolve":
    case "reopen": {
      const status = THREAD_ONLY_STATUS[action.action];
      if (loaded.row.type !== "thread") {
        throw new Refusal(
          "not-applicable",
          `${loaded.row.id} is a ${loaded.row.type}, not a thread; only threads are ` +
            `${action.action === "resolve" ? "resolved" : "reopened"} (SPEC.md §6)`,
        );
      }
      return planFrontmatter(workspace, loaded, { status }, { stampUpdated: true });
    }
    case "move": {
      // `destination` was resolved once for the whole request: a folder that
      // names nothing is the request's fault, not any one document's.
      assertMovable(loaded);
      const plan = planMove(workspace, loaded, destination ?? "");
      if (plan === null) return null;
      return {
        operations: plan.operations,
        stage: plan.stage,
        project: plan.project,
        unproject: plan.unproject,
        keys: docKeys(loaded),
        // A move renames the file and changes not one byte inside it, so there
        // is nothing new for §14 to read.
        validate: null,
      };
    }
    case "tag": {
      const tags = nextTags(loaded.parsed.data["tags"], action.add ?? [], action.remove ?? []);
      return planFrontmatter(workspace, loaded, { tags }, { stampUpdated: true });
    }
    case "review": {
      // SPEC.md §5: recording "still current" is a committed act that is
      // deliberately *not* an edit — staleness runs from `max(updated,
      // reviewed)`, so stamping `updated` would reset the very clock the act is
      // about. Same rule `PUT /api/docs/{id}` follows.
      const reviewed = formatInstant(workspace.now());
      return planFrontmatter(workspace, loaded, { reviewed }, { stampUpdated: false });
    }
    case "delete": {
      const plan = planDelete(workspace, loaded);
      return {
        operations: plan.operations,
        stage: plan.stage,
        project: plan.project,
        unproject: plan.unproject,
        keys: plan.keys,
        validate: null,
        orphanedThreadIds: plan.orphanedThreadIds,
        ...(plan.isThread ? { deletedThreadId: loaded.row.id } : {}),
      };
    }
  }
}

/**
 * Apply one act to a named set of documents, and land it as one commit.
 *
 * The whole act runs inside every named document's write lane, so it is
 * serialized against every other mutation to those documents for its entire
 * length — which is what makes `changed` and the commit the same set rather than
 * two answers a concurrent save could pull apart. `runInLanes` sorts, so an
 * arbitrary set cannot deadlock against a thread deletion's `[thread, parent]`.
 */
export async function applyBulkAction(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  request: BulkActionRequest,
): Promise<BulkActionResult> {
  const { action } = request;

  // Before anything is read or written: an agent may not delete, and whether the
  // documents exist is not information the refusal depends on (§9.2). The
  // refusal is the request's, never a per-document outcome.
  if (action.action === "delete" && actor === "agent") throw forbidden(AGENT_DELETE_MESSAGE);

  const ids = collapse(request.ids);
  // Resolved once, and outside the lanes: a folder that could never be written
  // to is a `400` for the call, not twenty identical refusals.
  const destination = action.action === "move" ? resolveFolder(action.folder) : null;

  // A deleted anchored thread rewrites its **parent's** frontmatter (§6), so the
  // parent's lane is held too — and, per sprint-006 Adjudication 1, its lock can
  // refuse the deletion. Read before the lanes, because which lanes to hold is a
  // question only each document's own frontmatter answers; an id that fails to
  // load here is refused inside, on the read that counts.
  const parents = new Map<string, string>();
  if (action.action === "delete") {
    for (const id of ids) {
      try {
        const anchored = anchoredThreadParent(
          loadDocument(workspace.workspaceRoot, workspace.projection, id),
        );
        if (anchored !== null) parents.set(id, anchored.parentId);
      } catch {
        // Unreadable now is unreadable inside the lanes too, where it is
        // reported as this document's own refusal.
      }
    }
  }

  return runInLanes(mutex, [...ids, ...parents.values()], () =>
    runBulk(workspace, actor, ids, action, destination, parents),
  );
}

async function runBulk(
  workspace: DocsWorkspace,
  actor: Actor,
  ids: readonly string[],
  action: BulkAction,
  destination: string | null,
  parents: ReadonlyMap<string, string>,
): Promise<BulkActionResult> {
  const guard = workspace.assertWritable ?? ((): void => undefined);

  const changed: string[] = [];
  const alreadyInState: string[] = [];
  const refused: BulkActionRefusal[] = [];
  const orphanedThreadIds: string[] = [];
  const deletedThreadIds: string[] = [];
  const stage: string[] = [];
  const project: string[] = [];
  const unproject: string[] = [];
  const keys: QueryKey[] = [];
  const warnings: Warning[] = [];

  for (const id of ids) {
    let loaded: LoadedDocument;
    let plan: DocumentPlan | null;
    try {
      await guard(id, actor);
      const parentId = parents.get(id);
      // The lock that refuses a cascade is the one on the file being rewritten.
      if (parentId !== undefined) await guardCascadeParent(guard, id, parentId, actor);
      loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    } catch (error) {
      refused.push(refusalFor(workspace, id, error, "invalid"));
      continue;
    }

    try {
      plan = planFor(workspace, loaded, action, destination);
    } catch (error) {
      // Everything else `planFor` raises means "this act does not apply to this
      // document". A destination that is already taken means the write could not
      // happen — a different sentence and a different remedy (rename something,
      // rather than refresh a board that is perfectly current).
      refused.push(
        error instanceof DestinationOccupiedError
          ? occupiedRefusal(id, error)
          : refusalFor(workspace, id, error, "not-applicable"),
      );
      continue;
    }
    if (plan === null) {
      alreadyInState.push(id);
      continue;
    }

    try {
      if (plan.validate !== null) {
        warnings.push(...validateBeforeWrite(workspace, plan.validate.path, plan.validate.text));
      }
    } catch (error) {
      refused.push(refusalFor(workspace, id, error, "invalid"));
      continue;
    }

    try {
      applyOperations(workspace, id, plan.operations);
    } catch (error) {
      // "Nothing about this document reached the commit" — the group rolled
      // itself back, so there is nothing of it on disk to stage either. The
      // failure is reported here rather than allowed to abort the act: the
      // documents already written would otherwise be left uncommitted, which is
      // a worse outcome than a refusal the caller can see. `refusalFor` logs it.
      refused.push(refusalFor(workspace, id, error, "write-failed"));
      continue;
    }

    changed.push(id);
    stage.push(...plan.stage);
    project.push(...plan.project);
    unproject.push(...plan.unproject);
    keys.push(...plan.keys);
    orphanedThreadIds.push(...(plan.orphanedThreadIds ?? []));
    if (plan.deletedThreadId !== undefined) deletedThreadIds.push(plan.deletedThreadId);
  }

  // **A thread this act deleted is not a surviving orphan.** `planDelete` answers
  // "what threads hang from this document" from the projection, and the
  // projection only moves in `finishMutation` — after the whole loop, because the
  // act is one commit and one re-projection. So a plan made for a parent still
  // sees the row of a thread an earlier plan in the same act already unlinked,
  // and the act would report an id in both `changed` and `orphanedThreadIds`:
  // deleted and, in the same breath, "still readable, drop its caches". §11's
  // bulk-delete confirm counts exactly this number, so it would over-count.
  //
  // Filtered here rather than inside `planDelete`, which is shared with
  // `DELETE /api/docs/{id}` where the projection is never behind, and filtered
  // after the loop rather than during it so the answer does not depend on the
  // order the ids arrived in. A thread whose own deletion was *refused* is
  // absent from `deletedThreadIds` and stays reported, which is correct: it did
  // survive.
  const deleted = new Set(deletedThreadIds);
  const result = {
    action: action.action,
    changed,
    alreadyInState,
    refused,
    orphanedThreadIds: [...new Set(orphanedThreadIds)].filter((id) => !deleted.has(id)),
  };

  // "An act that changes nothing makes no commit at all": no files moved, so
  // there is nothing to commit, nothing to re-project and nothing to announce.
  if (changed.length === 0) return { ...result, commit: null, warnings };

  const commit = await finishMutation(workspace, {
    // The representative of the set — see `finishMutation`. `docIds` is what the
    // trailers and §4's commit rule read.
    docId: changed[0] ?? "",
    docIds: changed,
    actor,
    plan: {
      stage: [...new Set(stage)],
      project: [...new Set(project)],
      unproject: [...new Set(unproject)],
      commit: { subject: commitSubject(action.action, changed.length, actor) },
      // One frame for the act, carrying every affected key once (§9.2) — never
      // one frame per document.
      keys: dedupeKeys(keys),
      mayChangeTree: TREE_MOVING_ACTIONS.has(action.action),
    },
  });

  // After the commit, never before: bytes removed for a deletion that then
  // failed are unrecoverable, while bytes left behind for a moment are not.
  for (const threadId of deletedThreadIds) {
    removeThreadAttachments(workspace.attachmentsRoot, threadId);
  }

  return {
    ...result,
    commit:
      commit !== null && (commit.kind === "committed" || commit.kind === "amended")
        ? commit.sha
        : null,
    warnings: [...warnings, ...commitWarnings(commit)],
  };
}

/**
 * The commit's subject (SPEC.md §4: "its message names the action and the
 * documents it changed").
 *
 * The subject names the act and how many documents it changed; the documents
 * themselves are named in the message **body**, one `Corpus-Doc` trailer each,
 * because a selection is legitimately thousands of documents and a subject line
 * is one line. `git log --format=%s` therefore reads as a list of acts, and
 * `git show` names every document.
 */
export function commitSubject(action: BulkAction["action"], count: number, actor: Actor): string {
  return `bulk ${action}: ${String(count)} document${count === 1 ? "" : "s"} by ${actor}`;
}
