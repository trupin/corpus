// Auto-commit: the audit trail half of the write path (SPEC.md §4).
//
// "Every mutation the server performs auto-commits the affected files with a
// structured message and with the acting party (`user` or `agent`) as git
// author — `git log` doubles as the audit trail of who changed what."
//
// Three properties carry the weight:
//
// - **Only the author is the actor.** The committer stays the workspace's own
//   configured identity, which is what makes `git log --format='%an'` a clean
//   "who asked for this" column rather than a restatement of "the server did
//   it". A workspace with no configured identity gets a neutral committer
//   fallback rather than a failed commit.
// - **Only the mutation's paths are committed.** Staging is path-scoped and the
//   commit itself is `--only`, so an operator's unrelated dirty (or even
//   staged) file is never swallowed by an autosave — and two mutations to two
//   documents can never cross-contaminate each other's commits.
// - **One commit per act, not per save** (§4's commit-window rider, signed
//   2026-08-10). At most one window is open at a time and it belongs to **one
//   party**: every save that party makes, to whichever document, folds into the
//   same commit until the window closes. Every condition under which that would
//   rewrite something the server did not itself just create is checked first,
//   and the fallback — a fresh commit — is always safe.
//
//   The window's content is in git *at every instant*: the first save commits
//   immediately and each later one amends that commit. "Closing a window" is
//   therefore not a flush of buffered work — there is none — but "stop amending
//   it", plus one final amend that rewrites the subject where no act named it.
//   That is deliberate and adjudicated (SERVER-091): §5 says the file on disk is
//   the truth and §14 says a mutation stands when its commit does not, so an
//   in-memory buffer would lose a crash's worth of commits, where the amend
//   model loses at worst a *boundary* — which is exactly the cost §4 states.
//
//   Because the window's commit is amendable while it is open, **a sha read off
//   an open window is provisional**. §4's answer is that nothing reads a history
//   the window is still holding: any operation that names, reads or reverts a
//   commit closes the window first, in the same critical section as the read
//   ({@link AutoCommitter.withClosedWindow}) — and **every** amend that moves the
//   window's sha announces it ({@link AutoCommitterOptions.onWindowRewritten}):
//   the close's relabel, and each later save folding in. Two sites, one message,
//   so a range already published outside the repository follows the rewrite
//   instead of dangling.
// - **One action, one commit** (§4's other half). A mutation that names several
//   documents — a bulk archive, tag or move — passes them as `docIds`, and that
//   is the whole signal: such a commit neither folds into a preceding editing
//   session nor opens one for a later save to fold into. Nothing about it is
//   inferred from document plus actor, which by construction could only ever
//   produce one commit per document.
// - **No attempt ever leaves the index dirty.** The index is a shared file: a
//   change staged and then not committed is swept up by the *next* commit made
//   by anything at all, the operator's own included. Every outcome that is not
//   a landed commit restores the index to `HEAD` for the paths it staged. The
//   working tree is never touched — the mutation stands (SPEC.md §14), it is
//   simply not staged.

import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Actor } from "@corpus/contract";
import { silentLogger, type Logger } from "../logger.js";
import { gitOutput, type Git, type GitCommandResult } from "./git.js";

/**
 * How long after an auto-commit a further save by the same party still counts
 * as the same commit window (SPEC.md §4's "things going quiet: the same short
 * idle window that folds repeated saves today"). Exported so the value can be
 * read from the code rather than guessed, and adjusted without redesign —
 * sprint-005 Open Conflict 5 pins 30 s.
 */
export const SQUASH_IDLE_MS = 30_000;

/**
 * The longest a window may stay open, however busy it stays (SPEC.md §4 — "No
 * window stays open indefinitely"). Once a window has been open this long the
 * next save opens a fresh one, so an unbroken hour of writing is several commits
 * rather than one and an unclean stop costs a boundary rather than a session.
 *
 * Five minutes, chosen against the two intervals it has to live beside rather
 * than for its own sake: comfortably longer than {@link SQUASH_IDLE_MS} (or
 * ageing out would be the *usual* way a window ends rather than the backstop it
 * is meant to be), and longer than `EDIT_ACK_IDLE_MS` (3 min), so an idle edit
 * session's acknowledgment names a commit the window had already settled on.
 *
 * The number is deliberately here and not in SPEC.md: §4 guarantees that a
 * window ages out, not the interval it ages out at.
 */
export const WINDOW_MAX_MS = 300_000;

export const TRAILER_DOC = "Corpus-Doc";
export const TRAILER_ACTOR = "Corpus-Actor";
export const TRAILER_ANCHORS = "Corpus-Anchors";

/**
 * Why a window stopped taking saves. Informational — it reaches the log and
 * nothing else, because what a close *does* is decided by the window (was it
 * named by an act?) rather than by who asked for it. Naming the cases anyway
 * keeps a closed window's log line answerable and gives §4's list of closers one
 * place in the code where it is written down.
 */
export type WindowCloseReason =
  /** A discrete act completed — a turn posted, a thread resolved, a document archived (SERVER-092). */
  | "act"
  /** The other party wrote: a window belongs to one party, so theirs ends first. */
  | "party-change"
  /** A deletion or a staged bulk Save — §4's two acts that commit alone. */
  | "commits-alone"
  /** The window has been open longer than {@link WINDOW_MAX_MS}. */
  | "aged-out"
  /**
   * The idle gap elapsed, or the window's commit is no longer ours to amend —
   * anything that made the next save a fresh commit without naming a cause.
   */
  | "superseded"
  /** Something named, read or reverted a commit and must not see a held history (SERVER-093). */
  | "read-back"
  /** The server is stopping cleanly (SERVER-094). */
  | "shutdown";

