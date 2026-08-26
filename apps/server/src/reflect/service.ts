// SPEC.md §7's reflection, as one object: the ask, the clock, the status and the
// quiet window (rider 9, 2026-08-22; SERVER-137).
//
// **Reflection is an act over the whole corpus, never a side effect of one
// change.** Nothing in this file watches a field. A stage moved, a status
// flipped, a tag, a move, an archive: none of them enqueues anything, and the
// only thing a write does here is restart a timer.
//
// Two things produce a reflection and they meet in one function
// ({@link ReflectService.ask} and the scheduler both reach `enqueueUnique`),
// which is what makes "an ask while one is pending is answered with the pending
// one, never doubled" true of *both* paths rather than of the one that was
// written with it in mind.

import type { Actor, ReflectAskResult, ReflectStatus } from "@corpus/contract";
import { WORKSPACE_REFLECT_EVENT_TYPE } from "@corpus/contract";
import { silentLogger, type Logger } from "../logger.js";
import type { ConfigWriteResult } from "../config.js";
import type { ProjectionDb } from "../projection/index.js";
import type { EnqueueInput } from "../queue/service.js";
import type { StoredEvent } from "../queue/store.js";
import { advanceClock, readReflectState, recordAwaitingDigest } from "./clock.js";
import { createReflectScheduler, type ReflectAttempt, type ReflectScheduler } from "./scheduler.js";
import { countUnreflected, findLiveReflection, resolveDigest } from "./status.js";

/**
 * The `source` a reflection's event file carries (SPEC.md §7's queue contract).
 *
 * `source` names the producing surface, and here the two surfaces are the two
 * things §7 says produce a reflection — a person asked, or the dust settled. An
 * operator reading `corpus queue list` can tell them apart, which matters
 * exactly when somebody is asking why a reflection happened.
 */
export const REFLECT_ASK_SOURCE = "reflect";
export const REFLECT_QUIET_SOURCE = "reflect-quiet";

/** Appends one line to a job's log; `undefined` on a server with no job service. */
export type RecordJobLine = (eventId: string, line: string) => Promise<void>;

/**
 * What a reflection's job log says when the job finished and posted no digest.
 *
 * **Not an error** — the reflection happened, the clock moved, and §7 asks for a
 * digest thread without making one the condition of the work being done. What
 * makes it worth a line is that the omission is otherwise **invisible**: the
 * board bar shows a fresh "reflected 2m ago" beside the *previous* reflection's
 * digest, or beside no digest at all, and nothing anywhere says why. The line
 * names the two ways an agent gets it wrong, because both look like a posted
 * digest from the agent's side.
 */
export const NO_DIGEST_LOG_LINE =
  "this reflection finished without a digest thread, so the workspace still shows the " +
  "previous one (or none). A digest is a standalone thread created against this job: " +
  "`corpus thread create --job <eventId>` with no `--parent`. A thread posted without " +
  "`--job`, or with a parent, is an ordinary thread and is not recorded as the digest.";

export interface ReflectServiceOptions {
  readonly corpusDir: string;
  readonly projection: ProjectionDb;
  readonly enqueue: (input: EnqueueInput) => Promise<StoredEvent>;
  /** SPEC.md §7's window, re-read on every use — see `readQuietMinutes`. */
  readonly quietMinutes: () => number;
  /**
   * Write SPEC.md §7's window (SERVER-151), for the switch its rider signed
   * 2026-08-25 puts on the board bar.
   *
   * A seam rather than a direct `writeQuietMinutes` call, for the reason
   * {@link quietMinutes} is one: this service owns *when* a reflection happens
   * and knows nothing about where the workspace keeps its config. It also lets a
   * test state the refusal case — an unreadable file — without writing a broken
   * config to disk to provoke it.
   */
  readonly setQuietMinutes?: ((quiet: number) => ConfigWriteResult) | undefined;
  /**
   * The reflection's own job log, written to twice.
   *
   * **Who asked**: the route takes an actor header and the contract says the
   * header "records who asked, which is what the job log and the digest thread
   * report" — a `workspace.reflect` payload is `{ since }` and nothing else, and
   * a `StoredEvent` has no actor field, so the job log is the one place that
   * record can honestly live.
   *
   * **What was missing at the end**: see {@link NO_DIGEST_LOG_LINE}. The same
   * log, because both are facts about one job that live nowhere else.
   */
  readonly recordJobLine?: RecordJobLine | undefined;
  readonly logger?: Logger | undefined;
}

