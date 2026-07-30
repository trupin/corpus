import type { Doc, DocRow } from "@corpus/contract";

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
    pinned: false,
    order: null,
    query: null,
    column: null,
    extra: {},
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

/**
 * A `GET /api/docs` row. Every key the contract declares is present, including
 * the thread affordances that are `null` off a thread: a fixture that omitted
 * them would let a renderer read a field the server always sends.
 */
export const DOC_ROW: DocRow = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  path: "data/docs/finance/mortgage-options.md",
  status: "open",
  tags: ["finance"],
  created: "2026-07-27T10:00:00Z",
  updated: "2026-07-27T10:00:00Z",
  due: null,
  reviewed: null,
  evergreen: false,
  excerpt: "30-year fixed at 6.1%.",
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
  stale: null,
  parent: null,
  parentTitle: null,
  agent: null,
  anchorQuote: null,
  turnCount: null,
  lastAuthor: null,
  lastTurn: null,
  unread: null,
  awaitingAgent: null,
  unreadThreads: 0,
  attention: [],
  snippets: [],
};

export const row = (overrides: Partial<DocRow>): DocRow => ({ ...DOC_ROW, ...overrides });
