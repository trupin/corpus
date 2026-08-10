// `POST /api/docs/bulk` — a column's **staged set**, applied as **one act and
// one commit** (SPEC.md §4's "One action, one commit", §11's bulk mode; riders
// signed 2026-08-05 and 2026-08-09).
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
// **A mix of verbs is still one act** (SHARED-032; §4, in signed text: "a Save
// carrying a mix of verbs is still one act and still one commit — archiving
// three documents and resolving two is one pass, so it is one commit, not one
// per verb"). Concretely that means the planner is chosen **per document**
// rather than once for the request: `planFor` runs against a row's own act, and
// nothing else about the shape above moves. Grouping the staged set by verb and
// running the loop once per group would write the same files and produce several
// commits, so it would satisfy every assertion about *files* while breaking the
// one §4 is about — which is why the loop below is over rows and never over
// verbs (SERVER-087).
//
// **Where the rows come from.** Enumerated `entries` are the staged rows, in
// request order; §11's whole-result-set selection is one further entry carrying
// one act for everything a query matches, resolved into ids by
// `docs/selection.ts` when the Save runs and covering everything **except** the
// ids `entries` names — so no document is ever staged twice and the act needs no
// precedence rule. An id repeated inside `entries` is the contract's `400`
// (CONTRACT-048), refused before this file runs and deliberately not re-derived
// here: last-write-wins would be a silent choice about someone's documents.
//
// **The act's report and the commit are one computation — containment, in one
// direction.** Only a write that landed puts an id in `changed`, and only those
// writes are staged, so **every document `changed` names has a file in that
// commit** and `git show --name-only` lists it, while a document that was
// refused or was already in the target state wrote nothing **of its own**. Its
// files may still be in the commit, carried there by another document's act:
// archiving a skill that nests a second *requested* skill moves the nested
// one's file while refusing it by id, so the commit does record something the
// caller was told did not happen. That is SERVER-078's territory, not a
// property of this route — the id it refused by is the one the move changed.
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

