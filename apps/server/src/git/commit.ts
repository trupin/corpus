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
// - **One commit per editing session, not one per keystroke.** Repeated saves
//   of the same document by the same author inside `SQUASH_IDLE_MS` amend the
//   previous auto-commit. Every condition under which that would rewrite
//   something the server did not itself just create is checked first, and the
//   fallback — a fresh commit — is always safe.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Actor } from "@corpus/contract";
import { silentLogger, type Logger } from "../logger.js";
import { gitOutput, type Git, type GitCommandResult } from "./git.js";

/**
 * How long after an auto-commit a further save by the same author to the same
 * document still counts as the same editing session (SPEC.md §4's "short idle
 * window"). Exported so the value can be read from the code rather than guessed,
 * and adjusted without redesign — sprint-005 Open Conflict 5 pins 30 s.
 */
export const SQUASH_IDLE_MS = 30_000;

export const TRAILER_DOC = "Corpus-Doc";
export const TRAILER_ACTOR = "Corpus-Actor";
export const TRAILER_ANCHORS = "Corpus-Anchors";

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
  /** The document the commit is about; becomes the `Corpus-Doc` trailer and half the squash key. */
  readonly docId: string;
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
  /** `false` opts out of session folding — an audit entry is its own event, never part of an edit. */
  readonly squash?: boolean | undefined;
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
}

export interface AutoCommitterOptions {
  readonly git: Git;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
  readonly squashIdleMs?: number | undefined;
}

/** What the last auto-commit was, so the next save can decide whether to fold into it. */
type SessionRecord = {
  readonly docId: string;
  readonly actor: Actor;
  readonly sha: string;
  /** Instant of the most recent save in this session — the idle window runs from here. */
  readonly at: number;
  /** Anchor ids touched anywhere in the session, so an amended message stays truthful. */
  readonly remapped: ReadonlySet<string>;
  readonly orphaned: ReadonlySet<string>;
};

const trailerValue = (body: string, name: string): string | null => {
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim();
    if (value !== "") return value;
  }
  return null;
};

const buildTrailers = (
  docId: string,
  actor: Actor,
  remapped: ReadonlySet<string>,
  orphaned: ReadonlySet<string>,
  extra: readonly string[] = [],
): string => {
  const lines = [`${TRAILER_DOC}: ${docId}`, `${TRAILER_ACTOR}: ${actor}`];
  // Omitted entirely when nothing moved: a trailer reading `remapped=0
  // orphaned=0` on every commit would train the reader to ignore it.
  if (remapped.size > 0 || orphaned.size > 0) {
    lines.push(`${TRAILER_ANCHORS}: remapped=${remapped.size} orphaned=${orphaned.size}`);
  }
  return [...lines, ...extra].join("\n");
};

/** Union of the session's anchor ids; an anchor that later detached counts as orphaned only. */
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

  let session: SessionRecord | null = null;
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
   * The HEAD commit this save may fold into, or `null`. Every condition SPEC.md
   * §4 names is checked here; a `null` answer always means "make a fresh
   * commit", which is safe in every repository state.
   */
  const amendTarget = async (
    request: CommitRequest,
    head: string,
  ): Promise<{ subject: string; authorDate: string } | null> => {
    if (request.squash === false || request.paths.length === 0) return null;
    const record = session;
    if (record === null) return null;
    if (record.docId !== request.docId || record.actor !== request.actor) return null;
    if (now() - record.at >= squashIdleMs) return null;
    // Anything committed since ours — by us for another document, by a hook, by
    // the operator — ends the session: folding would rewrite someone else's work.
    if (record.sha !== head) return null;
    // Detached HEAD: an amend there rewrites a commit no branch names.
    if (!(await git.exec(["symbolic-ref", "--quiet", "HEAD"])).ok) return null;
    if (await midOperation()) return null;
    if (await isPublished()) return null;

    const message = await git.exec(["log", "-1", "--format=%B"]);
    if (!message.ok) return null;
    if (trailerValue(message.stdout, TRAILER_DOC) !== request.docId) return null;
    if (trailerValue(message.stdout, TRAILER_ACTOR) !== request.actor) return null;

    const subject = await git.exec(["log", "-1", "--format=%s"]);
    const authorDate = await git.exec(["log", "-1", "--format=%aI"]);
    if (!subject.ok || !authorDate.ok) return null;
    return { subject: subject.stdout.trim(), authorDate: authorDate.stdout.trim() };
  };

  const headSha = async (): Promise<string | null> => {
    const result = await git.exec(["rev-parse", "--verify", "--quiet", "HEAD"]);
    return result.ok && result.stdout.trim() !== "" ? result.stdout.trim() : null;
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
      session = null;
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
    const paths = await stageablePaths(request.paths);
    if (paths.length > 0) {
      // `-A` so a removal (a delete, or a move's old path) stages as a removal
      // rather than being silently left behind in the tree.
      const staged = await git.exec(["add", "-A", "--", ...paths]);
      if (!staged.ok) return failure("staging failed", staged);
    } else if (!(request.allowEmpty ?? false)) {
      return { kind: "skipped", reason: "nothing to commit" };
    }

    if (!(request.allowEmpty ?? false)) {
      const status = await git.exec(["status", "--porcelain", "--", ...paths]);
      if (status.ok && status.stdout.trim() === "") {
        return { kind: "skipped", reason: "nothing to commit" };
      }
    }

    const head = await headSha();
    const target = head === null ? null : await amendTarget(request, head);
    const anchors = mergeAnchors(target === null ? null : session, request.anchors);
    const subject = target?.subject ?? request.subject;
    const message = buildTrailers(
      request.docId,
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
      subject,
      "-m",
      message,
    ];
    if (target !== null) args.push("--amend", `--date=${target.authorDate}`);
    if (request.allowEmpty ?? false) args.push("--allow-empty");
    // `--only` commits the named paths' working-tree content and disregards
    // whatever else is staged, so an operator's staged-but-unrelated work is
    // never swallowed. It needs a HEAD to compare against, and needs the paths
    // to be known to git — which the `add` above guarantees.
    if (paths.length > 0 && head !== null) args.push("--only", "--", ...paths);

    const committed = await git.exec(args);
    if (!committed.ok) {
      session = null;
      return failure(
        target === null ? "git commit failed" : "git commit --amend failed",
        committed,
      );
    }

    const sha = await headSha();
    if (sha === null) {
      session = null;
      return { kind: "skipped", reason: "commit produced no HEAD" };
    }
    session = {
      docId: request.docId,
      actor: request.actor,
      sha,
      at: now(),
      remapped: anchors.remapped,
      orphaned: anchors.orphaned,
    };
    return target === null ? { kind: "committed", sha } : { kind: "amended", sha };
  };

  return {
    withGitLock,
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
