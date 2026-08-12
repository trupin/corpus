// Edit-session end detection and the `doc.edited` queue event (SPEC.md §4's
// edit-acknowledgment rider, signed 2026-08-02; CONTRACT-028 fixes the wire).
//
// > Every *user* edit session on a document ends one of two ways: the reader
// > closes (the UI flushes the session), or the document goes inactive for a few
// > minutes while open (default 3 minutes, a distinct and longer window than the
// > commit-squash idle above). Either way the server emits one `doc.edited`
// > queue event carrying the document id and the session's commit range with
// > change stats — never the diff body. … Agent-authored edits never emit the
// > event (actor-scoped), so the loop cannot feed itself.
//
// **What a session is, mechanically.** A session is opened by the first *user*
// editor save that lands a commit on a document, and it accumulates every later
// user editor save to that same document. Its identity is one
// {@link OpenSession} object; both end paths take that object out of the map and
// hand it to one emitter, which is what makes `sessionId` the dedupe key the
// contract promises — the two triggers cannot both reach the same session,
// because whichever fires first removes it.
//
// **Why the window is its own constant.** §4 names the acknowledgment window as
// "a distinct and longer window than the commit-squash idle", so
// {@link EDIT_ACK_IDLE_MS} is deliberately *not* derived from `SQUASH_IDLE_MS`.
// They answer unrelated questions — one decides whether two saves are one
// commit, the other whether the person has put the document down — and a shared
// constant would make a change to either a change to both.
//
// **Nothing here runs on the write path.** `observeCommit` and `observeRewrite`
// are synchronous, do no I/O and issue no git command; every read the event
// needs happens on the timer or flush side, in `emit`. §4's autosave fires on a
// timer, so the acknowledgment must cost it nothing.

import { randomBytes } from "node:crypto";
import {
  DOC_EDITED_EVENT_TYPE,
  EMPTY_TREE_OBJECT_ID,
  type Actor,
  type DocEditedPayload,
  type EditSessionEndReason,
} from "@corpus/contract";
import { resolveRevision, type CommitOutcome, type Git } from "../git/index.js";
import { silentLogger, type Logger } from "../logger.js";
import { parentOf, readRangeStats } from "./diff.js";

/**
 * §4's acknowledgment window: how long a document may sit with no user editor
 * save before the session on it is over. Three minutes — the default the rider
 * names.
 *
 * Six times `SQUASH_IDLE_MS`, and independent of it (see the module note). The
 * spread is the point: 30 s decides "was this the same burst of typing", three
 * minutes decides "has the person moved on". A workspace that wants its agent
 * woken sooner or later edits this one number, as
 * `.corpus/config.json`'s `editAcknowledgment.idleMs`.
 */
export const EDIT_ACK_IDLE_MS = 180_000;

/**
 * Which surface produced the event, for the `source` field of the queue file
 * (SPEC.md §7). Spelled here rather than added to `threads/workspace.ts`'s
 * `EVENT_SOURCE`: an edit acknowledgment is not a thread event, and the edit
 * module owes the thread module no import. It follows the same rule that
 * constant documents — `source` names the *producing surface*, which is
 * information the server has, and never "ui" or "cli", which it does not.
 */
export const EDIT_EVENT_SOURCE = "edit";

/** What an enqueue answers with; only the id is ever read. */
export interface EnqueuedEditEvent {
  readonly id: string;
}

export interface EditEnqueueInput {
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
}

/**
 * The seam onto the file-backed queue — `QueueService.enqueue` in production,
 * because that is the only path that also wakes a parked `corpus queue idle`
 * (SPEC.md §7). Injected for the same reason `ThreadsWorkspace.enqueue` is.
 */
export type EditEnqueue = (input: EditEnqueueInput) => Promise<EnqueuedEditEvent>;

/** One completed mutation, as {@link EditSessionTracker.observeCommit} sees it. */
export interface ObservedCommit {
  readonly docId: string;
  readonly actor: Actor;
  /** Workspace-relative paths the commit staged — files or directories. */
  readonly paths: readonly string[];
  /**
   * The workspace-relative path of the document when — and only when — this
   * write is the **editor's save** (`PUT /api/docs/{id}`, which is also where
   * the plugin read-modify-write lands). `null` for every other mutation: a
   * create, a move, an archive, a delete, a thread turn, a lock audit entry.
   * §4's sessions are the reader's editor, so none of those opens a session or
   * extends one — though any of them can still *seal* one (see
   * {@link OpenSession.sealed}).
   */
  readonly editPath: string | null;
  readonly outcome: CommitOutcome | null;
}

