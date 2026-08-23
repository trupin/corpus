import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError } from "./errors.js";
import { parseFlags } from "./parse-args.js";
import { registry } from "./registry/index.js";
import { REMOVED_FLAGS } from "./removed-flags.js";

/**
 * A removed flag is a **different mistake** from a misspelled one, and the whole
 * point of this module is that the answer says so. The caller most likely to
 * type `--pinned` is an agent working from an older skill, a prompt or a shell
 * snippet in a document, and it recovers from the message or it does not recover
 * at all — so what is asserted here is the content of the message, not merely
 * that something was thrown.
 */

const target = { name: "doc edit", args: [], flags: [] };

const failure = (tokens: readonly string[]): unknown => {
  try {
    parseFlags(target, tokens);
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected a throw");
};

const hint = (error: unknown): string => (isCliError(error) ? (error.hint ?? "") : "");

describe("a flag this CLI removed", () => {
  it("names the release and what replaced it, at exit 2", () => {
    const error = failure(["--pinned", "true"]);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("removed in 0.19.0");
    expect(String(error)).toContain("a board lists its columns");
    expect(String(error)).toContain("corpus upgrade");
  });

  it("says what to run instead, including the migration for a file that still carries the key", () => {
    expect(hint(failure(["--pinned"]))).toContain("--columns");
    expect(hint(failure(["--pinned"]))).toContain("--unset pinned");
  });

  it("answers the same on every verb, because the flag left the tool and not one command", () => {
    const elsewhere = failure(["--pinned"]);
    expect(String(elsewhere)).toContain("removed in");
  });

  it("is refused in the `--flag=value` form too", () => {
    expect(String(failure(["--pinned=false"]))).toContain("removed in");
  });

  it("still lists the alternatives for a flag that was merely mistyped", () => {
    const error = failure(["--pinnd"]);
    expect(String(error)).toContain("unknown flag");
    expect(String(error)).not.toContain("removed in");
  });

  it("does not hijack a short flag that happens to spell one", () => {
    // Only the long form is consulted: `-p` is an alias namespace, not a name.
    expect(String(failure(["-p"]))).toContain("unknown flag");
  });
});

describe("the epitaph list and the live surface cannot both claim a name", () => {
  it("declares no flag the registry still publishes", () => {
    const live = new Set<string>();
    const collect = (flags: readonly { readonly name: string }[]): void => {
      for (const flag of flags) live.add(flag.name);
    };
    for (const command of registry.commands) collect(command.flags);
    for (const topic of registry.topics) {
      for (const command of topic.commands) collect(command.flags);
    }

    for (const name of Object.keys(REMOVED_FLAGS)) {
      expect(live.has(name), `--${name} is both removed and declared`).toBe(false);
    }
  });
});
