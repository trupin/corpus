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

import { existsSync } from "node:fs";
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
  /** A deletion, a staged bulk Save, a force unlock — §4's three acts that commit alone. */
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
   * Extra `Key: value` trailer lines appended after the standard ones. The
   * document verbs need none — `Corpus-Doc` and `Corpus-Actor` say everything
   * about an edit — but a lock force break also has to record *whose* lease it
   * took away, which neither standard trailer expresses.
   */
  readonly trailers?: readonly string[] | undefined;
  /**
   * Commit even when the paths hold no change. The write path never needs it;
   * SERVER-009's force-break audit entry does, because `.corpus/` is gitignored
   * and there is no file to stage.
   */
  readonly allowEmpty?: boolean | undefined;
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
  extra: readonly string[] = [],
): string => {
  // One `Corpus-Doc` line per document: git trailers repeat, and a bulk act's
  // subject cannot name a thousand documents on one line.
  const lines = [...docIds.map((id) => `${TRAILER_DOC}: ${id}`), `${TRAILER_ACTOR}: ${actor}`];
  // Omitted entirely when nothing moved: a trailer reading `remapped=0
  // orphaned=0` on every commit would train the reader to ignore it.
  if (remapped.size > 0 || orphaned.size > 0) {
    lines.push(`${TRAILER_ANCHORS}: remapped=${remapped.size} orphaned=${orphaned.size}`);
  }
  return [...lines, ...extra].join("\n");
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
    // is untouched and so is a save this very commit path has just staged. A
    // caller's extra trailers are not replayed here and do not need to be: they
    // arrive only with `squash: false`, which opens no window to close.
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

  /** The subset git can be asked about: present on disk, or tracked (so a removal stages). */
  const stageablePaths = async (paths: readonly string[]): Promise<string[]> => {
    const candidates = [...new Set(paths)];
    const missing = candidates.filter((path) => !existsSync(resolve(git.root, path)));
    if (missing.length === 0) return candidates;
    const tracked = await git.exec(["ls-files", "--", ...missing]);
    const trackedPaths = tracked.ok
      ? tracked.stdout.split("\n").filter((line) => line.trim() !== "")
      : [];
    const isTracked = (path: string): boolean =>
      trackedPaths.some((entry) => entry === path || entry.startsWith(`${path}/`));
    return candidates.filter((path) => !missing.includes(path) || isTracked(path));
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
    const allowEmpty = request.allowEmpty ?? false;
    const paths = await stageablePaths(request.paths);
    const head = await headSha();
    if (paths.length > 0) {
      // `-A` so a removal (a delete, or a move's old path) stages as a removal
      // rather than being silently left behind in the tree.
      const staged = await git.exec(["add", "-A", "--", ...paths]);
      if (!staged.ok) {
        await unstage(paths, head);
        return failure("staging failed", staged);
      }
    } else if (!allowEmpty) {
      return { kind: "skipped", reason: "nothing to commit" };
    }

    if (!allowEmpty) {
      const status = await git.exec(["status", "--porcelain", "--", ...paths]);
      if (status.ok && status.stdout.trim() === "") {
        await unstage(paths, head);
        return { kind: "skipped", reason: "nothing to commit" };
      }
    }

    const candidate = head === null ? null : await amendTarget(request, head);
    // An amend that would empty the commit is refused by git; make the fresh
    // commit that records this save instead of losing it to that refusal.
    const target =
      candidate !== null && !allowEmpty && (await amendWouldEmptyHead(paths)) ? null : candidate;
    // A save that cannot fold is a save the open window did not take, which is
    // exactly what "the window closed" means — because the other party wrote,
    // because it went quiet, because it aged out, or because this write is one of
    // §4's three acts that commit alone. Closing it *here* is what gives it an
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
      request.trailers,
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
    if (allowEmpty) args.push("--allow-empty");
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
    // A commit that stands alone opens no window: §4 requires that no later save
    // fold into it, and the only mechanism a later save has for folding is this
    // record. Both signals count — an act over a named set (`docIds`), and the
    // explicit `squash: false` an audit entry carries. The second half was
    // missing: a force break opened a window, so the next save by that party
    // amended the audit entry, replacing its subject and dropping the
    // `Corpus-Lock-Holder` trailer that is the whole point of it. "Never part of
    // an edit" was only ever enforced in one direction (SERVER-091, verifying
    // the issue's `allowEmpty` edge case).
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