export interface ReflectService {
  /** `POST /api/workspace/reflect`. Never refuses; see {@link enqueueUnique}. */
  ask(actor: Actor): Promise<ReflectAskResult>;
  /** `GET /api/workspace/reflect`. */
  status(): ReflectStatus;
  /**
   * `PUT /api/workspace/reflect/quiet` — set the window, or switch the automatic
   * path off with `0` (SPEC.md §7).
   *
   * Answers the whole status rather than an acknowledgement, so a caller that
   * switched the path off learns in the same round trip what is still pending.
   * `null` when the workspace config could not be read: the file has a typo in
   * it, which is a thing a person has to find, so nothing is written over it.
   */
  setQuiet(quiet: number): ReflectStatus | null;
  /** A mutation landed, by this party. Restarts the quiet window unless it is the agent's. */
  observeWrite(actor: Actor): void;
  /**
   * A **standalone** thread was created by a write naming `job`. When that job
   * is a reflection, the thread is that reflection's digest.
   */
  observeThreadCreated(job: string | undefined, threadId: string): void;
  /**
   * A queue event moved. Called by `QueueService` **before** it announces the
   * transition, so a client refetching on the frame reads the clock this move
   * set rather than the one before it.
   */
  observeSettled(event: StoredEvent): void;
  /** Arms the first quiet window; see {@link ReflectScheduler.start}. */
  start(): void;
  stop(): void;
  /** The armed window in ms, or `null`. Test seam, forwarded from the scheduler. */
  readonly armedForMs: number | null;
}