/**
 * The subject a window gets when it closes with no act to name it (SPEC.md §4 —
 * "A window that closes with no act to name says so: that it is an editing
 * session, and how many documents it holds"). The count, never the documents: a
 * window can hold many, and the `Corpus-Doc` trailers already name each one.
 */
export const editingSessionSubject = (documents: number, actor: Actor): string =>
  `editing session: ${documents} document${documents === 1 ? "" : "s"} by ${actor}`;

/**
 * Git identity per acting party (SPEC.md §4). Author only — never the committer.
 *
 * The **name is the actor string itself**, not a prettified label: `corpus init`
 * already writes the workspace's bootstrap commit as `user <user@corpus.local>`
 * (CLI-002, `apps/cli/src/commands/init/git.ts`), and `git log --format='%an'`
 * has to read as one uniform "who asked for this" column from the first commit
 * onward rather than switching spelling the moment the server takes over.
 */
export const ACTOR_IDENTITIES: Readonly<Record<Actor, { name: string; email: string }>> = {
  user: { name: "user", email: "user@corpus.local" },
  agent: { name: "agent", email: "agent@corpus.local" },
};

/** Used as the committer only when the workspace configures no `user.email` of its own. */
export const FALLBACK_COMMITTER = { name: "Corpus", email: "corpus@corpus.local" } as const;

/**
 * The author of a **recovery commit** (SPEC.md §4, SERVER-094) — the one commit
 * in a workspace that claims no acting party, and §7's single deliberate
 * exception (SHARED-040 Decision 2, signed by the user 2026-08-09). Which
 * party's window was open is precisely what an unclean stop destroyed, so the
 * alternative is a commit naming a party the server is guessing at.
 *
 * It lives here, beside {@link ACTOR_IDENTITIES} and {@link FALLBACK_COMMITTER},
 * because those three are the workspace's whole cast of git identities and
 * reading them in one place is how one stays distinguishable from the others.
 * It is deliberately **not** an `Actor`: that union is two-membered across the
 * whole contract, and widening it to carry a git-authorship concept would leak
 * "no party" into the API. `git/recovery.ts` therefore reaches git directly
 * rather than through {@link AutoCommitter.commit}.
 *
 * Neither the name nor the email may contain `user` or `agent` as a substring:
 * `git log --author=user` is a regex match over `name <email>`, and §4 requires
 * that it never match this commit.
 */
export const RECOVERY_AUTHOR = { name: "recovery", email: "recovery@corpus.local" } as const;

export const gitAuthorOf = (actor: Actor): string =>
  `${ACTOR_IDENTITIES[actor].name} <${ACTOR_IDENTITIES[actor].email}>`;

export type AnchorChange = {
  readonly remapped: readonly string[];
  readonly orphaned: readonly string[];
};

export interface CommitRequest {
  /**
   * The document the commit is about. It becomes a `Corpus-Doc` trailer and
   * joins the open window's set of documents; it is **not** part of the fold
   * key, which is the acting party alone (SPEC.md §4's commit window). When
   * {@link CommitRequest.docIds} is given it is the *representative* of the set
   * rather than the whole subject — see there.
   */
  readonly docId: string;
  /**
   * **Every document one act changed** (SPEC.md §4's "One action, one commit").
   * Present exactly when this commit is an *act over a named set* — a bulk
   * archive, tag, move — and absent for every ordinary save.
   *
   * Its presence is how the committer is **told** that these writes are one act
   * rather than being left to infer it from document plus actor, and it decides
   * §4's squashing in both directions:
   *
   * - the commit **never folds into** whatever editing session preceded it
   *   ({@link amendTarget} refuses immediately), and
   * - it **opens no session**, so no later save folds into it.
   *
   * That is a derivation rather than a coincidence: §4's squashing is defined
   * over repeated saves of *one* document, and an act over a set is not a save
   * of a document. It holds for a set of one, too — the caller said "an act",
   * not "a save" — which is why the signal is the field's presence and not its
   * length. Each id becomes its own `Corpus-Doc` trailer, so `git log` names
   * every document the act changed even where `--name-only` shows paths.
   */
  readonly docIds?: readonly string[] | undefined;
  readonly actor: Actor;
  readonly subject: string;
  /** Workspace-relative paths (files or directories) this mutation touched. */
  readonly paths: readonly string[];
  readonly anchors?: AnchorChange | undefined;
  /**
   * `false` opts out of window folding **in both directions** — an audit entry
   * is its own event, never part of an edit: it neither folds into the open
   * window nor opens one for a later save to fold into.
   */
  readonly squash?: boolean | undefined;
  /**
   * This write **is the act** that closes the window (SPEC.md §4: "the act's own
   * change is the last thing in the window's commit, and the commit's subject
   * names the act"). Its only effect is on the close that follows: a window a
   * discrete act named keeps that subject, where one that merely went quiet is
   * rewritten to {@link editingSessionSubject}.
   *
   * Set by the act call sites and by nothing else (SERVER-092) — an ordinary
   * save that set it would leave a save's subject on a window that closed with
   * no act, which is the one thing §4 asks the subject to disambiguate. It does
   * not itself close the window: {@link AutoCommitter.closeWindow} does.
   */
  readonly act?: boolean | undefined;
}

export type CommitOutcome =
  | { readonly kind: "committed"; readonly sha: string }
  | { readonly kind: "amended"; readonly sha: string }
  /** No commit was possible or needed; the mutation still stands (SPEC.md §14). */
  | { readonly kind: "skipped"; readonly reason: string }
  /** git refused — most often a workspace hook (SPEC.md §14). The file mutation stands. */
  | { readonly kind: "failed"; readonly reason: string; readonly output: string };