export interface EditSessionTracker {
  /**
   * Called by `runMutation` after every mutation, committed or not. Synchronous
   * and I/O-free by contract: it runs on the autosave path.
   */
  observeCommit(commit: ObservedCommit): void;
  /**
   * The twin of {@link observeCommit}: the open window's commit was **amended**,
   * so its sha moved (`from` → `to`, same tree).
   *
   * A session records shas at the instant its saves land, and a save's commit is
   * the open window's commit — which two things then rewrite under it:
   *
   * - **A close** relabels it (the other party wrote, a `corpus doc diff` read
   *   the history, the server stopped).
   * - **A fold** amends it — and because §4's window belongs to a *party*, the
   *   save that folds may be to a **different document**. That write's own
   *   `observeCommit` names only its own document, so nothing there reaches the
   *   neighbour's session; only this does (PR #42 review). It is why two
   *   documents edited in one window can name one commit, as §4 requires.
   *
   * Following the rewrite is what keeps §4's promise that a `doc.edited` range is
   * "already in git when the agent receives it": without it the event names an
   * object no branch holds, which still resolves for git's unreachable grace and
   * then does not.
   *
   * Note the *published* case never reaches here: {@link end} calls
   * `endSquashSession(session.lastSha)` before it emits, which forgets the
   * window, so a commit an event has already named is never relabelled at all.
   * That forget depends on this: it matches by sha, so a session whose sha a
   * neighbour's fold had moved would offer one the window is no longer sitting
   * on and silently forget nothing. Following every rewrite is what makes
   * `lastSha` the window's *current* commit and the forget effective.
   *
   * This handles the window still open under a session still open — the state
   * SERVER-091 measured and escalated.
   *
   * Synchronous and I/O-free by contract, exactly like `observeCommit`: it is
   * called from inside the git lock on the commit path.
   */
  observeRewrite(from: string, to: string): void;
  /**
   * SPEC.md §7's advisory **someone is editing this**: does a *person* have an
   * edit session open on this document right now?
   *
   * The signal §7 asks for is this module's existing state, exposed — not a
   * second tracker. §7 names it "§4's edit session — the same one that ends in an
   * acknowledgment", and that is literally what {@link sessions} holds, so
   * anything else would be a second answer to one question.
   *
   * **It reports; it never refuses.** Nothing consults this before a write, there
   * is nothing to acquire or release, and no document is ever read-only.
   * Correctness is the key's job (`docs/key.ts`); this is politeness, and the
   * asymmetry §7 makes deliberately: forgetting the key cannot cost correctness
   * because the write does not happen, while ignoring this costs only manners.
   *
   * A **sealed** session still counts. Sealing freezes a *range* because the
   * other party wrote (see {@link OpenSession.sealed}); it says nothing about
   * whether the person is still at the document, and answering `false` there
   * would tell the agent it had the document to itself precisely because it had
   * just written to it.
   *
   * Reports the **person** only, and never the agent: an agent's writing is a
   * sequence of one-shot commands with no session to report, and the person sees
   * those writes land live instead (§9.4). Free by construction —
   * `observeCommit` opens a session for no other actor.
   */
  isOpen(docId: string): boolean;
  /**
   * §4's **close** path: the reader closed and the session is flushed. Ends and
   * emits every session open on this document.
   *
   * Reached by `POST /api/docs/{id}/edit-session/flush` (CONTRACT-031, mounted
   * by SERVER-057) and by {@link close}. It is deliberately *not* reached by
   * §7's edit-lock release, which CONTRACT-028 §7 first proposed as the close
   * signal: the shipped editor drops the lease on blur and after ten seconds of
   * not typing (`useUserLock.ts`), which would end a session inside every pause
   * and make §4's three-minute window unreachable.
   *
   * Idempotent, which is what lets the route publish itself that way: a document
   * with no open session is a loop over nothing.
   */
  flush(docId: string): void;
  /**
   * Shutdown. Every session still open ends as a `close`, and the returned
   * promise resolves once every emission has reached the queue.
   *
   * **Emitting beats dropping.** A reader's edit session cannot outlive the
   * server tracking it, so at `corpus server stop` the choice is between
   * announcing work the user has already done and discarding an acknowledgment
   * they are owed. Resuming across a restart was considered and rejected: the
   * state would have to be persisted from the write path (which §4's autosave
   * cadence makes exactly the wrong place to add a write), and a session
   * reconstructed from history could not know whether its event had already been
   * enqueued — which is the duplicate the `sessionId` invariant exists to make
   * impossible. A process killed outright still loses its open sessions; that is
   * the honest cost of keeping the write path free of bookkeeping.
   */
  close(): Promise<void>;
}

