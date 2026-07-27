// Job logs: `.corpus/jobs/<eventId>.jsonl` (SPEC.md §7).
//
// Every queue event is a job, and a job's progress lines all converge on one
// append-only file — one JSON object per line, written by the CLI verb path and
// by the tokenless loopback hook path alike. There is one append implementation,
// reached by two callers.
//
// The file is **runtime state**: gitignored, reaped with its event, and a
// superset of the wire shape. `source` records which path wrote a line, for
// operators reading the file directly; `JobLogSchema` declares `{ts, line}` and
// nothing else, so `source` never reaches a response.
//
// Both caps below exist because this is the one endpoint an unauthenticated
// caller can write to: a runaway agent — or a hostile loopback process — must
// not be able to fill the disk.

import { appendFile, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { JobLogLine } from "@corpus/contract";
import { formatInstant, normalizeInstant } from "../core/time.js";

export const JOBS_DIR_NAME = "jobs";

/** Longest single line stored, in bytes. Anything longer is cut and marked. */
export const MAX_LOG_LINE_BYTES = 8 * 1024;

/** Appended to a line that was cut, so a truncated line never reads as complete. */
export const LINE_TRUNCATION_MARKER = " …[truncated]";

/** Ceiling on one job's log file, in bytes. Past it the file stops growing. */
export const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;

/** The single line written when {@link MAX_LOG_FILE_BYTES} is reached. */
export const FILE_CAP_NOTICE = `log capped at ${MAX_LOG_FILE_BYTES} bytes; further lines were dropped`;

/** How much of the file's tail is read to decide whether the cap notice is already there. */
const CAP_NOTICE_PROBE_BYTES = 4096;

export const LOG_SOURCES = ["hook", "cli", "server"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/**
 * One record as it sits on disk. Read leniently — an out-of-band `printf >>` is
 * a supported way to feed a log (SPEC.md §9.1's catch-all), so a line missing
 * `source` is still a line.
 */
export const StoredLogLineSchema = z.object({
  ts: z.string(),
  source: z.enum(LOG_SOURCES).optional(),
  line: z.string(),
});

export type StoredLogLine = z.infer<typeof StoredLogLineSchema>;

export interface AppendOutcome {
  /** The line as stored, or `undefined` when the file cap refused it. */
  readonly stored: JobLogLine | undefined;
  /** True when the file had already reached {@link MAX_LOG_FILE_BYTES}. */
  readonly capped: boolean;
}

/**
 * Cuts a line to {@link MAX_LOG_LINE_BYTES}, on a code-point boundary so the
 * result is still valid UTF-8, and marks it as cut.
 */
export function truncateLine(line: string, maxBytes: number = MAX_LOG_LINE_BYTES): string {
  if (Buffer.byteLength(line, "utf8") <= maxBytes) return line;
  const budget = maxBytes - Buffer.byteLength(LINE_TRUNCATION_MARKER, "utf8");
  let used = 0;
  let kept = "";
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > budget) break;
    kept += character;
    used += size;
  }
  return `${kept}${LINE_TRUNCATION_MARKER}`;
}

/** The `{ts, line}` the API returns; `source` stays behind, in the file. */
export function toWireLine(record: StoredLogLine): JobLogLine {
  return { ts: normalizeInstant(record.ts) ?? record.ts, line: record.line };
}

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

export interface AppendInput {
  readonly line: string;
  readonly source: LogSource;
  /** Epoch milliseconds; injected so tests and the write path share one clock. */
  readonly at: number;
}

export class JobLogStore {
  readonly jobsDir: string;
  /**
   * One append at a time in this process. `appendFile` on a POSIX file opened
   * `O_APPEND` would not interleave two short writes anyway, but the file-cap
   * check is a read-then-write and the cap notice must be written exactly once.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly corpusDir: string) {
    this.jobsDir = join(corpusDir, JOBS_DIR_NAME);
  }

  pathFor(eventId: string): string {
    return join(this.jobsDir, `${eventId}.jsonl`);
  }

  async exists(eventId: string): Promise<boolean> {
    try {
      await stat(this.pathFor(eventId));
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  async append(eventId: string, input: AppendInput): Promise<AppendOutcome> {
    return this.serialize(async () => {
      await mkdir(this.jobsDir, { recursive: true });
      const path = this.pathFor(eventId);
      const size = await this.sizeOf(path);

      if (size >= MAX_LOG_FILE_BYTES) {
        // Not an error: a job that logged too much is still a job, and failing
        // the append would turn a disk-protection measure into a broken hook.
        if (!(await this.hasCapNotice(path, size))) {
          await this.write(path, {
            ts: formatInstant(input.at),
            source: "server",
            line: FILE_CAP_NOTICE,
          });
        }
        return { stored: undefined, capped: true };
      }

      const record: StoredLogLine = {
        ts: formatInstant(input.at),
        source: input.source,
        line: truncateLine(input.line),
      };
      await this.write(path, record);
      return { stored: toWireLine(record), capped: false };
    });
  }

  /**
   * Every parseable line, oldest first. Unparseable lines are skipped rather
   * than failing the read: the file is append-only and a half-written tail (or a
   * hand-edited line) must not cost the console the rest of the log.
   */
  async read(eventId: string): Promise<JobLogLine[]> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(eventId), "utf8");
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
    const lines: JobLogLine[] = [];
    for (const text of raw.split("\n")) {
      if (text.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const record = StoredLogLineSchema.safeParse(parsed);
      if (record.success) lines.push(toWireLine(record.data));
    }
    return lines;
  }

  /** `false` when there was no log file, which is never an error. */
  async remove(eventId: string): Promise<boolean> {
    try {
      await unlink(this.pathFor(eventId));
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  private async write(path: string, record: StoredLogLine): Promise<void> {
    // One `appendFile` of one complete line, newline included: two concurrent
    // appends can order either way but neither can land inside the other.
    await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private async sizeOf(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch (error) {
      if (isEnoent(error)) return 0;
      throw error;
    }
  }

  /** Reads only the file's tail: the notice is the last thing written, if at all. */
  private async hasCapNotice(path: string, size: number): Promise<boolean> {
    const length = Math.min(size, CAP_NOTICE_PROBE_BYTES);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString("utf8").includes(FILE_CAP_NOTICE);
    } finally {
      await handle.close();
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work, work);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
