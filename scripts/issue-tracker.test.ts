import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyStatus,
  compare,
  describe as describeFinding,
  ISSUE_STATUSES,
  parsePlan,
  readIssueFiles,
  type Finding,
} from "./issue-tracker.js";

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A fixture tree shaped like `issues/`: a PLAN and files under domain dirs. */
function tree(plan: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "issues-"));
  dir = root;
  writeFileSync(join(root, "PLAN.md"), plan, "utf8");
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return root;
}

const issue = (id: string, status: string): string =>
  `# [${id}] A title\n\n## Domain\n\nserver\n\n## Status\n\n${status}\n\n## Priority\n\nP1\n`;

const planOf = (...rows: [string, string][]): string =>
  ["| ID | Title | Status | Priority | Dependencies |", "| --- | --- | --- | --- | --- |"]
    .concat(rows.map(([id, status]) => `| ${id} | A title | ${status} | P1 | — |`))
    .join("\n");

const kinds = (findings: readonly Finding[]): string[] => findings.map((f) => f.kind);

describe("classifyStatus", () => {
  it.each(ISSUE_STATUSES)("accepts %s on its own", (status) => {
    expect(classifyStatus(status)).toBe(status);
  });

  it("keeps the word and lets the prose after it stand", () => {
    expect(classifyStatus("done — SIGNED 2026-08-12 and applied")).toBe("done");
    expect(classifyStatus("todo — signed by the user; apply at phase kickoff")).toBe("todo");
    expect(classifyStatus("blocked: waiting on CONTRACT-051")).toBe("blocked");
    expect(classifyStatus("closed (superseded by INFRA-025)")).toBe("closed");
  });

  it("reads through markdown emphasis around the word", () => {
    expect(classifyStatus("**done — signed and applied.**")).toBe("done");
    expect(classifyStatus("_todo_")).toBe("todo");
  });

  it("keeps the underscore that is part of `in_progress`", () => {
    // A global emphasis-strip turned this into `inprogress` and rejected the two
    // files that spell the status exactly as the template does.
    expect(classifyStatus("in_progress")).toBe("in_progress");
    expect(classifyStatus("**in_progress**")).toBe("in_progress");
    expect(classifyStatus("in progress — half landed")).toBe("in_progress");
  });

  it("refuses a status that merely contains a vocabulary word", () => {
    // The caution this check exists to encode: a first attempt at the cleanup
    // used `"signed" in status` and mis-flipped a row whose status read "needs
    // the amendment signed off first" — i.e. blocked, not done.
    expect(
      classifyStatus("needs the one-line SPEC amendment below signed off first"),
    ).toBeUndefined();
    expect(classifyStatus("nearly done")).toBeUndefined();
    expect(classifyStatus("reverted")).toBeUndefined();
    expect(classifyStatus("")).toBeUndefined();
  });

  it("reads a status whose emphasis closes around the word, leaving the gloss outside", () => {
    // `**closed** — superseded` is a spelling this repo uses. Stripping emphasis
    // only at the edges left `closed** — superseded`, which the parser then
    // refused as unclassifiable — a false positive on a well-formed status, and
    // the reason the gloss check and the classifier now share one normalisation
    // (PR #46 third review).
    expect(classifyStatus("**closed** — superseded by INFRA-025")).toBe("closed");
    expect(classifyStatus("**done** — signed and applied")).toBe("done");
    expect(classifyStatus("`todo` — waiting on the phase")).toBe("todo");
    // And the interior underscore still survives it.
    expect(classifyStatus("**in_progress** — half landed")).toBe("in_progress");
  });

  it("refuses a longer word that starts with a vocabulary word", () => {
    expect(classifyStatus("todos")).toBeUndefined();
    expect(classifyStatus("doneness")).toBeUndefined();
  });
});

describe("parsePlan", () => {
  it("reads a row per issue and skips the header and separator", () => {
    expect(parsePlan(planOf(["SERVER-001", "done"], ["UI-002", "todo"]))).toEqual([
      { id: "SERVER-001", rawStatus: "done" },
      { id: "UI-002", rawStatus: "todo" },
    ]);
  });

  it("ignores prose between phase tables", () => {
    const plan = `## Phase 1\n\nSome prose about the phase.\n\n${planOf(["CLI-003", "todo"])}`;
    expect(parsePlan(plan).map((row) => row.id)).toEqual(["CLI-003"]);
  });
});

