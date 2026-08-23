import { describe, expect, it } from "vitest";
import { createOutput, type Output } from "../output.js";
import type { WorkspaceCorpus } from "./corpus.js";
import { migrationLines, renderMigrations } from "./render.js";
import {
  defineMigration,
  detectMigrations,
  fromFlag,
  MIGRATIONS,
  shellQuote,
  type DetectedMigration,
} from "./registry.js";

const emptyCorpus: WorkspaceCorpus = { root: "/workspace", documents: [] };

function captured(): { out: Output; lines: string[] } {
  const lines: string[] = [];
  const out = createOutput({
    json: false,
    color: false,
    stdout: (text) => lines.push(...text.split("\n").slice(0, -1)),
    stderr: () => undefined,
  });
  return { out, lines };
}

describe("the registry", () => {
  it("holds every entry under a distinct, stable id", () => {
    // The id is what an agent branches on, so it is asserted rather than
    // assumed: a duplicate would make one entry unreportable.
    expect(new Set(MIGRATIONS.map((migration) => migration.id)).size).toBe(MIGRATIONS.length);
    expect(MIGRATIONS.map((migration) => migration.id)).toEqual(["views-to-board"]);
  });

  it("reports nothing for a workspace whose documents are all current", async () => {
    expect(
      await detectMigrations({ root: "/w", dataDir: "data", actor: "user", corpus: emptyCorpus }),
    ).toEqual([]);
  });

  it("reads the workspace off disk when no corpus is injected", async () => {
    // A directory that does not exist is an empty corpus, never a throw: an
    // upgrade must survive being run in a half-formed workspace.
    expect(
      await detectMigrations({
        root: "/nowhere-this-does-not-exist",
        dataDir: "data",
        actor: "user",
      }),
    ).toEqual([]);
  });
});

describe("defineMigration", () => {
  const hitting = defineMigration<{ ids: readonly string[] }>({
    id: "test-entry",
    detect: () => ({ ids: ["doc_a"] }),
    statement: (hit) => `${String(hit.ids.length)} document is written the old way`,
    instruct: (hit) => hit.ids.map((id) => `corpus doc edit ${id} --unset legacy`),
    optional: () => ["corpus doc edit doc_b --unset legacy"],
  });

  const missing = defineMigration<never>({
    id: "never-fires",
    detect: () => null,
    statement: () => "unreachable",
    instruct: () => ["unreachable"],
  });

  const context = { corpus: emptyCorpus, actor: "user" } as const;

  it("turns a hit into the reported shape", () => {
    expect(hitting.run(context)).toEqual({
      id: "test-entry",
      statement: "1 document is written the old way",
      commands: ["corpus doc edit doc_a --unset legacy"],
      optional: ["corpus doc edit doc_b --unset legacy"],
    });
  });

  it("defaults `optional` to none for an entry that declares none", () => {
    const noOptional = defineMigration<true>({
      id: "no-optional",
      detect: () => true,
      statement: () => "s",
      instruct: () => ["c"],
    });
    expect(noOptional.run(context)?.optional).toEqual([]);
  });

  it("prints nothing at all for an entry whose detector does not hit", () => {
    expect(missing.run(context)).toBeNull();
    const { out, lines } = captured();
    renderMigrations(
      out,
      [missing.run(context)].filter((m): m is DetectedMigration => m !== null),
    );
    expect(lines).toEqual([
      "migrations: none — every document is written the way this tool reads it.",
    ]);
    expect(lines.join("\n")).not.toContain("never-fires");
  });
});

describe("the migrations section", () => {
  const one: DetectedMigration = {
    id: "views-to-board",
    statement: "views rely on a key nothing reads.",
    commands: [
      "corpus doc create --type board --title Board",
      "corpus doc edit doc_a --unset pinned",
    ],
    optional: [],
  };

  it("says so when the section is empty", () => {
    expect(migrationLines([])).toEqual([
      "migrations: none — every document is written the way this tool reads it.",
    ]);
  });

  it("prints nothing when no workspace was inspected", () => {
    // `corpus upgrade` outside a workspace looked at no files at all, and
    // "none" there would be a claim about something nothing read.
    expect(migrationLines(null)).toEqual([]);
  });

  it("prints one block per migration, the statement then the commands", () => {
    expect(migrationLines([one])).toEqual([
      "",
      "1 data migration — these files are written for a version of the tool that no longer reads " +
        "them as they are. Run the commands below, or ask the agent to. Nothing here was performed:",
      "  views-to-board: views rely on a key nothing reads.",
      "    corpus doc create --type board --title Board",
      "    corpus doc edit doc_a --unset pinned",
    ]);
  });

  it("sets the optional commands apart under their own line", () => {
    const lines = migrationLines([{ ...one, optional: ["corpus doc edit doc_b --unset pinned"] }]);
    expect(lines).toContain(
      "    optional — these keys are dead weight, and nothing breaks if they stay:",
    );
    expect(lines.at(-1)).toBe("      corpus doc edit doc_b --unset pinned");
  });

  it("counts more than one", () => {
    expect(migrationLines([one, { ...one, id: "second" }])[1]).toContain("2 data migrations");
  });

  it("writes nothing to stdout under --json, where the key carries it", () => {
    const lines: string[] = [];
    const out = createOutput({
      json: true,
      color: false,
      stdout: (text) => lines.push(text),
      stderr: () => undefined,
    });
    renderMigrations(out, [one]);
    expect(lines).toEqual([]);
  });

  it("records every line it prints, for the upgrade's own report file", () => {
    const recorded: string[] = [];
    const { out } = captured();
    renderMigrations(out, [one], (line) => recorded.push(line));
    expect(recorded).toEqual(migrationLines([one]));
  });
});

describe("command spelling", () => {
  it("adds --from only for a non-default actor", () => {
    expect(fromFlag("user")).toBe("");
    expect(fromFlag("agent")).toBe(" --from agent");
  });

  it("quotes a title and escapes what a shell would otherwise read", () => {
    expect(shellQuote("Board")).toBe('"Board"');
    expect(shellQuote('My "Board"')).toBe('"My \\"Board\\""');
    expect(shellQuote("a$b`c\\d")).toBe('"a\\$b\\`c\\\\d"');
  });
});