export interface EditSessionTrackerOptions {
  readonly git: Git;
  readonly enqueue: EditEnqueue;
  /**
   * `AutoCommitter.endSquashSession` — the one thing this module says *back* to
   * the write path, and the reason it is a required option rather than an
   * optional one: a tracker built without it publishes commit ranges that §4's
   * squash is still free to rewrite, and no assertion about this module's own
   * output can see that.
   */
  readonly endSquashSession: (sha: string) => void;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
  readonly idleMs?: number | undefined;
}

interface OpenSession {
  readonly id: string;
  readonly docId: string;
  /**
   * Refreshed on every save, so a session survives the document being renamed
   * under it. `docs/move.ts` commits as the *user* and carries no `editPath`, so
   * it neither opens a session nor (being the same party) seals one; the next
   * save then arrives with the new path and the emitter diffs the file where it
   * now is, which is the only path `git diff` will report it under.
   */
  path: string;
  /** The session's earliest commit — the one whose parent becomes `from`. */
  firstSha: string;
  /** The session's newest commit — `to`. */
  lastSha: string;
  /**
   * Is the session's *base* — `firstSha` — still `HEAD`? That is the only state
   * in which §4's squash can rewrite it: `git commit --amend` only ever rewrites
   * `HEAD`, so the moment anything sits on top, the base's sha is fixed.
   *
   * It answers a question about **git**, and so it is maintained from the
   * commits this tracker is told about — never from "I have seen one save of my
   * own and no others". Those were the same statement only while every user
   * `PUT` opened a session; SERVER-095 made a frontmatter-only save open none,
   * and a thread creation never did. Such a write still lands a commit on top of
   * this session's base and still opens a window the next body save folds into —
   * so a tracker reasoning from its own saves believed the amend was rewriting
   * *its* commit, moved `firstSha` onto the interloper, and published a range
   * starting after the person's first edit (SERVER-096).
   *
   * `observeCommit` hears about **every** mutation, including the ones that open
   * no session, which is what makes the honest answer available here at no cost.
   */
  baseIsHead: boolean;
  lastWriteAt: number;
  /**
   * Set when a commit by **the other party** touched this document. A sealed
   * session accepts no further saves — the next one opens a *new* session — so
   * its range can never grow across the interloping commit.
   *
   * Sealing does not *end* the session: §4 gives a session exactly two ends, and
   * "somebody else wrote here" is neither, so it still waits for its own `close`
   * or `idle` and reports that as `endedBy`. What CONTRACT-028 requires is only
   * that the range not span the other author's commit, and freezing the range is
   * what delivers that.
   */
  sealed: boolean;
}

/** Opaque, per the contract: 64 bits of entropy, compared only for equality. */
const newSessionId = (): string => `es_${randomBytes(8).toString("hex")}`;

const landed = (outcome: CommitOutcome | null): { sha: string; amended: boolean } | null => {
  if (outcome === null) return null;
  if (outcome.kind === "committed") return { sha: outcome.sha, amended: false };
  if (outcome.kind === "amended") return { sha: outcome.sha, amended: true };
  // `skipped` (SPEC.md §14 — no git in the workspace, nothing to commit) and
  // `failed` (a workspace hook refused): the file mutation stands, but there is
  // no revision to name. A session made only of these has no range and emits
  // nothing, exactly as CONTRACT-028 §3 requires — which falls out of never
  // recording them rather than needing a rule of its own.
  return null;
};

/**
 * §4's sessions are the **user's** ("Every *user* edit session on a document…"),
 * which `observeCommit` enforces by ignoring any other actor's `editPath`. So
 * every open session belongs to this party, and every commit by another one is
 * the interloper the sealing rule is about.
 */
const SESSION_ACTOR = "user" satisfies Actor;

/**
 * Does this commit touch the file `session` is about? By path, not only by
 * document id: an anchored thread creation stages its **parent document's**
 * frontmatter under the *thread's* id, so a `docId` comparison alone would let
 * the other party's commit slip inside a user's range.
 *
 * Only ever asked about a commit by the other party — see the sealing rule in
 * `observeCommit`.
 */
