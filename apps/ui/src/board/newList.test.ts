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
  it("creates a pinned view document, filed where views live", () => {
    expect(columnRequest(folderChoices(TREE)[0] as never, 40)).toEqual({
      type: "view",
      title: "finance",
      folder: VIEW_DOCUMENT_FOLDER,
      pinned: true,
      order: 40,
      query: { folder: "finance" },
      evergreen: true,
    });
  });

  it("files new views where the seed workspace files its own", () => {
    const seed = readFileSync(
      fileURLToPath(
        new URL("../../../../assets/workspace/data/docs/views/inbox.md", import.meta.url),
      ),
      "utf8",
    );
    expect(seed).toContain("pinned: true");
    expect(VIEW_DOCUMENT_FOLDER).toBe("views");
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
