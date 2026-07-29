import { describe, expect, it } from "vitest";
import {
  decide,
  isReported,
  nextManifestFiles,
  planUpgrade,
  writes,
  UPGRADE_ACTIONS,
  type IncomingFile,
  type UpgradeAction,
  type UpgradeDecision,
} from "./plan.js";

/**
 * The decision matrix is a pure function of three hashes precisely so it can be
 * exhausted here rather than approximated against a filesystem. The cell that
 * matters is `update` — it is the only one that destroys anything — so every
 * test below is really asking "is this cell `update`, and should it be?".
 */

const A = "aaaa";
const B = "bbbb";
const C = "cccc";

const at = (
  baseline: string | null,
  workspace: string | null,
  incoming: string | null,
): UpgradeAction => decide({ path: "p", baseline, workspace, incoming });

describe("decide", () => {
  it("covers every cell of (baseline × workspace × incoming)", () => {
    const values = [null, A, B, C];
    const seen = new Set<UpgradeAction>();
    for (const baseline of values) {
      for (const workspace of values) {
        for (const incoming of values) {
          const action = at(baseline, workspace, incoming);
          expect(UPGRADE_ACTIONS).toContain(action);
          seen.add(action);
        }
      }
    }
    // Every declared verdict is reachable: an action nothing can produce is an
    // action nobody maintains.
    expect([...seen].sort()).toEqual([...UPGRADE_ACTIONS].sort());
  });

  it("updates only what the workspace never touched and the tool changed", () => {
    expect(at(A, A, B)).toBe("update");
  });

  it("keeps and reports a file modified here that the tool also changed", () => {
    expect(at(A, B, C)).toBe("keep-modified");
  });

  it("keeps a file modified here silently when the tool did not change it", () => {
    // Nothing to upgrade, so nothing to say: reporting it would train the
    // operator to ignore the report.
    expect(at(A, B, A)).toBe("keep-silent");
    expect(isReported("keep-silent")).toBe(false);
  });

  it("says nothing when the workspace copy already is the incoming one", () => {
    expect(at(A, A, A)).toBe("current");
    expect(at(A, B, B)).toBe("current");
    expect(isReported("current")).toBe(false);
  });

  it("reports a deleted file rather than reinstalling it", () => {
    expect(at(A, null, A)).toBe("restore-candidate");
    expect(at(A, null, B)).toBe("restore-candidate");
    expect(writes("restore-candidate", false)).toBe(false);
    expect(writes("restore-candidate", true)).toBe(true);
  });

  it("installs a file that is new to the template and absent here", () => {
    expect(at(null, null, A)).toBe("install");
  });

  it("never overwrites a file it has no baseline for", () => {
    // Without a baseline an untouched old copy and an edited one look the same,
    // and guessing wrong destroys work.
    expect(at(null, B, A)).toBe("keep-modified");
    expect(at(null, A, A)).toBe("current");
  });

  it("retires a manifest entry the template dropped, whatever the workspace holds", () => {
    expect(at(A, A, null)).toBe("retired");
    expect(at(A, B, null)).toBe("retired");
    expect(at(A, null, null)).toBe("retired");
    expect(writes("retired", true)).toBe(false);
  });

  it("writes on exactly two verdicts, plus restore under its flag", () => {
    const writing = UPGRADE_ACTIONS.filter((action) => writes(action, false));
    expect(writing).toEqual(["update", "install"]);
    expect(UPGRADE_ACTIONS.filter((action) => writes(action, true))).toEqual([
      "update",
      "install",
      "restore-candidate",
    ]);
  });
});

