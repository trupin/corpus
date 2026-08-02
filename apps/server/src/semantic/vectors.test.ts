import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { notArchivedSql } from "../docs/filters.js";
import { blobToVector, vectorToBlob, writeEmbedding } from "./embeddings.js";
import { embedChunks, embedDocuments, listChunkRows } from "./vector-fixture.js";
import {
  SEMANTIC_MIN_SIMILARITY,
  UNFILTERED_SCOPE,
  cosineSimilarity,
  documentCentroid,
  nearestDocuments,
  normalizeVector,
  vectorCensus,
  vectorFromBlob,
} from "./vectors.js";

const IDENTITY = "stub/fixture@2";
const OTHER_IDENTITY = "stub/other@2";

let ws: Workspace;

beforeAll(() => {
  ws = createWorkspace("vectors");
  ws.doc({ id: "doc_north", title: "North", body: "Alpha body." });
  ws.doc({ id: "doc_east", title: "East", body: "Beta body." });
  ws.doc({ id: "doc_far", title: "Far", body: "Gamma body." });
  ws.doc({ id: "doc_arch", title: "Archived", status: "archived", body: "Delta body." });
  ws.doc({
    id: "doc_two",
    title: "Two sections",
    body: "## One\n\nFirst section text.\n\n## Two\n\nSecond section text.\n",
  });
  ws.reproject();
});

afterAll(() => {
  ws.close();
});

