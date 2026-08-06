import { describe, expect, it } from "vitest";
import { InternalError, ServerResponseError, UsageError } from "./errors.js";
import { createNestedOutput, createOutput } from "./output.js";

function collector() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (json: boolean, color = false) =>
      createOutput({
        json,
        color,
        stdout: (text) => void stdout.push(text),
        stderr: (text) => void stderr.push(text),
      }),
  };
}

describe("--json mode", () => {
  it("writes exactly one JSON value to stdout and nothing else", () => {
    const sink = collector();
    const out = sink.out(true);
    out.line("this human one-liner must not appear");
    out.emit({ status: "ok", uptimeSeconds: 1 });

    expect(sink.stdout.join("")).toBe('{"status":"ok","uptimeSeconds":1}\n');
    expect(JSON.parse(sink.stdout.join(""))).toEqual({ status: "ok", uptimeSeconds: 1 });
    expect(sink.stderr).toEqual([]);
  });

  it("refuses a second emit, because --json promises exactly one value", () => {
    const sink = collector();
    const out = sink.out(true);
    out.emit(1);
    expect(() => out.emit(2)).toThrow(InternalError);
  });

  it("writes failures as a problem envelope on stderr, leaving stdout empty", () => {
    const sink = collector();
    sink.out(true).fail(
      new ServerResponseError("404 not_found: no such document", {
        code: "not_found",
        status: 404,
        details: { id: "doc-1" },
      }),
      { verbose: false },
    );

    expect(sink.stdout).toEqual([]);
    expect(JSON.parse(sink.stderr.join(""))).toEqual({
      error: {
        code: "not_found",
        message: "404 not_found: no such document",
        details: { id: "doc-1" },
      },
    });
  });

  it("reports a non-CliError as an internal problem", () => {
    const sink = collector();
    sink.out(true).fail(new Error("boom"), { verbose: false });
    expect(JSON.parse(sink.stderr.join(""))).toEqual({
      error: { code: "internal_error", message: "boom" },
    });
  });
});

describe("human mode", () => {
  it("is quiet on success: the one-liner only, never the JSON value", () => {
    const sink = collector();
    const out = sink.out(false);
    out.emit({ status: "ok" });
    out.line("ok — corpus 0.0.0");

    expect(sink.stdout.join("")).toBe("ok — corpus 0.0.0\n");
  });

  it("renders the message, the hint and the details on stderr", () => {
    const sink = collector();
    sink
      .out(false)
      .fail(new UsageError('unknown flag "--nope".', { hint: "Known flags: --json" }), {
        verbose: false,
      });
    expect(sink.stderr.join("")).toBe('corpus: unknown flag "--nope".\n  Known flags: --json\n');
  });

  it("prints a stack only under --verbose", () => {
    const sink = collector();
    const error = new Error("boom");
    sink.out(false).fail(error, { verbose: false });
    expect(sink.stderr.join("")).not.toContain("at ");

    const verboseSink = collector();
    verboseSink.out(false).fail(error, { verbose: true });
    expect(verboseSink.stderr.join("")).toContain("Error: boom");
  });
});

describe("colour", () => {
  it("bolds only when colour is on", () => {
    const sink = collector();
    expect(sink.out(false, false).bold("Usage:")).toBe("Usage:");
    expect(sink.out(false, true).bold("Usage:")).toContain("Usage:");
    expect(sink.out(false, true).bold("Usage:")).not.toBe("Usage:");
  });

  it("writes help text to stdout in both modes", () => {
    const sink = collector();
    sink.out(true).write("help text\n");
    expect(sink.stdout.join("")).toBe("help text\n");
  });
});

describe("a note", () => {
  it("goes to stderr in human mode, leaving stdout to the machine payload", () => {
    // `queue claim-all` writes one JSON line to stdout in *both* modes, so its
    // human prose has nowhere else to go — and the split is what keeps the
    // claimed batch and the server's in-progress view from ever mixing.
    const sink = collector();
    sink.out(false).note("the server still holds 2 events in-progress");

    expect(sink.stdout).toEqual([]);
    expect(sink.stderr.join("")).toBe("the server still holds 2 events in-progress\n");
  });

  it("is silent under --json, where stderr is the failure envelope", () => {
    const sink = collector();
    sink.out(true).note("the server still holds 2 events in-progress");

    expect(sink.stdout).toEqual([]);
    expect(sink.stderr).toEqual([]);
  });
});

describe("a nested output, for a command run as a step of another", () => {
  it("captures the step's JSON value instead of emitting it", () => {
    // The invariant `--json` rests on: exactly one value on stdout. A composite
    // command calling three handlers must not produce three documents.
    const sink = collector();
    const parent = sink.out(true);
    const nested = createNestedOutput(parent);

    nested.output.emit({ stopped: true });
    parent.emit({ mode: "upgrade" });

    expect(sink.stdout.join("")).toBe('{"mode":"upgrade"}\n');
    expect(nested.value()).toEqual({ stopped: true });
  });

  it("passes human lines through indented, and records them", () => {
    const sink = collector();
    const nested = createNestedOutput(sink.out(false));
    nested.output.line("stopped (pid 4711)");

    expect(sink.stdout.join("")).toBe("  stopped (pid 4711)\n");
    expect(nested.lines()).toEqual(["stopped (pid 4711)"]);
  });

  it("keeps a step's `write` off stdout, where it would break --json", () => {
    const sink = collector();
    const nested = createNestedOutput(sink.out(true));
    nested.output.write("two\nlines\n");

    expect(sink.stdout).toEqual([]);
    expect(nested.lines()).toEqual(["two", "lines"]);
  });

  it("passes a step's note through indented, on the parent's stderr", () => {
    const sink = collector();
    const nested = createNestedOutput(sink.out(false));
    nested.output.note("the server still holds 1 event in-progress");

    expect(sink.stdout).toEqual([]);
    expect(sink.stderr.join("")).toBe("  the server still holds 1 event in-progress\n");
  });

  it("never lets a step decide to print JSON", () => {
    const nested = createNestedOutput(collector().out(true));
    expect(nested.output.json).toBe(false);
  });
});