export interface AutoCommitter {
  commit(request: CommitRequest): Promise<CommitOutcome>;
  /** Serializes arbitrary git work against the same index lock the commit path holds. */
  withGitLock<T>(run: () => Promise<T>): Promise<T>;
  /**
   * Close the open commit window (SPEC.md §4). No-op when none is open, and
   * never an error: every caller in §4's list of closers calls it
   * unconditionally, without first asking whether there is anything to close.
   *
   * Closing does not *flush* anything — the window's content has been in git
   * since its first save. What it does is stop later saves folding into that
   * commit, and, where no act named it, rewrite its subject to say it was an
   * editing session and how many documents it holds. The rewrite is an ordinary
   * amend and is refused in exactly the states an ordinary amend is (detached
   * HEAD, mid-operation, published, HEAD moved under us, trailers that are not
   * ours); refusing it is harmless — the commit keeps the last save's subject
   * and the window closes anyway.
   */
  closeWindow(reason: WindowCloseReason): Promise<void>;
  /**
   * Close the open window and then run `read` **without releasing the git lock**
   * (SPEC.md §4 — "Nothing reads a history the window is still holding").
   *
   * This is the whole of §4's read-back rule, and the reason it is one primitive
   * rather than a `closeWindow` followed by a `withGitLock`: between those two
   * calls the lock is free, so an autosave can open a *fresh* window and the read
   * is once again looking at a commit the server intends to amend — the bug in
   * miniature. The close and the read have to be one critical section.
   *
   * Only a reader that names, reads or reverts a **commit** needs it. A
   * projection query, a document read, a tree read and a search touch no git
   * history and must keep costing no git at all; §4's second list is explicit
   * about that, and taking this lock on them would queue every board refresh
   * behind an autosave.
   */
  withClosedWindow<T>(reason: WindowCloseReason, read: () => Promise<T>): Promise<T>;
  /**
   * Forget the open window if it is sitting on `sha`, so the next save by the
   * same party makes a **fresh** commit instead of amending that one.
   *
   * Called when a sha has been published *outside* the repository: §4's edit
   * acknowledgment names a commit range in a queue event, and from there the
   * range reaches the agent, a thread, a log line. Amending the commit such a
   * range ends at leaves it pointing at an object no branch holds, and — because
   * an amend of a one-commit session moves that session's base too — makes the
   * *next* session start again at the same parent, so one change is announced
   * twice under two session ids. It is the rule {@link isPublished} already
   * applies to a commit a remote has seen, applied to the other way a sha gets
   * out (SERVER-052 review, PR #22).
   *
   * Synchronous and lock-free by design, and deliberately **not** a wrapper over
   * {@link AutoCommitter.closeWindow}: it only *forgets* state, which is safe
   * from any point — the cost of forgetting a window that was still foldable is
   * one commit that did not fold — and its caller is a timer that must not queue
   * behind an autosave. Closing needs the git lock for its subject rewrite, and
   * a rewrite is precisely what must not happen here: the sha this is given has
   * been published, so amending it (even only to relabel it) would dangle the
   * very range that named it. Forgetting is the whole obligation; the window is
   * closed in the sense that matters, and its commit keeps its own subject.
   */
  endSquashSession(sha: string): void;
}

export interface AutoCommitterOptions {
  readonly git: Git;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
  readonly squashIdleMs?: number | undefined;
  readonly windowMaxMs?: number | undefined;
  /**
   * Told whenever the open window's commit was **rewritten**, so anything that
   * had recorded the old sha can follow it (SERVER-093, ruling of 2026-08-10).
   *
   * Two sites move a window's sha and both report here, because an amend is an
   * amend either way: same tree, **new sha**.
   *
   * 1. **The close.** Where no act named it, a closing window has its subject
   *    relabelled, and that is an amend.
   * 2. **A fold.** Every later save into the window amends its commit too. Under
   *    §4's party-scoped fold key that save may belong to a *different document*
   *    than the one holding the sha — so the write's own `observeCommit`, which
   *    names only the document written, cannot stand in for this (PR #42 review).
   *
   * Everything inside the server that had only to know "stop amending" is already
   * served by the window being forgotten — this exists for the one thing that had
   * written the sha down, `edit/sessions.ts`, whose `doc.edited` event publishes a
   * commit range outside the repository. Its `observeCommit` is the twin of this:
   * one hears about commits, the other about the rewrites of them.
   *
   * Called from inside the git lock on the commit path, so an implementation
   * must be synchronous and do no I/O — the same contract `observeCommit` has,
   * for the same reason.
   */
  readonly onWindowRewritten?: ((from: string, to: string) => void) | undefined;
}

/**
 * The open commit window (SPEC.md §4) — what the last auto-commit was, so the
 * next save can decide whether to fold into it. At most one exists at a time and
 * it belongs to **one party**, which is the whole of the fold key.
 */
type WindowRecord = {
  /** The party it belongs to. The moment the other one writes, this window closes. */
  readonly actor: Actor;
  /**
   * Every document the window has held, in the order they were first touched —
   * one `Corpus-Doc` trailer each, so `git log` names them all. A `Set` gives
   * both the insertion order and the "a third save to the first document adds no
   * duplicate" property for free.
   */
  readonly docIds: ReadonlySet<string>;
  readonly sha: string;
  /** Instant of the most recent save — the idle window runs from here. */
  readonly at: number;
  /** Instant of the first save — the ageing-out runs from here. */
  readonly openedAt: number;
  /** Did a discrete act set the subject? If so, closing leaves it alone. */
  readonly namedByAct: boolean;
  /** Anchor ids touched anywhere in the window, so an amended message stays truthful. */
  readonly remapped: ReadonlySet<string>;
  readonly orphaned: ReadonlySet<string>;
};

