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
    origin: null,
    stage: null,
    order: null,
    query: null,
    columns: null,
    kanban: null,
    defaultOpen: false,
    extra: {},
  },
  body: "30-year fixed at 6.1%.\n",
  path: "data/docs/finance/mortgage-options.md",
  // A real-shaped key: 64 lowercase hex characters, which is what
  // `DOCUMENT_KEY_PATTERN` accepts and therefore what `--key` round-trips. A
  // placeholder like "key1" would pass every assertion in these tests and fail
  // the first real invocation.
  key: "3b2ec1f04d75a2c6ef2b8b9a1f0c4d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3",
  userEditing: false,
  anchors: [],
};

/** The same document after someone opened it in the board — §7's advisory signal. */
export const beingEdited = (doc: Doc): Doc => ({ ...doc, userEditing: true });

/** A document that has moved on: a different key, which is what makes an old one stale. */
export const rekeyed = (doc: Doc, key: string): Doc => ({ ...doc, key });

export const archived = (doc: Doc): Doc => ({
  ...doc,
  frontmatter: { ...doc.frontmatter, status: "archived" },
});

export const at = (doc: Doc, path: string): Doc => ({ ...doc, path });

/**
 * The motivating document of CLI-017: a `type: skill` whose archiving is two
 * facts, not one — the status *and* which side of `.claude/skills-archived/`
 * the folder is on. Every guard that talks about a skill's folder has to be
 * exercised against a fixture that actually has one, or it is only ever tested
 * against a note that cannot reach the state being described (wave-3 audit,
 * TEST 22).
 */
export const SKILL: Doc = {
  ...DOC,
  frontmatter: {
    ...DOC.frontmatter,
    id: "doc_gqyrzvto",
    type: "skill",
    title: "weekly-review",
    tags: [],
  },
  body: "Review the week.\n",
  path: ".claude/skills/weekly-review/SKILL.md",
};

/** The same skill after `corpus doc archive`: status *and* folder both moved. */
export const ARCHIVED_SKILL: Doc = at(
  archived(SKILL),
  ".claude/skills-archived/weekly-review/SKILL.md",
);

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
  origin: null,
  // Who wrote it last (SPEC.md §4) — the field §7's reflection reads to decide
  // whether a change is the agent's own output or somebody's new work.
  lastActor: "user",
  excerpt: "30-year fixed at 6.1%.",
  stage: null,
  order: null,
  query: null,
  columns: null,
  kanban: null,
  defaultOpen: false,
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
  // `0`, not null, on a non-thread row: the count is a count (CONTRACT-040).
  unansweredForms: 0,
  attention: [],
  snippets: [],
};

export const row = (overrides: Partial<DocRow>): DocRow => ({ ...DOC_ROW, ...overrides });
