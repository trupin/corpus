import { describe, expect, it } from "vitest";
import { resolveCommand, topLevelNames } from "./dispatch.js";
import { ExitCode, UsageError } from "./errors.js";
import { fixtureRegistry } from "./registry/fixtures.js";

function resolve(argv: readonly string[]) {
  return resolveCommand(fixtureRegistry, argv);
}

describe("resolveCommand", () => {
  it("prints top-level help for no arguments", () => {
    expect(resolve([])).toEqual({ kind: "root-help" });
  });

  it("prints top-level help for --help and reports the version for --version", () => {
    expect(resolve(["--help"])).toEqual({ kind: "root-help" });
    expect(resolve(["-h"])).toEqual({ kind: "root-help" });
    expect(resolve(["--version"])).toEqual({ kind: "version" });
    expect(resolve(["--version=true"])).toEqual({ kind: "version" });
    expect(resolve(["--help", "--version"])).toEqual({ kind: "root-help" });
  });

  it("treats a lone --json as no command at all", () => {
    expect(resolve(["--json"])).toEqual({ kind: "root-help" });
  });

  it("resolves a top-level command and hands the rest of argv to the parser", () => {
    const resolution = resolve(["everything", "doc-1", "--loud"]);
    expect(resolution.kind).toBe("command");
    if (resolution.kind !== "command") return;
    expect(resolution.command.name).toBe("everything");
    expect(resolution.topic).toBeUndefined();
    expect(resolution.tokens).toEqual(["doc-1", "--loud"]);
  });

  it("resolves a topic verb and strips both path tokens", () => {
    const resolution = resolve(["widget", "show", "w-1", "--json"]);
    expect(resolution.kind).toBe("command");
    if (resolution.kind !== "command") return;
    expect(resolution.command.name).toBe("show");
    expect(resolution.topic).toBe("widget");
    expect(resolution.tokens).toEqual(["w-1", "--json"]);
  });

  it("skips global flags and their values when looking for the command name", () => {
    const resolution = resolve(["--workspace", "/tmp/ws", "--json", "widget", "list"]);
    expect(resolution.kind).toBe("command");
    if (resolution.kind !== "command") return;
    expect(resolution.command.name).toBe("list");
    expect(resolution.tokens).toEqual(["--workspace", "/tmp/ws", "--json"]);
  });

  it("does not mistake an inline flag value for a command name", () => {
    const resolution = resolve(["--workspace=/tmp/ws", "everything", "doc-1"]);
    expect(resolution.kind).toBe("command");
    if (resolution.kind !== "command") return;
    expect(resolution.command.name).toBe("everything");
  });

  it("prints topic help when a topic is named with no verb", () => {
    const resolution = resolve(["widget"]);
    expect(resolution.kind).toBe("topic-help");
    if (resolution.kind !== "topic-help") return;
    expect(resolution.topic.name).toBe("widget");
  });

  it("prints topic help for `corpus <topic> --help`", () => {
    expect(resolve(["widget", "--help"]).kind).toBe("topic-help");
  });

  it("stops scanning at `--`", () => {
    expect(resolve(["--", "widget"])).toEqual({ kind: "root-help" });
  });

  it("rejects an unknown command with exit code 2 and lists the valid names", () => {
    let thrown: unknown;
    try {
      resolve(["nosuchtopic"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UsageError);
    expect(thrown).toHaveProperty("exitCode", ExitCode.usageError);
    const hint = thrown instanceof UsageError ? (thrown.hint ?? "") : "";
    expect(hint).toContain("Valid: everything, bootstrap, widget.");
    expect(hint).not.toContain("Did you mean");
  });

  it("suggests a near miss within edit distance 2", () => {
    try {
      resolve(["widgets"]);
      expect.unreachable("expected a usage error");
    } catch (error) {
      const hint = error instanceof UsageError ? (error.hint ?? "") : "";
      expect(hint).toContain('Did you mean "widget"?');
    }
  });

  it("rejects an unknown verb, listing the topic's verbs", () => {
    try {
      resolve(["widget", "shwo"]);
      expect.unreachable("expected a usage error");
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as Error).message).toContain('unknown verb "shwo" for "corpus widget"');
      const hint = error instanceof UsageError ? (error.hint ?? "") : "";
      expect(hint).toContain('Did you mean "show"?');
      expect(hint).toContain("Valid: list, show.");
    }
  });
});

describe("topLevelNames", () => {
  it("lists commands before topics", () => {
    expect(topLevelNames(fixtureRegistry)).toEqual(["everything", "bootstrap", "widget"]);
  });
});
