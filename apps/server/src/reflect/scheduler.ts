// SPEC.md §7's quiet window: "or the dust settles" (rider 9, 2026-08-22).
//
// One debounced timer, never a poll. §7 asks for a reflection when three things
// are true at once — something changed after the clock, nothing has changed for
// the window, and no reflection is pending or running — and only the middle one
// is about time. So the timer answers the middle one and {@link
// ReflectSchedulerOptions.attempt} answers the other two at the moment it fires,
// which is the only moment their answer matters.
//
// **What restarts the clock is a write by somebody other than the agent.** §7:
// "a document changed only by the agent since the clock is not marked, not
// counted, and does not start the quiet window — the digest and the changelog
// entries a reflection produces are its output, not new work for it". An agent
// write reaching here is therefore ignored outright, rather than being armed and
// then filtered at the fire: a reflection writing forty changelog entries would
// otherwise hold its own successor off for forty windows.

import type { Actor } from "@corpus/contract";
import { silentLogger, type Logger } from "../logger.js";

/** Minutes to milliseconds, in one place so a test and the timer agree. */
export const minutesToMs = (minutes: number): number => minutes * 60_000;

/**
 * What one fire found. The scheduler needs to tell "there was nothing to do"
 * from "there was something to do and somebody else is already doing it",
 * because only the second is worth waiting for again.
 */
export type ReflectAttempt =
  /** An event went on the queue. Nothing more is armed: the next write arms the next one. */
  | "enqueued"
  /** Nothing is unreflected. Nothing is armed: a corpus with nothing to say stays quiet. */
  | "nothing-to-do"
  /**
   * Something is unreflected and a reflection is already pending, in progress or
   * deferred. Re-armed for another full window — the change that arrived while
   * the running reflection held the queue is real work, and dropping it here
   * would leave it unreflected until somebody happened to write again.
   */
  | "busy";

export interface ReflectSchedulerOptions {
  /** Read afresh on every arm and every fire, so a config edit needs no restart. */
  readonly quietMinutes: () => number;
  readonly attempt: () => Promise<ReflectAttempt>;
  readonly logger?: Logger | undefined;
}

export interface ReflectScheduler {
  /**
   * Arms one full window from now (SPEC.md §7, and the issue's restart rule:
   * "after one full window from start, never at the instant of start").
   *
   * A restart is not evidence that the corpus is quiet — it is evidence of
   * nothing at all, since the process that knew was the one that went away — so
   * boot is treated as the most recent activity there is.
   */
  start(): void;
  /** A mutation landed. `agent` is ignored; see the header. */
  noteWrite(actor: Actor): void;
  /**
   * The configured window changed (SERVER-151) — re-read it and arm from now.
   *
   * `quietMinutes` is a thunk, so a changed window would be picked up on the
   * next write anyway. That is not soon enough for a switch: a person who turns
   * the automatic path off expects it off, not off after the next thing they
   * type. Re-arming makes it immediate in both directions — `0` disarms now, a
   * non-zero value arms now.
   */
  rearm(): void;
  stop(): void;
  /** The window currently armed, in ms, or `null` when nothing is. Test seam. */
  readonly armedForMs: number | null;
}

export function createReflectScheduler(options: ReflectSchedulerOptions): ReflectScheduler {
  const logger = options.logger ?? silentLogger;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armedForMs: number | null = null;
  let stopped = false;

  const disarm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    armedForMs = null;
  };

  const arm = (): void => {
    disarm();
    if (stopped) return;
    const minutes = options.quietMinutes();
    // `0` disables the automatic path (SPEC.md §7). Nothing is armed, so a
    // workspace that turned it off pays no timer at all.
    if (minutes <= 0) return;
    const delay = minutesToMs(minutes);
    armedForMs = delay;
    timer = setTimeout(() => {
      fire();
    }, delay);
    // The window is half an hour by default and a shutdown must not wait for
    // it. Reflection is something the *next* start will consider afresh.
    timer.unref();
  };

  const fire = (): void => {
    timer = undefined;
    armedForMs = null;
    if (stopped) return;
    // Re-read rather than trusting the value this window was armed with: the
    // operator may have set `reflect.quiet` to `0` during it, and disabling the
    // automatic path has to disable the reflection it is in the middle of
    // waiting for, not only the ones after it.
    if (options.quietMinutes() <= 0) return;
    void options
      .attempt()
      .then((outcome) => {
        if (outcome === "busy") arm();
      })
      .catch((error: unknown) => {
        // Never fatal, and never re-armed: a failure here is a queue write that
        // did not happen, and the next change to the corpus arms the next
        // window. Retrying a broken enqueue on a timer would just log it again.
        logger.error("could not enqueue a reflection after the quiet window", {
          error: String(error),
        });
      });
  };

  return {
    start: arm,
    rearm: arm,
    noteWrite(actor) {
      if (actor === "agent") return;
      arm();
    },
    stop() {
      stopped = true;
      disarm();
    },
    get armedForMs() {
      return armedForMs;
    },
  };
}
