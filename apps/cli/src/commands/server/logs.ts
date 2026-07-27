import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { UsageError } from "../../errors.js";
import { serverLogPath } from "../../paths.js";
import type { WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `.corpus/server.log` is append-only and grows for the life of a workspace
 * (rotation is out of scope here), so both verbs below read backwards from the
 * end. Loading the file to print its last 50 lines would be the obvious
 * implementation and the wrong one.
 */

export const DEFAULT_LOG_LINES = 50;
const CHUNK_BYTES = 64 * 1024;
export const FOLLOW_POLL_MS = 150;

/** The last `count` lines, read as trailing chunks rather than whole-file. */
export function tailLines(path: string, count: number): readonly string[] {
  if (count <= 0 || !existsSync(path)) return [];

  const fd = openSync(path, "r");
  try {
    let position = statSync(path).size;
    if (position === 0) return [];

    const chunks: Buffer[] = [];
    let newlines = 0;
    while (position > 0 && newlines <= count) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      readSync(fd, chunk, 0, length, position);
      chunks.unshift(chunk);
      for (const byte of chunk) if (byte === 0x0a) newlines += 1;
    }

    const text = Buffer.concat(chunks).toString("utf8");
    const lines = text.split("\n");
    // A trailing newline yields a final empty element that is not a line.
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(Math.max(0, lines.length - count));
  } finally {
    closeSync(fd);
  }
}

export interface FollowOptions {
  readonly path: string;
  /** Byte offset to resume from; usually the size at the moment the tail was read. */
  readonly from: number;
  readonly signal: AbortSignal;
  readonly write: (text: string) => void;
  readonly intervalMs?: number;
}

/**
 * Streams appended bytes until the signal aborts. Polling rather than
 * `fs.watch`: the file is appended to by another process, watch semantics for
 * that differ per platform, and 150 ms of latency on a log tail is invisible.
 */
export async function followFile(options: FollowOptions): Promise<void> {
  const intervalMs = options.intervalMs ?? FOLLOW_POLL_MS;
  let position = options.from;

  while (!options.signal.aborted) {
    let size: number;
    try {
      size = statSync(options.path).size;
    } catch {
      size = 0;
    }

    // A truncated or replaced logfile restarts from the beginning rather than
    // silently going quiet forever.
    if (size < position) position = 0;

    if (size > position) {
      const fd = openSync(options.path, "r");
      try {
        const length = size - position;
        const buffer = Buffer.alloc(length);
        readSync(fd, buffer, 0, length, position);
        position = size;
        options.write(buffer.toString("utf8"));
      } finally {
        closeSync(fd);
      }
    }

    await sleep(intervalMs, options.signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const logsCommand: WorkspaceCommandSpec = {
  name: "logs",
  summary: "Print the tail of this workspace's server log.",
  description:
    "Reads the end of `.corpus/server.log` without loading the whole file. Each " +
    "`corpus server start` writes a header line naming the timestamp, pid and port, so runs " +
    "are distinguishable in one log. `--follow` streams new lines until interrupted and exits " +
    "0 on Ctrl-C; it cannot be combined with `--json`, which promises exactly one value.",
  args: [],
  flags: [
    {
      name: "lines",
      alias: "n",
      type: "number",
      valueName: "count",
      default: DEFAULT_LOG_LINES,
      description: "How many trailing lines to print.",
    },
    {
      name: "follow",
      alias: "f",
      type: "boolean",
      description: "Keep streaming new lines until interrupted.",
    },
  ],
  examples: [
    { command: "corpus server logs", description: "Print the last 50 lines." },
    { command: "corpus server logs -n 200", description: "Print the last 200 lines." },
    {
      command: "corpus server logs -f",
      description: "Follow the log until Ctrl-C.",
    },
  ],
  handler: async (context) => {
    const { workspace, out } = context;
    const path = serverLogPath(workspace.root);
    const follow = context.flags.boolean("follow");
    const count = context.flags.number("lines") ?? DEFAULT_LOG_LINES;

    if (follow && out.json) {
      throw new UsageError("--follow streams; it cannot be combined with --json.", {
        hint: "Use `corpus server logs -n <count> --json` for a snapshot instead.",
      });
    }

    const lines = tailLines(path, count);
    out.emit({ path, lines });
    // Log text is neither data nor a status line: it is printed verbatim in both
    // modes, the same exception `--help` gets.
    if (!out.json) for (const line of lines) out.write(`${line}\n`);

    if (!follow) return;

    const controller = new AbortController();
    const stop = (): void => {
      controller.abort();
    };
    process.once("SIGINT", stop);
    try {
      await followFile({
        path,
        from: existsSync(path) ? statSync(path).size : 0,
        signal: controller.signal,
        write: (text) => {
          out.write(text);
        },
      });
    } finally {
      process.removeListener("SIGINT", stop);
    }
  },
};
