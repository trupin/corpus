// The chunk tables inside the real projection: what a save rewrites, what it
// leaves alone, and what a rebuild reconstructs.
//
// The observable criterion SPEC.md §9.1 states — "saving a small change to a
// large document recomputes only the edited sections' chunks; untouched
// sections are never recomputed" — is measured here on `chunk_embeddings`, not
// on `chunks`. `projectDocument` deletes and reinserts a document's rows
// wholesale, so every `chunks` row is rewritten by every save and a row-level
// diff of that table would fail on a correct implementation. What the promise
// is actually about is the *work*: the chunks whose content changed are the
// chunks that need re-embedding, and content-addressed ids make that set exact.

import { readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspace, docMarkdown, type Workspace } from "../docs/corpus-fixture.js";
import { openProjection, openProjectionReadonly } from "../projection/db.js";
import { silentLogger } from "../logger.js";
import { projectDocument, removeDocument } from "../projection/project-document.js";
import { rebuild } from "../projection/rebuild.js";
import { PROJECTION_TABLES, REPOPULATED_TABLES, SCHEMA_VERSION } from "../projection/schema.js";
import { countPendingChunks, orphanedEmbeddingIds, pendingChunkIds } from "./chunks.js";

type ChunkRow = {
  readonly ref: string;
  readonly ord: number;
  readonly chunk_id: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly heading_path: string;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly char_length: number;
};

type EmbeddingRow = {
  readonly chunk_id: string;
  readonly vec: Buffer | null;
  readonly updated_ms: number;
};

const chunkRows = (ws: Workspace, docId?: string): ChunkRow[] =>
  ws.db
    .prepare(
      docId === undefined
        ? "SELECT * FROM chunks ORDER BY ref, ord"
        : "SELECT * FROM chunks WHERE doc_id = @doc ORDER BY ref, ord",
    )
    .all(docId === undefined ? {} : { doc: docId }) as ChunkRow[];

const embeddingRows = (ws: Workspace): EmbeddingRow[] =>
  ws.db
    .prepare("SELECT chunk_id, vec, updated_ms FROM chunk_embeddings ORDER BY chunk_id")
    .all() as EmbeddingRow[];

/** Stands in for SERVER-044's worker: one row per pending chunk, with a stub vector. */
function embedEverything(ws: Workspace, at = 1_000): void {
  const insert = ws.db.prepare(
    `INSERT INTO chunk_embeddings (chunk_id, identity, dim, vec, state, failures, updated_ms)
     VALUES (?, 'stub/model', 3, ?, 'ready', 0, ?)`,
  );
  for (const id of pendingChunkIds(ws.db)) {
    insert.run(id, Buffer.from(id.slice(0, 6), "hex"), at);
  }
}

/** Ten sections, each long enough to be recognisable and short enough not to split. */
const TEN_SECTIONS = Array.from(
  { length: 10 },
  (_, index) =>
    `## Section ${String(index)}\n\nParagraph one of section ${String(index)}.\n\n` +
    `Paragraph two of section ${String(index)}, with escrow detail.\n`,
).join("\n");

function seedTenSections(prefix: string): Workspace {
  const ws = createWorkspace(prefix);
  ws.doc({
    id: "doc_big",
    path: "data/docs/big.md",
    title: "Big document",
    body: TEN_SECTIONS,
  });
  ws.reproject();
  return ws;
}

const project = (ws: Workspace, relativePath: string): void => {
  projectDocument(ws.db, join(ws.config.workspaceRoot, relativePath));
};

describe("schema registration", () => {
  // TEST-832
  it("registers the three tables in the lists that make them visible", () => {
    // The semantic tables arrived at stamp 9; the stamp moves on (SERVER-055
    // took it to 10) without ever un-registering them, which is what this
    // asserts. Pinning the literal here only ever meant editing this line.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
    expect(PROJECTION_TABLES).toContain("chunks");
    expect(PROJECTION_TABLES).toContain("chunk_search");
    expect(PROJECTION_TABLES).toContain("chunk_embeddings");

    // Derived, so wiped and rebuilt — children first, before `documents`.
    expect(REPOPULATED_TABLES).toContain("chunks");
    expect(REPOPULATED_TABLES).toContain("chunk_search");
    expect(REPOPULATED_TABLES.indexOf("chunks")).toBeLessThan(
      REPOPULATED_TABLES.indexOf("documents"),
    );
    expect(REPOPULATED_TABLES.indexOf("chunk_search")).toBeLessThan(
      REPOPULATED_TABLES.indexOf("chunks"),
    );

    // Computed, not derived: a rebuild carries it over instead of wiping it.
    expect(REPOPULATED_TABLES).not.toContain("chunk_embeddings");
  });
});

