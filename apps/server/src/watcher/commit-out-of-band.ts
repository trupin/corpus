// Committing what an outside editor changed (SPEC.md §4, SERVER-090).
//
// §2 rule 1 makes an out-of-band edit a **supported** act, and §4 makes `git log`
// the audit trail of who changed what. Until this module existed those two were
// in contradiction: the watcher reconciled anchors and re-projected, and stopped
// there. The change reached git only when the *next* server mutation to the same
// document staged it — `git add -A -- <path>` takes the file's working-tree
// content, whoever wrote it — so a person's paragraph was committed under the
// agent's name, with the agent's subject, and a reader had no way to tell.
// Absent a later mutation it stayed uncommitted indefinitely.
//
// §4 says exactly what this has to be, and it is deliberately unremarkable:
//
//   "**An out-of-band edit belongs to the person at the machine.** A change the
//   watcher picks up from outside the server (§9.1) is a `user` edit: it closes
//   the agent's window if one is open, then joins — or opens — the user's,
//   exactly like editing in the board. Nothing about it is an act and nothing
//   announces it, so the idle window is what commits it."
//
// So this is an **ordinary save**, and the whole of that sentence falls out of
// `AutoCommitter.commit` for free: the party-scoped fold key closes the agent's
// window on the actor change, the absent `act` flag leaves the window unnamed so
// its close relabels it `editing session: N documents by user`, and the absent
// `docIds`/`squash` leave it foldable in both directions. An external editor that
// saves as you type therefore produces one commit per editing session, as the
// board does, not one per save.
//
// **Why not SERVER-007's `reconcile: anchors on <docId> after external edit`.**
// That subject was specified in a sprint that predates §4's commit-window rider
// and §7's 2026-08-12 loop-safety amendment, and both now rule against it. It
// would be *false* on the overwhelming majority of out-of-band edits, which have
// no anchors to reconcile; it would announce the change as its own kind of event
// where §4 says "nothing announces it"; and §7's amendment asks that the
// operator's recovery "leaves the same visible trace every other change does" —
// the *same* trace, not a distinguishable one. What tells this apart from a
// mutation the server performed is the thing §4 actually nominates for the job:
// the author. It is `user`, because the watcher cannot know it was anyone else
// and a person editing their own files is the only actor §2 rule 1 describes.
//
// **A removal here is an ordinary save, and that is now safe (PR #43 review).**
// This module used to argue the point at length: §4's "a **deletion** closes the
// open window, lets that commit land, and then commits the deletion by itself"
// sits in a list of *acts*, and §4's out-of-band paragraph says in as many words
// that nothing the watcher picks up is one, so a removal folded like any save.
// The review found what that costs. Three ordinary out-of-band changes inside one
// window — edit A (commit `C1` holds A), create B (`C1` amended, holds A+B),
// delete B — folded the third into `C1`, and `C1` then held A alone. B's bytes
// were in no commit at all. That is §4's own stated reason ("a document created
// and deleted inside one window would otherwise leave nothing in git to recover
// from"), reached by a different door than the verb.
//
// The two paragraphs turn out not to be in tension, because they answer different
// questions. "Nothing about it is an act and nothing announces it" is about how
// the history **reads** — whether the change closes a window and takes a subject
// naming what it did — and it still holds here in full. "A deletion ... commits
// by itself" is about whether the content a removal takes away stays
// **recoverable**; its reason names no verb and no actor, only a window, a create
// and a delete, and §7's claim it protects ("deletion is user-only, git preserves
// history") is a claim about the workspace rather than about
// `DELETE /api/docs/{id}`.
//
// So the fix is not here. Recoverability is a property of the **amend**, not of
// the caller, and the amend already had a guard for one instance of it —
// `amendWouldEmptyHead`, whose own comment names "a document created and deleted
// inside the same idle window" as its canonical trigger. It only ever caught the
// case where the window held nothing else. `git/commit.ts` now asks the general
// question (`amendWouldOrphanContent`), which covers every caller and leaves this
// one saying exactly what §4 says it is: an ordinary save.
//
// Two things that were tried and reverted, because they belong to the act rule
// and not to the data rule: passing `squash: false` on a removal, and joining a
// rename's halves before git sees them. Both made a removal unfoldable, and a
// removal has to stay foldable — `mv` reaches chokidar as unlink-then-add, and
// on a real server the two halves land in **different** batches, so what makes
// git report `R100` rather than a deletion followed by an unrelated creation is
// precisely the add folding into the unlink's commit. Measured live: with the
// removal standing alone, one `mv` became `doc delete: Mortgage` followed by
// `doc edit: Mortgage` — a subject asserting a deletion that never happened.
//
// **Nothing here writes a file**, so the document's key (§7) stays where the
// reconciliation left it — the key is a digest of the file's bytes, and this
// touches none.
//
// **And nothing here reads one either (SERVER-142).** A commit used to take the
// working tree as it stands, which is what made the anchor reconciliation's
// rewrite and the person's own edit land together as one change. It also meant
// the tree was read at the moment the commit *ran*, and a commit runs later than
// the flush that found it: `flush()` is synchronous and a commit is not, so the
// batch is handed to a promise chain. A server write landing in that gap put its
// own bytes into the person's commit under the `user` author — and where the
// server had already committed them, left the person's edit in no commit at all.
// Both were measured on a real server. So the flush hands over the **bytes it
// observed**, `CommitRequest.snapshot` carries them, and the two changes still
// land together because the snapshot is taken after reconciliation has written.

