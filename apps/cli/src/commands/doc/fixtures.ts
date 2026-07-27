import type { Doc } from "@corpus/contract";

/**
 * Contract-shaped fixtures for the `doc` verbs' tests. They are the real wire
 * shapes — a stub that answered something the contract cannot produce would
 * prove nothing about the verb that reads it.
 */

export const DOC: Doc = {
  frontmatter: {
    id: "doc_a1b2c3",
    type: "note",
    title: "Mortgage options",
    created: "2026-07-27T10:00:00Z",
    updated: "2026-07-27T10:00:00Z",
    tags: ["finance"],
    status: "open",
    anchors: {},
    due: null,
    reviewed: null,
    evergreen: false,
  },
  body: "30-year fixed at 6.1%.\n",
  path: "data/docs/finance/mortgage-options.md",
  anchors: [],
};

export const archived = (doc: Doc): Doc => ({
  ...doc,
  frontmatter: { ...doc.frontmatter, status: "archived" },
});

export const at = (doc: Doc, path: string): Doc => ({ ...doc, path });
