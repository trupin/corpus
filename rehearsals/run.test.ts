import { describe, expect, it } from "vitest";
import { parseArgs, runnerArgv, runnerPrompt, RUNNER_MODEL } from "./run.js";

describe("runnerPrompt — rule 1, asserted against the literal string", () => {
  it("carries the workspace path and the follow-your-skill instruction, and nothing else", () => {
    expect(runnerPrompt("/private/tmp/corpus-abc123/workspace")).toBe(
      "You are the agent for the Corpus workspace at /private/tmp/corpus-abc123/workspace. " +
        "That workspace is your working directory. " +
        "Follow the orchestrate skill installed in this workspace: " +
        "invoke /orchestrate and run its loop until the session is stopped.",
    );
  });

  it("is a pure template over the path — two paths differ only by the path", () => {
    const a = runnerPrompt("/one");
    const b = runnerPrompt("/two");
    expect(a.replace("/one", "/two")).toBe(b);
  });

  it("leaks no test knowledge", () => {
    // A neutral path, so the check measures the template and not the caller.
    const prompt = runnerPrompt("/w").toLowerCase();
    for (const banned of [
      "scenario",
      "test",
      "assert",
      "expect",
      "check",
      "verif",
      "invariant",
      "judgment",
      "score",
      "grade",
      "observ",
      "measur",
      "rehears",
      "story",
      "reply",
      "answer",
      "question",
      "event",
      "model",
      "weight",
    ]) {
      expect(prompt, `prompt must not contain "${banned}"`).not.toContain(banned);
    }
  });
});

describe("runnerArgv", () => {
  it("carries the prompt verbatim as one argv entry and only operational flags", () => {
    expect(runnerArgv("PROMPT")).toEqual([
      "-p",
      "PROMPT",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "--setting-sources",
      "project",
      "--model",
      RUNNER_MODEL,
    ]);
  });
});

describe("parseArgs", () => {
  it("splits scenario ids from the release label", () => {
    expect(parseArgs(["03-one-question-one-answer", "--release", "v0.31.0"])).toEqual({
      scenarioIds: ["03-one-question-one-answer"],
      release: "v0.31.0",
    });
  });

  it("refuses an unknown flag rather than running the wrong pass", () => {
    expect(() => parseArgs(["--runs"])).toThrow("unknown flag");
  });
});
