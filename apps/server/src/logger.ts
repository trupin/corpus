// Structured logging for the server process. One JSON object per line, written
// to stdout — `corpus server start` (CLI-002) redirects that stream into
// `.corpus/server.log`, so the format has to stay machine-parseable while still
// naming things a human reading `corpus server logs` can act on.

import { z } from "zod";

export const LOG_LEVELS = ["silent", "info", "debug"] as const;

export const LogLevelSchema = z.enum(LOG_LEVELS);

export type LogLevel = z.infer<typeof LogLevelSchema>;

/** Ordering used for level gating; `silent` suppresses everything but errors. */
const LEVEL_RANK: Record<LogLevel, number> = { silent: 0, info: 1, debug: 2 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  /** Errors are never gated: a silenced server must still report why it died. */
  error(message: string, fields?: LogFields): void;
}

export interface LogSink {
  write(line: string): void;
}

export const stdoutSink: LogSink = {
  write(line) {
    process.stdout.write(`${line}\n`);
  },
};

export const stderrSink: LogSink = {
  write(line) {
    process.stderr.write(`${line}\n`);
  },
};

/**
 * Serializes a record to a single JSON line. Values that JSON cannot represent
 * (BigInt, circular structures, functions) are stringified rather than throwing —
 * a logger that can crash the request it is describing is worse than a lossy one.
 */
function formatLine(
  level: Exclude<LogLevel, "silent"> | "error",
  message: string,
  fields: LogFields,
): string {
  const record: LogFields = { level, msg: message, ...fields };
  try {
    return JSON.stringify(record, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    return JSON.stringify({ level, msg: message, fieldsError: "unserializable" });
  }
}

export function createLogger(level: LogLevel, sink: LogSink = stdoutSink): Logger {
  const enabled = (at: LogLevel): boolean => LEVEL_RANK[level] >= LEVEL_RANK[at];

  return {
    level,
    info(message, fields = {}) {
      if (enabled("info")) sink.write(formatLine("info", message, fields));
    },
    debug(message, fields = {}) {
      if (enabled("debug")) sink.write(formatLine("debug", message, fields));
    },
    error(message, fields = {}) {
      sink.write(formatLine("error", message, fields));
    },
  };
}

/** A logger that discards everything — the default for `createServer` in tests. */
export const silentLogger: Logger = createLogger("silent", { write: () => undefined });