const trailerValues = (body: string, name: string): string[] => {
  const values: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim();
    if (value !== "") values.push(value);
  }
  return values;
};

const trailerValue = (body: string, name: string): string | null =>
  trailerValues(body, name)[0] ?? null;

/** Do the `Corpus-Doc` trailers on a commit name exactly the window's documents? */
const namesExactly = (found: readonly string[], expected: ReadonlySet<string>): boolean => {
  const unique = new Set(found);
  return unique.size === expected.size && [...expected].every((id) => unique.has(id));
};

const buildTrailers = (
  docIds: readonly string[],
  actor: Actor,
  remapped: ReadonlySet<string>,
  orphaned: ReadonlySet<string>,
): string => {
  // One `Corpus-Doc` line per document: git trailers repeat, and a bulk act's
  // subject cannot name a thousand documents on one line.
  const lines = [...docIds.map((id) => `${TRAILER_DOC}: ${id}`), `${TRAILER_ACTOR}: ${actor}`];
  // Omitted entirely when nothing moved: a trailer reading `remapped=0
  // orphaned=0` on every commit would train the reader to ignore it.
  if (remapped.size > 0 || orphaned.size > 0) {
    lines.push(`${TRAILER_ANCHORS}: remapped=${remapped.size} orphaned=${orphaned.size}`);
  }
  return lines.join("\n");
};

/** Union of the window's anchor ids; an anchor that later detached counts as orphaned only. */
const mergeAnchors = (
  previous: { remapped: ReadonlySet<string>; orphaned: ReadonlySet<string> } | null,
  change: AnchorChange | undefined,
): { remapped: Set<string>; orphaned: Set<string> } => {
  const orphaned = new Set([...(previous?.orphaned ?? []), ...(change?.orphaned ?? [])]);
  const remapped = new Set([...(previous?.remapped ?? []), ...(change?.remapped ?? [])]);
  for (const id of orphaned) remapped.delete(id);
  return { remapped, orphaned };
};

