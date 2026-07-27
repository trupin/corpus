import { describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger, stderrSink, stdoutSink, type LogSink } from "./logger.js";

function collectingSink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("createLogger", () => {
  it("emits one JSON object per line with level, message and fields", () => {
    const sink = collectingSink();
    createLogger("info", sink).info("listening", { port: 8765 });

    expect(sink.lines).toHaveLength(1);
    expect(JSON.parse(sink.lines[0] ?? "")).toEqual({
      level: "info",
      msg: "listening",
      port: 8765,
    });
  });

  it.each([
    ["silent", { info: 0, debug: 0 }],
    ["info", { info: 1, debug: 0 }],
    ["debug", { info: 1, debug: 1 }],
  ] as const)("gates output at level %s", (level, expected) => {
    const infoSink = collectingSink();
    createLogger(level, infoSink).info("i");
    expect(infoSink.lines).toHaveLength(expected.info);

    const debugSink = collectingSink();
    createLogger(level, debugSink).debug("d");
    expect(debugSink.lines).toHaveLength(expected.debug);
  });

  it("never gates errors — a silenced server must still say why it died", () => {
    const sink = collectingSink();
    createLogger("silent", sink).error("boom", { code: "EADDRINUSE" });
    expect(JSON.parse(sink.lines[0] ?? "")).toMatchObject({ level: "error", msg: "boom" });
  });

  it("exposes its level", () => {
    expect(createLogger("debug", collectingSink()).level).toBe("debug");
  });

  it("stringifies BigInt rather than throwing", () => {
    const sink = collectingSink();
    createLogger("info", sink).info("big", { size: 10n });
    expect(JSON.parse(sink.lines[0] ?? "")).toMatchObject({ size: "10" });
  });

  it("degrades to a placeholder when fields cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const sink = collectingSink();
    createLogger("info", sink).info("cycle", circular);

    expect(JSON.parse(sink.lines[0] ?? "")).toEqual({
      level: "info",
      msg: "cycle",
      fieldsError: "unserializable",
    });
  });
});

describe("process sinks", () => {
  it("stdoutSink and stderrSink append a newline to the right stream", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      stdoutSink.write("a");
      stderrSink.write("b");
      expect(out).toHaveBeenCalledWith("a\n");
      expect(err).toHaveBeenCalledWith("b\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("createLogger defaults to stdout", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      createLogger("info").info("default sink");
      expect(out).toHaveBeenCalledTimes(1);
    } finally {
      out.mockRestore();
    }
  });
});

describe("silentLogger", () => {
  it("discards every level, including errors", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      silentLogger.info("i");
      silentLogger.debug("d");
      silentLogger.error("e");
      expect(out).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
    }
  });
});
