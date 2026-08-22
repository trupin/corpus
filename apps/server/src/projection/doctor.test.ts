import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectionError, cacheDbPath, openProjection, type ProjectionConfig } from "./db.js";
import { DRIFT_KINDS, doctor, inspectProjection } from "./doctor.js";
import { projectDocument, removeDocument } from "./project-document.js";
import { rebuild } from "./rebuild.js";
import { UNREADABLE_REASON, writeUnreadableDocument } from "./unreadable-fixture.js";

let root: string;
let config: ProjectionConfig;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-doctor-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  config = { workspaceRoot: ws, corpusDir: join(ws, ".corpus") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
  const abs = join(config.workspaceRoot, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

const doc = (id: string, body = "Body.\n"): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${id}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\n${body}`;

const event = (id: string): string =>
  JSON.stringify({
    id,
    type: "comment.created",
    created: "2026-07-06T09:00:00Z",
    source: "cli",
    payload: {},
  });

function cleanWorkspace(): void {
  write("data/docs/a.md", doc("doc_aaa"));
  write("data/docs/nested/b.md", doc("doc_bbb"));
  write(
    ".claude/skills/orchestrate/SKILL.md",
    `---\nname: orchestrate\ndescription: Loop.\n---\n\nS.\n`,
  );
  for (const status of ["pending", "processed"]) {
    mkdirSync(join(config.corpusDir, "queue", status), { recursive: true });
    writeFileSync(join(config.corpusDir, "queue", status, ".gitkeep"), "", "utf8");
  }
  writeFileSync(
    join(config.corpusDir, "queue", "pending", "evt_aaa111222333.json"),
    event("evt_aaa111222333"),
    "utf8",
  );
  rebuild(config);
}

const kindsOf = (report: ReturnType<typeof doctor>): string[] =>
  report.drift.map((entry) => entry.kind);

describe("doctor", () => {
  it("reports ok on a workspace rebuilt from its current files", () => {
    cleanWorkspace();
    const report = doctor(config);
    expect(report).toMatchObject({ ok: true, drift: [] });
    expect(report.stats).toMatchObject({ files: 3, documents: 3, hashed: 0, parsed: 0 });
  });

  it("does not count the queue skeleton's .gitkeep as an event", () => {
    cleanWorkspace();
    // Three status directories each holding only a `.gitkeep` — the shape every
    // `init`-produced workspace has, and the one that used to report drift.
    for (const status of ["in-progress", "failed", "abandoned"]) {
      mkdirSync(join(config.corpusDir, "queue", status), { recursive: true });
      writeFileSync(join(config.corpusDir, "queue", status, ".gitkeep"), "", "utf8");
    }
    expect(doctor(config).ok).toBe(true);
  });

  it("does not modify the database it inspects", () => {
    cleanWorkspace();
    const before = statSync(cacheDbPath(config));
    doctor(config);
    const after = statSync(cacheDbPath(config));
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("detects a file changed on disk, and clears once it is re-projected", () => {
    cleanWorkspace();
    const abs = join(config.workspaceRoot, "data/docs/a.md");
    appendFileSync(abs, "an out-of-band edit\n", "utf8");

    const report = doctor(config);
    expect(report.ok).toBe(false);
    expect(kindsOf(report)).toEqual(["content_mismatch"]);
    expect(report.drift[0]?.path).toBe("data/docs/a.md");
    expect(report.stats.hashed).toBe(1);

    const db = openProjection(config, { populate: false });
    projectDocument(db, abs);
    db.close();
    expect(doctor(config).ok).toBe(true);
  });

  it("detects a file that was never projected, and clears once it is", () => {
    cleanWorkspace();
    const abs = write("data/docs/new.md", doc("doc_new"));

    const report = doctor(config);
    expect(kindsOf(report)).toEqual(["missing_row"]);
    expect(report.drift[0]?.path).toBe("data/docs/new.md");
    expect(report.stats.parsed).toBe(1);

    const db = openProjection(config, { populate: false });
    projectDocument(db, abs);
    db.close();
    expect(doctor(config).ok).toBe(true);
  });

  it("detects a projected file that is gone, and clears once it is removed", () => {
    cleanWorkspace();
    const abs = join(config.workspaceRoot, "data/docs/a.md");
    rmSync(abs);

    const report = doctor(config);
    expect(kindsOf(report)).toEqual(["orphan_row"]);
    expect(report.drift[0]?.path).toBe("data/docs/a.md");

    const db = openProjection(config, { populate: false });
    removeDocument(db, abs);
    db.close();
    expect(doctor(config).ok).toBe(true);
  });

  it("detects an unparseable document, and a root file with no usable id", () => {
    cleanWorkspace();
    write("data/docs/broken.md", `---\nid: doc_x\ntitle: [unclosed\n---\n\nBody.\n`);
    write("data/docs/noid.md", `---\ntype: note\ntitle: No id\n---\n\nBody.\n`);

    const report = doctor(config);
    expect(kindsOf(report)).toEqual(["unparseable", "unparseable"]);
    expect(report.drift.map((entry) => entry.path).sort()).toEqual([
      "data/docs/broken.md",
      "data/docs/noid.md",
    ]);
  });

  // SERVER-064. Boot now survives a document it cannot read, which makes this
  // check the recovery loop: the file is on disk, the projection does not
  // describe it, and `db doctor` is the only thing that can say so. Reporting
  // `ok` here would be the worst available outcome — a workspace quietly short
  // of a document, and the check whose whole job is to notice agreeing that
  // nothing is wrong.
  it("detects a document it cannot read, which is why it produced no row", () => {
    cleanWorkspace();
    const abs = join(config.workspaceRoot, "data/docs/m.md");
    writeUnreadableDocument(abs);
    // The boot the file survived: its own populate skipped this file.
    rebuild(config);

    const report = doctor(config);
    expect(report.ok).toBe(false);
    expect(kindsOf(report)).toEqual(["unparseable"]);
    expect(report.drift[0]?.path).toBe("data/docs/m.md");
    expect(report.drift[0]?.detail).toMatch(UNREADABLE_REASON);

    // `unparseable`, not `missing_row`, on purpose: the kind is what the boot
    // catch-up keys on, and no number of repopulates will make this file
    // readable — see `watcher/catch-up.test.ts` for the other half of that.
    //
    // Clears the moment the file does, with no rebuild in between: this is a
    // state of the workspace, and the workspace is where it is fixed.
    rmSync(abs);
    expect(doctor(config).ok).toBe(true);
  });

  it("detects a second file claiming an id that is already projected", () => {
    cleanWorkspace();
    write("data/docs/copy.md", doc("doc_aaa"));

    const report = doctor(config);
    expect(kindsOf(report)).toEqual(["duplicate_id"]);
    expect(report.drift[0]?.path).toBe("data/docs/copy.md");
    expect(report.drift[0]?.detail).toMatch(/claims id doc_aaa, already projected from/);
  });

  it("detects a queue event the mirror has not seen", () => {
    cleanWorkspace();
    writeFileSync(
      join(config.corpusDir, "queue", "pending", "evt_bbb444555666.json"),
      event("evt_bbb444555666"),
      "utf8",
    );

    const report = doctor(config);
    expect(kindsOf(report)).toEqual(["count_mismatch"]);
    expect(report.drift[0]?.detail).toMatch(/2 evt_\*\.json file\(s\).*1 event row/);
  });

  it("skips hashing when size and mtime are unchanged, and hashes when mtime moves", () => {
    cleanWorkspace();
    expect(doctor(config).stats.hashed).toBe(0);
    expect(doctor(config).stats.hashed).toBe(0);

    const abs = join(config.workspaceRoot, "data/docs/a.md");
    const later = new Date(Date.now() + 60_000);
    utimesSync(abs, later, later);

    const report = doctor(config);
    // The bytes did not change, so hashing settles it: hashed, then clean.
    expect(report.stats.hashed).toBe(1);
    expect(report.ok).toBe(true);
  });

  it("reports a row whose file lost its recorded hash", () => {
    cleanWorkspace();
    const db = openProjection(config, { populate: false });
    db.prepare("DELETE FROM file_hashes WHERE path = 'data/docs/a.md'").run();
    db.close();

    const report = doctor(config);
    expect(kindsOf(report)).toEqual(["content_mismatch"]);
    expect(report.drift[0]?.detail).toMatch(/no recorded content hash/);
  });

  it("says what to run when there is no projection at all", () => {
    mkdirSync(config.corpusDir, { recursive: true });
    expect(() => doctor(config)).toThrow(ProjectionError);
  });

  it("reports a file it can never index as a warning, and the verdict stays clean", () => {
    cleanWorkspace();
    write("data/docs/.claude/skills/invisible-doc.md", doc("doc_invisible001"));

    const report = doctor(config);

    // Warnings are not drift: `ok` is the exit code `corpus db doctor` returns,
    // and §11's `rebuild && doctor` clean invariant may not break on a workspace
    // whose projection is right (sprint-018 TEST-609).
    expect(report.ok).toBe(true);
    expect(report.drift).toEqual([]);
    expect(report.warnings?.map((warning) => warning.path)).toEqual([
      "data/docs/.claude/skills/invisible-doc.md",
    ]);
    expect(report.warnings?.[0]?.kind).toBe("unindexable_file");

    rebuild(config);
    const after = doctor(config);
    expect(after.ok).toBe(true);
    expect(after.warnings).toHaveLength(1);
  });

  it("runs the recovery pass on a healthy workspace and finds nothing", () => {
    cleanWorkspace();

    expect(doctor(config).warnings).toEqual([]);
  });

  it("leaves the boot catch-up's narrower question exactly as it was", () => {
    cleanWorkspace();
    write("data/docs/node_modules/ignored-dir-doc.md", doc("doc_invisible002"));

    const db = openProjection(config, { populate: false });
    const report = inspectProjection(db);
    db.close();

    // `watcher/catch-up.ts` asks only whether files and rows agree, on the boot
    // path; it must not pay for a second walk it does not read.
    expect(report.warnings).toBeUndefined();
    expect(report.ok).toBe(true);
  });

  it("declares every drift kind it can produce", () => {
    expect([...DRIFT_KINDS].sort()).toEqual([
      "content_mismatch",
      "count_mismatch",
      "duplicate_id",
      "missing_row",
      "orphan_row",
      "unparseable",
    ]);
  });
});