export function createAutoCommitter(options: AutoCommitterOptions): AutoCommitter {
  const { git } = options;
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? Date.now;
  const squashIdleMs = options.squashIdleMs ?? SQUASH_IDLE_MS;
  const windowMaxMs = options.windowMaxMs ?? WINDOW_MAX_MS;
  const onWindowRewritten = options.onWindowRewritten;

  /** The one open window, or `null`. §4 allows at most one at a time. */
  let openWindow: WindowRecord | null = null;
  /**
   * `.git/index` is one shared file: two concurrent stage/commit pairs would
   * cross-contaminate each other's commits and can deadlock on the index lock.
   * Every git invocation in the server funnels through here.
   */
  let gitLock: Promise<unknown> = Promise.resolve();

  const withGitLock = <T>(run: () => Promise<T>): Promise<T> => {
    const result = gitLock.then(run, run);
    gitLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /** `null` until asked; the workspace's git identity does not change under a running server. */
  let committerFallback: readonly string[] | null = null;
  const committerFlags = async (): Promise<readonly string[]> => {
    if (committerFallback !== null) return committerFallback;
    const configured = await git.exec(["config", "--get", "user.email"]);
    committerFallback =
      configured.ok && configured.stdout.trim() !== ""
        ? []
        : [
            "-c",
            `user.name=${FALLBACK_COMMITTER.name}`,
            "-c",
            `user.email=${FALLBACK_COMMITTER.email}`,
          ];
    return committerFallback;
  };

  const headSha = async (): Promise<string | null> => {
    const result = await git.exec(["rev-parse", "--verify", "--quiet", "HEAD"]);
    return result.ok && result.stdout.trim() !== "" ? result.stdout.trim() : null;
  };

  const gitPathExists = async (name: string): Promise<boolean> => {
    const result = await git.exec(["rev-parse", "--git-path", name]);
    if (!result.ok) return false;
    const path = result.stdout.trim();
    if (path === "") return false;
    return existsSync(isAbsolute(path) ? path : resolve(git.root, path));
  };

  /** True during a merge, rebase, cherry-pick or revert — never rewrite a commit mid-operation. */
  const midOperation = async (): Promise<boolean> => {
    for (const name of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
    ]) {
      if (await gitPathExists(name)) return true;
    }
    return false;
  };

  /** True when HEAD is reachable from any remote-tracking ref — i.e. already published. */
  const isPublished = async (): Promise<boolean> => {
    const refs = await git.exec(["for-each-ref", "--format=%(refname)", "refs/remotes/"]);
    if (!refs.ok) return false;
    for (const ref of refs.stdout.split("\n").map((line) => line.trim())) {
      if (ref === "") continue;
      const ancestor = await git.exec(["merge-base", "--is-ancestor", "HEAD", ref]);
      if (ancestor.ok) return true;
    }
    return false;
  };

  /**
   * May `HEAD` be rewritten as this window's commit? The half of the question
   * that is about the *repository* rather than about the window, shared by the
   * fold path and by the subject rewrite a close performs — because a subject
   * rewrite is an ordinary amend and §4 refuses it in exactly the same states.
   *
   * Returns the commit's author date, which is the one thing an amend carries
   * over: the window's start, not the moment of its latest save.
   */
  const amendableHead = async (record: WindowRecord): Promise<{ authorDate: string } | null> => {
    // Detached HEAD: an amend there rewrites a commit no branch names.
    if (!(await git.exec(["symbolic-ref", "--quiet", "HEAD"])).ok) return null;
    if (await midOperation()) return null;
    if (await isPublished()) return null;

    // The commit we are about to rewrite must be one *we* made, for *this*
    // window: its trailers name exactly the documents the window has held and
    // the party it belongs to. A set comparison rather than a first-value one,
    // because a window commit carries one `Corpus-Doc` line per document.
    const message = await git.exec(["log", "-1", "--format=%B"]);
    if (!message.ok) return null;
    if (!namesExactly(trailerValues(message.stdout, TRAILER_DOC), record.docIds)) return null;
    if (trailerValue(message.stdout, TRAILER_ACTOR) !== record.actor) return null;

    const authorDate = await git.exec(["log", "-1", "--format=%aI"]);
    if (!authorDate.ok) return null;
    return { authorDate: authorDate.stdout.trim() };
  };

  /**
   * The open window this save folds into, or `null`. Every condition SPEC.md §4
   * names is checked here; a `null` answer always means "close the window and
   * make a fresh commit", which is safe in every repository state.
   *
   * Only the author date is carried over. The *subject* is deliberately the new
   * save's: when different verbs fold into one window commit, a subject frozen
   * at the window's first save ends up describing content that has since been
   * moved, archived or rewritten — `doc create:` on a commit whose diff shows an
   * archived document at a new path. The latest verb is the one that describes
   * what the commit now contains, and a window that closes with no act to name
   * gets an honest subject at the close instead.
   */
  const amendTarget = async (
    request: CommitRequest,
    head: string,
  ): Promise<{ record: WindowRecord; authorDate: string } | null> => {
    // An act over a named set is not a save of a document, so §4's window does
    // not reach it in either direction (see `CommitRequest.docIds`).
    if (request.docIds !== undefined) return null;
    if (request.squash === false || request.paths.length === 0) return null;
    const record = openWindow;
    if (record === null) return null;
    // The whole fold key: a window belongs to a party, not to a document, so a
    // save to a *neighbour* document folds in and a save by the *other party*
    // never does.
    if (record.actor !== request.actor) return null;
    if (now() - record.at >= squashIdleMs) return null;
    // §4's "No window stays open indefinitely": activity keeps a window open,
    // but only so far.
    if (now() - record.openedAt >= windowMaxMs) return null;
    // Anything committed since ours — by a hook, by the operator, by a commit
    // that deliberately stands alone — ends the window: folding would rewrite
    // someone else's work.
    if (record.sha !== head) return null;

    const base = await amendableHead(record);
    return base === null ? null : { record, authorDate: base.authorDate };
  };

  /**
   * Stop amending the open window, and — where no act named it — rewrite its
   * commit's subject to say what it was. Assumes the git lock is held; the
   * public {@link AutoCommitter.closeWindow} is this inside `withGitLock`, and
   * the commit path calls it directly because it already holds the lock.
   */
  const closeWindowLocked = async (reason: WindowCloseReason): Promise<void> => {
    const record = openWindow;
    // Forgotten first and unconditionally: whatever git says next, this window
    // takes no further saves. A close that cannot rewrite the subject is still
    // a close.
    openWindow = null;
    if (record === null) return;
    // §4: "the act's own change is the last thing in the window's commit, and
    // the commit's subject names the act". Nothing to say here that the act has
    // not already said better.
    if (record.namedByAct) return;

    const head = await headSha();
    if (head !== record.sha) return;
    const base = await amendableHead(record);
    if (base === null) return;

    // `--amend --only` with **no** pathspec is a message-only rewrite: it takes
    // no working-tree content and no index content, so an operator's staged work
    // is untouched and so is a save this very commit path has just staged.
    const rewritten = await git.exec([
      ...(await committerFlags()),
      "commit",
      "--amend",
      "--only",
      `--author=${gitAuthorOf(record.actor)}`,
      `--date=${base.authorDate}`,
      "-m",
      editingSessionSubject(record.docIds.size, record.actor),
      "-m",
      buildTrailers([...record.docIds], record.actor, record.remapped, record.orphaned),
    ]);
    if (!rewritten.ok) {
      // Harmless: the commit keeps its last save's subject and the window is
      // closed either way. Worth a line, because a workspace whose hook refuses
      // every amend will never show an editing-session subject.
      logger.info("could not name a closing commit window; it keeps its last subject", {
        reason,
        sha: record.sha,
        output: gitOutput(rewritten),
      });
      return;
    }

    // The relabel is an amend, so the commit that carried this window now has a
    // **different sha** for the same tree. This is the one site in the server
    // that moves a commit out from under something that may have recorded it,
    // so it is the one site that says so (SERVER-093's escalated item). Read
    // back rather than predicted: only git knows what the rewrite produced.
    const relabelled = await headSha();
    if (relabelled !== null && relabelled !== record.sha) {
      onWindowRewritten?.(record.sha, relabelled);
    }
  };

  /**
   * Everything `HEAD` itself contributes, as workspace-relative file paths —
   * its diff against its parent, or its whole tree when it is a root commit.
   */
  const headContribution = async (parent: string | null): Promise<string[] | null> => {
    const result = await git.exec(
      parent === null
        ? ["diff-tree", "--root", "-r", "--name-only", "--no-commit-id", "HEAD"]
        : ["diff", "--name-only", parent, "HEAD"],
    );
    if (!result.ok) return null;
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  };

  /**
   * Would folding this save into `HEAD` leave `HEAD` with nothing to say?
   *
   * git refuses such an amend outright, and the refusal arrives at the worst
   * possible moment: the mutation is already on disk and already staged. Asking
   * first turns the whole case into an ordinary fresh commit — which is what the
   * history should record anyway. The canonical trigger is a document created
   * and deleted inside the same idle window: the create commit's entire content
   * is that one file, and the file is now gone, so amending would restate the
   * parent and the deletion would go unrecorded.
   *
   * The question is answered from plumbing rather than from git's (translatable)
   * prose. Any path `HEAD` changed that this save does not touch survives the
   * amend untouched, so the commit still says something; when everything `HEAD`
   * carries is ours, the amend empties it exactly when our staged content is
   * what the parent already holds.
   */
  const amendWouldEmptyHead = async (paths: readonly string[]): Promise<boolean> => {
    if (paths.length === 0) return false;

    const parentResult = await git.exec(["rev-parse", "--quiet", "--verify", "HEAD^"]);
    const parent =
      parentResult.ok && parentResult.stdout.trim() !== "" ? parentResult.stdout.trim() : null;

    const contributed = await headContribution(parent);
    if (contributed === null) return false;
    const isOurs = (path: string): boolean =>
      paths.some((owned) => path === owned || path.startsWith(`${owned}/`));
    if (!contributed.every(isOurs)) return false;

    if (parent === null) {
      // A root commit is empty exactly when its tree is, and by the check above
      // its tree holds nothing but our paths.
      const listed = await git.exec(["ls-files", "--", ...paths]);
      return listed.ok && listed.stdout.trim() === "";
    }
    // `--quiet` exits 0 only when there is no difference at all — i.e. the
    // amended commit would restate its own parent.
    return (await git.exec(["diff", "--cached", "--quiet", parent, "--", ...paths])).ok;
  };

  /**
   * Restore the index to `HEAD` for the paths an attempt staged, leaving the
   * working tree alone. Called on every outcome that is not a landed commit, so
   * a refused auto-commit can never escape into someone else's.
   */
  const unstage = async (paths: readonly string[], head: string | null): Promise<void> => {
    if (paths.length === 0) return;
    const result =
      head === null
        ? await git.exec(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...paths])
        : await git.exec(["reset", "--quiet", "HEAD", "--", ...paths]);
    if (!result.ok) {
      logger.error("could not restore the index after an auto-commit that did not land", {
        paths: [...paths],
        output: gitOutput(result),
      });
    }
  };

  /**
   * The subset git can be asked about: present on disk, or tracked (so a removal
   * stages) — and, separately, which of them this save **removes**, and whether
   * any of them is a **directory**.
   *
   * `removed` is a by-product rather than a second question: a path gone from
   * disk but known to git is exactly a path this commit stages as a deletion,
   * and the walk that decides stageability has already established both halves.
   * Free where it matters, too — a save whose every path is on disk answers
   * `removed: []` without spawning anything, which is every autosave.
   *
   * `directories` is free in the same way, and is a **list rather than a flag**
   * because the guard below asks git about exactly these paths and no others.
   * `statSync` answers "does this exist" and "is it a directory" in the one
   * syscall `existsSync` was already making, and a *removed* directory is read
   * off the `ls-files` output this branch has already fetched — a tracked entry
   * **beneath** a missing path is what makes that path a directory. So no new
   * git invocation reaches the autosave path, whose every path is a file.
   *
   * `statSync` is wrapped because it is not a total replacement for
   * `existsSync`: `throwIfNoEntry: false` suppresses `ENOENT` and nothing else,
   * while `EACCES`, `ENOTDIR` and `ELOOP` still throw where `existsSync` simply
   * answered `false`. `runCommit` has no try/catch, so an unreadable parent
   * directory would reject the commit instead of returning a `CommitOutcome` —
   * bypassing this module's contract that every failure is a `skipped` or
   * `failed` outcome with §14's logging. A path we cannot stat is a path that is
   * not there **as far as staging is concerned**, which is what `existsSync`
   * meant all along.
   */
  const stageablePaths = async (
    paths: readonly string[],
  ): Promise<{ paths: string[]; removed: string[]; directories: string[] }> => {
    const candidates = [...new Set(paths)];
    const missing: string[] = [];
    const directories: string[] = [];
    for (const path of candidates) {
      let stat;
      try {
        stat = statSync(resolve(git.root, path), { throwIfNoEntry: false });
      } catch {
        stat = undefined;
      }
      if (stat === undefined) missing.push(path);
      else if (stat.isDirectory()) directories.push(path);
    }
    if (missing.length === 0) return { paths: candidates, removed: [], directories };
    const tracked = await git.exec(["ls-files", "--", ...missing]);
    const trackedPaths = tracked.ok
      ? tracked.stdout.split("\n").filter((line) => line.trim() !== "")
      : [];
    const isTracked = (path: string): boolean =>
      trackedPaths.some((entry) => entry === path || entry.startsWith(`${path}/`));
    return {
      paths: candidates.filter((path) => !missing.includes(path) || isTracked(path)),
      removed: missing.filter(isTracked),
      directories: [
        ...directories,
        ...missing.filter((path) => trackedPaths.some((entry) => entry.startsWith(`${path}/`))),
      ],
    };
  };

  /**
   * Would folding this save into `HEAD` drop content that `HEAD` alone holds?
   *
   * {@link amendWouldEmptyHead} is the same question asked narrowly, and its own
   * comment names the case both exist for: "a document created and deleted
   * inside the same idle window". It only catches that when the window holds
   * *nothing else* — the moment a neighbour's save has folded into the same
   * commit, `HEAD` still says something after the amend and the guard passes,
   * while the created-and-deleted document's only revision goes with it. PR #43's
   * review found it out of band (edit A, create B, delete B, all in one window),
   * but nothing about it is out of band: it is reachable from any caller whose
   * window gathered a neighbour, and `commit.test.ts` blessed it in-band.
   *
   * Asked of the paths this save **removes**, and of `HEAD`'s parent, because a
   * path the parent already carries survives the amend in the parent — it is only
   * a path the window itself introduced that has nowhere else to be. `HEAD` as a
   * root commit has no parent to survive in, so nothing it holds may be amended
   * away.
   *
   * Deliberately about paths rather than blobs. A move stages its old path as a
   * removal while the same bytes arrive at the new one, so a content-level
   * question would allow that fold where this one refuses it — at the cost of one
   * extra commit in the rare case where the moved document was *also* created
   * inside the same window. Refusing a fold is always safe (it is what every
   * other `amendTarget` condition does) and costs a commit; allowing a wrong one
   * costs the document. The bias goes to the cheap mistake.
   */
  const amendWouldOrphanContent = async (removed: readonly string[]): Promise<boolean> => {
    if (removed.length === 0) return false;
    const parent = await git.exec(["rev-parse", "--quiet", "--verify", "HEAD^"]);
    if (!parent.ok || parent.stdout.trim() === "") return true;
    for (const path of removed) {
      if (!(await git.exec(["cat-file", "-e", `HEAD^:${path}`])).ok) return true;
    }
    return false;
  };

  /**
   * The same question, asked of a staged **directory** — where the one above
   * cannot answer it (SERVER-105).
   *
   * A tree defeats {@link amendWouldOrphanContent} in both directions. A
   * directory still on disk is never "missing", so `removed` is empty and the
   * guard returns `false` whatever was deleted underneath it; and
   * `cat-file -e HEAD^:<dir>` succeeds on a *tree*, so a whole-directory removal
   * looks like a path the parent already carries while the contents the window
   * added go with the amend. Both were reproduced against real git.
   *
   * So this asks it properly, by listing the paths beneath the staged
   * directories in `HEAD` and in its parent. A path `HEAD` holds is safe to
   * amend away only if something else still has it: the parent commit, or the
   * working tree (where it is about to be re-staged into the amended commit).
   * A path in neither is one whose **only** revision is the commit being
   * rewritten, which is what §4's guard exists to refuse.
   *
   * **Gated on there being a staged directory at all**, which is what keeps the
   * fold path free. Every autosave stages files, so `directories` is empty and
   * this returns without spawning anything — the property that lets the guard
   * run on every fold. The two `ls-tree` calls are paid only by the skill-folder
   * archive, which is rare and is an act.
   *
   * An earlier attempt refused to fold *any* save that staged a directory, on
   * the reasoning that the only such caller is an act and "§4's acts commit
   * alone". That reasoning was wrong: §4 has **two** acts that commit alone (a
   * deletion and a bulk Save), and archiving is not one of them — it is one of
   * the four whose "own change is the last thing in the window's commit", so it
   * folds and *then* closes the window. Refusing outright broke that guarantee
   * for skills (PR #46 review).
   */
  const amendWouldOrphanUnderDirectory = async (
    directories: readonly string[],
  ): Promise<boolean> => {
    if (directories.length === 0) return false;
    const parent = await git.exec(["rev-parse", "--quiet", "--verify", "HEAD^"]);
    if (!parent.ok || parent.stdout.trim() === "") return true;
    // A failed listing is **not** an empty tree. Reading it as one would let a
    // failure on the `HEAD` side answer "nothing beneath these directories, so
    // nothing to orphan" and permit the fold — the one guard here breaking the
    // bias every other one keeps ("refusing a fold is always safe … the bias
    // goes to the cheap mistake"). `undefined` means "could not tell", and the
    // caller refuses (PR #46 review).
    const listing = async (ref: string): Promise<Set<string> | undefined> => {
      const listed = await git.exec(["ls-tree", "-r", "--name-only", ref, "--", ...directories]);
      if (!listed.ok) return undefined;
      return new Set(listed.stdout.split("\n").filter((line) => line.trim() !== ""));
    };
    const head = await listing("HEAD");
    const survives = await listing("HEAD^");
    if (head === undefined || survives === undefined) return true;
    for (const path of head) {
      if (survives.has(path)) continue;
      if (existsSync(resolve(git.root, path))) continue;
      return true;
    }
    return false;
  };

  /**
   * Why the open window did not take this request. Informational only — the
   * close happens either way — but it is the one place §4's causes are read off
   * a real request rather than asserted, so a log line can say which it was.
   */
  const closeReason = (request: CommitRequest): WindowCloseReason => {
    const record = openWindow;
    if (record === null) return "superseded";
    if (record.actor !== request.actor) return "party-change";
    if (request.docIds !== undefined || request.squash === false) return "commits-alone";
    if (now() - record.openedAt >= windowMaxMs) return "aged-out";
    return "superseded";
  };

  const failure = (reason: string, result: GitCommandResult): CommitOutcome => ({
    kind: "failed",
    reason,
    output: gitOutput(result),
  });

  const runCommit = async (request: CommitRequest): Promise<CommitOutcome> => {
    const repository = await git.exec(["rev-parse", "--git-dir"]);
    if (!repository.ok) {
      // Both are ordinary states of a usable workspace, and neither may cost the
      // operator a mutation (SPEC.md §14: the file is the source of truth).
      openWindow = null;
      return {
        kind: "skipped",
        reason: repository.spawned
          ? "the workspace is not a git repository"
          : "git is not available on PATH",
      };
    }

    // git refuses a whole `add` when *any* pathspec matches nothing, and a move
    // legitimately names a path that no longer exists (and a never-committed
    // skill folder names one git has never heard of). Filtering keeps one such
    // path from failing the commit for the paths that are real.
    const { paths, removed, directories } = await stageablePaths(request.paths);
    const head = await headSha();
    if (paths.length > 0) {
      // `-A` so a removal (a delete, or a move's old path) stages as a removal
      // rather than being silently left behind in the tree.
      const staged = await git.exec(["add", "-A", "--", ...paths]);
      if (!staged.ok) {
        await unstage(paths, head);
        return failure("staging failed", staged);
      }
    } else {
      return { kind: "skipped", reason: "nothing to commit" };
    }

    const status = await git.exec(["status", "--porcelain", "--", ...paths]);
    if (status.ok && status.stdout.trim() === "") {
      await unstage(paths, head);
      return { kind: "skipped", reason: "nothing to commit" };
    }

    const candidate = head === null ? null : await amendTarget(request, head);
    // Three reasons a fold that git would accept must not happen anyway: an
    // amend that would *empty* the commit git refuses outright, one that would
    // take the open window's only copy of what this save removes, and — the
    // same question asked where a tree hides it — one that would orphan
    // something beneath a staged directory (SERVER-105). All answer "make a
    // fresh commit instead", which is what the history should record.
    //
    // Each is gated so the fold path stays free: `removed` is empty for a save
    // whose paths are all on disk, and `directories` is empty for every
    // autosave, so neither spawns anything on the hot path.
    const unfoldable =
      candidate !== null &&
      ((await amendWouldEmptyHead(paths)) ||
        (await amendWouldOrphanContent(removed)) ||
        (await amendWouldOrphanUnderDirectory(directories)));
    const target = unfoldable ? null : candidate;
    // A save that cannot fold is a save the open window did not take, which is
    // exactly what "the window closed" means — because the other party wrote,
    // because it went quiet, because it aged out, or because this write is one of
    // §4's two acts that commit alone. Closing it *here* is what gives it an
    // honest subject: its commit is still HEAD at this instant and still ours to
    // rewrite, and one instruction later it will not be.
    if (target === null) await closeWindowLocked(closeReason(request));

    const anchors = mergeAnchors(target?.record ?? null, request.anchors);
    // Every document the window has held, in the order they were first touched.
    const windowDocIds = new Set([...(target?.record.docIds ?? []), request.docId]);
    const message = buildTrailers(
      request.docIds ?? [...windowDocIds],
      request.actor,
      anchors.remapped,
      anchors.orphaned,
    );

    const args = [
      ...(await committerFlags()),
      "commit",
      `--author=${gitAuthorOf(request.actor)}`,
      "-m",
      request.subject,
      "-m",
      message,
    ];
    if (target !== null) args.push("--amend", `--date=${target.authorDate}`);
    // `--only` commits the named paths' working-tree content and disregards
    // whatever else is staged, so an operator's staged-but-unrelated work is
    // never swallowed. It needs the paths to be known to git — which the `add`
    // above guarantees — and nothing else: git scopes an initial commit the
    // same way it scopes any other, so the unborn-branch case is not the
    // exception this once made it (SERVER-022 finding 5). Skipping the flag
    // there meant the very first auto-commit in a fresh workspace swallowed
    // whatever the operator happened to have staged.
    if (paths.length > 0) args.push("--only", "--", ...paths);

    const committed = await git.exec(args);
    if (!committed.ok) {
      openWindow = null;
      await unstage(paths, head);
      return failure(
        target === null ? "git commit failed" : "git commit --amend failed",
        committed,
      );
    }

    const sha = await headSha();
    if (sha === null) {
      openWindow = null;
      await unstage(paths, head);
      return { kind: "skipped", reason: "commit produced no HEAD" };
    }
    // A fold is an amend, so it moves the window's commit exactly as a close's
    // relabel does — and under a party-scoped fold key it moves it out from
    // under a *neighbour* document, whose own write is not this one and so
    // hears nothing through `observeCommit`. Both sites that rewrite a sha must
    // say so, or an edit acknowledgment for the first document names a commit
    // no branch holds (PR #42 review; the same hazard SERVER-093 closed at the
    // close path). Read back rather than predicted, for the same reason the
    // close reads it back: only git knows what the rewrite produced.
    if (target !== null && sha !== target.record.sha) {
      onWindowRewritten?.(target.record.sha, sha);
    }
    // A commit that stands alone opens no window: §4 requires that no later save
    // fold into it, and the only mechanism a later save has for folding is this
    // record. Both signals count — an act over a named set (`docIds`), and the
    // explicit `squash: false` a caller passes (`threads/reattach.ts`).
    // Enforcing only the first left "never part of an
    // edit" true in one direction: the next save by the same party amended the
    // standalone commit and replaced its subject (SERVER-091).
    openWindow =
      request.docIds !== undefined || request.squash === false
        ? null
        : {
            actor: request.actor,
            docIds: windowDocIds,
            sha,
            at: now(),
            openedAt: target?.record.openedAt ?? now(),
            namedByAct: request.act ?? false,
            remapped: anchors.remapped,
            orphaned: anchors.orphaned,
          };
    return target === null ? { kind: "committed", sha } : { kind: "amended", sha };
  };

  return {
    withGitLock,
    closeWindow: (reason) => withGitLock(() => closeWindowLocked(reason)),
    withClosedWindow: (reason, read) =>
      withGitLock(async () => {
        await closeWindowLocked(reason);
        return read();
      }),
    endSquashSession(sha) {
      if (openWindow !== null && openWindow.sha === sha) openWindow = null;
    },
    commit: (request) =>
      withGitLock(async () => {
        const outcome = await runCommit(request);
        if (outcome.kind === "failed") {
          // SPEC.md §14: the failure surfaces loudly. The mutation stands; this
          // is the operator-facing half of "rather than silently leaving
          // uncommitted drift".
          logger.error("auto-commit failed — the file mutation stands, uncommitted", {
            docId: request.docId,
            actor: request.actor,
            subject: request.subject,
            reason: outcome.reason,
            output: outcome.output,
          });
        } else if (outcome.kind === "skipped" && outcome.reason !== "nothing to commit") {
          logger.info("auto-commit skipped", { docId: request.docId, reason: outcome.reason });
        }
        return outcome;
      }),
  };
}
