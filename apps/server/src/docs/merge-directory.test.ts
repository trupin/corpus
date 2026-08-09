// The two windows a *merge* has and the plain rename it replaced did not
// (PR #38's review, findings 4a and 4b).
//
// `renameSync` moved a whole folder in one kernel call; a merge is one call per
// file, so anything that appears at either end while it runs falls between the
// plan's checks and the write. Neither window is reachable through the routes —
// `applyOperations` is synchronous, and this server has one writer — which is
// exactly why they are driven here, against `mergeDirectory` itself, with the
// interleaving decided rather than raced: `node:fs`'s `renameSync` is wrapped so
// a test can say *when* the intruder appears.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";

const hooks = vi.hoisted(() => ({ afterRename: undefined as (() => void) | undefined }));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: actual,
    renameSync: (from: Parameters<typeof actual.renameSync>[0], to: string) => {
      actual.renameSync(from, to);
      hooks.afterRename?.();
    },
  };
});

const { mergeDirectory } = await import("./write.js");

/** The refusal's own words — the summary is one sentence, the path is the issue. */
function refusal(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpError && "issues" in error.body) {
      return `${error.message}: ${error.body.issues[0]?.message ?? ""}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the merge to refuse");
}

let root = "";

afterEach(() => {
  hooks.afterRename = undefined;
  if (root !== "") rmSync(root, { recursive: true, force: true });
  root = "";
});

/** A source folder holding a `SKILL.md` and a nested one, and an empty destination. */
function trees(): { source: string; destination: string } {
  root = mkdtempSync(join(tmpdir(), "corpus-s025-merge-"));
  const source = join(root, "from", "demo");
  const destination = join(root, "to", "demo");
  mkdirSync(join(source, "nested"), { recursive: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "outer\n", "utf8");
  writeFileSync(join(source, "nested", "SKILL.md"), "inner\n", "utf8");
  return { source, destination };
}

describe("mergeDirectory", () => {
  it("moves both trees together and leaves no source behind", () => {
    const { source, destination } = trees();

    mergeDirectory(source, destination, "to/demo");

    expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("outer\n");
    expect(readFileSync(join(destination, "nested", "SKILL.md"), "utf8")).toBe("inner\n");
    expect(existsSync(source)).toBe(false);
  });

  it("puts everything back when it is undone", () => {
    const { source, destination } = trees();

    mergeDirectory(source, destination, "to/demo")();

    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe("outer\n");
    expect(readFileSync(join(source, "nested", "SKILL.md"), "utf8")).toBe("inner\n");
    expect(existsSync(join(destination, "SKILL.md"))).toBe(false);
  });

  // 4b: `assertMergeable` established at plan time that nothing at the
  // destination would be overwritten. That was then, and `renameSync` overwrites
  // silently, so the question is asked again at the moment of the write.
  it("refuses a file that appeared at the destination instead of overwriting it", () => {
    const { source, destination } = trees();
    hooks.afterRename = () => {
      hooks.afterRename = undefined;
      writeFileSync(join(destination, "nested", "SKILL.md"), "someone else's\n", "utf8");
    };

    expect(refusal(() => mergeDirectory(source, destination, "to/demo"))).toContain(
      "to/demo/nested/SKILL.md already exists",
    );

    // Refused, and unwound: the intruder's bytes stand and the source is whole.
    expect(readFileSync(join(destination, "nested", "SKILL.md"), "utf8")).toBe("someone else's\n");
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe("outer\n");
    expect(readFileSync(join(source, "nested", "SKILL.md"), "utf8")).toBe("inner\n");
  });

  it("refuses a non-directory where a directory it must move would go", () => {
    const { source, destination } = trees();
    writeFileSync(join(destination, "nested"), "not a directory\n", "utf8");

    expect(refusal(() => mergeDirectory(source, destination, "to/demo"))).toContain(
      "to/demo/nested already exists",
    );
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe("outer\n");
  });

  // 4a: the source was emptied with `rmSync(…, {recursive: true, force: true})`
  // on the strength of "only the now-empty skeleton is left" — an assumption
  // `force: true` then suppressed. A file written under the source after it was
  // enumerated was destroyed, and since nothing had committed it, git was no
  // recovery. `rmdir` from the bottom up fails loudly instead.
  it("refuses to delete a source that a file appeared under while it was moving", () => {
    const { source, destination } = trees();
    let moves = 0;
    hooks.afterRename = () => {
      moves += 1;
      // After the last file has moved, and so after the walk that decided the
      // source was about to be empty: exactly the window.
      if (moves === 2) writeFileSync(join(source, "late.md"), "unsaved work\n", "utf8");
    };

    expect(refusal(() => mergeDirectory(source, destination, "to/demo"))).toMatch(
      /ENOTEMPTY|not empty/,
    );

    expect(readFileSync(join(source, "late.md"), "utf8")).toBe("unsaved work\n");
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe("outer\n");
    expect(existsSync(join(destination, "SKILL.md"))).toBe(false);
  });
});