export function createReflectService(options: ReflectServiceOptions): ReflectService {
  const { corpusDir, projection, enqueue, quietMinutes, setQuietMinutes } = options;
  const logger = options.logger ?? silentLogger;

  /**
   * Serializes every enqueue decision in this process.
   *
   * "Read whether one is pending, then enqueue" is a read-modify-write, and two
   * people pressing Reflect in the same tick is the ordinary case rather than the
   * exotic one — it is the very case §7 legislates for. The queue's own chain
   * does not help: it serializes the *writes*, and both callers would have
   * already read `null`.
   */
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work, work);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /**
   * The one enqueue, shared by the ask and the quiet window.
   *
   * **`202` with the pending event, never a `409`** (SPEC.md §7, settled at PR
   * #56's review): a second ask is not a mistake to correct, it is the same
   * request arriving twice, and the honest answer is the reflection that is
   * already going to run. `pending` is what tells a client which of the two
   * happened, so it can say "asked" or "already asked" without holding ids it
   * may never have seen.
   */
  const enqueueUnique = (source: string, line: string): Promise<ReflectAskResult> =>
    serialize(async () => {
      const since = readReflectState(corpusDir).reflected;
      const live = findLiveReflection(projection);
      if (live !== null) return { eventId: live, since, pending: true };

      // The payload is one timestamp and nothing else (§7): the agent gathers
      // the window itself. `null` means a corpus never reflected on, and it
      // means *everything* rather than an empty window.
      const event = await enqueue({
        type: WORKSPACE_REFLECT_EVENT_TYPE,
        source,
        payload: { since },
      });
      if (options.recordJobLine !== undefined) {
        try {
          await options.recordJobLine(event.id, line);
        } catch (error: unknown) {
          // The event is already durable. A log line that did not land is worth
          // reporting and is never worth failing the ask over.
          logger.error("could not record who asked for a reflection", {
            eventId: event.id,
            error: String(error),
          });
        }
      }
      return { eventId: event.id, since, pending: false };
    });

  const attempt = async (): Promise<ReflectAttempt> => {
    // §7's first condition, asked before anything is written: "the server
    // enqueues one when something changed after the last reflection". An
    // archive alone never starts a reflection because an archived document is
    // not in this count, which is the reason CONTRACT-076 gives for excluding
    // it — a document that shows on no board cannot carry a mark.
    const state = readReflectState(corpusDir);
    if (countUnreflected(projection, state.reflected) === 0) return "nothing-to-do";
    const minutes = quietMinutes();
    const result = await enqueueUnique(
      REFLECT_QUIET_SOURCE,
      `reflection enqueued after ${String(minutes)} min of quiet`,
    );
    return result.pending ? "busy" : "enqueued";
  };

  /**
   * Says, in the reflection's own job log, that it finished without a digest.
   *
   * **Fire and forget, on purpose.** `observeSettled` is called inside the
   * queue's own move, before the transition is announced, and it returns
   * `void`: a log append may not hold that up, and a job log that could not be
   * written may certainly not fail a transition that has already happened. The
   * failure path is the server log, exactly as the ask line's is — **unless the
   * service has been stopped by then**. An append in flight across a shutdown
   * finds the queue gone and fails for that reason alone, and a shutdown that
   * printed an error about a log line nobody will read would teach an operator
   * to ignore this message.
   */
  const reportMissingDigest = (eventId: string): void => {
    if (options.recordJobLine === undefined) return;
    void options.recordJobLine(eventId, NO_DIGEST_LOG_LINE).catch((error: unknown) => {
      if (stopped) return;
      logger.error("could not record that a reflection posted no digest", {
        eventId,
        error: String(error),
      });
    });
  };

  /** Set by {@link ReflectService.stop}; see {@link reportMissingDigest}. */
  let stopped = false;

  const scheduler: ReflectScheduler = createReflectScheduler({ quietMinutes, attempt, logger });

  return {
    ask(actor) {
      return enqueueUnique(REFLECT_ASK_SOURCE, `reflection asked by ${actor}`);
    },

    status() {
      const state = readReflectState(corpusDir);
      return {
        reflected: state.reflected,
        pending: findLiveReflection(projection),
        changed: countUnreflected(projection, state.reflected),
        lastDigest: resolveDigest(projection, state.digest),
        quiet: quietMinutes(),
      };
    },

    setQuiet(quiet) {
      const written = setQuietMinutes?.(quiet) ?? { ok: false, reason: "unreadable" as const };
      if (!written.ok) return null;
      /*
       * Re-armed from the value now on disk, not from the argument.
       *
       * `quietMinutes` re-reads the file on every use, so the scheduler would
       * pick this up on its own eventually — but "eventually" here means at the
       * next write, and switching the automatic path off has to take effect
       * before one. Re-arming makes the switch immediate in both directions:
       * `0` disarms now, and a non-zero value arms now.
       */
      scheduler.rearm();
      // The whole status, from the same read every `GET` does — so what a caller
      // is told it set is what a caller would be told if it asked again.
      return this.status();
    },

    observeWrite(actor) {
      scheduler.noteWrite(actor);
    },

    observeThreadCreated(job, threadId) {
      if (job === undefined) return;
      const row = projection.prepare("SELECT type FROM events WHERE id = ?").get(job) as
        { type: string } | undefined;
      if (row?.type !== WORKSPACE_REFLECT_EVENT_TYPE) return;
      try {
        recordAwaitingDigest(corpusDir, job, threadId);
      } catch (error: unknown) {
        // The thread is written and committed; losing the note costs one link
        // on a board bar and nothing else.
        logger.error("could not record a reflection's digest thread", {
          eventId: job,
          threadId,
          error: String(error),
        });
      }
    },

    observeSettled(event) {
      if (event.type !== WORKSPACE_REFLECT_EVENT_TYPE) return;
      // §7: the clock is "the `created` time of the last reflection **whose job
      // was processed**". `failed`, `abandoned` and `deferred` leave it exactly
      // where it was, so the retry that follows sees the same window.
      if (event.status !== "processed") return;
      // Read before the move, because the move consumes it: this is the one
      // moment anything can tell whether this reflection posted a digest.
      const awaiting = readReflectState(corpusDir).awaitingDigest;
      if (awaiting?.eventId !== event.id) reportMissingDigest(event.id);
      try {
        advanceClock(corpusDir, event.id, event.created);
      } catch (error: unknown) {
        // A transition may not fail because a derived file could not be
        // written: the event has already moved.
        logger.error("could not move the reflection clock", {
          eventId: event.id,
          error: String(error),
        });
      }
    },

    start() {
      scheduler.start();
    },

    stop() {
      stopped = true;
      scheduler.stop();
    },

    get armedForMs() {
      return scheduler.armedForMs;
    },
  };
}
