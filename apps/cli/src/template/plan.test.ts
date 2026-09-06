import { describe, expect, it } from "vitest";
import {
  decide,
  isReported,
  nextManifestFiles,
  planUpgrade,
  writes,
  UPGRADE_ACTIONS,
  type ContentShas,
  type IncomingFile,
  type UpgradeAction,
  type UpgradeDecision,
  type UpgradeInput,
} from "./plan.js";

/**
 * The decision matrix is a pure function of three hashes precisely so it can be
 * exhausted here rather than approximated against a filesystem. The cell that
 * matters is `update` — it is the only one that destroys anything — so every
 * test below is really asking "is this cell `update`, and should it be?".
 *
 * Since CLI-083 every side carries a second, *normalized* identity — the sha of
 * the bytes with ignored frontmatter keys removed — and equality lifts through
 * it. The raw-only tests keep every normalized field `null`, which is exactly a
 * legacy manifest's world, so they also pin that the lift changes nothing when
 * nothing is known.
 */

const A = "aaaa";
const B = "bbbb";
const C = "cccc";

const at = (
  baseline: string | null,
  workspace: string | null,
  incoming: string | null,
): UpgradeAction =>
  decide({
    path: "p",
    baseline,
    baselineNormalized: null,
    workspace,
    workspaceNormalized: null,
    incoming,
    incomingNormalized: null,
  });

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

describe("decide over ignored-key deltas (CLI-083, UI-189)", () => {
  // Distinct raw shas that normalize to the same document: a restamped
  // `updated:` or a board-written `width:` and nothing else.
  const N = "normalized";
  const M = "other-normalized";

  const cell = (input: Omit<UpgradeInput, "path">): UpgradeAction =>
    decide({ path: "p", ...input });

  it("reads a stamp-only delta from the incoming copy as current", () => {
    // The migration-free rule of sprint-024 P4: normalized(workspace) ===
    // normalized(incoming) never consults the baseline, so it holds on every
    // existing workspace — a resized view against an unchanged template.
    expect(
      cell({
        baseline: A,
        baselineNormalized: null,
        workspace: B,
        workspaceNormalized: N,
        incoming: C,
        incomingNormalized: N,
      }),
    ).toBe("current");
  });

  it("reads a stamp-only delta from a RECORDED baseline as untouched: update", () => {
    // Post-CLI-083 manifest: the baseline's normalized sha is on record, the
    // workspace's only delta is ignored keys, and upstream changed the file —
    // so the file is update-eligible again, which is the whole point.
    expect(
      cell({
        baseline: A,
        baselineNormalized: N,
        workspace: B,
        workspaceNormalized: N,
        incoming: C,
        incomingNormalized: M,
      }),
    ).toBe("update");
  });

  it("reads the same delta against a LEGACY baseline as keep-modified (O2)", () => {
    // The residual case, decided rather than hidden: a pre-CLI-083 manifest
    // recorded only the raw sha, the baseline's bytes are gone, and its
    // normalized form is unrecoverable. Never guess a baseline — the honest
    // verdict falls back to the raw comparison.
    expect(
      cell({
        baseline: A,
        baselineNormalized: null,
        workspace: B,
        workspaceNormalized: N,
        incoming: C,
        incomingNormalized: M,
      }),
    ).toBe("keep-modified");
  });

  it("keeps silent when only the incoming copy's ignored keys moved under an edit", () => {
    expect(
      cell({
        baseline: A,
        baselineNormalized: N,
        workspace: B,
        workspaceNormalized: M,
        incoming: C,
        incomingNormalized: N,
      }),
    ).toBe("keep-silent");
  });

  it("still reports a stamped delta that also carries a real edit", () => {
    // Three distinct normalized identities: the workspace edited the body AND
    // was restamped, and the tool changed the file too. Ignoring the stamp must
    // not swallow the edit.
    expect(
      cell({
        baseline: A,
        baselineNormalized: "base-normalized",
        workspace: B,
        workspaceNormalized: M,
        incoming: C,
        incomingNormalized: N,
      }),
    ).toBe("keep-modified");
  });

  it("adopts a baseline-less copy that differs only in ignored keys", () => {
    expect(
      cell({
        baseline: null,
        baselineNormalized: null,
        workspace: B,
        workspaceNormalized: N,
        incoming: C,
        incomingNormalized: N,
      }),
    ).toBe("current");
  });
});