describe("planUpgrade", () => {
  const incoming: readonly IncomingFile[] = [
    { path: ".claude/skills/comment/SKILL.md", from: "/t/comment", sha256: B },
    { path: ".claude/skills/notes/SKILL.md", from: "/p/notes", sha256: B, source: "plugin:todos" },
    { path: "README.md", from: "/t/readme", sha256: A },
  ];

  it("decides one path at a time, sorted, and carries each file's provenance", () => {
    const workspace = new Map([
      [".claude/skills/comment/SKILL.md", A],
      [".claude/skills/notes/SKILL.md", A],
      ["README.md", A],
      ["data/docs/views/old.md", C],
    ]);
    const plan = planUpgrade(
      [
        { path: ".claude/skills/comment/SKILL.md", sha256: A },
        { path: ".claude/skills/notes/SKILL.md", sha256: A, source: "plugin:todos" },
        { path: "README.md", sha256: A },
        { path: "data/docs/views/old.md", sha256: C },
      ],
      incoming,
      (path) => workspace.get(path) ?? null,
    );

    expect(plan.map((decision) => [decision.path, decision.action])).toEqual([
      [".claude/skills/comment/SKILL.md", "update"],
      [".claude/skills/notes/SKILL.md", "update"],
      ["README.md", "current"],
      ["data/docs/views/old.md", "retired"],
    ]);
    // The plugin entry is refreshed from the plugin's own copy, not the template's.
    expect(plan[1]?.source).toBe("plugin:todos");
    expect(plan[0]?.source).toBeUndefined();
  });

  it("unions the manifest's paths with the current sources", () => {
    const plan = planUpgrade([{ path: "gone.md", sha256: A }], incoming, () => null);
    expect(plan.map((decision) => decision.path)).toEqual([
      ".claude/skills/comment/SKILL.md",
      ".claude/skills/notes/SKILL.md",
      "README.md",
      "gone.md",
    ]);
  });
});

describe("nextManifestFiles", () => {
  const decision = (
    path: string,
    action: UpgradeAction,
    shas: { baseline: string | null; workspace: string | null; incoming: string | null },
    source?: string,
  ): UpgradeDecision => ({ path, action, ...shas, ...(source === undefined ? {} : { source }) });

  it("records what a write actually put on disk", () => {
    expect(
      nextManifestFiles(
        [decision("a", "update", { baseline: A, workspace: A, incoming: B })],
        false,
      ),
    ).toEqual([{ path: "a", sha256: B }]);
  });

  it("keeps a modified file's ORIGINAL baseline, so it stays modified next time", () => {
    // Adopting the current bytes as the baseline would make the file read as
    // untouched on the next run, and the run after that would overwrite the
    // very edit this verb refused to touch.
    expect(
      nextManifestFiles(
        [decision("a", "keep-modified", { baseline: A, workspace: B, incoming: C })],
        false,
      ),
    ).toEqual([{ path: "a", sha256: A }]);
  });

  it("keeps a deleted file's baseline so a later --restore still knows it", () => {
    expect(
      nextManifestFiles(
        [decision("a", "restore-candidate", { baseline: A, workspace: null, incoming: A })],
        false,
      ),
    ).toEqual([{ path: "a", sha256: A }]);
    expect(
      nextManifestFiles(
        [decision("a", "restore-candidate", { baseline: A, workspace: null, incoming: B })],
        true,
      ),
    ).toEqual([{ path: "a", sha256: B }]);
  });

  it("drops a retired entry, whose file stays on disk", () => {
    expect(
      nextManifestFiles(
        [decision("a", "retired", { baseline: A, workspace: A, incoming: null })],
        false,
      ),
    ).toEqual([]);
  });

  it("adopts a baseline-less file only when it already matches the incoming copy", () => {
    expect(
      nextManifestFiles(
        [decision("a", "current", { baseline: null, workspace: A, incoming: A })],
        false,
      ),
    ).toEqual([{ path: "a", sha256: A }]);
    expect(
      nextManifestFiles(
        [decision("a", "keep-modified", { baseline: null, workspace: B, incoming: A })],
        false,
      ),
    ).toEqual([]);
  });

  it("carries the plugin marker through", () => {
    expect(
      nextManifestFiles(
        [decision("a", "update", { baseline: A, workspace: A, incoming: B }, "plugin:todos")],
        false,
      ),
    ).toEqual([{ path: "a", sha256: B, source: "plugin:todos" }]);
  });
});