import {
  BULK_ACTION_NAMES,
  type Actor,
  type BulkAction,
  type BulkActionName,
  type BulkActionOutcome,
  type BulkActionRefusal,
  type BulkActionRequest,
  type BulkActionResult,
  type BulkRefusalReason,
  type Lock,
  type QueryKey,
  type Warning,
} from "@corpus/contract";
import { removeThreadAttachments } from "../attachments/index.js";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import { DOCS_KEY, dedupeKeys, docKey, threadKey } from "../events/index.js";
import { HttpError, forbidden } from "../errors.js";
import {
  carriedDocumentIds,
  carriedWarnings,
  planSetArchived,
  type CarriedDocument,
} from "./archive.js";
import { AGENT_DELETE_MESSAGE, anchoredThreadParent, planDelete } from "./delete.js";
import { assertMovable, planMove } from "./move.js";
import { loadDocument, type LoadedDocument } from "./read.js";
import { resolveWholeResultSet } from "./selection.js";
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
   * The documents this row's share of the act carried — §7's skill folder move
   * taking a nested `SKILL.md` with it (CONTRACT-047). Turned into warnings by
   * {@link carriedWarnings} once the write has landed, and never into a fourth
   * part of the result: the three parts partition the ids the request named, and
   * a carried document was not one of them (PR #37).
   */
  readonly carried?: readonly CarriedDocument[];
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
 *
 * **Asked per row, not per request** (SERVER-087). It used to be one question
 * about the act's single verb; a Save that moves one document and tags another
 * would then have measured nothing and left the badge stale, because the request
 * as a whole has no verb to ask about. It is asked of the rows whose write
 * actually **landed**: a refused row wrote nothing, so it can have moved
 * nothing, and the answer here only ever decides whether the measurement is
 * worth taking.
 */
const TREE_MOVING_ACTIONS: ReadonlySet<BulkActionName> = new Set([
  "archive",
  "unarchive",
  "move",
  "delete",
]);

/**
 * One staged row, resolved: the document, the act staged against it, and — for
 * a `move` — where that act sends it.
 *
 * `destination` is resolved **once per distinct folder and outside every lane**,
 * because a folder that names nothing is the request's fault rather than any one
 * document's: it is a `400` for the call, not twenty identical refusals. Two
 * rows may legitimately name different folders in one Save, which is why it is a
 * property of the row rather than of the act.
 */
type StagedRow = {
  readonly id: string;
  readonly action: BulkAction;
  readonly destination: string | null;
};

/** The two acts that are only meaningful on a thread (SPEC.md §6). */
const THREAD_ONLY_STATUS: Partial<Record<BulkActionName, "resolved" | "open">> = {
  resolve: "resolved",
  reopen: "open",
};

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
  row: StagedRow,
  error: unknown,
  fallback: BulkRefusalReason,
): BulkActionRefusal {
  const id = row.id;
  const action = row.action.action;
  if (error instanceof Refusal) {
    return { id, action, reason: error.reason, message: error.message, lock: error.lock };
  }
  if (error instanceof HttpError) {
    if (error.status === 423 && "lock" in error.body && error.body.lock !== undefined) {
      return { id, action, reason: "locked", message: error.message, lock: error.body.lock };
    }
    if (error.status === 404)
      return { id, action, reason: "not-found", message: error.message, lock: null };
    if (error.status < 500)
      return { id, action, reason: fallback, message: error.message, lock: null };
  }
  workspace.logger.error("a bulk act could not apply to a document", {
    docId: id,
    action,
    reason: fallback,
    error: String(error),
  });
  return {
    id,
    action,
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
function occupiedRefusal(row: StagedRow, error: DestinationOccupiedError): BulkActionRefusal {
  const detail = "issues" in error.body ? error.body.issues[0]?.message : undefined;
  return {
    id: row.id,
    action: row.action.action,
    reason: "write-failed",
    message: detail === undefined ? error.message : `${error.message}: ${detail}`,
    lock: null,
  };
}

/**
 * The lock guard on a document this act writes **without having been asked
 * about it** — §6's cascade parent, §7's carried skill — reported so the row
 * says which document is actually locked.
 *
 * The refusal stays filed under the *requested* id: the three parts partition
 * the requested ids, and neither the parent nor a carried skill need even be
 * among them. But everything in that row that names a document has to name the
 * locked one, or a person reads "locked" beside the document they acted on and
 * clears *its* lease, which changes nothing. `lock` already does (`Lock` carries
 * its own `docId`, and this is the lease whose clearing unblocks the act); the
 * message says so in words instead of leaving a reader to notice that the id in
 * the sentence is not the id in the row (SERVER-077 review, finding 5).
 */
async function guardRelated(
  guard: WriteGuard,
  relatedId: string,
  actor: Actor,
  explain: (holder: Actor) => string,
): Promise<void> {
  try {
    await guard(relatedId, actor);
  } catch (error) {
    if (error instanceof HttpError && error.status === 423 && "lock" in error.body) {
      const lock = error.body.lock;
      if (lock !== undefined) throw new Refusal("locked", explain(lock.holder), lock);
    }
    throw error;
  }
}

const cascadeParentLocked =
  (id: string, parentId: string) =>
  (holder: Actor): string =>
    `deleting ${id} rewrites its parent ${parentId}'s anchors in the same commit ` +
    `(SPEC.md §6), and ${parentId} is being edited by ${holder}; the lock to clear ` +
    `is ${parentId}'s, not ${id}'s`;

const carriedSkillLocked =
  (verb: string, id: string, carriedId: string) =>
  (holder: Actor): string =>
    `to ${verb} ${id} its whole skill folder moves (SPEC.md §7), which rewrites ` +
    `${carriedId}'s file in the same commit, and ${carriedId} is being edited by ${holder}; ` +
    `the lock to clear is ${carriedId}'s, not ${id}'s`;

/**
 * Note where a plan just moved documents that are not its own, so a later id in
 * the same act finds its file.
 *
 * Read off the operations that landed rather than tracked by the planner: the
 * operation is the thing that actually moved the bytes, so the map cannot drift
 * from the disk the way a second bookkeeping list would. Only `renameDir`
 * carries other documents — `renameFile` moves the requested document itself,
 * whose row is corrected by the re-projection like every other.
 */
function recordRelocations(
  relocated: Map<string, string>,
  operations: readonly FileOperation[],
): void {
  for (const operation of operations) {
    if (operation.kind !== "renameDir") continue;
    const prefix = `${operation.from}/`;
    for (const path of operation.documents) {
      if (path.startsWith(prefix)) {
        relocated.set(path, `${operation.to}/${path.slice(prefix.length)}`);
      }
    }
  }
}

/** The one act, as it applies to one document. */
function planFor(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  action: BulkAction,
  destination: string | null,
  held: ReadonlySet<string>,
): DocumentPlan | null {
  switch (action.action) {
    case "archive":
    case "unarchive": {
      const plan = planSetArchived(workspace, loaded, action.action === "archive", held);
      if (plan === null) return null;
      return {
        operations: plan.operations,
        stage: plan.stage,
        project: plan.project,
        unproject: plan.unproject,
        keys: docKeys(loaded),
        validate: plan.text === null ? null : { path: plan.path, text: plan.text },
        carried: plan.carried,
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
 * The staged set as rows this file can run: enumerated entries in request order,
 * then §11's whole-result-set entry expanded into the ids its query matches,
 * minus the ids `entries` already names.
 *
 * The exclusion is the contract's (CONTRACT-048 decision 4) and it is what makes
 * the whole act need no tie-break: a row somebody staged by hand keeps the verb
 * they chose, and no document is covered twice. Uniqueness *within* `entries` is
 * the contract's too — a repeat is a `400` before the handler — so it is not
 * re-derived here.
 */
function stageRows(workspace: DocsWorkspace, request: BulkActionRequest): StagedRow[] {
  const folders = new Map<string, string>();
  const destinationFor = (action: BulkAction): string | null => {
    if (action.action !== "move") return null;
    const known = folders.get(action.folder);
    if (known !== undefined) return known;
    const resolved = resolveFolder(action.folder);
    folders.set(action.folder, resolved);
    return resolved;
  };

  const rows: StagedRow[] = request.entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    destination: destinationFor(entry.action),
  }));

  const whole = request.wholeResultSet;
  if (whole !== undefined) {
    const enumerated = new Set(rows.map((row) => row.id));
    const destination = destinationFor(whole.action);
    for (const id of resolveWholeResultSet(workspace, whole)) {
      if (enumerated.has(id)) continue;
      rows.push({ id, action: whole.action, destination });
    }
  }
  return rows;
}

/**
 * The lanes the act must hold: every staged document, plus every document a
 * planner reaches without having been asked about it.
 *
 * Both extra sets are read **before** the lanes are taken, because which lanes
 * to hold is a question only each document's own frontmatter answers. A mixed
 * Save touches more planners than a single-verb one — a delete row and an
 * archive row in the same request contribute a cascade parent and a carried
 * skill respectively — so the union is larger, never different in kind.
 *
 * An id that fails to load here is simply not represented; it is refused inside
 * the lanes, on the read that counts.
 */
function lanesFor(
  workspace: DocsWorkspace,
  rows: readonly StagedRow[],
): {
  readonly parents: Map<string, string>;
  readonly carried: Set<string>;
} {
  // A deleted anchored thread rewrites its **parent's** frontmatter (§6), so the
  // parent's lane is held too — and, per sprint-006 Adjudication 1, its lock can
  // refuse the deletion.
  const parents = new Map<string, string>();
  // §7's skill folder move *writes* every other `SKILL.md` under the folder — it
  // stamps the id the move would otherwise re-mint (SERVER-078) — so those
  // documents' lanes are held too, on the same reasoning as a cascaded parent's
  // and by the same pre-lane read (PR #38, finding 3).
  const carried = new Set<string>();

  for (const row of rows) {
    const act = row.action.action;
    if (act !== "delete" && act !== "archive" && act !== "unarchive") continue;
    try {
      const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, row.id);
      if (act === "delete") {
        const anchored = anchoredThreadParent(loaded);
        if (anchored !== null) parents.set(row.id, anchored.parentId);
        continue;
      }
      for (const carriedId of carriedDocumentIds(workspace, loaded, act === "archive")) {
        carried.add(carriedId);
      }
    } catch {
      // Unreadable now is unreadable inside the lanes too, where it is reported
      // as this document's own refusal — on the read that counts.
    }
  }
  return { parents, carried };
}

/**
 * Apply a staged set to the documents it names, and land it as one commit.
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
  // Before anything is read or written: an agent may not delete, and whether the
  // documents exist is not information the refusal depends on (§9.2). The
  // refusal is the request's, never a per-document outcome — **including when
  // the delete is one row of five**: a staged set is not a way to smuggle a
  // delete past §9.2, so the whole Save is refused rather than four rows of it
  // applied. `wholeResultSet` cannot spell `delete` at all (§11), which the
  // contract makes a type error rather than a check anyone here could forget.
  if (actor === "agent" && request.entries.some((entry) => entry.action.action === "delete")) {
    throw forbidden(AGENT_DELETE_MESSAGE);
  }

  const rows = stageRows(workspace, request);
  const { parents, carried } = lanesFor(workspace, rows);
  const held = new Set([...rows.map((row) => row.id), ...carried, ...parents.values()]);
  return runInLanes(mutex, [...held], () => runBulk(workspace, actor, rows, parents, held));
}

async function runBulk(
  workspace: DocsWorkspace,
  actor: Actor,
  rows: readonly StagedRow[],
  parents: ReadonlyMap<string, string>,
  held: ReadonlySet<string>,
): Promise<BulkActionResult> {
  const guard = workspace.assertWritable ?? ((): void => undefined);

  const changed: BulkActionOutcome[] = [];
  const alreadyInState: BulkActionOutcome[] = [];
  const refused: BulkActionRefusal[] = [];
  const orphanedThreadIds: string[] = [];
  const deletedThreadIds: string[] = [];
  const stage: string[] = [];
  const project: string[] = [];
  const unproject: string[] = [];
  const keys: QueryKey[] = [];
  const warnings: Warning[] = [];
  // The ids the caller named — what a carried warning is never about.
  const requested = new Set(rows.map((row) => row.id));
  // Where this act has already moved a document's file, old path to new. §7's
  // skill folder move relocates every `SKILL.md` under it, including ones the
  // act names later — and the projection does not move until `finishMutation`,
  // so without this the later id loads a path the act itself emptied and is
  // refused `not-found` while its file rides in the commit (SERVER-078).
  const relocated = new Map<string, string>();
  // Whether any write that *landed* could have moved a folder badge — asked of
  // each row's own act, since a Save carrying a mix has no single verb to ask
  // about (SERVER-087). `finishMutation` still decides `["tree"]` by measuring.
  let mayChangeTree = false;

  for (const row of rows) {
    const { id, action } = row;
    let loaded: LoadedDocument;
    let plan: DocumentPlan | null;
    try {
      await guard(id, actor);
      const parentId = parents.get(id);
      // The lock that refuses a cascade is the one on the file being rewritten.
      if (parentId !== undefined) {
        await guardRelated(guard, parentId, actor, cascadeParentLocked(id, parentId));
      }
      loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id, relocated);
      // The same rule one lane deeper: a folder move rewrites the files of the
      // skills it carries, so a lease on one of them refuses this document's
      // share of the act (the refusal names the locked document, and `lock`
      // carries its id).
      if (action.action === "archive" || action.action === "unarchive") {
        for (const carriedId of carriedDocumentIds(
          workspace,
          loaded,
          action.action === "archive",
        )) {
          await guardRelated(
            guard,
            carriedId,
            actor,
            carriedSkillLocked(action.action, id, carriedId),
          );
        }
      }
    } catch (error) {
      refused.push(refusalFor(workspace, row, error, "invalid"));
      continue;
    }

    try {
      plan = planFor(workspace, loaded, action, row.destination, held);
    } catch (error) {
      // Everything else `planFor` raises means "this act does not apply to this
      // document". A destination that is already taken means the write could not
      // happen — a different sentence and a different remedy (rename something,
      // rather than refresh a board that is perfectly current).
      refused.push(
        error instanceof DestinationOccupiedError
          ? occupiedRefusal(row, error)
          : refusalFor(workspace, row, error, "not-applicable"),
      );
      continue;
    }
    if (plan === null) {
      alreadyInState.push({ id, action: action.action });
      continue;
    }

    try {
      if (plan.validate !== null) {
        warnings.push(...validateBeforeWrite(workspace, plan.validate.path, plan.validate.text));
      }
    } catch (error) {
      refused.push(refusalFor(workspace, row, error, "invalid"));
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
      refused.push(refusalFor(workspace, row, error, "write-failed"));
      continue;
    }

    changed.push({ id, action: action.action });
    // After `applyOperations`, never before: a carried warning describes an
    // effect the act *had*, and a row whose operations threw rolled itself back
    // — nothing of it reached the commit, so the folder never moved and no
    // skill's enablement changed. Reporting it there would be §4's rule run
    // backwards, telling the caller about an effect `git log` never records.
    //
    // `requested`, not `held`: the excluded set is the ids the **caller named**,
    // and `held` also contains the lanes this act took *because* of the carry,
    // which would suppress exactly the warnings this exists to emit. A staged
    // set naming both an outer skill and the nested one it carries reports the
    // nested one as a `changed` entry, which is where the contract says a
    // requested document is answered for.
    warnings.push(...carriedWarnings(plan.carried ?? [], requested));
    if (TREE_MOVING_ACTIONS.has(action.action)) mayChangeTree = true;
    recordRelocations(relocated, plan.operations);
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
    changed,
    alreadyInState,
    refused,
    orphanedThreadIds: [...new Set(orphanedThreadIds)].filter((id) => !deleted.has(id)),
  };

  // "An act that changes nothing makes no commit at all": no files moved, so
  // there is nothing to commit, nothing to re-project and nothing to announce.
  // A Save whose every row was refused lands here, and so does one whose
  // whole-result-set query matched nothing when it ran — neither is an error.
  if (changed.length === 0) return { ...result, commit: null, warnings };

  const changedIds = changed.map((outcome) => outcome.id);
  const commit = await finishMutation(workspace, {
    // The representative of the set — see `finishMutation`. `docIds` is what the
    // trailers and §4's commit rule read.
    docId: changedIds[0] ?? "",
    docIds: changedIds,
    actor,
    plan: {
      stage: [...new Set(stage)],
      project: [...new Set(project)],
      unproject: [...new Set(unproject)],
      commit: { subject: commitSubject(changed, actor) },
      // One frame for the act, carrying every affected key once (§9.2) — never
      // one frame per document.
      keys: dedupeKeys(keys),
      mayChangeTree,
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
 *
 * **A mixed Save names every verb it carried, with a count each** —
 * `bulk archive 3, resolve 2: 5 documents by user`. §4 asks the message to name
 * *the action*, and one act now legitimately holds several; naming only the
 * first, or inventing a word like "save" that says nothing, would leave `git log`
 * unable to tell a bulk archive from a bulk delete. The single-verb form is
 * unchanged — a count repeated twice on one line reads as a mistake — so the
 * common case still says `bulk archive: 3 documents by user`.
 *
 * Verbs are named in {@link BULK_ACTION_NAMES} order rather than in the order
 * the rows arrived, so two Saves carrying the same mix produce the same subject
 * and the history stays diffable. Bounded by construction: there are eight acts,
 * so the line can never grow with the selection.
 */
export function commitSubject(changed: readonly BulkActionOutcome[], actor: Actor): string {
  const counts = new Map<BulkActionName, number>();
  for (const outcome of changed) {
    counts.set(outcome.action, (counts.get(outcome.action) ?? 0) + 1);
  }
  const verbs = BULK_ACTION_NAMES.filter((name) => counts.has(name));
  const named =
    verbs.length === 1
      ? (verbs[0] ?? "")
      : verbs.map((verb) => `${verb} ${String(counts.get(verb) ?? 0)}`).join(", ");
  const count = changed.length;
  return `bulk ${named}: ${String(count)} document${count === 1 ? "" : "s"} by ${actor}`;
}