import type { Actor } from "@corpus/contract";
import type { AnchorChange, AutoCommitter } from "../git/index.js";
import { silentLogger, type Logger } from "../logger.js";

/** The one party an out-of-band change can be attributed to (SPEC.md §4). */
const OUT_OF_BAND_ACTOR: Actor = "user";

/**
 * One document the watcher saw change on disk without having written it.
 *
 * `docId` is the document the *path* belongs to, taken from the projection —
 * before the row is dropped for a removal, after it is rebuilt otherwise. A path
 * the projection cannot name a document for is not represented here at all: see
 * {@link createOutOfBandCommitter}.
 */
export interface OutOfBandChange {
  readonly docId: string;
  /**
   * Workspace-relative POSIX paths this document's change occupies — what git is
   * asked to stage.
   *
   * Almost always one. It is two for a rename whose halves reached the watcher
   * in the order that hides the removal (`add` before `unlink`): by the time the
   * unlink is processed the old path has no row left to name a document with, so
   * the new name's change carries the old name with it and the commit is a
   * rename rather than a creation with a deletion left behind.
   */
  readonly paths: readonly string[];
  readonly title: string;
  readonly type: string;
  /** The file is gone: someone deleted or moved it away outside the server. */
  readonly removed: boolean;
  /**
   * What each of {@link OutOfBandChange.paths} held **when the flush observed
   * it** — post-reconciliation, which is what makes the remapped `anchors` block
   * and the person's own edit one change. `null` for a path observed as gone.
   *
   * Required rather than optional, so no path through this module can hand git
   * a change without the bytes it is a change *to* (SERVER-142).
   */
  readonly snapshot: ReadonlyMap<string, Buffer | null>;
  /** What reconciliation moved, when it ran — the `Corpus-Anchors` trailer (§6). */
  readonly anchors?: AnchorChange | undefined;
}

/**
 * The subject the interim commit carries, in the grammar the board's own writes
 * use (`docs/update.ts`, `docs/delete.ts`) because §4 makes this the same kind of
 * change: "exactly like editing in the board".
 *
 * It is nearly always transient. A window that no act named is relabelled
 * `editing session: N documents by user` when it closes, so this is what a
 * `git log` run by hand *while the window is still open* sees — §4's "one reader
 * that cannot be flushed".
 */
export function outOfBandSubject(change: OutOfBandChange): string {
  if (change.removed) {
    const noun = change.type === "thread" ? "thread" : "doc";
    return `${noun} delete: ${change.title} (${change.docId}) by ${OUT_OF_BAND_ACTOR}`;
  }
  return `doc edit: ${change.title} (${change.docId}) by ${OUT_OF_BAND_ACTOR}`;
}

export type CommitOutOfBandChanges = (changes: readonly OutOfBandChange[]) => Promise<void>;

export interface OutOfBandCommitterOptions {
  readonly git: AutoCommitter;
  readonly logger?: Logger | undefined;
}

/**
 * Commits a batch of out-of-band changes, one document at a time.
 *
 * One `commit` call per document rather than one per batch, because that is what
 * a window *is*: each call folds into the party's open window, so a batch of
 * three edited documents is one commit carrying three `Corpus-Doc` trailers —
 * the same commit three separate saves a second apart would have produced.
 * Handing the committer a set of documents instead would mean `docIds`, which is
 * how a caller declares an **act** (§4's "One action, one commit"), and an
 * external editor saving three files is not one act.
 *
 * Sequential and awaited: `AutoCommitter.commit` serializes on the git lock
 * anyway, and folding depends on each call seeing the window the previous one
 * left. Never throws — §11 already rules that a mutation stands when its commit
 * does not, and `AutoCommitter` logs a refusal itself.
 */
export function createOutOfBandCommitter(
  options: OutOfBandCommitterOptions,
): CommitOutOfBandChanges {
  const logger = options.logger ?? silentLogger;
  return async (changes) => {
    for (const change of changes) {
      const outcome = await options.git.commit({
        docId: change.docId,
        actor: OUT_OF_BAND_ACTOR,
        subject: outOfBandSubject(change),
        paths: change.paths,
        snapshot: change.snapshot,
        ...(change.anchors === undefined ? {} : { anchors: change.anchors }),
      });
      if (outcome.kind === "committed" || outcome.kind === "amended") {
        logger.debug("committed an out-of-band edit", {
          paths: [...change.paths],
          docId: change.docId,
          sha: outcome.sha,
          folded: outcome.kind === "amended",
        });
      }
    }
  };
}
