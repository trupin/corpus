import { describe, expect, it } from "vitest";
import type { DocumentOnDisk, WorkspaceCorpus } from "./corpus.js";
import { detectMigrations, type DetectedMigration } from "./registry.js";

/**
 * The `views-to-board` entry, driven through the registry rather than around it:
 * what an upgrade prints is what `detectMigrations` returns, and a test that
 * called the detector directly could pass while the entry was unregistered.
 *
 * The corpus is injected, so every case here is a set of frontmatter blocks and
 * nothing else. `corpus.test.ts` owns "these bytes on disk become that corpus".
 */

function document(frontmatter: Record<string, unknown>, path = "data/docs/x.md"): DocumentOnDisk {
  return {
    path,
    id: typeof frontmatter.id === "string" ? frontmatter.id : null,
    type: typeof frontmatter.type === "string" ? frontmatter.type : null,
    title: typeof frontmatter.title === "string" ? frontmatter.title : null,
    frontmatter,
  };
}

function corpusOf(...documents: readonly DocumentOnDisk[]): WorkspaceCorpus {
  return { root: "/workspace", documents };
}

function detect(
  corpus: WorkspaceCorpus,
  actor: "user" | "agent" = "user",
): DetectedMigration | undefined {
  return detectMigrations({ root: "/workspace", dataDir: "data", actor, corpus }).find(
    (migration) => migration.id === "views-to-board",
  );
}

/** The three seed views of a workspace written before Phase 41. */
const seedViews = [
  document({ id: "doc_seedattention", type: "view", title: "Attention", pinned: true, order: 1 }),
  document({ id: "doc_seedinbox", type: "view", title: "Inbox", pinned: true, order: 2 }),
  document({
    id: "doc_seedopenthreads",
    type: "view",
    title: "Open threads",
    pinned: true,
    order: 3,
  }),
];

