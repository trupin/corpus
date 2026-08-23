import type { DocRow, FolderNode } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  boundLabel,
  buildTreeRows,
  type FolderDocs,
  type TreeInput,
  type TreeRow,
} from "./treeRows";

/**
 * The tree's shape, its ordering, its marks and its bound line — every rule
 * SPEC.md §10's rider 1 states about what the explorer shows, tested without a
 * DOM or a server, because that is what the module is pure for.
 */

function folder(
  path: string,
  options: {
    readonly count?: number;
    readonly total?: number;
    readonly children?: readonly FolderNode[];
  } = {},
): FolderNode {
  const children = options.children ?? [];
  const count = options.count ?? 0;
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    count,
    totalCount: options.total ?? count,
    children,
  };
}

function doc(id: string, title: string, extra: Partial<DocRow> = {}): DocRow {
  return {
    id,
    type: "note",
    title,
    status: "open",
    stale: null,
    ...extra,
  } as DocRow;
}

function answered(items: readonly DocRow[], total = items.length): FolderDocs {
  return { items, total, isPending: false, error: null };
}

function build(overrides: Partial<TreeInput> & Pick<TreeInput, "folders">): readonly TreeRow[] {
  return buildTreeRows({
    docsByFolder: new Map(),
    isExpanded: () => true,
    openDocs: new Set(),
    originDoc: null,
    currentBoardId: null,
    ...overrides,
  });
}

const shape = (rows: readonly TreeRow[]): readonly string[] => rows.map((row) => row.key);

describe("shape and order", () => {
  it("walks folders before documents at every level", () => {
    const rows = build({
      folders: [
        folder("finance", { count: 1, total: 2, children: [folder("finance/tax", { count: 1 })] }),
      ],
      docsByFolder: new Map([
        ["finance", answered([doc("doc_a", "Alpha")])],
        ["finance/tax", answered([doc("doc_t", "Return")])],
      ]),
    });
    expect(shape(rows)).toEqual(["f:finance", "f:finance/tax", "d:doc_t", "d:doc_a"]);
  });

  it("sorts folders by name and documents by title", () => {
    const rows = build({
      folders: [folder("zeta"), folder("alpha", { count: 2 })],
      docsByFolder: new Map([
        ["alpha", answered([doc("doc_b", "Beta"), doc("doc_a", "Alpha")])],
        ["zeta", answered([])],
      ]),
    });
    expect(shape(rows)).toEqual(["f:alpha", "d:doc_a", "d:doc_b", "f:zeta"]);
  });

  it("draws a collapsed folder's row and nothing under it", () => {
    const rows = build({
      folders: [folder("finance", { count: 1, children: [folder("finance/tax")] })],
      docsByFolder: new Map([["finance", answered([doc("doc_a", "Alpha")])]]),
      isExpanded: (path) => path !== "finance",
    });
    expect(shape(rows)).toEqual(["f:finance"]);
    expect(rows[0]).toMatchObject({ kind: "folder", collapsed: true });
  });

  it("carries depth, so one flat list can be indented as a tree", () => {
    const rows = build({
      folders: [folder("a", { children: [folder("a/b", { children: [folder("a/b/c")] })] })],
    });
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });
});

describe("waiting, failing, and empty", () => {
  it("says a folder is loading while its documents are outstanding", () => {
    const rows = build({
      folders: [folder("inbox", { count: 3 })],
      docsByFolder: new Map([["inbox", { items: [], total: 0, isPending: true, error: null }]]),
    });
    expect(rows[1]).toMatchObject({ kind: "pending", folder: "inbox", error: null });
  });

  it("draws no waiting line for a folder that holds no documents of its own", () => {
    // The caret is open, the sub-folder is drawn, and there is simply no file
    // row — a folder that holds nothing is not waiting for anything.
    const rows = build({ folders: [folder("views", { count: 0, children: [folder("views/x")] })] });
    expect(shape(rows)).toEqual(["f:views", "f:views/x"]);
  });

  it("says a read failed, whatever the folder holds", () => {
    const rows = build({
      folders: [folder("inbox", { count: 0 })],
      docsByFolder: new Map([
        ["inbox", { items: [], total: 0, isPending: false, error: "the server refused it" }],
      ]),
    });
    // A failure is not the same fact as an empty folder, so it is said even
    // where an empty folder would say nothing.
    expect(rows[1]).toMatchObject({ kind: "pending", error: "the server refused it" });
  });
});

describe("the bound", () => {
  it("says so when the listing stopped short of the total (§10)", () => {
    const rows = build({
      folders: [folder("inbox", { count: 900 })],
      docsByFolder: new Map([["inbox", answered([doc("doc_a", "Alpha")], 900)]]),
    });
    expect(rows.at(-1)).toMatchObject({ kind: "bound", shown: 1, total: 900 });
    expect(boundLabel(1, 900)).toBe("1 of 900 — the listing reached its bound");
  });

  it("stays quiet when the listing is complete", () => {
    const rows = build({
      folders: [folder("inbox", { count: 1 })],
      docsByFolder: new Map([["inbox", answered([doc("doc_a", "Alpha")])]]),
    });
    expect(rows.some((row) => row.kind === "bound")).toBe(false);
  });

  it("cannot fire before an answer arrives", () => {
    // `0 < 0` is false: a pending folder has no length to compare against a
    // total, and a bound line drawn there would be a claim about nothing.
    const rows = build({
      folders: [folder("inbox", { count: 3 })],
      docsByFolder: new Map([["inbox", { items: [], total: 0, isPending: true, error: null }]]),
    });
    expect(rows.some((row) => row.kind === "bound")).toBe(false);
  });
});

describe("the marks (rider 1)", () => {
  const withDocs = (input: Partial<TreeInput>): TreeRow =>
    build({
      folders: [folder("inbox", { count: 1 })],
      docsByFolder: new Map([
        ["inbox", answered([doc("doc_a", "Alpha", { status: "archived" as DocRow["status"] })])],
      ]),
      ...input,
    })[1] as TreeRow;

  it("marks an archived document and keeps it in the tree — the one list that does", () => {
    expect(withDocs({})).toMatchObject({ kind: "doc", archived: true, status: "archived" });
  });

  it("marks the explorer path's origin row", () => {
    expect(withDocs({ originDoc: "doc_a" })).toMatchObject({ isOrigin: true, isOpen: false });
  });

  it("marks a document open on the showing board", () => {
    expect(withDocs({ openDocs: new Set(["doc_a"]) })).toMatchObject({
      isOrigin: false,
      isOpen: true,
    });
  });

  it("gives the origin row one mark, not two", () => {
    // The origin is the stronger statement and draws its own affordance; a dot
    // beside it would put two marks in one slot and move the row's contents.
    expect(withDocs({ originDoc: "doc_a", openDocs: new Set(["doc_a"]) })).toMatchObject({
      isOrigin: true,
      isOpen: false,
    });
  });

  it("marks the board document of the board being shown", () => {
    const rows = build({
      folders: [folder("boards", { count: 1 })],
      docsByFolder: new Map([["boards", answered([doc("doc_board", "Files", { type: "board" })])]]),
      currentBoardId: "doc_board",
    });
    expect(rows[1]).toMatchObject({ kind: "doc", type: "board", isCurrentBoard: true });
  });
});