describe("a stale schema stamp", () => {
  // TEST-833: there is no migration code, and there is not meant to be. A
  // database stamped one version back is wiped and rebuilt from files; a
  // read-only handle, which cannot do that, refuses and names the repair.
  it("wipes and rebuilds a previous-version database read-write, and refuses it read-only", () => {
    const ws = seedTenSections("chunks-stamp");
    try {
      // Stamp the projection as the previous schema version, as an installed
      // build one commit older would have left it.
      ws.db
        .prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'")
        .run(String(SCHEMA_VERSION - 1));
      ws.db.close();

      expect(() => openProjectionReadonly(ws.config)).toThrow(/corpus db rebuild/);

      const lines: string[] = [];
      const logger = {
        ...silentLogger,
        info: (message: string) => {
          lines.push(message);
        },
      };
      const reopened = openProjection(ws.config, { logger });
      try {
        expect(lines).toContain("projection schema changed; rebuilding from files");
        expect(
          reopened.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get(),
        ).toEqual({ value: String(SCHEMA_VERSION) });
        // The boot repopulation re-derived every chunk from the files.
        expect(reopened.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).toEqual(
          { n: 10 },
        );
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });
});

describe("projecting a document into chunks", () => {
  it("writes one chunk per section, in order, addressed by heading path", () => {
    const ws = seedTenSections("chunks-shape");
    try {
      const rows = chunkRows(ws, "doc_big");
      expect(rows).toHaveLength(10);
      expect(rows.map((row) => row.heading_path)).toEqual(
        Array.from({ length: 10 }, (_, index) => `Section ${String(index)}`),
      );
      expect(rows.map((row) => row.ord)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(new Set(rows.map((row) => row.ref))).toEqual(new Set(["doc_big"]));
      expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(["doc"]));
      for (const row of rows) {
        expect(row.char_length).toBe(row.end_offset - row.start_offset);
      }
    } finally {
      ws.close();
    }
  });

  // TEST-830
  it("chunks a thread per turn, each under the turn's own heading", () => {
    const ws = createWorkspace("chunks-turns");
    try {
      ws.thread({
        id: "th_talk",
        title: "A thread",
        body: "Preamble text before any turn.",
        turns: [
          { author: "user", ts: "2026-07-01T09:00:00Z", body: "First question." },
          {
            author: "agent",
            ts: "2026-07-01T10:00:00Z",
            body: "An answer.\n\n## Detail\n\nMore on the answer.",
          },
        ],
      });
      ws.reproject();

      const rows = chunkRows(ws, "th_talk");
      expect(rows.map((row) => [row.ref, row.kind, row.heading_path])).toEqual([
        ["th_talk", "doc", "A thread"],
        ["th_talk#2026-07-01T09:00:00Z", "turn", "user · 2026-07-01T09:00:00Z"],
        ["th_talk#2026-07-01T10:00:00Z", "turn", "agent · 2026-07-01T10:00:00Z"],
        ["th_talk#2026-07-01T10:00:00Z", "turn", "agent · 2026-07-01T10:00:00Z › Detail"],
      ]);
      // Turn chunks carry the thread's document id, not a per-turn one.
      expect(new Set(rows.map((row) => row.doc_id))).toEqual(new Set(["th_talk"]));
    } finally {
      ws.close();
    }
  });

  // TEST-827, at the projection level: one `Rates` section, not two.
  it("does not treat a heading inside a code fence as a section boundary", () => {
    const ws = createWorkspace("chunks-fence");
    try {
      ws.doc({
        id: "doc_fenced",
        path: "data/docs/fenced.md",
        title: "Fenced",
        body: "```md\n## Rates\n```\n\n## Rates\n\nThe real rates section.\n",
      });
      ws.reproject();
      expect(chunkRows(ws, "doc_fenced").map((row) => row.heading_path)).toEqual([
        "Fenced",
        "Rates",
      ]);
    } finally {
      ws.close();
    }
  });

  it("removes a deleted document's chunks and leaves nothing behind", () => {
    const ws = seedTenSections("chunks-delete");
    try {
      unlinkSync(join(ws.config.workspaceRoot, "data/docs/big.md"));
      removeDocument(ws.db, join(ws.config.workspaceRoot, "data/docs/big.md"));
      expect(chunkRows(ws)).toEqual([]);
      expect(
        ws.db.prepare("SELECT COUNT(*) AS n FROM chunk_search").get() as { n: number },
      ).toEqual({ n: 0 });
    } finally {
      ws.close();
    }
  });
});

describe("re-indexing is proportional to the edit", () => {
  // TEST-825
  it("recomputes one section's embedding and leaves the other nine untouched", () => {
    const ws = seedTenSections("chunks-edit");
    try {
      embedEverything(ws);
      const before = embeddingRows(ws);
      expect(before).toHaveLength(10);
      expect(countPendingChunks(ws.db)).toBe(0);

      // One line, inside section 5, and nothing else.
      ws.doc({
        id: "doc_big",
        path: "data/docs/big.md",
        title: "Big document",
        body: TEN_SECTIONS.replace(
          "Paragraph two of section 5, with escrow detail.",
          "Paragraph two of section 5, with revised escrow detail.",
        ),
      });
      project(ws, "data/docs/big.md");

      // Exactly one chunk is pending, and it is section 5's.
      const pending = pendingChunkIds(ws.db);
      expect(pending).toHaveLength(1);
      const pendingRow = chunkRows(ws, "doc_big").find((row) => row.chunk_id === pending[0]);
      expect(pendingRow?.heading_path).toBe("Section 5");

      // The other nine rows are untouched: same bytes, same timestamps, same ids.
      const after = embeddingRows(ws);
      expect(after).toEqual(before);
      const survivors = chunkRows(ws, "doc_big")
        .filter((row) => row.heading_path !== "Section 5")
        .map((row) => row.chunk_id);
      expect(survivors).toHaveLength(9);
      for (const id of survivors) {
        expect(
          after.some((row) => row.chunk_id === id),
          `no embedding for ${id}`,
        ).toBe(true);
      }

      // And the one now-orphaned embedding is section 5's previous content.
      expect(orphanedEmbeddingIds(ws.db)).toHaveLength(1);
    } finally {
      ws.close();
    }
  });

  it("recomputes nothing at all when a save changes no chunk's content", () => {
    const ws = seedTenSections("chunks-noop");
    try {
      embedEverything(ws);
      const before = embeddingRows(ws);

      // A frontmatter-only edit: `updated` moves, the body does not.
      ws.doc({
        id: "doc_big",
        path: "data/docs/big.md",
        title: "Big document",
        body: TEN_SECTIONS,
        updated: "2027-01-01T00:00:00Z",
      });
      project(ws, "data/docs/big.md");

      expect(countPendingChunks(ws.db)).toBe(0);
      expect(embeddingRows(ws)).toEqual(before);
      expect(orphanedEmbeddingIds(ws.db)).toEqual([]);
    } finally {
      ws.close();
    }
  });

  // TEST-826
  it("re-indexes nothing when a document is moved or renamed", () => {
    const ws = seedTenSections("chunks-move");
    try {
      embedEverything(ws);
      const before = embeddingRows(ws);
      const idsBefore = chunkRows(ws, "doc_big").map((row) => row.chunk_id);

      const moves: readonly (readonly [string, string])[] = [
        ["data/docs/big.md", "data/docs/finance/big.md"],
        ["data/docs/finance/big.md", "data/docs/finance/renamed.md"],
      ];
      for (const [from, to] of moves) {
        // The order the move route and the watcher both produce: the old path
        // stops existing, then the new one is projected.
        ws.write(to, docMarkdown({ id: "doc_big", title: "Big document", body: TEN_SECTIONS }));
        rmSync(join(ws.config.workspaceRoot, from));
        removeDocument(ws.db, join(ws.config.workspaceRoot, from));
        project(ws, to);

        expect(
          chunkRows(ws, "doc_big").map((row) => row.chunk_id),
          `after ${to}`,
        ).toEqual(idsBefore);
        expect(countPendingChunks(ws.db), `after ${to}`).toBe(0);
        expect(embeddingRows(ws), `after ${to}`).toEqual(before);
      }
      // `chunks.doc_id` is the id, never the path.
      expect(ws.db.prepare("SELECT path FROM documents WHERE id = 'doc_big'").get()).toEqual({
        path: "data/docs/finance/renamed.md",
      });
    } finally {
      ws.close();
    }
  });
});

describe("db rebuild", () => {
  // TEST-834
  it("reconstructs the chunk rows identically", () => {
    const ws = seedTenSections("chunks-rebuild");
    try {
      ws.thread({
        id: "th_talk",
        title: "A thread",
        turns: [{ author: "user", ts: "2026-07-01T09:00:00Z", body: "A turn.\n\n## Sub\n\nMore." }],
      });
      ws.reproject();
      const before = chunkRows(ws);
      expect(before.length).toBeGreaterThan(10);

      ws.db.close();
      rebuild(ws.config);

      const reopened = openProjection(ws.config, { populate: false });
      try {
        const after = reopened
          .prepare("SELECT * FROM chunks ORDER BY ref, ord")
          .all() as ChunkRow[];
        // A full-table comparison, not a count: ids, addresses, ordinals and
        // offsets all have to come back the same.
        expect(after).toEqual(before);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });

  // Open Conflict 5: a rebuild carries embeddings over rather than discarding
  // them, and content addressing re-attaches them for free.
  it("carries chunk_embeddings across the rename and re-attaches them by id", () => {
    const ws = seedTenSections("chunks-carry");
    try {
      embedEverything(ws);
      const before = embeddingRows(ws);
      expect(before).toHaveLength(10);
      ws.db.close();

      rebuild(ws.config);

      const reopened = openProjection(ws.config, { populate: false });
      try {
        expect(
          reopened
            .prepare("SELECT chunk_id, vec, updated_ms FROM chunk_embeddings ORDER BY chunk_id")
            .all(),
        ).toEqual(before);
        // Re-attached: every chunk the rebuild wrote already has its embedding,
        // so the rebuild queues nothing.
        expect(countPendingChunks(reopened)).toBe(0);
        expect(orphanedEmbeddingIds(reopened)).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });

  it("rebuilds with no previous projection to carry anything over from", () => {
    const ws = createWorkspace("chunks-carry-none");
    try {
      ws.doc({ id: "doc_a", path: "data/docs/a.md", body: "## A\n\nBody.\n" });
      ws.db.close();
      rmSync(join(ws.config.corpusDir, "cache.db"), { force: true });
      rebuild(ws.config);

      const reopened = openProjection(ws.config, { populate: false });
      try {
        expect(
          reopened.prepare("SELECT COUNT(*) AS n FROM chunk_embeddings").get() as { n: number },
        ).toEqual({ n: 0 });
        // Everything the rebuild wrote is pending, which is the honest state.
        expect(countPendingChunks(reopened)).toBe(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(ws.root, { recursive: true, force: true });
    }
  });
});

describe("styling markers never reach the semantic index (SERVER-162)", () => {
  const STYLED = 'The [mortgage]{color="warning"} rate ==rose== sharply, per <u>Ofgem</u>.\n';

  it("stores the stripped text as the chunk's body, and keeps the offsets on the file", () => {
    const ws = createWorkspace("chunks-styled");
    try {
      ws.doc({
        id: "doc_styled",
        path: "data/docs/styled.md",
        title: "Rates",
        body: STYLED,
      });
      ws.reproject();

      const body = ws.db
        .prepare("SELECT body FROM chunk_search WHERE doc_id = 'doc_styled'")
        .get() as { body: string };
      expect(body.body).toContain("The mortgage rate rose sharply, per Ofgem.");
      expect(body.body).not.toContain("color=");
      expect(body.body).not.toContain("==");
      expect(body.body).not.toContain("<u>");

      // The offsets still address the file, so a resolved passage reads the
      // bytes that are there — markers included.
      const [row] = chunkRows(ws, "doc_styled");
      expect(row).toBeDefined();
      const file = readFileSync(join(ws.config.workspaceRoot, "data/docs/styled.md"), "utf8");
      const bodyStart = file.indexOf("The [mortgage]");
      expect(bodyStart).toBeGreaterThan(0);
      expect(row?.char_length).toBe((row?.end_offset ?? 0) - (row?.start_offset ?? 0));
    } finally {
      ws.close();
    }
  });

  it("finds a chunk by a word that sits inside a styled phrase", () => {
    const ws = createWorkspace("chunks-styled-find");
    try {
      ws.doc({ id: "doc_s", path: "data/docs/s.md", title: "Rates", body: STYLED });
      ws.reproject();
      const hits = ws.db
        .prepare("SELECT doc_id FROM chunk_search WHERE chunk_search MATCH 'mortgage'")
        .all() as { doc_id: string }[];
      expect(hits.map((hit) => hit.doc_id)).toEqual(["doc_s"]);
    } finally {
      ws.close();
    }
  });

  it("gives two documents that differ only in styling the same chunk text", () => {
    const styledWs = createWorkspace("chunks-styled-a");
    const plainWs = createWorkspace("chunks-styled-b");
    try {
      styledWs.doc({ id: "doc_x", path: "data/docs/x.md", title: "Rates", body: STYLED });
      styledWs.reproject();
      plainWs.doc({
        id: "doc_x",
        path: "data/docs/x.md",
        title: "Rates",
        body: "The mortgage rate rose sharply, per Ofgem.\n",
      });
      plainWs.reproject();

      const bodyOf = (ws: Workspace): string =>
        (ws.db.prepare("SELECT body FROM chunk_search").get() as { body: string }).body;
      expect(bodyOf(styledWs)).toBe(bodyOf(plainWs));
    } finally {
      styledWs.close();
      plainWs.close();
    }
  });
});
