import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobLogLineSchema } from "@corpus/contract";
import {
  FILE_CAP_NOTICE,
  JobLogStore,
  LINE_TRUNCATION_MARKER,
  MAX_LOG_FILE_BYTES,
  MAX_LOG_LINE_BYTES,
  StoredLogLineSchema,
  truncateLine,
} from "./store.js";

const EVENT = "evt_7c1d0000";
const AT = Date.parse("2026-07-27T09:00:00Z");

let root: string;
let corpusDir: string;
let store: JobLogStore;

const logPath = (): string => join(corpusDir, "jobs", `${EVENT}.jsonl`);

const records = (): unknown[] =>
  readFileSync(logPath(), "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => StoredLogLineSchema.parse(JSON.parse(text)));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s009-joblog-"));
  corpusDir = join(root, ".corpus");
  store = new JobLogStore(corpusDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("truncateLine", () => {
  it("leaves a line inside the cap untouched", () => {
    expect(truncateLine("short")).toBe("short");
    expect(truncateLine("x".repeat(MAX_LOG_LINE_BYTES))).toHaveLength(MAX_LOG_LINE_BYTES);
  });

  it("cuts an oversized line to the cap and says that it did", () => {
    const cut = truncateLine("x".repeat(64 * 1024));

    expect(Buffer.byteLength(cut, "utf8")).toBe(MAX_LOG_LINE_BYTES);
    expect(cut.endsWith(LINE_TRUNCATION_MARKER)).toBe(true);
  });

  it("cuts on a code-point boundary so the result is still valid UTF-8", () => {
    // Four bytes per emoji: a byte-wise slice would land inside one and produce
    // a replacement character.
    const cut = truncateLine("🙂".repeat(4000), 64);

    expect(cut).not.toContain("�");
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(64);
    expect(cut.endsWith(LINE_TRUNCATION_MARKER)).toBe(true);
  });
});

describe("JobLogStore", () => {
  it("appends one complete JSON object per line, recording which path wrote it", async () => {
    const outcome = await store.append(EVENT, { line: "reading thread", source: "hook", at: AT });

    expect(outcome).toEqual({
      stored: { ts: "2026-07-27T09:00:00Z", line: "reading thread" },
      capped: false,
    });
    expect(records()).toEqual([
      { ts: "2026-07-27T09:00:00Z", source: "hook", line: "reading thread" },
    ]);
    // `source` is an internal property of a gitignored runtime file; the wire
    // shape is `{ts, line}` and nothing more.
    expect(JobLogLineSchema.parse(outcome.stored)).toEqual(outcome.stored);
  });

  it("stores an oversized line truncated", async () => {
    const outcome = await store.append(EVENT, {
      line: "y".repeat(64 * 1024),
      source: "cli",
      at: AT,
    });

    expect(outcome.stored?.line.endsWith(LINE_TRUNCATION_MARKER)).toBe(true);
    expect((await store.read(EVENT))[0]?.line).toBe(outcome.stored?.line);
  });

  it("reads lines back oldest first, skipping anything unparseable", async () => {
    mkdirSync(join(corpusDir, "jobs"), { recursive: true });
    writeFileSync(
      logPath(),
      [
        JSON.stringify({ ts: "2026-07-27T09:00:00Z", line: "one" }),
        "not json at all",
        JSON.stringify({ nope: true }),
        "",
        // Hand-written and out-of-band lines are read leniently and normalized.
        JSON.stringify({ ts: "2026-07-27 09:00:02+00:00", line: "two" }),
      ].join("\n"),
      "utf8",
    );

    expect(await store.read(EVENT)).toEqual([
      { ts: "2026-07-27T09:00:00Z", line: "one" },
      { ts: "2026-07-27T09:00:02Z", line: "two" },
    ]);
  });

  it("reads an absent log as empty rather than failing", async () => {
    expect(await store.read(EVENT)).toEqual([]);
    expect(await store.exists(EVENT)).toBe(false);

    await store.append(EVENT, { line: "first", source: "server", at: AT });
    expect(await store.exists(EVENT)).toBe(true);
  });

  it("stops growing at the file cap, writes one notice, and keeps answering", async () => {
    mkdirSync(join(corpusDir, "jobs"), { recursive: true });
    // Every line this store writes ends in a newline, so a file at the cap ends
    // in one too — the notice has to land as its own line.
    writeFileSync(logPath(), `${"x".repeat(MAX_LOG_FILE_BYTES - 1)}\n`, "utf8");

    const first = await store.append(EVENT, { line: "over the cap", source: "hook", at: AT });
    const second = await store.append(EVENT, { line: "also over", source: "hook", at: AT });

    expect(first).toEqual({ stored: undefined, capped: true });
    expect(second).toEqual({ stored: undefined, capped: true });
    const lines = await store.read(EVENT);
    // Exactly one notice, and the log still reads cleanly.
    expect(lines.filter((line) => line.line === FILE_CAP_NOTICE)).toHaveLength(1);
  });

  it("is not fooled by a logged line that quotes the notice", async () => {
    // SERVER-022 finding 2. The probe used to be a substring search over the
    // file's tail, so a job that echoed the notice's wording — or an operator
    // who pasted it in — suppressed the real notice forever, and the log
    // stopped growing with nothing in it saying why.
    mkdirSync(join(corpusDir, "jobs"), { recursive: true });
    const impostor = JSON.stringify({
      ts: "2026-07-27T08:59:00Z",
      source: "hook",
      line: `the runner said: ${FILE_CAP_NOTICE}`,
    });
    const forgery = JSON.stringify({
      ts: "2026-07-27T08:59:30Z",
      source: "cli",
      line: FILE_CAP_NOTICE,
    });
    const filler = "x".repeat(MAX_LOG_FILE_BYTES - impostor.length - forgery.length - 3);
    writeFileSync(logPath(), `${filler}\n${impostor}\n${forgery}\n`, "utf8");

    const outcome = await store.append(EVENT, { line: "over the cap", source: "hook", at: AT });

    expect(outcome).toEqual({ stored: undefined, capped: true });
    const notices = (await store.read(EVENT)).filter((line) => line.line === FILE_CAP_NOTICE);
    // The forged one and the genuine one — the store wrote its own rather than
    // trusting either.
    expect(notices).toHaveLength(2);
    const lastLine = readFileSync(logPath(), "utf8").trimEnd().split("\n").at(-1) ?? "";
    expect(StoredLogLineSchema.parse(JSON.parse(lastLine))).toEqual({
      ts: "2026-07-27T09:00:00Z",
      source: "server",
      line: FILE_CAP_NOTICE,
    });
  });

  it("recognizes its own notice through a tail window that starts mid-line", async () => {
    // The probe reads the last 4 KB, and a stored line may be up to 8 KB — so
    // the first fragment in the window is expected to be unparseable, and must
    // not stop the genuine notice below it from being recognized.
    mkdirSync(join(corpusDir, "jobs"), { recursive: true });
    const notice = JSON.stringify({
      ts: "2026-07-27T08:59:00Z",
      source: "server",
      line: FILE_CAP_NOTICE,
    });
    const long = JSON.stringify({
      ts: "2026-07-27T08:58:00Z",
      source: "hook",
      line: "y".repeat(6000),
    });
    const filler = "z".repeat(MAX_LOG_FILE_BYTES - long.length - notice.length - 3);
    writeFileSync(logPath(), `${filler}\n${long}\n${notice}\n`, "utf8");

    await store.append(EVENT, { line: "over the cap", source: "hook", at: AT });

    expect((await store.read(EVENT)).filter((line) => line.line === FILE_CAP_NOTICE)).toHaveLength(
      1,
    );
  });

  it("never interleaves two concurrent appends within a line", async () => {
    await Promise.all(
      Array.from({ length: 200 }, async (_unused, index) =>
        store.append(EVENT, {
          line: `line ${index}`,
          source: index % 2 === 0 ? "hook" : "cli",
          at: AT + index,
        }),
      ),
    );

    // Every line parses as a complete object — the proof that no write landed
    // inside another.
    expect(records()).toHaveLength(200);
    expect(new Set((await store.read(EVENT)).map((line) => line.line)).size).toBe(200);
  });

  it("removes a log idempotently", async () => {
    await store.append(EVENT, { line: "x", source: "cli", at: AT });

    expect(await store.remove(EVENT)).toBe(true);
    expect(await store.remove(EVENT)).toBe(false);
  });
});