describe("readIssueFiles", () => {
  it("takes the id from the heading, not the directory", () => {
    // The bug this whole design avoids: `AGENT-*` lives under both
    // `issues/agent/` and `issues/agent-runtime/`, and a path-derived resolver
    // reported 21 issues missing that were on disk.
    const root = tree(planOf(["AGENT-004", "todo"]), {
      "agent-runtime/004-a-slug.md": issue("AGENT-004", "todo"),
    });
    expect(readIssueFiles(root)).toEqual([
      { id: "AGENT-004", path: "agent-runtime/004-a-slug.md", rawStatus: "todo" },
    ]);
    expect(compare(parsePlan(planOf(["AGENT-004", "todo"])), readIssueFiles(root))).toEqual([]);
  });

  it("skips evals and sprints, which are verdicts and contracts rather than issues", () => {
    const root = tree(planOf(), {
      "evals/001-a-verdict.md": "# [SERVER-001] Not an issue\n\n## Status\n\ndone\n",
      "sprints/017-a-contract.md": "# [UI-002] Not an issue\n\n## Status\n\ndone\n",
    });
    expect(readIssueFiles(root)).toEqual([]);
  });
});

describe("compare", () => {
  it("passes when both halves agree", () => {
    const root = tree(planOf(["SERVER-001", "done"]), {
      "server/001-a-slug.md": issue("SERVER-001", "done — and here is why"),
    });
    expect(compare(parsePlan(planOf(["SERVER-001", "done"])), readIssueFiles(root))).toEqual([]);
  });

  it("reports a status disagreement in both directions", () => {
    const root = tree("", { "server/001-a-slug.md": issue("SERVER-001", "todo") });
    const findings = compare(parsePlan(planOf(["SERVER-001", "done"])), readIssueFiles(root));
    expect(findings).toEqual([
      {
        kind: "status-disagreement",
        id: "SERVER-001",
        plan: "done",
        file: "todo",
        path: "server/001-a-slug.md",
      },
    ]);
  });

  it("fails loudly on a status it cannot classify, from either half", () => {
    const root = tree("", { "server/001-a-slug.md": issue("SERVER-001", "done") });
    expect(
      kinds(compare(parsePlan(planOf(["SERVER-001", "reverted"])), readIssueFiles(root))),
    ).toEqual(["unclassifiable-plan-status"]);

    const odd = tree("", { "server/002-a-slug.md": issue("SERVER-002", "nearly there") });
    expect(kinds(compare(parsePlan(planOf(["SERVER-002", "done"])), readIssueFiles(odd)))).toEqual([
      "unclassifiable-file-status",
    ]);
  });

  it("reports a PLAN row with no file, and a file with no PLAN row", () => {
    const root = tree("", { "ui/009-a-slug.md": issue("UI-009", "todo") });
    const findings = compare(parsePlan(planOf(["SERVER-104", "done"])), readIssueFiles(root));
    expect(kinds(findings)).toEqual(["missing-issue-file", "missing-plan-row"]);
  });

  it("fails when two files claim one id, and says so before anything else", () => {
    // SERVER-107/108 on 2026-08-12: one id, two unrelated issues, each branch
    // internally consistent. A dependency edge naming the id resolves to
    // whichever file the reader opens first.
    const root = tree("", {
      "server/107-a-resolved-document-does-not-age.md": issue("SERVER-107", "done"),
      "server/107-the-queue-learns-lanes.md": issue("SERVER-107", "todo"),
    });
    const findings = compare(parsePlan(planOf(["SERVER-107", "done"])), readIssueFiles(root));
    expect(findings).toEqual([
      {
        kind: "duplicate-issue-file",
        id: "SERVER-107",
        paths: [
          "server/107-a-resolved-document-does-not-age.md",
          "server/107-the-queue-learns-lanes.md",
        ],
      },
    ]);
  });

  it("does not also report the duplicated id as disagreeing or unrowed", () => {
    // Every other answer about that id is ambiguous until the duplicate is
    // settled, so one finding is the honest count rather than three.
    const root = tree("", {
      "server/107-one.md": issue("SERVER-107", "done"),
      "server/107-two.md": issue("SERVER-107", "todo"),
    });
    expect(
      kinds(compare(parsePlan(planOf(["SERVER-107", "blocked"])), readIssueFiles(root))),
    ).toEqual(["duplicate-issue-file"]);
  });

  it("fails when one id has two PLAN rows", () => {
    // The same ambiguity as two files, and it matters for the same reason: the
    // readiness rule reads PLAN, so a duplicated id gives it two answers. Live
    // when this was written — SERVER-090 appeared twice with different Priority
    // *and* Dependencies (PR #46 review).
    const root = tree("", { "server/090-a-slug.md": issue("SERVER-090", "done") });
    const plan = planOf(["SERVER-090", "done"], ["SERVER-090", "done"]);
    expect(compare(parsePlan(plan), readIssueFiles(root))).toEqual([
      { kind: "duplicate-plan-row", id: "SERVER-090", count: 2 },
    ]);
  });

  it("fails a bare `closed`, which names none of the fates it can mean", () => {
    // issues/TEMPLATE.md says `closed` always carries prose saying which, and a
    // vocabulary rule with nothing behind it is the shape this check exists
    // against. Superseded, obsoleted and reverted have different consequences
    // for a reader.
    const bare = tree("", { "server/055-a-slug.md": issue("SERVER-055", "closed") });
    expect(
      kinds(compare(parsePlan(planOf(["SERVER-055", "closed"])), readIssueFiles(bare))),
    ).toEqual(["bare-closed"]);

    const glossed = tree("", {
      "server/055-a-slug.md": issue("SERVER-055", "closed — implemented and then reverted"),
    });
    expect(compare(parsePlan(planOf(["SERVER-055", "closed"])), readIssueFiles(glossed))).toEqual(
      [],
    );
  });

  it("is not fooled by emphasis around a bare `closed`", () => {
    // Stripping only the *leading* marker left `**closed**` with a gloss of
    // `**` — not empty, so it passed. Defeated by the bolding convention the
    // status parser itself exists to handle (PR #46 review).
    for (const bare of [
      "**closed**",
      "`closed`",
      "_closed_",
      // Emphasis closing around the word, with only a separator after it — the
      // shape that survived the first repair, because the trailing `*` became
      // the gloss and blocked the separator strip.
      "**closed** —",
      "**closed**:",
      "`closed` -",
    ]) {
      const root = tree("", { "server/055-a-slug.md": issue("SERVER-055", bare) });
      expect(
        kinds(compare(parsePlan(planOf(["SERVER-055", "closed"])), readIssueFiles(root))),
      ).toEqual(["bare-closed"]);
    }
    // And still accepts a real gloss wearing the same emphasis.
    const emphasised = tree("", {
      "server/055-a-slug.md": issue("SERVER-055", "**closed — superseded by INFRA-025.**"),
    });
    expect(
      compare(parsePlan(planOf(["SERVER-055", "closed"])), readIssueFiles(emphasised)),
    ).toEqual([]);
  });

  it("reports every disagreement rather than stopping at the first", () => {
    const root = tree("", {
      "server/001-a.md": issue("SERVER-001", "todo"),
      "server/002-b.md": issue("SERVER-002", "todo"),
    });
    const plan = planOf(["SERVER-001", "done"], ["SERVER-002", "done"], ["SERVER-003", "done"]);
    expect(compare(parsePlan(plan), readIssueFiles(root))).toHaveLength(3);
  });
});

describe("describe", () => {
  it("says what to do about each shape, not only what it is", () => {
    const findings: Finding[] = [
      { kind: "status-disagreement", id: "A-1", plan: "done", file: "todo", path: "a/1.md" },
      { kind: "unclassifiable-plan-status", id: "A-2", raw: "reverted" },
      { kind: "unclassifiable-file-status", id: "A-3", raw: "nearly", path: "a/3.md" },
      { kind: "missing-issue-file", id: "A-4" },
      { kind: "missing-plan-row", id: "A-5", path: "a/5.md" },
      { kind: "duplicate-issue-file", id: "A-6", paths: ["a/6a.md", "a/6b.md"] },
    ];
    for (const finding of findings) {
      const line = describeFinding(finding);
      expect(line).toContain(finding.id);
      // Every line carries an instruction, which is the difference between a
      // check somebody fixes and one somebody switches off.
      expect(line).toMatch(/—/);
    }
  });
});
