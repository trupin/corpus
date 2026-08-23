import type { DocRow } from "@corpus/contract";

/**
 * A `DocRow` with every field at its "nothing to report" value, overridable per
 * test.
 *
 * A builder rather than a literal per test, because `DocRow` has twenty fields
 * and the nulls are load-bearing: `stale: null` is *fresh*, `unread: null` means
 * "not a thread" rather than "seen", and a test that spells them by hand
 * eventually spells one of them wrong and asserts against a row the server would
 * never send. It ships from `@corpus/kit/testing` because every suite that
 * renders a row — in this package and in `apps/ui` — needs exactly this.
 */
export function docRowFixture(overrides: Partial<DocRow> = {}): DocRow {
  return {
    id: "doc_fixture",
    type: "note",
    title: "Fixture document",
    path: "data/docs/inbox/fixture.md",
    status: "open",
    tags: [],
    created: "2026-07-01T09:00:00.000Z",
    updated: "2026-07-01T09:00:00.000Z",
    due: null,
    reviewed: null,
    evergreen: false,
    origin: null,
    // Never absent and never null (CONTRACT-074): a document the server has
    // never written reads `user`, and so does an out-of-band edit.
    lastActor: "user",
    excerpt: "",
    stale: null,
    parent: null,
    agent: null,
    anchorQuote: null,
    turnCount: null,
    lastAuthor: null,
    lastTurn: null,
    unread: null,
    awaitingAgent: null,
    unreadThreads: 0,
    // `0`, not null: a count is always a count (CONTRACT-040). A row with no
    // unanswered form and a row that is not a thread are the same `0` here.
    unansweredForms: 0,
    attention: [],
    snippets: [],
    parentTitle: null,
    stage: null,
    order: null,
    query: null,
    // The board keys (CONTRACT-074). `null` on every non-board document, which
    // is what a `type: view` row now looks like: a saved query and nothing more.
    columns: null,
    kanban: null,
    defaultOpen: false,
    extra: {},
    ...overrides,
  };
}
