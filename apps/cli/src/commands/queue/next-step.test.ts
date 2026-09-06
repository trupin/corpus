import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNestedOutput, createOutput } from "../../output.js";
import {
  IDLE_EVENTS_NEXT_STEP,
  IDLE_HALTED_NEXT_STEP,
  IDLE_TIMEOUT_NEXT_STEP,
  MAX_NEXT_STEP_LENGTH,
  NEXT_STEP_LINES,
  SETTLED_NEXT_STEP,
} from "./next-step.js";

/**
 * The strings themselves, held to the three rules CLI-078 wrote them under: one
 * line, short, and true of both the scoped and the unscoped loop.
 *
 * The last test is the one that matters most and is the easiest to lose: the
 * five call sites must take their wording from **here**. A test that re-typed
 * the sentence would pass while `idle.ts` and `transitions.ts` drifted apart,
 * which is the failure the module exists to prevent.
 */

describe("the next-step lines", () => {
  it.each(NEXT_STEP_LINES)("is a single line: %s", (line) => {
    expect(line).not.toContain("\n");
  });

  it.each(NEXT_STEP_LINES)("is at most 120 characters: %s", (line) => {
    expect(line.length).toBeLessThanOrEqual(MAX_NEXT_STEP_LENGTH);
  });

  it.each(NEXT_STEP_LINES)("states the loop's next step rather than the caller's: %s", (line) => {
    expect(line.startsWith("next step in the loop:")).toBe(true);
  });

  it("never names a lane flag, so one wording is true of both loops", () => {
    for (const line of NEXT_STEP_LINES) {
      expect(line).not.toContain("--thread");
    }
    expect(SETTLED_NEXT_STEP).toContain("the lane you claimed from");
  });

  it("gives the three idle outcomes three different lines", () => {
    expect(
      new Set([IDLE_TIMEOUT_NEXT_STEP, IDLE_HALTED_NEXT_STEP, IDLE_EVENTS_NEXT_STEP]).size,
    ).toBe(3);
  });

  it("says of a returned window that the events are pending, not claimed", () => {
    expect(IDLE_EVENTS_NEXT_STEP).toContain("pending, not claimed");
  });

  it("never grows a second sentence", () => {
    for (const line of NEXT_STEP_LINES) {
      // One colon opens the clause; nothing after it may end and start again.
      expect(/\.\s/.test(line)).toBe(false);
    }
  });
});

describe("where the lines are written", () => {
  const sourceOf = async (name: string): Promise<string> =>
    readFile(new URL(`./${name}`, import.meta.url), "utf8");

  it("is imported by the five call sites rather than re-typed at any of them", async () => {
    for (const module of ["idle.ts", "transitions.ts", "defer.ts"]) {
      const source = await sourceOf(module);
      expect(source).toContain('from "./next-step.js"');
      // The sentence itself appears nowhere but here.
      expect(source).not.toContain("next step in the loop:");
    }
  });

  it("reaches stderr through `note`, which `--json` suppresses", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const human = createOutput({
      json: false,
      color: false,
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
    });

    human.note(SETTLED_NEXT_STEP);

    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`${SETTLED_NEXT_STEP}\n`]);
  });

  it("stays out of a batch entry's captured report", () => {
    // `corpus batch` folds each entry's JSON value and human lines into its own
    // report. A note is neither, so the line rides stderr and the report is
    // exactly what it was (CLI-078 edge case).
    const stdout: string[] = [];
    const stderr: string[] = [];
    const parent = createOutput({
      json: false,
      color: false,
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
    });
    const nested = createNestedOutput(parent);

    nested.output.line("event evt_1111 is complete.");
    nested.output.note(SETTLED_NEXT_STEP);

    expect(nested.lines()).toEqual(["event evt_1111 is complete."]);
    expect(nested.value()).toBeUndefined();
    expect(stdout).toEqual(["  event evt_1111 is complete.\n"]);
    expect(stderr).toEqual([`  ${SETTLED_NEXT_STEP}\n`]);
  });
});