const touches = (commit: ObservedCommit, session: OpenSession): boolean =>
  commit.docId === session.docId ||
  commit.paths.some((path) => session.path === path || session.path.startsWith(`${path}/`));

export function createEditSessionTracker(options: EditSessionTrackerOptions): EditSessionTracker {
  const { git, enqueue, endSquashSession } = options;
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? EDIT_ACK_IDLE_MS;

  const sessions = new Map<string, OpenSession>();
  const inFlight = new Set<Promise<void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  /**
   * One timer for all sessions, re-armed to the earliest deadline, rather than
   * one each: a workspace being edited has one or two open sessions, but the
   * cost of being wrong about that is a live timer per document in the corpus.
   * `unref` so an open session never holds the process alive.
   */
  function rearm(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (closed || sessions.size === 0) return;
    let earliest = Infinity;
    for (const session of sessions.values()) {
      earliest = Math.min(earliest, session.lastWriteAt + idleMs);
    }
    timer = setTimeout(sweep, Math.max(0, earliest - now()));
    timer.unref?.();
  }

  /**
   * The event itself. Every git read the range needs happens here, on the timer
   * or flush side, so the acknowledgment costs the autosave path nothing.
   */
  async function emit(session: OpenSession, endedBy: EditSessionEndReason): Promise<void> {
    // History is re-read rather than trusted: these shas were recorded minutes
    // ago, and a workspace is a git repository a person may also drive by hand.
    // A range that no longer resolves is a range that is gone, and an event
    // pointing at it would be worse than no event.
    const to = await resolveRevision(git, session.lastSha);
    const first = await resolveRevision(git, session.firstSha);
    if (to === null || first === null) {
      logger.info("edit session dropped: its commits are no longer in the repository", {
        docId: session.docId,
        sessionId: session.id,
      });
      return;
    }
    const from = (await parentOf(git, first)) ?? EMPTY_TREE_OBJECT_ID;
    const stats = await readRangeStats(git, from, to, session.path);

    // Nothing to acknowledge. `commits: 0` is the contract's own rule ("a
    // session that produced no commit produces no event"); a range whose
    // path-scoped diff is empty is that same state reached differently — an edit
    // and its undo inside one session — and waking the agent to reflect on a
    // change of zero lines is precisely the cost a frugal event exists to avoid.
    if (stats.commits === 0 || stats.insertions + stats.deletions === 0) {
      logger.info("edit session ended with no change to acknowledge", {
        docId: session.docId,
        sessionId: session.id,
      });
      return;
    }

    const payload: DocEditedPayload = {
      docId: session.docId,
      sessionId: session.id,
      actor: SESSION_ACTOR,
      endedBy,
      from,
      to,
      stats,
    };
    const event = await enqueue({
      type: DOC_EDITED_EVENT_TYPE,
      source: EDIT_EVENT_SOURCE,
      payload: { ...payload, stats: { ...stats } },
    });
    logger.info("user edit session acknowledged", {
      docId: session.docId,
      sessionId: session.id,
      endedBy,
      eventId: event.id,
    });
  }

  /** Ends a session. Removed from the map first, so no second trigger reaches it. */
  function end(session: OpenSession, endedBy: EditSessionEndReason): void {
    sessions.delete(session.id);
    // The session's last commit is about to be named outside the repository, so
    // §4's squash may no longer fold into it: an amend would leave that `to`
    // dangling *and* — since amending a one-commit session moves its base — would
    // open the next session at the very same parent, announcing this change a
    // second time under a second `sessionId` that no dedupe rule can match
    // (SERVER-052 review, PR #22).
    //
    // Synchronous and before the emitter's first git read, because the save this
    // has to get in front of is precisely one that lands while those reads are in
    // flight. Unconditional rather than conditional on an event actually
    // following: a session that ended is a boundary in the history either way,
    // and being wrong costs one commit that did not fold.
    endSquashSession(session.lastSha);
    const pending = emit(session, endedBy)
      .catch((error: unknown) => {
        // An acknowledgment that could not be enqueued is a lost wake-up, never
        // a failed mutation: the write it describes landed and was committed
        // long before this ran.
        logger.error("could not enqueue a doc.edited event", {
          docId: session.docId,
          sessionId: session.id,
          error: String(error),
        });
      })
      .finally(() => {
        inFlight.delete(pending);
      });
    inFlight.add(pending);
  }

  function sweep(): void {
    timer = null;
    const deadline = now() - idleMs;
    for (const session of [...sessions.values()]) {
      if (session.lastWriteAt <= deadline) end(session, "idle");
    }
    rearm();
  }

  return {
    observeCommit(commit) {
      const result = landed(commit.outcome);
      if (result === null || closed) return;
      const editPath = commit.actor === SESSION_ACTOR ? commit.editPath : null;

      // The session this write belongs to. Only the user's editor save has one;
      // every other write either seals a session or passes through.
      let own: OpenSession | undefined;
      if (editPath !== null) {
        for (const session of sessions.values()) {
          if (session.docId === commit.docId && !session.sealed) own = session;
        }
      }

      // CONTRACT-028's interleaving rule: a range never spans **the other
      // party's** commit on this document. Sealing enforces it — the open
      // session stops growing here, so the agent's commit can only ever sit
      // *after* its `to`, and the user's next save starts a second session with
      // its own range rather than one range crediting them with the agent's work.
      //
      // Scoped to the other party on purpose. The user's own non-editor writes to
      // the document they are editing — a thread anchoring into its frontmatter,
      // an archive, a move — are part of that sitting, and `readRangeStats`
      // counts them in the range by design (`edit/diff.ts`: `commits` comes from
      // `rev-list`, not from the saves this tracker observed). Sealing on them
      // would split one sitting into two acknowledgments while the ranges stayed
      // correct — a user-visible split with nothing to show for it.
      if (commit.actor !== SESSION_ACTOR) {
        for (const session of sessions.values()) {
          if (touches(commit, session)) session.sealed = true;
        }
      }

      // A commit that is not an amend becomes the new `HEAD`, so every session
      // already open is now sitting under it and none of their bases can be
      // rewritten again. Said here — over *all* sessions, from the commit rather
      // than from the save — because the write that lands it need not be one
      // this tracker follows: a frontmatter-only `PUT` (SERVER-095), a thread
      // creation, an archive, a move. Each of those also opens a window the next
      // body save folds into, and an amend of *that* window must not be mistaken
      // for §4's squash rewriting the session's own commit (SERVER-096).
      //
      // Before the session below is opened or extended, so a session this very
      // commit starts still records a base that is `HEAD` — which it is.
      if (!result.amended) {
        for (const session of sessions.values()) session.baseIsHead = false;
      }

      if (editPath === null) {
        rearm();
        return;
      }
      if (own === undefined) {
        const session: OpenSession = {
          id: newSessionId(),
          docId: commit.docId,
          path: editPath,
          firstSha: result.sha,
          lastSha: result.sha,
          baseIsHead: true,
          lastWriteAt: now(),
          sealed: false,
        };
        sessions.set(session.id, session);
      } else {
        // §4's squash rewrites `HEAD` in place, so an amend moves the session's
        // *base* exactly when that base is `HEAD` — the old sha no longer exists
        // and `from` has to be read from the new one. With anything on top, be
        // it the session's own second commit or a write that opened no session
        // at all, `HEAD` is not the session's first commit and only the head
        // moves. (A new commit has already cleared `baseIsHead` above; it is the
        // same statement, made once for every session rather than only for this
        // one.)
        if (result.amended && own.baseIsHead) own.firstSha = result.sha;
        own.lastSha = result.sha;
        own.path = editPath;
        own.lastWriteAt = now();
      }
      rearm();
    },

    observeRewrite(from, to) {
      if (from === to) return;
      for (const session of sessions.values()) {
        // Both ends, and independently: a one-commit session has the same sha at
        // both, and that is precisely the case §4's squash can rewrite (an amend
        // only ever touches `HEAD`). Leaving `baseIsHead` alone is deliberate —
        // a rewrite replaces a commit in place, it adds none, so a base that was
        // `HEAD` is still `HEAD` under its new sha and one that was not still is
        // not.
        if (session.firstSha === from) session.firstSha = to;
        if (session.lastSha === from) session.lastSha = to;
      }
    },

    isOpen(docId) {
      for (const session of sessions.values()) {
        if (session.docId === docId) return true;
      }
      return false;
    },

    flush(docId) {
      for (const session of [...sessions.values()]) {
        if (session.docId === docId) end(session, "close");
      }
      rearm();
    },

    async close() {
      closed = true;
      for (const session of [...sessions.values()]) end(session, "close");
      rearm();
      await Promise.all([...inFlight]);
    },
  };
}
