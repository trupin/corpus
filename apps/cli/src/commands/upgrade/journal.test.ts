import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UPGRADE_LOG_RELATIVE_PATH, upgradeLogPath } from "../../paths.js";
import { openJournal, REPORT_MARKER, silentJournal } from "./journal.js";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-cli025-journal-"));
  scratch.push(root);
  return root;
}

describe("the upgrade journal", () => {
  it("creates .corpus/ if it has to, and names itself workspace-relative", () => {
    const root = workspace();
    const journal = openJournal({
      root,
      startedAt: new Date("2026-08-05T10:00:00.000Z"),
      from: "0.3.0",
      to: "0.4.0",
    });

    expect(journal.relativePath).toBe(UPGRADE_LOG_RELATIVE_PATH);
    expect(journal.path).toBe(upgradeLogPath(root));
    const header = readFileSync(upgradeLogPath(root), "utf8");
    expect(header).toContain("corpus upgrade 0.3.0 → 0.4.0");
    expect(header).toContain("2026-08-05T10:00:00.000Z");
  });

  it("appends as it goes, so a killed run still leaves what it got through", () => {
    const root = workspace();
    const journal = openJournal({ root, startedAt: new Date(), from: "0.3.0", to: "0.4.0" });
    journal.note("verified corpus-0.4.0.tgz");
    expect(readFileSync(upgradeLogPath(root), "utf8")).toContain("verified corpus-0.4.0.tgz");
  });

  it("ends in one machine-readable line, so the conflicts are legible without parsing prose", () => {
    const root = workspace();
    const journal = openJournal({ root, startedAt: new Date(), from: "0.3.0", to: "0.4.0" });
    journal.note("something happened");
    journal.finish({ conflicts: [{ path: ".claude/skills/comment/SKILL.md" }] });

    const lines = readFileSync(upgradeLogPath(root), "utf8").trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "";
    expect(last.startsWith(`${REPORT_MARKER} `)).toBe(true);
    expect(JSON.parse(last.slice(REPORT_MARKER.length + 1))).toEqual({
      conflicts: [{ path: ".claude/skills/comment/SKILL.md" }],
    });
  });

  it("truncates, because the question is what the last upgrade did", () => {
    const root = workspace();
    openJournal({ root, startedAt: new Date(), from: "0.1.0", to: "0.2.0" }).note("old run");
    openJournal({ root, startedAt: new Date(), from: "0.2.0", to: "0.3.0" });
    const text = readFileSync(upgradeLogPath(root), "utf8");
    expect(text).not.toContain("old run");
    expect(text).toContain("0.2.0 → 0.3.0");
  });

  it("writes nothing at all when there is nowhere to write", () => {
    expect(silentJournal.path).toBeNull();
    expect(silentJournal.relativePath).toBeNull();
    silentJournal.note("ignored");
    silentJournal.finish({ ignored: true });
  });
});
