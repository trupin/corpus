import { DocsQuerySchema, type FolderNode } from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { queryDocs } from "./query.js";
import { folderTree } from "./tree.js";

const NOW = Date.parse("2026-07-26T12:00:00Z");

let ws: Workspace;

const nodeAt = (folders: readonly FolderNode[], path: string): FolderNode | undefined => {
  for (const node of folders) {
    if (node.path === path) return node;
    const found = nodeAt(node.children, path);
    if (found !== undefined) return found;
  }
  return undefined;
};

beforeEach(() => {
  ws = createWorkspace("tree");
});

afterEach(() => {
  ws.close();
});

describe("folderTree", () => {
  it("is empty for an empty corpus", () => {
    ws.reproject();
    expect(folderTree(ws.db)).toEqual({ folders: [] });
  });

  it("nests folders with direct and recursive counts", () => {
    ws.doc({ id: "doc_in1", path: "data/docs/inbox/a.md" });
    ws.doc({ id: "doc_in2", path: "data/docs/inbox/b.md" });
    ws.doc({ id: "doc_fin", path: "data/docs/finance/mortgage.md" });
    ws.doc({ id: "doc_q1", path: "data/docs/finance/2026/q1.md" });
    ws.doc({ id: "doc_q2", path: "data/docs/finance/2026/q2.md" });
    ws.doc({ id: "doc_q3", path: "data/docs/finance/2026/q3.md" });
    ws.doc({ id: "doc_tpl", path: "data/docs/templates/note.md", type: "template" });
    ws.doc({ id: "doc_root", path: "data/docs/loose.md" });
    ws.reproject();

    const { folders } = folderTree(ws.db);
    expect(folders.map((node) => node.name)).toEqual(["finance", "inbox", "templates"]);

    const finance = nodeAt(folders, "finance");
    expect(finance).toMatchObject({ path: "finance", name: "finance", count: 1, totalCount: 4 });
    expect(nodeAt(folders, "finance/2026")).toMatchObject({
      path: "finance/2026",
      name: "2026",
      count: 3,
      totalCount: 3,
      children: [],
    });
    expect(nodeAt(folders, "inbox")).toMatchObject({ count: 2, totalCount: 2 });
    // A document filed at the root of `data/docs/` belongs to no folder node.
    expect(folders.some((node) => node.path === "")).toBe(false);
  });

  it("counts a thread in its parent's folder, so the badge matches the list", () => {
    ws.doc({ id: "doc_fin", path: "data/docs/finance/mortgage.md" });
    ws.doc({ id: "doc_q1", path: "data/docs/finance/2026/q1.md" });
    ws.thread({ id: "th_one", parent: "doc_fin" });
    ws.thread({ id: "th_orphan", parent: "doc_gone" });
    ws.reproject();

    const finance = nodeAt(folderTree(ws.db).folders, "finance");
    expect(finance?.totalCount).toBe(3);

    const listed = queryDocs(
      ws.db,
      DocsQuerySchema.parse({ folder: "finance", limit: "200" }),
      NOW,
    );
    expect(listed.page.total).toBe(finance?.totalCount);
    // The orphaned thread is in neither: it cannot be placed in a folder.
    expect(listed.items.map((item) => item.id)).not.toContain("th_orphan");
  });

  it("excludes archived documents, exactly as the default list does", () => {
    ws.doc({ id: "doc_open", path: "data/docs/legal/nda.md" });
    ws.doc({ id: "doc_gone", path: "data/docs/legal/old.md", status: "archived" });
    ws.reproject();

    expect(nodeAt(folderTree(ws.db).folders, "legal")).toMatchObject({ count: 1, totalCount: 1 });
    expect(queryDocs(ws.db, DocsQuerySchema.parse({ folder: "legal" }), NOW).page.total).toBe(1);
  });

  it("reports the projected state, not the filesystem", () => {
    ws.doc({ id: "doc_one", path: "data/docs/notes/one.md" });
    ws.reproject();
    ws.write("data/docs/notes/one.md", "");
    // No re-projection: the tree still answers from the rows it has.
    expect(nodeAt(folderTree(ws.db).folders, "notes")).toMatchObject({ count: 1 });
  });
});
