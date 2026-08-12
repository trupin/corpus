// Jobs: the console's view of the queue (SPEC.md §7, §11).
//
// A job is a queue event being worked, addressed by that event's id. This
// service owns the log file, the console row and the two actions the console
// offers on a failed job; the queue owns every status transition, and this
// service calls it rather than reimplementing one.

import type { Job, JobLog } from "@corpus/contract";
import { notFound } from "../errors.js";
import { silentLogger, type Logger } from "../logger.js";
import type { ProjectionDb } from "../projection/index.js";
import type { QueueService } from "../queue/index.js";
import { listJobRows, readJobRow, recordJobLine, type JobFilter } from "./project.js";
import { JobLogStore, type AppendOutcome, type LogSource } from "./store.js";

/** Recorded in the log when the console asks for a failed job to run again. */
export const RETRY_LOG_LINE = "retry requested";

export interface JobServiceOptions {
  readonly corpusDir: string;
  readonly projection: ProjectionDb;
  readonly queue: QueueService;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}

export class JobService {
  readonly store: JobLogStore;
  private readonly projection: ProjectionDb;
  private readonly queue: QueueService;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(options: JobServiceOptions) {
    this.store = new JobLogStore(options.corpusDir);
    this.projection = options.projection;
    this.queue = options.queue;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? Date.now;
  }

  /**
   * Appends one line to a job's log.
   *
   * "Unknown" is resolved against the **queue store** — the filesystem — rather
   * than the projection's `events` mirror: a Claude Code hook can fire before
   * the mirror has caught up, and refusing that append would lose a real line
   * over a race (sprint-005 Open Conflict 7h).
   *
   * The append deliberately broadcasts **nothing**. The watcher tails
   * `.corpus/jobs/` (SPEC.md §9.1) and its debounce is what turns a chatty job's
   * hundreds of lines into a handful of `invalidate` frames per second; a frame
   * per append would be the same data at a hundred times the volume, and the
   * frames still carry only keys (§2 rule 3). The projection row *is* updated
   * here, synchronously, so `GET /api/jobs` after an append already shows the
   * line.
   */
  async appendLine(eventId: string, line: string, source: LogSource): Promise<AppendOutcome> {
    if ((await this.queue.store.locate(eventId)) === undefined) {
      throw notFound(`no queue event ${eventId}`);
    }
    const outcome = await this.store.append(eventId, { line, source, at: this.now() });
    if (outcome.stored !== undefined) {
      recordJobLine(this.projection, eventId, outcome.stored);
    } else if (outcome.capped) {
      this.logger.info("job log is at its size cap; dropping the line", { eventId });
    }
    return outcome;
  }

  /**
   * Lines from `cursor` onwards. A job that has never logged reads as an empty
   * log, not a 404 — the event exists, it simply has nothing to say yet.
   */
  async readLog(eventId: string, cursor: number): Promise<JobLog> {
    const lines = await this.store.read(eventId);
    if (lines.length === 0 && !(await this.store.exists(eventId))) {
      if ((await this.queue.store.locate(eventId)) === undefined) {
        throw notFound(`no job ${eventId}`);
      }
    }
    // A cursor past the end is an ordinary state — the caller holds more than the
    // file does after a rebuild — and answers with an empty page, never an error.
    return { lines: lines.slice(cursor), nextCursor: lines.length };
  }

  list(recent: number, filter: JobFilter = {}): Job[] {
    return listJobRows(this.projection, recent, filter);
  }

  /**
   * Failed **or deferred** → pending, with the attempt count reset. Retry is
   * defined for those two states only: asking for it on a job that is still
   * running is a conflict, not a silent no-op that would look like it worked.
   *
   * Deferred is admitted since SERVER-030, and this is the **manual override**
   * SPEC.md §7 names — automatic re-entry when the person's edit session ends
   * (SERVER-099) supplements it, it does not delete it. The operator still needs
   * a way to pull back a deferral that automatic re-entry never reached: a
   * deferral that named the wrong document, or one filed against a document
   * whose session had already ended.
   *
   * The "which status is it?" question is asked **by the queue, inside its own
   * writer chain** (`onlyFrom`). Asked here it would be answered before the
   * move, and a `complete` landing in between would leave `requeue` — which
   * moves the event from wherever it happens to be — re-running a job that had
   * just finished (SERVER-022 finding 2).
   */
  async retry(eventId: string): Promise<Job> {
    await this.queue.requeue(eventId, { onlyFrom: ["failed", "deferred"] });
    // The log file is kept — it is the evidence of why the job failed — and gains
    // a line saying the run was asked for again.
    await this.appendLine(eventId, RETRY_LOG_LINE, "server");
    return this.requireRow(eventId);
  }

  /** Gives up on the job. The event moves to `abandoned/`; nothing is deleted. */
  async abandon(eventId: string): Promise<Job> {
    await this.queue.abandon(eventId);
    return this.requireRow(eventId);
  }

  private requireRow(eventId: string): Job {
    const row = readJobRow(this.projection, eventId);
    if (row === undefined) throw notFound(`no job ${eventId}`);
    return row;
  }
}

export function createJobService(options: JobServiceOptions): JobService {
  return new JobService(options);
}
