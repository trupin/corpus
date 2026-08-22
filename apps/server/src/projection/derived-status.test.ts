// SPEC.md §12 (rider signed 2026-08-12) at the projection: a doc type that
// derives its own status is projected under the derived value, and every type
// that does not keeps the one its file states (SERVER-085).
//
// The derivation used here is a stand-in, not the todos plugin's: `apps/server`
// may not import `plugins/*` (CLAUDE.md's dependency direction), and what is
// under test is the plumbing — which document a derivation is asked about, what
// it is handed, and what is done with its answer. The plugin's own rule is
// tested where it lives (`plugins/todos/items.test.ts`).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDerivedStatusRegistry, type DeriveStatusInput } from "../plugins/derived-status.js";
import { openProjection, type ProjectionDb } from "./db.js";
import { projectDocument } from "./project-document.js";

/** The rider's rule, as a stand-in: items and no open items resolves, else open. */
const asked: DeriveStatusInput[] = [];
function todoStatus(input: DeriveStatusInput): "open" | "resolved" | null {
  asked.push(input);
  if (input.status === "archived") return null;
  if (input.extra?.["items"] === "unreadable") return null;
  const items = input.body.match(/^- \[[ x]\]/gm) ?? [];
  return items.length > 0 && items.every((item) => item === "- [x]") ? "resolved" : "open";
}

const registry = createDerivedStatusRegistry([
  { dir: "todos", types: [{ type: "todo", derivedStatus: true }], deriveStatus: todoStatus },
]);

let root: string;
let ws: string;
let db: ProjectionDb;

beforeEach(() => {
  asked.length = 0;
  root = mkdtempSync(join(tmpdir(), "corpus-s040-derived-"));
  ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  db = openProjection(
    { workspaceRoot: ws, corpusDir: join(ws, ".corpus") },
    { derivedStatus: registry },
  );
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function project(relative: string, content: string): void {
  const abs = join(ws, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  const outcome = projectDocument(db, abs);
  expect(outcome.kind, JSON.stringify(outcome)).toBe("projected");
}

const doc = (options: {
  id: string;
  type?: string;
  status?: string;
  body?: string;
  extra?: string;
}): string =>
  [
    "---",
    `id: ${options.id}`,
    `type: ${options.type ?? "todo"}`,
    "title: Errands",
    `status: ${options.status ?? "open"}`,
    ...(options.extra === undefined ? [] : [options.extra]),
    "---",
    "",
    options.body ?? "",
  ].join("\n");

const statusOf = (id: string): unknown =>
  (
    db.prepare("SELECT status FROM documents WHERE id = ?").get(id) as
      { status: string } | undefined
  )?.status;

describe("the projection derives a status its type answers for (SPEC.md §12)", () => {
  it("resolves a list whose every item is checked, whatever the file says", () => {
    project("data/docs/a.md", doc({ id: "doc_aa11", body: "- [x] one\n- [x] two\n" }));
    expect(statusOf("doc_aa11")).toBe("resolved");
  });

  it("opens a list with an open item, whatever the file says", () => {
    project(
      "data/docs/b.md",
      doc({ id: "doc_bb22", status: "resolved", body: "- [x] one\n- [ ] two\n" }),
    );
    expect(statusOf("doc_bb22")).toBe("open");
  });

  it("opens an empty list, which has completed nothing", () => {
    project("data/docs/c.md", doc({ id: "doc_cc33", status: "resolved", body: "Nothing yet.\n" }));
    expect(statusOf("doc_cc33")).toBe("open");
  });

  it("leaves an archived list archived however its items read", () => {
    project(
      "data/docs/d.md",
      doc({ id: "doc_dd44", status: "archived", body: "- [x] one\n- [x] two\n" }),
    );
    expect(statusOf("doc_dd44")).toBe("archived");
    // The stored value is what the derivation was handed, so §12's carve-out is
    // the plugin's own answer rather than a rule restated here.
    expect(asked.at(-1)?.status).toBe("archived");
  });

  it("falls back to the stored value when the items cannot be read", () => {
    project(
      "data/docs/e.md",
      doc({ id: "doc_ee55", status: "resolved", body: "- [ ] one\n", extra: "items: unreadable" }),
    );
    expect(statusOf("doc_ee55")).toBe("resolved");
  });

  it("hands the derivation the type, the stored status, the body and `extra`", () => {
    project("data/docs/f.md", doc({ id: "doc_ff66", body: "- [ ] one\n", extra: "colour: blue" }));
    expect(asked.at(-1)).toEqual({
      type: "todo",
      status: "open",
      body: "\n- [ ] one\n",
      extra: { colour: "blue" },
    });
  });

  it("asks nothing about a type no plugin declares", () => {
    project("data/docs/g.md", doc({ id: "doc_gg77", type: "note", body: "- [x] one\n" }));
    expect(statusOf("doc_gg77")).toBe("open");
    expect(asked).toEqual([]);
  });

  it("keeps the stored status when no plugin is present at all (§15 M6)", () => {
    const bare = openProjection({ workspaceRoot: ws, corpusDir: join(ws, ".corpus", "bare") });
    try {
      const abs = join(ws, "data", "docs", "h.md");
      writeFileSync(abs, doc({ id: "doc_hh88", body: "- [x] one\n" }), "utf8");
      projectDocument(bare, abs);
      expect(
        (
          bare.prepare("SELECT status FROM documents WHERE id = ?").get("doc_hh88") as {
            status: string;
          }
        ).status,
      ).toBe("open");
    } finally {
      bare.close();
    }
  });

  it("keeps the root's own status for a document whose location decides it (§7)", () => {
    // An archived skill is archived because of where it sits. Nothing about a
    // document's content may overrule that, so the ladder never asks.
    project(
      ".claude/skills-archived/tidy/SKILL.md",
      ["---", "name: tidy", "type: todo", "status: open", "---", "", "- [ ] one\n"].join("\n"),
    );
    const row = db.prepare("SELECT status FROM documents WHERE path LIKE '%tidy%'").get() as
      { status: string } | undefined;
    expect(row?.status).toBe("archived");
    expect(asked).toEqual([]);
  });
});
