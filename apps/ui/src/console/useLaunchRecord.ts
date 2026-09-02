import { useJobLog, useJobs } from "@corpus/kit";
import { designationJob, readLaunchRecord, type LaunchRecord } from "./launchRecord";

/**
 * What the selected lane's listener launched at, read through the queue
 * (SPEC.md §7; AGENT-059's launch record — see `launchRecord.ts` for why this is
 * read and never derived).
 *
 * ## Two reads, and only for the lane a person is looking at
 *
 * `GET /api/jobs?originId=<lane>` finds the designation's own event, then
 * `GET /api/jobs/{id}/log` reads what that event logged. Both are keyed on the
 * **selected** lane, exactly as `useThreadScope` is: a roster of a dozen lanes
 * must not be two dozen requests on mount, and §7 forbids the sweep.
 *
 * That is deliberately *not* {@link useOutstandingJobs}' shared query. UI-075
 * removed a per-row `?originId=` fan-out and this does not re-open it — the
 * distinction is a gesture against a row. It also could not use it: a
 * designation is normally `processed`, and that query is filtered to the three
 * non-terminal states, so the event this needs is exactly the kind it drops.
 *
 * ## An unanswered read is never an answer
 *
 * `record` is `undefined` while either read is in flight and `null` only once
 * the queue has answered with nothing — UI-098's rule, which matters more here
 * than usual: `null` is what the surface turns into *"what it went out at is
 * unknown"*, and saying that out of a fetch that has not landed would be the tab
 * asserting an absence it has not observed.
 *
 * A read that **failed** is a third thing again, and is reported as a failure
 * rather than folded into either: the server's own message is more specific than
 * anything this file could say about a request it did not see.
 */
export interface LaunchReading {
  /**
   * The launch record, `null` when the queue holds none, `undefined` while
   * either read is still in flight.
   */
  readonly record: LaunchRecord | null | undefined;
  /** The message of whichever read failed, or `null` when neither did. */
  readonly failure: string | null;
}

/** Nothing to read: the pane is showing a lane with no designation behind it. */
const IDLE: LaunchReading = { record: null, failure: null };

export function useLaunchRecord(lane: string | null): LaunchReading {
  const enabled = lane !== null;
  const jobs = useJobs({ originId: lane ?? "" }, { enabled });
  const designation = designationJob(jobs.data?.jobs, lane ?? "");
  const log = useJobLog(designation?.eventId ?? null, { enabled: enabled && designation !== null });

  if (!enabled) return IDLE;
  if (jobs.error !== null) return { record: undefined, failure: jobs.error.message };
  if (jobs.data === undefined) return { record: undefined, failure: null };
  // The queue holds no designation event for this lane: reaped, or made before
  // AGENT-059 ever logged one. Answered, and the answer is nothing.
  if (designation === null) return { record: null, failure: null };
  if (log.error !== null) return { record: undefined, failure: log.error.message };
  if (log.data === undefined) return { record: undefined, failure: null };
  return { record: readLaunchRecord(log.data.lines), failure: null };
}