describe("normalizeVector", () => {
  it("scales to unit length", () => {
    const unit = normalizeVector(Float32Array.from([3, 4]));
    expect(Math.hypot(unit[0] ?? 0, unit[1] ?? 0)).toBeCloseTo(1, 6);
  });

  it("returns an already-unit vector untouched, allocating nothing", () => {
    const already = Float32Array.from([1, 0]);
    expect(normalizeVector(already)).toBe(already);
  });

  it("leaves a zero vector alone rather than dividing by zero", () => {
    const zero = Float32Array.from([0, 0]);
    expect(normalizeVector(zero)).toBe(zero);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for the same direction, 0 for orthogonal, -1 for opposite", () => {
    const query = Float32Array.from([1, 0]);
    expect(cosineSimilarity(query, Float32Array.from([1, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(query, Float32Array.from([0, 1]))).toBeCloseTo(0, 6);
    expect(cosineSimilarity(query, Float32Array.from([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it("normalises the stored vector, so an un-normalised row still scores correctly", () => {
    // The worker normalises at write time; a row that reached the table another
    // way must not out-rank everything merely by being long.
    const query = Float32Array.from([1, 0]);
    expect(cosineSimilarity(query, Float32Array.from([100, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(query, Float32Array.from([0, 0]))).toBe(0);
  });

  it("is bit-reproducible for fixed inputs", () => {
    const query = normalizeVector(Float32Array.from([0.3, -0.7, 0.2, 0.9]));
    const vector = Float32Array.from([0.11, 0.42, -0.87, 0.5]);
    const once = cosineSimilarity(query, vector);
    for (let run = 0; run < 5; run += 1) {
      expect(cosineSimilarity(query, vector)).toBe(once);
    }
  });
});

describe("vector storage", () => {
  it("round-trips a vector bit-identically through the BLOB encoding", () => {
    const values = [0, 1, -1, 0.5, -0.25, 3.4028234663852886e38, 1.401298464324817e-45];
    const vector = Float32Array.from(values);
    const blob = vectorToBlob(vector);

    expect(blob.length).toBe(vector.length * Float32Array.BYTES_PER_ELEMENT);
    expect([...blobToVector(blob)]).toEqual([...vector]);
    expect([...(vectorFromBlob(blob, vector.length) ?? [])]).toEqual([...vector]);
  });

  it("decodes identically whether the fast view or the explicit LE loop is used", () => {
    // `vectorFromBlob` takes a zero-copy `Float32Array` view when the platform
    // is little-endian and the buffer is aligned; `blobToVector` reads each
    // float explicitly. They must never disagree.
    const vector = Float32Array.from([0.125, -7.5, 1024.75, 0.0009765625]);
    const blob = vectorToBlob(vector);
    expect([...(vectorFromBlob(blob, vector.length) ?? [])]).toEqual([...blobToVector(blob)]);

    // An unaligned blob: the same bytes at an odd offset inside a larger buffer.
    const padded = Buffer.alloc(blob.length + 1);
    blob.copy(padded, 1);
    const unaligned = padded.subarray(1);
    expect(unaligned.byteOffset % 4).not.toBe(0);
    expect([...(vectorFromBlob(unaligned, vector.length) ?? [])]).toEqual([...vector]);
  });

  it("refuses a blob whose length disagrees with the recorded dimension", () => {
    // Unrepresentable through `writeEmbedding`, which derives `dim` from the
    // vector it is given — so the guard is where a disagreement can actually
    // arrive: a hand-edited projection. A scan that trusted the row would read
    // the next row's bytes as floats.
    const blob = vectorToBlob(Float32Array.from([1, 2, 3]));
    expect(vectorFromBlob(blob, 4)).toBeNull();
    expect(vectorFromBlob(blob, 2)).toBeNull();
    expect(vectorFromBlob(blob, 0)).toBeNull();
  });

  it("stores what the writer was given and reads it back through the row", () => {
    const scratch = createWorkspace("vectors-roundtrip");
    try {
      scratch.doc({ id: "doc_only", body: "One passage." });
      scratch.reproject();
      const [chunk] = listChunkRows(scratch.db);
      expect(chunk).toBeDefined();

      const vector = Float32Array.from([0.6, -0.8]);
      writeEmbedding(scratch.db, {
        state: "ready",
        chunkId: chunk?.chunkId ?? "",
        identity: IDENTITY,
        vector,
        updatedMs: 7,
      });

      const row = scratch.db
        .prepare("SELECT dim, vec FROM chunk_embeddings WHERE chunk_id = ?")
        .get(chunk?.chunkId) as { dim: number; vec: Buffer };
      expect(row.dim).toBe(2);
      expect([...(vectorFromBlob(row.vec, row.dim) ?? [])]).toEqual([...vector]);
    } finally {
      scratch.close();
    }
  });
});

describe("nearestDocuments", () => {
  const scan = (query: readonly number[], overrides: Record<string, unknown> = {}) =>
    nearestDocuments(ws.db, {
      identity: IDENTITY,
      query: Float32Array.from(query),
      scope: UNFILTERED_SCOPE,
      limit: 10,
      ...overrides,
    });

  beforeAll(() => {
    embedDocuments(ws.db, IDENTITY, {
      doc_north: [1, 0],
      doc_east: [0.8, 0.6],
      doc_far: [0, 1],
      doc_arch: [1, 0],
    });
  });

  it("ranks by cosine distance, nearest first", () => {
    // `doc_arch` and `doc_north` are equidistant, so the tie breaks on id.
    // `doc_far` is orthogonal to the query and falls below the relevance floor,
    // so it is absent rather than last.
    expect(scan([1, 0]).map((match) => match.id)).toEqual(["doc_arch", "doc_north", "doc_east"]);
    expect(scan([0, 1]).map((match) => match.id)[0]).toBe("doc_far");
  });

  it("drops a chunk below the relevance floor rather than ranking it last", () => {
    // `doc_far` is a perfect match for `[0, 1]` and scores 0 against `[1, 0]`.
    // Without the floor, every document in the index would appear in every
    // ranked answer — and `related` would call an unrelated document `similar`.
    expect(SEMANTIC_MIN_SIMILARITY).toBeGreaterThan(0);
    expect(scan([1, 0]).map((match) => match.id)).not.toContain("doc_far");
    expect(scan([0, 1]).map((match) => match.id)).toContain("doc_far");
    // `doc_east` at cosine 0.6 is kept: the floor excludes the unrelated, it
    // does not decide relevance.
    expect(scan([1, 0]).map((match) => match.id)).toContain("doc_east");
  });

  it("reads only vectors recorded under the asked-for identity", () => {
    // SPEC.md §9.1: results from different models are never mixed. Not ranked
    // lower — never read.
    expect(
      nearestDocuments(ws.db, {
        identity: OTHER_IDENTITY,
        query: Float32Array.from([1, 0]),
        scope: UNFILTERED_SCOPE,
        limit: 10,
      }),
    ).toEqual([]);
  });

  it("skips a row whose dimension does not match the query's", () => {
    const scratch = createWorkspace("vectors-dim");
    try {
      scratch.doc({ id: "doc_wide", body: "Wide." });
      scratch.doc({ id: "doc_narrow", body: "Narrow." });
      scratch.reproject();
      embedChunks(scratch.db, IDENTITY, (chunk) =>
        chunk.docId === "doc_wide" ? [1, 0, 0] : [1, 0],
      );

      const found = nearestDocuments(scratch.db, {
        identity: IDENTITY,
        query: Float32Array.from([1, 0]),
        scope: UNFILTERED_SCOPE,
        limit: 10,
      });
      expect(found.map((match) => match.id)).toEqual(["doc_narrow"]);
    } finally {
      scratch.close();
    }
  });

  it("applies the shared filters — archived is excluded by the same fragment", () => {
    const live = nearestDocuments(ws.db, {
      identity: IDENTITY,
      query: Float32Array.from([1, 0]),
      scope: { where: notArchivedSql("d"), params: {} },
      limit: 10,
    });
    expect(live.map((match) => match.id)).not.toContain("doc_arch");
    expect(live.map((match) => match.id)).toContain("doc_north");
  });

  it("never returns the document it was told to exclude", () => {
    expect(scan([1, 0], { excludeDocId: "doc_north" }).map((match) => match.id)).not.toContain(
      "doc_north",
    );
  });

  it("returns one row per document, ranked by its best chunk and addressed by it", () => {
    // TEST-892: max, never sum — a long document must not out-rank a precise one
    // by having more passages.
    const scratch = createWorkspace("vectors-aggregate");
    try {
      scratch.doc({
        id: "doc_many",
        title: "Many",
        body: "## One\n\nFirst.\n\n## Two\n\nSecond.\n\n## Three\n\nThird.\n",
      });
      scratch.doc({ id: "doc_one", title: "One", body: "Precise." });
      scratch.reproject();

      // Every chunk of `doc_many` is a mediocre match; `doc_one`'s single chunk
      // is a perfect one. Summing would put the three-chunk document first.
      embedChunks(scratch.db, IDENTITY, (chunk) =>
        chunk.docId === "doc_many"
          ? chunk.headingPath === "Two"
            ? [0.8, 0.6]
            : [0.6, 0.8]
          : [1, 0],
      );

      const found = nearestDocuments(scratch.db, {
        identity: IDENTITY,
        query: Float32Array.from([1, 0]),
        scope: UNFILTERED_SCOPE,
        limit: 10,
      });
      expect(found.map((match) => match.id)).toEqual(["doc_one", "doc_many"]);
      expect(found).toHaveLength(2);

      // And the chunk reported is the best one, not the first one.
      const best = found.find((match) => match.id === "doc_many");
      const heading = scratch.db
        .prepare("SELECT heading_path FROM chunks WHERE chunk_id = ? LIMIT 1")
        .get(best?.chunkId) as { heading_path: string } | undefined;
      expect(heading?.heading_path).toBe("Two");
    } finally {
      scratch.close();
    }
  });

  it("breaks a score tie by id, and a within-document tie by chunk id", () => {
    // Neither ordering may depend on the order SQLite visited rows in.
    const found = scan([1, 0]);
    const north = found.find((match) => match.id === "doc_north");
    const archived = found.find((match) => match.id === "doc_arch");
    expect(north?.score).toBe(archived?.score);
    expect(found.findIndex((match) => match.id === "doc_arch")).toBeLessThan(
      found.findIndex((match) => match.id === "doc_north"),
    );

    const twice = scan([1, 0]);
    expect(twice).toEqual(found);
  });

  it("answers nothing for a degenerate request rather than scanning", () => {
    expect(scan([])).toEqual([]);
    expect(scan([1, 0], { limit: 0 })).toEqual([]);
  });

  it("caps at the requested limit", () => {
    expect(scan([1, 0], { limit: 2 })).toHaveLength(2);
  });
});

describe("vectorCensus", () => {
  it("separates 'nothing indexed' from 'indexed by another model'", () => {
    const scratch = createWorkspace("vectors-census");
    try {
      scratch.doc({ id: "doc_c", body: "Census body." });
      scratch.reproject();
      expect(vectorCensus(scratch.db, IDENTITY)).toEqual({ total: 0, atIdentity: 0 });

      embedDocuments(scratch.db, OTHER_IDENTITY, { doc_c: [1, 0] });
      expect(vectorCensus(scratch.db, IDENTITY)).toEqual({ total: 1, atIdentity: 0 });
      expect(vectorCensus(scratch.db, OTHER_IDENTITY)).toEqual({ total: 1, atIdentity: 1 });
    } finally {
      scratch.close();
    }
  });

  it("counts a failed row in neither number", () => {
    const scratch = createWorkspace("vectors-census-failed");
    try {
      scratch.doc({ id: "doc_f", body: "Failed body." });
      scratch.reproject();
      const [chunk] = listChunkRows(scratch.db);
      writeEmbedding(scratch.db, {
        state: "failed",
        chunkId: chunk?.chunkId ?? "",
        identity: IDENTITY,
        failures: 3,
        updatedMs: 1,
      });
      expect(vectorCensus(scratch.db, IDENTITY)).toEqual({ total: 0, atIdentity: 0 });
    } finally {
      scratch.close();
    }
  });
});

describe("documentCentroid", () => {
  it("averages a document's chunk vectors and returns a unit vector", () => {
    const centroid = documentCentroid(ws.db, "doc_two", IDENTITY);
    expect(centroid).toBeNull();

    const scratch = createWorkspace("vectors-centroid");
    try {
      scratch.doc({
        id: "doc_pair",
        body: "## One\n\nFirst section.\n\n## Two\n\nSecond section.\n",
      });
      scratch.reproject();
      embedChunks(scratch.db, IDENTITY, (chunk) => (chunk.headingPath === "One" ? [1, 0] : [0, 1]));

      const mean = documentCentroid(scratch.db, "doc_pair", IDENTITY);
      expect(mean).not.toBeNull();
      expect(mean?.[0]).toBeCloseTo(Math.SQRT1_2, 6);
      expect(mean?.[1]).toBeCloseTo(Math.SQRT1_2, 6);
    } finally {
      scratch.close();
    }
  });

  it("answers nothing for a document with no vector at this identity", () => {
    expect(documentCentroid(ws.db, "doc_north", OTHER_IDENTITY)).toBeNull();
    expect(documentCentroid(ws.db, "doc_missing", IDENTITY)).toBeNull();
  });
});