describe("views-to-board", () => {
  it("fires on pinned views with no board, and builds one that opens", () => {
    const migration = detect(corpusOf(...seedViews));

    expect(migration?.statement).toContain("3 view documents");
    expect(migration?.statement).toContain("no board document in this workspace");
    expect(migration?.commands).toEqual([
      'corpus doc create --type board --title "Board" --folder boards ' +
        "--columns doc_seedattention,doc_seedinbox,doc_seedopenthreads --default-open true",
      "corpus doc edit doc_seedattention --unset pinned --unset order",
      "corpus doc edit doc_seedinbox --unset pinned --unset order",
      "corpus doc edit doc_seedopenthreads --unset pinned --unset order",
    ]);
    expect(migration?.optional).toEqual([]);
  });

  it("does not fire when every pinned view is already a board's column", () => {
    expect(
      detect(
        corpusOf(
          ...seedViews,
          document({
            id: "doc_board",
            type: "board",
            columns: ["doc_seedattention", "doc_seedinbox", "doc_seedopenthreads"],
          }),
        ),
      ),
    ).toBeUndefined();
  });

  it("does not fire on views that carry neither key", () => {
    expect(
      detect(corpusOf(document({ id: "doc_a", type: "view", title: "A", query: { folder: "x" } }))),
    ).toBeUndefined();
  });

  it("does not fire on a corpus with no view documents at all", () => {
    expect(detect(corpusOf(document({ id: "doc_n", type: "note", title: "N" })))).toBeUndefined();
  });

  it("fires on `order` alone, and on `pinned: true` alone", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_ordered", type: "view", title: "Ordered", order: 4 }),
        document({ id: "doc_pinned", type: "view", title: "Pinned", pinned: true }),
      ),
    );
    // `order: 4` sorts before the view with no order at all — nulls last.
    expect(migration?.commands[0]).toContain("--columns doc_ordered,doc_pinned");
  });

  it("treats `pinned: false` with no order as tidy-up, never as stranded", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_a", type: "view", title: "A", pinned: true, order: 1 }),
        document({ id: "doc_off", type: "view", title: "Off", pinned: false }),
      ),
    );

    expect(migration?.commands[0]).toContain("--columns doc_a");
    expect(migration?.commands[0]).not.toContain("doc_off");
    expect(migration?.optional).toEqual(["corpus doc edit doc_off --unset pinned --unset order"]);
  });

  it("offers a listed view's leftover keys as tidy-up too", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_stranded", type: "view", title: "Stranded", pinned: true }),
        document({ id: "doc_listed", type: "view", title: "Listed", pinned: true, order: 9 }),
        document({ id: "doc_board", type: "board", title: "B", columns: ["doc_listed"] }),
      ),
    );

    expect(migration?.commands).toEqual([
      "corpus doc edit doc_board --columns doc_listed,doc_stranded",
      "corpus doc edit doc_stranded --unset pinned --unset order",
    ]);
    expect(migration?.optional).toEqual([
      "corpus doc edit doc_listed --unset pinned --unset order",
    ]);
  });

  it("orders the columns by order, nulls last, then title, then id", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_z", type: "view", title: "Zulu", pinned: true }),
        document({ id: "doc_a", type: "view", title: "Alpha", pinned: true }),
        document({ id: "doc_second", type: "view", title: "Second", pinned: true, order: 2 }),
        document({ id: "doc_first", type: "view", title: "First", pinned: true, order: 1 }),
        document({ id: "doc_tie_b", type: "view", title: "alpha", pinned: true }),
      ),
    );

    // 1, 2, then the three with no order: `Alpha` and `alpha` tie on a
    // case-insensitive title and break on id, then `Zulu`.
    expect(migration?.commands[0]).toContain(
      "--columns doc_first,doc_second,doc_a,doc_tie_b,doc_z",
    );
  });

  it("counts an archived board as listing its views", () => {
    // The board can be restored; telling the operator to build a second one over
    // the same views would be the wrong answer.
    expect(
      detect(
        corpusOf(
          document({ id: "doc_a", type: "view", title: "A", pinned: true }),
          document({
            id: "doc_board",
            type: "board",
            title: "Archived",
            status: "archived",
            columns: ["doc_a"],
          }),
        ),
      ),
    ).toBeUndefined();
  });

  it("extends the default-open board when several exist", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_a", type: "view", title: "A", pinned: true }),
        document({ id: "doc_first", type: "board", title: "First", order: 1, columns: ["doc_x"] }),
        document({
          id: "doc_open",
          type: "board",
          title: "Open",
          order: 5,
          "default-open": true,
          columns: ["doc_y"],
        }),
      ),
    );

    expect(migration?.commands[0]).toBe("corpus doc edit doc_open --columns doc_y,doc_a");
  });

  it("prefers a live board over an archived one", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_a", type: "view", title: "A", pinned: true }),
        document({
          id: "doc_gone",
          type: "board",
          title: "Gone",
          order: 1,
          status: "archived",
          columns: [],
        }),
        document({ id: "doc_live", type: "board", title: "Live", order: 2, columns: [] }),
      ),
    );

    expect(migration?.commands[0]).toBe("corpus doc edit doc_live --columns doc_a");
  });

  it("creates a board rather than writing columns onto a kanban", () => {
    // A kanban's columns are derived one per stage and are not view documents
    // (rider 6): `--columns` on one writes a key it does not render.
    const migration = detect(
      corpusOf(
        document({ id: "doc_a", type: "view", title: "A", pinned: true }),
        document({
          id: "doc_kanban",
          type: "board",
          title: "Kanban",
          kanban: { field: "stage", stages: ["triage", "done"] },
        }),
      ),
    );

    expect(migration?.commands[0]).toContain("corpus doc create --type board");
  });

  it("never repeats a column already on the board", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_a", type: "view", title: "A", pinned: true, order: 1 }),
        document({ id: "doc_board", type: "board", title: "B", columns: ["doc_a", "doc_b"] }),
      ),
    );

    // `doc_a` is listed, so nothing is stranded and the entry does not fire.
    expect(migration).toBeUndefined();
  });

  it("skips a view with no id, because no command can name it", () => {
    expect(
      detect(corpusOf(document({ type: "view", title: "Nameless", pinned: true }))),
    ).toBeUndefined();
  });

  it("ignores `order: null`, which is the key carrying nothing", () => {
    expect(
      detect(corpusOf(document({ id: "doc_a", type: "view", title: "A", order: null }))),
    ).toBeUndefined();
  });

  it("writes --from agent into every command when the agent ran the upgrade", () => {
    const migration = detect(
      corpusOf(
        document({ id: "doc_a", type: "view", title: "A", pinned: true }),
        document({ id: "doc_off", type: "view", title: "Off", pinned: false }),
      ),
      "agent",
    );

    expect(migration?.commands).toEqual([
      'corpus doc create --type board --title "Board" --folder boards --columns doc_a ' +
        "--default-open true --from agent",
      "corpus doc edit doc_a --unset pinned --unset order --from agent",
    ]);
    expect(migration?.optional).toEqual([
      "corpus doc edit doc_off --unset pinned --unset order --from agent",
    ]);
  });

  it("ignores a board's own `order`, which is live", () => {
    // `--order` survived rider 7 with a new meaning: a board's position among
    // boards. A board carrying one is not a document to migrate.
    expect(
      detect(corpusOf(document({ id: "doc_board", type: "board", title: "B", order: 3 }))),
    ).toBeUndefined();
  });
});
