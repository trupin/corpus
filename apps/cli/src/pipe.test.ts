import { describe, expect, it } from "vitest";
import { BROKEN_PIPE_CODES, guardPipes, isBrokenPipe, type PipeStream } from "./pipe.js";

/**
 * The guard is tested by **closing the stream**, never by racing a real `head`.
 *
 * CLI-024 recorded the reason: the evaluator saw the crash once and could not
 * reproduce it in fifteen tries, because whether an EPIPE lands at all depends
 * on flush timing against the reader's exit. A test built on that race would be
 * a flake that passes when the bug is present. So the two ways Node reports a
 * dead reader — a synchronous throw from `write`, and an asynchronous `error`
 * event — are produced directly.
 */

interface FakeStream extends PipeStream {
  readonly written: string[];
  /** Raises the stream's `error` event, as Node does one tick after a failed write. */
  emit(error: unknown): void;
}

function fakeStream(options: { readonly throwOnWrite?: unknown } = {}): FakeStream {
  const written: string[] = [];
  const listeners: ((error: unknown) => void)[] = [];
  return {
    written,
    write(text: string) {
      // `unknown` in the signature, an Error at every call site — the cast is
      // what lets a test hand the guard exactly what Node hands it.
      if (options.throwOnWrite !== undefined) throw options.throwOnWrite as Error;
      written.push(text);
      return true;
    },
    on(_event: "error", listener: (error: unknown) => void) {
      listeners.push(listener);
      return this;
    },
    emit(error: unknown) {
      for (const listener of listeners) listener(error);
    },
  };
}

const epipe = (): NodeJS.ErrnoException =>
  Object.assign(new Error("write EPIPE"), { code: "EPIPE", errno: -32, syscall: "write" });

describe("isBrokenPipe", () => {
  it.each([...BROKEN_PIPE_CODES])("recognises %s as the reader having gone away", (code) => {
    expect(isBrokenPipe(Object.assign(new Error("x"), { code }))).toBe(true);
  });

  it("does not claim a real I/O failure — a full disk is not a closed pipe", () => {
    expect(isBrokenPipe(Object.assign(new Error("no space"), { code: "ENOSPC" }))).toBe(false);
  });

  it.each([undefined, null, "EPIPE", new Error("bare"), { code: 32 }])(
    "is false for %s, which carries no string code",
    (value) => {
      expect(isBrokenPipe(value)).toBe(false);
    },
  );
});

describe("a closed stdout", () => {
  it("ends the run quietly rather than crashing, when write throws", () => {
    const stdout = fakeStream({ throwOnWrite: epipe() });
    const stderr = fakeStream();
    const quits: number[] = [];

    const guard = guardPipes({ stdout, stderr, quit: () => quits.push(1) });
    expect(() => guard.stdout("a line\n")).not.toThrow();

    expect(quits).toHaveLength(1);
    // Nothing is said about it: the only channel left is stderr, which under the
    // usual `2>&1 | head` is the very pipe that just closed.
    expect(stderr.written).toEqual([]);
  });

  it("ends the run quietly when the error arrives as an event instead", () => {
    // The asynchronous half: on a pipe Node queues the write and reports the
    // failure a tick later, after `run` may already have returned.
    const stdout = fakeStream();
    const quits: number[] = [];

    guardPipes({ stdout, stderr: fakeStream(), quit: () => quits.push(1) });
    stdout.emit(epipe());

    expect(quits).toEqual([1]);
  });

  it("stops writing afterwards, so a command mid-loop does not repeat the failure", () => {
    const stdout = fakeStream();
    const quits: number[] = [];
    const guard = guardPipes({ stdout, stderr: fakeStream(), quit: () => quits.push(1) });

    guard.stdout("first\n");
    stdout.emit(epipe());
    guard.stdout("second\n");
    guard.stdout("third\n");

    expect(stdout.written).toEqual(["first\n"]);
    // One quit, not one per suppressed line.
    expect(quits).toEqual([1]);
  });

  it("re-throws anything that is not a broken pipe", () => {
    const full = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const guard = guardPipes({
      stdout: fakeStream({ throwOnWrite: full }),
      stderr: fakeStream(),
      quit: () => undefined,
    });

    expect(() => guard.stdout("a line\n")).toThrow(full);
  });

  it("re-throws a non-pipe error arriving as an event, rather than absorbing it", () => {
    const stdout = fakeStream();
    guardPipes({ stdout, stderr: fakeStream(), quit: () => undefined });

    expect(() => {
      stdout.emit(Object.assign(new Error("io"), { code: "EIO" }));
    }).toThrow("io");
  });
});

describe("a closed stderr", () => {
  it("drops the diagnostic and lets the run finish with the code it earned", () => {
    // Deliberately different from stdout. Exiting 0 here would turn a failure
    // into a success because nobody was reading the complaint.
    const stderr = fakeStream({ throwOnWrite: epipe() });
    const quits: number[] = [];
    const guard = guardPipes({ stdout: fakeStream(), stderr, quit: () => quits.push(1) });

    expect(() => guard.stderr("corpus: 404 not_found\n")).not.toThrow();
    expect(quits).toEqual([]);
  });

  it("does not end the run when the error arrives as an event either", () => {
    const stderr = fakeStream();
    const quits: number[] = [];
    guardPipes({ stdout: fakeStream(), stderr, quit: () => quits.push(1) });

    stderr.emit(epipe());
    expect(quits).toEqual([]);
  });

  it("still re-throws a real failure on that stream", () => {
    const stderr = fakeStream();
    guardPipes({ stdout: fakeStream(), stderr, quit: () => undefined });

    expect(() => {
      stderr.emit(Object.assign(new Error("io"), { code: "EIO" }));
    }).toThrow("io");
  });
});

describe("ordinary output", () => {
  it("passes through untouched while both readers are alive", () => {
    const stdout = fakeStream();
    const stderr = fakeStream();
    const guard = guardPipes({ stdout, stderr, quit: () => undefined });

    guard.stdout("one\n");
    guard.stdout("two\n");
    guard.stderr("a note\n");

    expect(stdout.written).toEqual(["one\n", "two\n"]);
    expect(stderr.written).toEqual(["a note\n"]);
  });

  it("keeps the two streams independent — a dead stdout does not silence stderr", () => {
    const stdout = fakeStream();
    const stderr = fakeStream();
    const guard = guardPipes({ stdout, stderr, quit: () => undefined });

    stdout.emit(epipe());
    guard.stdout("suppressed\n");
    guard.stderr("still reported\n");

    expect(stdout.written).toEqual([]);
    expect(stderr.written).toEqual(["still reported\n"]);
  });
});