describe("planUpgrade", () => {
  const both = (sha: string): ContentShas => ({ sha256: sha, normalizedSha256: sha });
  const incoming: readonly IncomingFile[] = [
    { path: ".claude/skills/comment/SKILL.md", from: "/t/comment", ...both(B) },
    { path: ".claude/skills/notes/SKILL.md", from: "/t/notes", ...both(B) },
    { path: "README.md", from: "/t/readme", ...both(A) },
  ];

  it("decides one path at a time, sorted", () => {
    const workspace = new Map([
      [".claude/skills/comment/SKILL.md", both(A)],
      [".claude/skills/notes/SKILL.md", both(A)],
      ["README.md", both(A)],
      ["data/docs/views/old.md", both(C)],
    ]);
    const plan = planUpgrade(
      [
        { path: ".claude/skills/comment/SKILL.md", sha256: A },
        { path: ".claude/skills/notes/SKILL.md", sha256: A },
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

  it("carries a recorded normalized baseline into the decision, and only a string one", () => {
    const plan = planUpgrade(
      [
        { path: "README.md", sha256: A, normalizedSha256: C },
        // A hand-damaged optional field degrades to "not recorded" rather than
        // comparing a string against whatever it holds.
        { path: ".claude/skills/comment/SKILL.md", sha256: A, normalizedSha256: 7 as never },
      ],
      incoming,
      () => null,
    );
    const byPath = new Map(plan.map((decision) => [decision.path, decision]));
    expect(byPath.get("README.md")?.baselineNormalized).toBe(C);
    expect(byPath.get(".claude/skills/comment/SKILL.md")?.baselineNormalized).toBeNull();
  });

  it("carries the keep-mark from the manifest entry, and only a literal true", () => {
    const plan = planUpgrade(
      [
        { path: "README.md", sha256: A, kept: true },
        { path: ".claude/skills/comment/SKILL.md", sha256: A, kept: "yes" as never },
      ],
      incoming,
      () => null,
    );
    const byPath = new Map(plan.map((decision) => [decision.path, decision]));
    expect(byPath.get("README.md")?.kept).toBe(true);
    expect(byPath.get(".claude/skills/comment/SKILL.md")?.kept).toBe(false);
    expect(byPath.get(".claude/skills/notes/SKILL.md")?.kept).toBe(false);
  });
});

describe("nextManifestFiles", () => {
  const decision = (
    path: string,
    action: UpgradeAction,
    shas: { baseline: string | null; workspace: string | null; incoming: string | null },
    normalized?: Partial<Pick<UpgradeInput, "baselineNormalized">>,
  ): UpgradeDecision => ({
    path,
    action,
    ...shas,
    // Legacy by default — the raw-only world — with the workspace's and the
    // incoming copy's normalized identities equal to their raw ones, which is
    // what a file with no ignored keys hashes to.
    baselineNormalized: normalized?.baselineNormalized ?? null,
    workspaceNormalized: shas.workspace,
    incomingNormalized: shas.incoming,
    kept: false,
  });

  /** What the run put on disk: the second argument is a fact, not a plan. */
  const NOTHING: ReadonlyMap<string, ContentShas> = new Map();
  const wrote = (sha: string, normalized: string = sha): ReadonlyMap<string, ContentShas> =>
    new Map([["a", { sha256: sha, normalizedSha256: normalized }]]);

  it("records what a write actually put on disk, with both hashes", () => {
    expect(
      nextManifestFiles(
        [decision("a", "update", { baseline: A, workspace: A, incoming: B })],
        wrote(B),
      ),
    ).toEqual([{ path: "a", sha256: B, normalizedSha256: B }]);
  });

  it("records the merged bytes for an update that preserved ignored keys", () => {
    // The written file is the template's content plus the workspace's stamps,
    // so its raw sha is neither side's — and the manifest records what is on
    // disk, never what the template alone would have been (sprint-024 P5).
    expect(
      nextManifestFiles(
        [decision("a", "update", { baseline: A, workspace: A, incoming: B })],
        wrote(C, B),
      ),
    ).toEqual([{ path: "a", sha256: C, normalizedSha256: B }]);
  });

  it("records the OLD baseline for a writing verdict the run did not carry out", () => {
    // `--adopt` on a workspace with no manifest plans an install and then applies
    // nothing (CLI-014). Recording the incoming sha would claim a file that is
    // not on disk, and the next run would read that absence as a user deletion.
    expect(
      nextManifestFiles(
        [decision("a", "install", { baseline: null, workspace: null, incoming: B })],
        NOTHING,
      ),
    ).toEqual([]);
    // Same install, actually performed.
    expect(
      nextManifestFiles(
        [decision("a", "install", { baseline: null, workspace: null, incoming: B })],
        wrote(B),
      ),
    ).toEqual([{ path: "a", sha256: B, normalizedSha256: B }]);
  });

  it("records per path, so a mixed run is half adopted and half installed", () => {
    expect(
      nextManifestFiles(
        [
          decision("a", "install", { baseline: null, workspace: null, incoming: B }),
          decision("b", "current", { baseline: null, workspace: A, incoming: A }),
          decision("c", "install", { baseline: null, workspace: null, incoming: C }),
        ],
        new Map([["c", { sha256: C, normalizedSha256: C }]]),
      ),
    ).toEqual([
      { path: "b", sha256: A, normalizedSha256: A },
      { path: "c", sha256: C, normalizedSha256: C },
    ]);
  });

  it("keeps a modified file's ORIGINAL baseline, so it stays modified next time", () => {
    // Adopting the current bytes as the baseline would make the file read as
    // untouched on the next run, and the run after that would overwrite the
    // very edit this verb refused to touch.
    expect(
      nextManifestFiles(
        [decision("a", "keep-modified", { baseline: A, workspace: B, incoming: C })],
        NOTHING,
      ),
    ).toEqual([{ path: "a", sha256: A }]);
  });

  it("carries a recorded normalized baseline forward, and never invents one", () => {
    expect(
      nextManifestFiles(
        [
          decision(
            "a",
            "keep-modified",
            { baseline: A, workspace: B, incoming: C },
            { baselineNormalized: B },
          ),
        ],
        NOTHING,
      ),
    ).toEqual([{ path: "a", sha256: A, normalizedSha256: B }]);
    // A legacy entry stays raw-only: the installed bytes are gone, so the
    // normalized baseline is unrecoverable — never guessed (sprint-024 P4).
    const legacy = nextManifestFiles(
      [decision("a", "keep-modified", { baseline: A, workspace: B, incoming: C })],
      NOTHING,
    );
    expect(legacy[0]).not.toHaveProperty("normalizedSha256");
  });

  it("advances a kept entry to the incoming copy's shas, mark and all (CLI-081)", () => {
    // Keeping is not merging: the file is never written, but the recorded
    // baseline follows the template — so a later un-keep compares against the
    // current template. The incoming shas are the tool's own bytes, so the
    // modified copy still reads modified.
    expect(
      nextManifestFiles(
        [
          {
            ...decision("a", "keep-modified", { baseline: A, workspace: B, incoming: C }),
            kept: true,
          },
        ],
        NOTHING,
      ),
    ).toEqual([{ path: "a", sha256: C, normalizedSha256: C, kept: true }]);
    // A kept file the workspace deleted advances the same way — the workspace
    // owns its absence, and the entry survives for a later un-keep.
    expect(
      nextManifestFiles(
        [
          {
            ...decision("a", "restore-candidate", { baseline: A, workspace: null, incoming: C }),
            kept: true,
          },
        ],
        NOTHING,
      ),
    ).toEqual([{ path: "a", sha256: C, normalizedSha256: C, kept: true }]);
    // Retirement still drops the entry, mark included: the tool no longer
    // ships the file, so there is nothing left to keep quiet about.
    expect(
      nextManifestFiles(
        [
          {
            ...decision("a", "retired", { baseline: A, workspace: B, incoming: null }),
            kept: true,
          },
        ],
        NOTHING,
      ),
    ).toEqual([]);
  });

  it("keeps a deleted file's baseline so a later --restore still knows it", () => {
    expect(
      nextManifestFiles(
        [decision("a", "restore-candidate", { baseline: A, workspace: null, incoming: A })],
        NOTHING,
      ),
    ).toEqual([{ path: "a", sha256: A }]);
    expect(
      nextManifestFiles(
        [decision("a", "restore-candidate", { baseline: A, workspace: null, incoming: B })],
        wrote(B),
      ),
    ).toEqual([{ path: "a", sha256: B, normalizedSha256: B }]);
  });

  it("drops a retired entry, whose file stays on disk", () => {
    expect(
      nextManifestFiles(
        [decision("a", "retired", { baseline: A, workspace: A, incoming: null })],
        NOTHING,
      ),
    ).toEqual([]);
  });

  it("adopts a baseline-less file only when it already matches the incoming copy", () => {
    expect(
      nextManifestFiles(
        [decision("a", "current", { baseline: null, workspace: A, incoming: A })],
        NOTHING,
      ),
    ).toEqual([{ path: "a", sha256: A, normalizedSha256: A }]);
    expect(
      nextManifestFiles(
        [decision("a", "keep-modified", { baseline: null, workspace: B, incoming: A })],
        NOTHING,
      ),
    ).toEqual([]);
  });

  it("adopts a baseline-less copy whose only delta is ignored keys, as its own bytes", () => {
    // The workspace's copy is the incoming document plus a stamp. What is
    // recorded is the copy on disk — both hashes — so the next run still reads
    // it as current rather than as a deletion of bytes nobody has.
    const stampOnly: UpgradeDecision = {
      path: "a",
      action: "current",
      baseline: null,
      baselineNormalized: null,
      workspace: B,
      workspaceNormalized: A,
      incoming: C,
      incomingNormalized: A,
      kept: false,
    };
    expect(nextManifestFiles([stampOnly], NOTHING)).toEqual([
      { path: "a", sha256: B, normalizedSha256: A },
    ]);
  });
});
