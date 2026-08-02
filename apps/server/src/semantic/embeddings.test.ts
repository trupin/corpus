// Identity as a property of the rows themselves (sprint-021 TEST-844), against
// the real projection schema rather than a stand-in table.

import { describe, expect, it, afterEach } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import {
  blobToVector,
  recordedIdentities,
  recordedIdentity,
  vectorToBlob,
  writeEmbedding,
} from "./embeddings.js";

let workspace: Workspace | undefined;

afterEach(() => {
  workspace?.close();
  workspace = undefined;
});

const open = (): Workspace => {
  workspace = createWorkspace("s021-embeddings");
  return workspace;
};

describe("vector blobs", () => {
  it("round-trips through the layout the scan reads", () => {
    const vector = Float32Array.from([0.5, -1.25, 0, 3.75]);
    expect(blobToVector(vectorToBlob(vector))).toEqual(vector);
  });
});

describe("writeEmbedding", () => {
  /**
   * TEST-844: the identity lands with the vector, in one statement. There is no
   * window in which a vector exists without the identity that produced it —
   * `identity` is `NOT NULL` and this is the only write path.
   */
  it("records the identity in the same row as the vector", () => {
    const ws = open();
    writeEmbedding(ws.db, {
      state: "ready",
      chunkId: "c1",
      identity: "local/all-MiniLM-L6-v2@4",
      vector: Float32Array.from([1, 2, 3, 4]),
      updatedMs: 1_000,
    });

    const row = ws.db
      .prepare("SELECT chunk_id, identity, dim, vec, state, failures FROM chunk_embeddings")
      .get() as {
      chunk_id: string;
      identity: string;
      dim: number;
      vec: Buffer;
      state: string;
      failures: number;
    };

    expect(row).toMatchObject({
      chunk_id: "c1",
      identity: "local/all-MiniLM-L6-v2@4",
      dim: 4,
      state: "ready",
      failures: 0,
    });
    expect(blobToVector(row.vec)).toEqual(Float32Array.from([1, 2, 3, 4]));
  });

  it("makes a vector with no identity unrepresentable, not merely unlikely", () => {
    const ws = open();
    expect(() =>
      ws.db
        .prepare(
          `INSERT INTO chunk_embeddings (chunk_id, identity, dim, vec, state, failures, updated_ms)
           VALUES ('c1', NULL, 3, NULL, 'ready', 0, 1)`,
        )
        .run(),
    ).toThrow(/NOT NULL/);

    expect(() =>
      writeEmbedding(ws.db, {
        state: "ready",
        chunkId: "c1",
        identity: "",
        vector: Float32Array.from([1]),
        updatedMs: 1,
      }),
    ).toThrow(/no identity/);
  });

  it("records a failure as a counted row, with no vector", () => {
    const ws = open();
    writeEmbedding(ws.db, {
      state: "failed",
      chunkId: "c2",
      identity: "local/m@8",
      dim: 8,
      failures: 3,
      updatedMs: 2_000,
    });

    const row = ws.db.prepare("SELECT vec, state, failures FROM chunk_embeddings").get() as {
      vec: Buffer | null;
      state: string;
      failures: number;
    };
    expect(row).toEqual({ vec: null, state: "failed", failures: 3 });
  });

  it("replaces a chunk's row rather than accumulating rows for it", () => {
    const ws = open();
    const base = { chunkId: "c1", identity: "local/m@2", updatedMs: 1 } as const;
    writeEmbedding(ws.db, { ...base, state: "ready", vector: Float32Array.from([1, 1]) });
    writeEmbedding(ws.db, { ...base, state: "ready", vector: Float32Array.from([2, 2]) });

    const rows = ws.db.prepare("SELECT vec FROM chunk_embeddings").all() as { vec: Buffer }[];
    expect(rows).toHaveLength(1);
    expect(blobToVector(rows[0]?.vec ?? Buffer.alloc(0))).toEqual(Float32Array.from([2, 2]));
  });
});

describe("recordedIdentities", () => {
  it("is empty on a fresh workspace — no vectors, no claim", () => {
    const ws = open();
    expect(recordedIdentities(ws.db)).toEqual([]);
    expect(recordedIdentity(ws.db)).toBeNull();
  });

  it("reports the one identity behind an index built by one model", () => {
    const ws = open();
    for (const chunkId of ["a", "b", "c"]) {
      writeEmbedding(ws.db, {
        state: "ready",
        chunkId,
        identity: "local/m@2",
        vector: Float32Array.from([1, 1]),
        updatedMs: 1,
      });
    }
    expect(recordedIdentities(ws.db)).toEqual(["local/m@2"]);
    expect(recordedIdentity(ws.db)).toBe("local/m@2");
  });

  it("surfaces every identity when an index holds more than one", () => {
    const ws = open();
    writeEmbedding(ws.db, {
      state: "ready",
      chunkId: "a",
      identity: "local/m@2",
      vector: Float32Array.from([1, 1]),
      updatedMs: 1,
    });
    writeEmbedding(ws.db, {
      state: "ready",
      chunkId: "b",
      identity: "ollama/n@3",
      vector: Float32Array.from([1, 1, 1]),
      updatedMs: 1,
    });

    expect(recordedIdentities(ws.db)).toEqual(["local/m@2", "ollama/n@3"]);
    // No single answer exists, and inventing one would hide drift `db doctor`
    // has to fail on (SERVER-046).
    expect(recordedIdentity(ws.db)).toBeNull();
  });

  it("counts a failed chunk's identity too — the index is committed to that model", () => {
    const ws = open();
    writeEmbedding(ws.db, {
      state: "failed",
      chunkId: "a",
      identity: "local/m@2",
      failures: 1,
      updatedMs: 1,
    });
    expect(recordedIdentities(ws.db)).toEqual(["local/m@2"]);
  });
});
