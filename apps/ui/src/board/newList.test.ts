import type { FolderTree } from "@corpus/contract";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clampMenuPosition,
  columnRequest,
  folderChoices,
  MENU_HEIGHT,
  MENU_WIDTH,
  PRESET_CHOICES,
  searchChoice,
  VIEW_DOCUMENT_FOLDER,
} from "./newList";

const TREE: FolderTree = {
  folders: [
    {
      path: "finance",
      name: "finance",
      count: 2,
      totalCount: 3,
      children: [{ path: "finance/tax", name: "tax", count: 1, totalCount: 1, children: [] }],
    },
    { path: "inbox", name: "inbox", count: 1, totalCount: 1, children: [] },
  ],
};

describe("folderChoices", () => {
  it("offers every folder the tree reports, descendants included", () => {
    expect(folderChoices(TREE).map((choice) => choice.key)).toEqual([
      "folder:finance",
      "folder:finance/tax",
      "folder:inbox",
    ]);
  });

  it("shows the count a folder query would actually match", () => {
    // `folder=finance` matches the folder and its descendants — so `totalCount`.
    expect(folderChoices(TREE)[0]).toMatchObject({
      title: "finance",
      query: { folder: "finance" },
      detail: "3 docs",
    });
    expect(folderChoices(TREE)[2]?.detail).toBe("1 doc");
  });

  it("offers nothing before the tree has loaded", () => {
    expect(folderChoices(undefined)).toEqual([]);
  });
});

describe("the preset library", () => {
  it("never restates a column the seed workspace already ships", () => {
    // A picker that re-offered the seed columns would be the board's own column
    // set written in TypeScript — the thing SPEC.md §10 forbids.
    const text = JSON.stringify(PRESET_CHOICES);
    expect(text).not.toContain("Attention");
    expect(text).not.toContain("Open threads");
    expect(text).not.toContain("needs=me");
    expect(text).not.toContain('"needs":"me"');
  });

  it("is only ever a query", () => {
    for (const preset of PRESET_CHOICES) {
      expect(Object.keys(preset.query).length).toBeGreaterThan(0);
      expect(preset.source).toBe("preset");
    }
  });
});

describe("searchChoice", () => {
  it("is absent until a search query exists", () => {
    expect(searchChoice("")).toBeNull();
    expect(searchChoice("   ")).toBeNull();
  });

  it("carries the query it was given", () => {
    expect(searchChoice(" mortgage ")).toMatchObject({
      source: "search",
      title: "mortgage",
      query: { q: "mortgage" },
    });
  });
});

describe("columnRequest", () => {
  /**
   * A view is a saved query and nothing more (SPEC.md §10, rider 2): no
   * `pinned`, no `order`. What puts it on a board is the board's own `columns`,
   * appended in a second write.
   */
  it("creates a view document with no board position of its own", () => {
    expect(columnRequest(folderChoices(TREE)[0] as never)).toEqual({
      type: "view",
      title: "finance",
      folder: VIEW_DOCUMENT_FOLDER,
      query: { folder: "finance" },
      evergreen: true,
    });
  });

  /**
   * The picker and the seed workspace have to agree about what a column *is*
   * (SPEC.md §10, rider 2), and since UI-148 that is two documents rather than a
   * flag: a view filed under `views/`, and a board that lists its id. The old
   * form of this test read `pinned: true` out of the seed's own view document,
   * which is exactly the key rider 2 removed.
   */
  it("files new views where the seed workspace files its own, and boards list them", () => {
    const read = (path: string): string =>
      readFileSync(
        fileURLToPath(new URL(`../../../../assets/workspace/${path}`, import.meta.url)),
        "utf8",
      );

    const view = read("data/docs/views/inbox.md");
    expect(view).toContain("type: view");
    expect(view).not.toContain("pinned:");
    expect(VIEW_DOCUMENT_FOLDER).toBe("views");

    // …and the seed's own board is what puts it on a board, by id.
    const board = read("data/docs/boards/attention.md");
    expect(board).toContain("type: board");
    expect(board).toContain("doc_seedinbox");
  });
});

describe("clampMenuPosition", () => {
  it("opens at the click point", () => {
    expect(clampMenuPosition(400, 300, { width: 1400, height: 900 })).toEqual({
      left: 360,
      top: 290,
    });
  });

  it("stays on screen at either edge", () => {
    const viewport = { width: 800, height: 600 };
    expect(clampMenuPosition(0, 0, viewport)).toEqual({ left: 8, top: 8 });
    expect(clampMenuPosition(2000, 2000, viewport)).toEqual({
      left: 800 - MENU_WIDTH,
      top: 600 - MENU_HEIGHT,
    });
  });
});
